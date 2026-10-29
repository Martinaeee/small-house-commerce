import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { QianyiClient, QianyiError } from './qianyi.client.js';
import {
  buildCreateOrderPayload,
  MissingMappingError,
  type QianyiOrderSource,
} from './qianyi-order.mapper.js';
import { readQianyiConfig, type QianyiConfig } from './qianyi.config.js';

const WORKER_INTERVAL_MS = 30_000;
const BATCH_SIZE = 10;
const MAX_ATTEMPTS = 5;
const RETRY_DELAYS_MINUTES = [1, 5, 15, 60];

const ORDER_INCLUDE = {
  items: { include: { sku: true } },
  shippingAddress: true,
  customer: true,
} satisfies Prisma.OrderInclude;

/**
 * Durable outbox for everything we send to Qianyi. The row is written inside
 * the caller's transaction, so a confirmed order can never be lost to a
 * network problem; the worker is the only thing that talks to the API.
 */
@Injectable()
export class QianyiSyncService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(QianyiSyncService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private readonly config: QianyiConfig;

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: QianyiClient,
    config: ConfigService,
  ) {
    this.config = readQianyiConfig(config);
  }

  onModuleInit(): void {
    if (!this.client.enabled || process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      void this.processPending().catch(() => undefined);
    }, WORKER_INTERVAL_MS);
    this.timer.unref?.();
    this.reconcileTimer = setInterval(() => {
      void this.reconcile().catch(() => undefined);
    }, 24 * 60 * 60 * 1000);
    this.reconcileTimer.unref?.();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    this.timer = null;
    this.reconcileTimer = null;
  }

  /** Queues the push for a freshly confirmed order. Call inside the tx. */
  async enqueue(
    tx: Prisma.TransactionClient,
    kind: 'PUSH_ORDER' | 'CLOSE_ORDER',
    orderId: string,
  ): Promise<void> {
    if (!this.client.enabled) return;
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: ORDER_INCLUDE,
    });
    if (!order) return;

    const { shop, warehouseId, warehouse, logistics } = this.config;
    // A missing mapping must never break the confirmation the operator just
    // made: the order is confirmed, the push is recorded as SKIPPED, and the
    // admin shows it in the unmatched list.
    let skipped: string | null = null;
    let payload: Record<string, unknown>;
    try {
      payload =
        kind === 'PUSH_ORDER'
          ? buildCreateOrderPayload(order as unknown as QianyiOrderSource, {
              shop,
              warehouseId,
              warehouse,
              logistics,
            })
          : { shop, onlineOrderNumber: order.orderNumber };
    } catch (error) {
      if (!(error instanceof MissingMappingError)) throw error;
      skipped = error.message;
      payload = { shop, onlineOrderNumber: order.orderNumber };
    }
    const lastError = skipped ? skipped.slice(0, 1024) : null;

    await tx.qianyiSyncJob.upsert({
      where: { orderId_kind: { orderId, kind } },
      create: {
        orderId,
        kind,
        requestPayload: payload as Prisma.InputJsonValue,
        status: skipped ? 'SKIPPED' : undefined,
        lastError,
      },
      update: {
        status: skipped ? 'SKIPPED' : 'PENDING',
        attempts: 0,
        nextAttemptAt: new Date(),
        requestPayload: payload as Prisma.InputJsonValue,
        lastError,
      },
    });
  }

  /** Delivers every due job; returns how many were attempted. */
  async processPending(now = new Date()): Promise<number> {
    if (!this.client.enabled || this.running) return 0;
    this.running = true;
    try {
      const due = await this.prisma.qianyiSyncJob.findMany({
        where: { status: 'PENDING', nextAttemptAt: { lte: now } },
        orderBy: { nextAttemptAt: 'asc' },
        take: BATCH_SIZE,
      });
      for (const job of due) {
        try {
          // A retry can follow a timeout where Qianyi DID create the order.
          // Ask first, so the retry adopts it instead of creating a second one.
          const existing =
            job.kind === 'PUSH_ORDER' && job.attempts > 0
              ? await this.findExistingOrder(job.requestPayload)
              : null;
          if (existing) {
            await this.markSent(job, existing);
            continue;
          }
          const result = await this.client.call(
            job.kind === 'PUSH_ORDER' ? 'CREATE_AND_AUDIT_SALES_ORDER' : 'CLOSE_SALES_ORDER',
            'salesOrder',
            job.requestPayload as Record<string, unknown>,
          );
          await this.markSent(job, result);
        } catch (error) {
          const attempts = job.attempts + 1;
          const failed = attempts >= MAX_ATTEMPTS || error instanceof MissingMappingError;
          const delayMinutes = RETRY_DELAYS_MINUTES[attempts - 1] ?? 60;
          await this.prisma.qianyiSyncJob.update({
            where: { id: job.id },
            data: {
              status: failed ? 'FAILED' : 'PENDING',
              attempts: { increment: 1 },
              nextAttemptAt: failed
                ? job.nextAttemptAt
                : new Date(now.getTime() + delayMinutes * 60_000),
              // Keep the Qianyi error code: it is what the operator acts on.
              lastError: (
                error instanceof QianyiError
                  ? `${error.errorCode}: ${error.message}`
                  : (error as Error).message
              ).slice(0, 1024),
            },
          });
        }
      }
      return due.length;
    } finally {
      this.running = false;
    }
  }

  /** Which Qianyi order number, if any, already exists for this online order. */
  private async findExistingOrder(payload: unknown): Promise<{ orderNumber?: string } | null> {
    const onlineOrderNumber = String(
      (payload as { onlineOrderNumber?: string } | null)?.onlineOrderNumber ?? '',
    );
    if (!onlineOrderNumber) return null;
    const rows = (await this.client.call('QUERY_SALES_ORDER_LIST', 'salesOrder', {
      onlineOrderNumber,
      page: 1,
      pageSize: 1,
    })) as Array<{ orderNumber?: string }> | null;
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  }

  private async markSent(job: { id: string; orderId: string }, result: unknown): Promise<void> {
    const external = (result as { orderNumber?: string } | null)?.orderNumber ?? null;
    await this.prisma.qianyiSyncJob.update({
      where: { id: job.id },
      data: {
        status: 'SENT',
        attempts: { increment: 1 },
        sentAt: new Date(),
        lastError: null,
        responsePayload: (result ?? null) as Prisma.InputJsonValue,
        externalOrderNumber: external,
      },
    });
    if (external) {
      await this.prisma.order.update({
        where: { id: job.orderId },
        data: { qianyiOrderNumber: external },
      });
    }
  }

  /**
   * Re-queues a SKIPPED push once every line carries a Qianyi code.
   *
   * `attempts` is set to 1 on purpose: the worker then asks Qianyi whether the
   * online order number already exists before creating anything, so a requeue
   * can never produce a second order. The original reason is kept verbatim and
   * the operator who did it is written to the order.
   */
  async requeueSkipped(
    jobId: string,
    operatorId: string,
  ): Promise<{ ok: boolean; missing?: string[]; reason?: string }> {
    const job = await this.prisma.qianyiSyncJob.findUnique({ where: { id: jobId } });
    if (!job) return { ok: false, reason: 'job not found' };
    if (job.kind !== 'PUSH_ORDER' || job.status !== 'SKIPPED') {
      return {
        ok: false,
        reason: `only a SKIPPED push can be requeued (this job is ${job.status})`,
      };
    }

    const order = await this.prisma.order.findUnique({
      where: { id: job.orderId },
      include: ORDER_INCLUDE,
    });
    if (!order) return { ok: false, reason: 'order not found' };

    const { shop, warehouseId, warehouse, logistics } = this.config;
    let payload: Record<string, unknown>;
    try {
      payload = buildCreateOrderPayload(order as unknown as QianyiOrderSource, {
        shop,
        warehouseId,
        warehouse,
        logistics,
      });
    } catch (error) {
      if (error instanceof MissingMappingError) return { ok: false, missing: error.skuCodes };
      throw error;
    }

    const previous = job.lastError ? ` (was: ${job.lastError})` : '';
    await this.prisma.qianyiSyncJob.update({
      where: { id: jobId },
      data: {
        status: 'PENDING',
        attempts: 1,
        nextAttemptAt: new Date(),
        requestPayload: payload as Prisma.InputJsonValue,
        lastError: `requeued from SKIPPED${previous}`.slice(0, 1024),
      },
    });
    await this.prisma.orderNote.create({
      data: {
        orderId: job.orderId,
        userId: operatorId,
        noteType: 'SYSTEM',
        content: `Qianyi push requeued after the SKU mapping was completed${previous}`.slice(0, 2000),
      },
    });
    void this.processPending().catch(() => undefined);
    return { ok: true };
  }

  /**
   * Pulls a FAILED job back into the queue.
   *
   * `attempts` is set to 1 so the worker's "does Qianyi already have this
   * order?" check runs first — a FAILED push may have failed *after* Qianyi
   * created the order.
   */
  async retry(jobId: string): Promise<void> {
    const job = await this.prisma.qianyiSyncJob.findUnique({ where: { id: jobId } });
    const previous = job?.lastError ? ` (was: ${job.lastError})` : '';
    await this.prisma.qianyiSyncJob.update({
      where: { id: jobId },
      data: {
        status: 'PENDING',
        attempts: 1,
        nextAttemptAt: new Date(),
        lastError: job
          ? `requeued from ${job.status}${previous}`.slice(0, 1024)
          : null,
      },
    });
    void this.processPending().catch(() => undefined);
  }

  /**
   * Daily safety net. Qianyi is the source of truth for outbound numbers, but
   * reconciliation only *flags*: writing a note lets the operator confirm
   * before anything moves, and stops another channel's tracking number being
   * attached to our order.
   */
  async reconcile(
    now = new Date(),
  ): Promise<{ checked: number; repaired: number; unmatched: number }> {
    if (!this.client.enabled) return { checked: 0, repaired: 0, unmatched: 0 };

    // Archive retention. The webhook table is append-only; without this it
    // grows forever. Optional-chained so a deploy that outruns its migration
    // cannot take the reconciliation down with it.
    await this.prisma.qianyiWebhookEvent?.deleteMany?.({
      where: { receivedAt: { lt: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000) } },
    });
    const from = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const fmt = (date: Date) =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Manila',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })
        .format(date)
        .replace(',', '');

    let page = 1;
    let checked = 0;
    let unmatched = 0;
    for (;;) {
      const rows = (await this.client.call('QUERY_SALES_ORDER_LIST', 'salesOrder', {
        updateTimeFrom: fmt(from),
        updateTimeTo: fmt(now),
        page,
        pageSize: 100,
      })) as Array<Record<string, unknown>> | null;
      if (!Array.isArray(rows) || rows.length === 0) break;
      checked += rows.length;
      for (const row of rows) {
        const online = String(row.onlineOrderNumber ?? '');
        const tracking = row.trackingNumber ? String(row.trackingNumber) : '';
        if (!online || !tracking) continue;
        const order = await this.prisma.order.findUnique({
          where: { orderNumber: online },
          include: { shipments: true },
        });
        if (!order) {
          // Qianyi has a shipment for an order we do not know about — either a
          // typo on their side or a local deletion. Say so instead of skipping.
          unmatched += 1;
          this.logger.warn(
            `qianyi reconcile: ${online} exists in Qianyi but not locally (tracking ${tracking})`,
          );
          continue;
        }
        if (order.shipments.some((shipment) => shipment.trackingNumber === tracking)) {
          continue;
        }
        await this.prisma.orderNote.create({
          data: {
            orderId: order.id,
            noteType: 'WAREHOUSE',
            content: `Reconciliation: Qianyi reports tracking ${tracking} not present locally`,
          },
        });
      }
      if (rows.length < 100) break;
      page += 1;
      if (page > 30) break;
    }
    return { checked, repaired: 0, unmatched };
  }

  async health(): Promise<{
    enabled: boolean;
    pending: number;
    failed: number;
    sent24h: number;
  }> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return {
      enabled: this.client.enabled,
      pending: await this.prisma.qianyiSyncJob.count({ where: { status: 'PENDING' } }),
      failed: await this.prisma.qianyiSyncJob.count({ where: { status: 'FAILED' } }),
      sent24h: await this.prisma.qianyiSyncJob.count({
        where: { status: 'SENT', sentAt: { gte: since } },
      }),
    };
  }
}
