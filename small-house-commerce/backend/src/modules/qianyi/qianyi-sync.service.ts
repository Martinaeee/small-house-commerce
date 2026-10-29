import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { QianyiClient } from './qianyi.client.js';
import { buildCreateOrderPayload, MissingMappingError } from './qianyi-order.mapper.js';
import { readQianyiConfig, type QianyiConfig } from './qianyi.config.js';

const WORKER_INTERVAL_MS = 30_000;
const BATCH_SIZE = 10;
const MAX_CLOSE_ATTEMPTS = 5;
const CLOSE_BACKOFF_MINUTES = [1, 5, 15, 60];
const SENDING_LEASE_MS = 10 * 60 * 1000;
const ORDER_INCLUDE = { items: { include: { sku: true } }, shippingAddress: true, customer: true } satisfies Prisma.OrderInclude;
const PUSHABLE = new Set(['CONFIRMED', 'SHIPPING']);

type Job = Prisma.QianyiSyncJobGetPayload<object>;
type Result = { ok: boolean; reason?: string; missing?: string[] };

@Injectable()
export class QianyiSyncService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(QianyiSyncService.name);
  private readonly config: QianyiConfig;
  private timer: ReturnType<typeof setInterval> | null = null;
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly prisma: PrismaService, private readonly client: QianyiClient, config: ConfigService) {
    this.config = readQianyiConfig(config);
  }

  onModuleInit(): void {
    if (!this.client.enabled || process.env.NODE_ENV === 'test') return;
    const tick = () => { void this.processPending().catch(() => this.logger.error('Qianyi worker tick failed')); };
    tick();
    this.timer = setInterval(tick, WORKER_INTERVAL_MS);
    this.timer.unref();
    this.reconcileTimer = setInterval(() => { void this.reconcile().catch(() => this.logger.error('Qianyi reconcile failed')); }, 24 * 60 * 60 * 1000);
    this.reconcileTimer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    this.timer = null;
    this.reconcileTimer = null;
  }

  /** Queues the push inside the caller's transaction. */
  async enqueue(tx: Prisma.TransactionClient, kind: 'PUSH_ORDER' | 'CLOSE_ORDER', orderId: string): Promise<void> {
    if (!this.client.enabled) return;
    const order = await tx.order.findUnique({ where: { id: orderId }, include: ORDER_INCLUDE });
    if (!order) return;
    const { shop, warehouseId, warehouse, logistics } = this.config;
    let skipped: string | null = null;
    let payload: Record<string, unknown>;
    try {
      if (kind === 'PUSH_ORDER') {
        payload = buildCreateOrderPayload(order, { shop, warehouseId, warehouse, logistics });
        payload._skuMapping = Object.fromEntries(order.items.map(item => [item.id, item.sku.qianyiSkuCode!.trim()]));
      } else {
        payload = { shop, onlineOrderNumber: order.orderNumber };
      }
    } catch (error) {
      if (!(error instanceof MissingMappingError)) throw error;
      skipped = error.message;
      payload = { shop, onlineOrderNumber: order.orderNumber };
    }
    const existing = await tx.qianyiSyncJob.findUnique({ where: { orderId_kind: { orderId, kind } } });
    if (existing && ['SENT', 'SENDING', 'CANCELLED'].includes(existing.status)) return;
    await tx.qianyiSyncJob.upsert({
      where: { orderId_kind: { orderId, kind } },
      create: { orderId, kind, requestPayload: payload as Prisma.InputJsonValue, status: skipped ? 'SKIPPED' : 'PENDING', lastError: skipped?.slice(0, 1024) },
      // A re-confirmation must not silently reactivate a job that needs review.
      update: existing?.pendingReview ? {} : {
        status: skipped ? 'SKIPPED' : 'PENDING', attempts: 0, autoCreateAttempts: 0, pendingReview: false,
        claimedAt: null, nextAttemptAt: new Date(), requestPayload: payload as Prisma.InputJsonValue, lastError: skipped?.slice(0, 1024),
      },
    });
  }

  /** Recovers jobs whose worker died between claim and confirmation. */
  async recoverStaleSends(now = new Date()): Promise<number> {
    const stale = await this.prisma.qianyiSyncJob.findMany({
      where: { status: 'SENDING', claimedAt: { lt: new Date(now.getTime() - SENDING_LEASE_MS) } },
      take: 50,
    });
    for (const job of stale) {
      await this.prisma.$transaction(async tx => {
        const changed = await tx.qianyiSyncJob.updateMany({ where: { id: job.id, status: 'SENDING' }, data: {
          status: 'FAILED', pendingReview: true, claimedAt: null,
          lastError: 'OUTCOME_UNKNOWN: the worker stopped during the request; reconcile in Qingyi before any retry',
        } });
        if (changed.count) await tx.orderNote.create({ data: { orderId: job.orderId, noteType: 'SYSTEM',
          content: 'Qianyi push interrupted during the request. Automatic retry is blocked; verify the order in Qianyi first.' } });
      });
    }
    return stale.length;
  }

  async processPending(now = new Date()): Promise<number> {
    if (!this.client.enabled) return 0;
    await this.recoverStaleSends(now);
    const claimed = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      UPDATE qianyi_sync_jobs SET status='SENDING', claimed_at=${now}, attempts=attempts+1
      WHERE id IN (SELECT id FROM qianyi_sync_jobs WHERE status='PENDING' AND next_attempt_at<=${now}
        ORDER BY next_attempt_at ASC FOR UPDATE SKIP LOCKED LIMIT ${BATCH_SIZE})
      RETURNING id`);
    for (const { id } of claimed) await this.deliver(id, now);
    return claimed.length;
  }

  private async deliver(id: string, now: Date): Promise<void> {
    const job = await this.prisma.qianyiSyncJob.findUniqueOrThrow({ where: { id } });
    try {
      if (job.kind === 'PUSH_ORDER') await this.deliverPush(job, now);
      else await this.deliverClose(job, now);
    } catch (error) {
      await this.prisma.$transaction(async tx => {
        await tx.qianyiSyncJob.update({ where: { id }, data: {
          status: 'FAILED', pendingReview: true, claimedAt: null,
          lastError: `${error instanceof Error ? error.message : 'unknown failure'}; verify the outcome in Qianyi before retrying`.slice(0, 1024),
        } });
        await tx.orderNote.create({ data: { orderId: job.orderId, noteType: 'SYSTEM',
          content: 'Qianyi delivery failed after dispatch. Automatic retry is blocked; reconcile the order in Qianyi.' } });
      });
    }
  }

  private async deliverPush(job: Job, now: Date): Promise<void> {
    const order = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM orders WHERE id=${job.orderId}::uuid FOR UPDATE`;
      return tx.order.findUnique({ where: { id: job.orderId }, include: ORDER_INCLUDE });
    });
    if (!order) return this.finish(job, { status: 'FAILED', lastError: 'ORDER_MISSING' });
    if (!PUSHABLE.has(order.orderStatus) || order.confirmationStatus !== 'CONFIRMED') {
      return this.finish(job, { status: 'FAILED', lastError: `ORDER_NOT_PUSHABLE: ${order.orderStatus}/${order.confirmationStatus}` });
    }
    let payload: Record<string, unknown>;
    try {
      payload = buildCreateOrderPayload(order, this.config);
    } catch (error) {
      if (!(error instanceof MissingMappingError)) throw error;
      return this.finish(job, { status: 'SKIPPED', lastError: error.message.slice(0, 1024), requestPayload: { shop: this.config.shop, onlineOrderNumber: order.orderNumber } });
    }
    const frozen = (job.requestPayload as Record<string, unknown> | null)?._skuMapping;
    if (frozen && typeof frozen === 'object') payload._skuMapping = frozen;
    else payload._skuMapping = Object.fromEntries(order.items.map(item => [item.id, item.sku.qianyiSkuCode!.trim()]));

    const existing = await this.findExistingOrder(payload);
    if (existing) return this.markSent(job, existing, payload);

    const granted = await this.prisma.qianyiSyncJob.updateMany({
      where: { id: job.id, status: 'SENDING', autoCreateAttempts: 0 },
      data: { autoCreateAttempts: 1, requestPayload: payload as Prisma.InputJsonValue },
    });
    if (granted.count === 0) {
      return this.finish(job, { status: 'FAILED', pendingReview: true, requestPayload: payload as Prisma.InputJsonValue,
        lastError: 'OUTCOME_UNKNOWN: a create was already dispatched; reconcile in Qianyi, then authorize a retry if it is absent' });
    }
    const result = await this.client.call('CREATE_AND_AUDIT_SALES_ORDER', 'salesOrder', payload);
    await this.markSent(job, result, payload);
  }

  private async deliverClose(job: Job, now: Date): Promise<void> {
    const result = await this.client.call('CLOSE_SALES_ORDER', 'salesOrder', job.requestPayload as Record<string, unknown>);
    await this.finish(job, { status: 'SENT', externalOrderNumber: (result as { orderNumber?: string })?.orderNumber ?? null });
  }

  private async finish(job: Job, data: Prisma.QianyiSyncJobUpdateInput): Promise<void> {
    const closing = job.kind === 'CLOSE_ORDER';
    const attempts = data.status === 'SENT' || !closing ? job.attempts : job.attempts + 1;
    const failed = closing && attempts >= MAX_CLOSE_ATTEMPTS;
    await this.prisma.qianyiSyncJob.update({ where: { id: job.id }, data: {
      ...data, claimedAt: null,
      status: data.status ?? (failed ? 'FAILED' : 'PENDING'),
      nextAttemptAt: failed ? job.nextAttemptAt : new Date(Date.now() + (CLOSE_BACKOFF_MINUTES[attempts - 1] ?? 60) * 60_000),
    } });
    if (data.status === 'SKIPPED') {
      await this.prisma.orderNote.create({ data: { orderId: job.orderId, noteType: 'SYSTEM',
        content: `Qianyi push skipped: ${String(data.lastError ?? '').slice(0, 500)}` } });
    }
  }

  private async markSent(job: Job | { id: string; orderId: string }, result: unknown, request?: Record<string, unknown>): Promise<void> {
    const external = (result as { orderNumber?: string } | null)?.orderNumber ?? null;
    await this.prisma.$transaction(async tx => {
      await tx.qianyiSyncJob.update({ where: { id: job.id }, data: {
        status: 'SENT', claimedAt: null, sentAt: new Date(), lastError: null, pendingReview: false,
        responsePayload: (result ?? null) as Prisma.InputJsonValue, externalOrderNumber: external,
        ...(request ? { requestPayload: request as Prisma.InputJsonValue } : {}),
      } });
      if (external) await tx.order.update({ where: { id: job.orderId }, data: { qianyiOrderNumber: external } });
    });
  }

  private async findExistingOrder(payload: Record<string, unknown>): Promise<{ orderNumber?: string } | null> {
    const onlineOrderNumber = String(payload.onlineOrderNumber ?? '');
    if (!onlineOrderNumber) return null;
    const rows = (await this.client.call('QUERY_SALES_ORDER_LIST', 'salesOrder', {
      shop: this.config.shop, onlineOrderNumber, page: 1, pageSize: 5,
    })) as Array<Record<string, unknown>> | null;
    const matches = (Array.isArray(rows) ? rows : []).filter(row => row.onlineOrderNumber === onlineOrderNumber &&
      (row.shop === undefined || row.shop === this.config.shop) &&
      (row.payAmount === undefined || `${row.payAmount}` === `${payload.codPayAmount}`));
    return matches.length === 1 ? matches[0] as { orderNumber?: string } : null;
  }

  /** Re-queues a SKIPPED push once every line carries a mapping. */
  async requeueSkipped(jobId: string, operatorId: string): Promise<Result> {
    const job = await this.prisma.qianyiSyncJob.findUnique({ where: { id: jobId } });
    if (!job) return { ok: false, reason: 'job not found' };
    if (job.kind !== 'PUSH_ORDER' || job.status !== 'SKIPPED' || job.autoCreateAttempts > 0 || job.pendingReview) {
      return { ok: false, reason: 'only a never-sent SKIPPED push can be requeued' };
    }
    const order = await this.prisma.order.findUnique({ where: { id: job.orderId }, include: ORDER_INCLUDE });
    if (!order || !PUSHABLE.has(order.orderStatus)) return { ok: false, reason: `order is ${order?.orderStatus ?? 'missing'}` };
    try {
      buildCreateOrderPayload(order, this.config);
    } catch (error) {
      if (error instanceof MissingMappingError) return { ok: false, missing: error.skuCodes };
      throw error;
    }
    const previous = job.lastError ? ` (was: ${job.lastError})` : '';
    await this.prisma.$transaction(async tx => {
      const changed = await tx.qianyiSyncJob.updateMany({ where: { id: jobId, status: 'SKIPPED', pendingReview: false },
        data: { status: 'PENDING', attempts: 0, autoCreateAttempts: 0, claimedAt: null, nextAttemptAt: new Date(),
          lastError: `requeued from SKIPPED${previous}`.slice(0, 1024), lastAction: `requeued by ${operatorId}` } });
      if (!changed.count) throw new Error('Job state changed; reload and retry');
      await tx.orderNote.create({ data: { orderId: job.orderId, userId: operatorId, noteType: 'SYSTEM',
        content: `Qianyi push requeued after the SKU mapping was completed${previous}`.slice(0, 2000) } });
    });
    void this.processPending().catch(() => undefined);
    return { ok: true };
  }

  /** Requeues a FAILED job that never dispatched a create, with an audit note. */
  async retry(jobId: string, operatorId: string): Promise<Result> {
    const job = await this.prisma.qianyiSyncJob.findUnique({ where: { id: jobId } });
    if (!job) return { ok: false, reason: 'job not found' };
    if (job.status !== 'FAILED' || job.pendingReview || job.autoCreateAttempts > 0) {
      return { ok: false, reason: 'this failure may have reached Qianyi; reconcile it, then authorize a create retry' };
    }
    const previous = job.lastError ? ` (was: ${job.lastError})` : '';
    await this.prisma.$transaction(async tx => {
      await tx.qianyiSyncJob.update({ where: { id: jobId }, data: { status: 'PENDING', attempts: 0, autoCreateAttempts: 0,
        claimedAt: null, nextAttemptAt: new Date(), lastError: `requeued from FAILED${previous}`.slice(0, 1024),
        lastAction: `retried by ${operatorId}` } });
      await tx.orderNote.create({ data: { orderId: job.orderId, userId: operatorId, noteType: 'SYSTEM',
        content: `Qianyi ${job.kind} requeued by operator${previous}`.slice(0, 2000) } });
    });
    void this.processPending().catch(() => undefined);
    return { ok: true };
  }

  /** Opens a create again ONLY after the operator confirmed it is absent in Qianyi. */
  async authorizeCreateRetry(jobId: string, operatorId: string, confirmedAbsent: boolean): Promise<Result> {
    if (!confirmedAbsent) return { ok: false, reason: 'operator must confirm the order is absent in Qianyi' };
    const job = await this.prisma.qianyiSyncJob.findUnique({ where: { id: jobId } });
    if (!job || job.kind !== 'PUSH_ORDER') return { ok: false, reason: 'not a push job' };
    if (job.status !== 'FAILED' || !job.pendingReview || job.autoCreateAttempts === 0) {
      return { ok: false, reason: 'this job does not need an authorized create retry' };
    }
    await this.prisma.$transaction(async tx => {
      const changed = await tx.qianyiSyncJob.updateMany({ where: { id: jobId, status: 'FAILED', pendingReview: true },
        data: { status: 'PENDING', attempts: 0, autoCreateAttempts: 0, pendingReview: false, claimedAt: null,
          nextAttemptAt: new Date(), lastError: `create retry authorized after manual reconciliation by ${operatorId}`.slice(0, 1024),
          lastAction: `create retry authorized by ${operatorId}` } });
      if (!changed.count) throw new Error('Job state changed; reload and retry');
      await tx.orderNote.create({ data: { orderId: job.orderId, userId: operatorId, noteType: 'SYSTEM',
        content: 'Operator confirmed no Qianyi order exists; one new create was authorized.' } });
    });
    void this.processPending().catch(() => undefined);
    return { ok: true };
  }

  /** Runs inside the cancel transaction. */
  async cancelWithin(tx: Prisma.TransactionClient, orderId: string, operatorId: string): Promise<'none' | 'cancelled' | 'review' | 'close'> {
    if (!this.client.enabled) return 'none';
    const job = await tx.qianyiSyncJob.findUnique({ where: { orderId_kind: { orderId, kind: 'PUSH_ORDER' } } });
    if (!job) return 'none';
    if (job.status === 'SENT') {
      await this.enqueue(tx, 'CLOSE_ORDER', orderId);
      return 'close';
    }
    if (job.status === 'SENDING') {
      await tx.qianyiSyncJob.update({ where: { id: job.id }, data: { status: 'FAILED', pendingReview: true, claimedAt: null,
        lastError: 'OUTCOME_UNKNOWN: cancelled while the create was in flight',
        lastAction: `cancelled by ${operatorId}` } });
      return 'review';
    }
    if (job.status === 'PENDING' || job.status === 'SKIPPED' || job.status === 'FAILED') {
      await tx.qianyiSyncJob.update({ where: { id: job.id }, data: { status: 'CANCELLED', claimedAt: null,
        lastAction: `cancelled by ${operatorId} from ${job.status}` } });
      return 'cancelled';
    }
    return 'none';
  }

  async reconcile(now = new Date()): Promise<{ checked: number; repaired: number; unmatched: number }> {
    if (!this.client.enabled) return { checked: 0, repaired: 0, unmatched: 0 };
    await this.prisma.qianyiWebhookEvent.deleteMany({ where: { receivedAt: { lt: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000) }, processedAt: { not: null } } });
    const from = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const fmt = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date).replace(',', '');
    let page = 1, checked = 0, unmatched = 0;
    for (;;) {
      const rows = (await this.client.call('QUERY_SALES_ORDER_LIST', 'salesOrder', {
        shop: this.config.shop, updateTimeFrom: fmt(from), updateTimeTo: fmt(now), page, pageSize: 100,
      })) as Array<Record<string, unknown>> | null;
      if (!Array.isArray(rows) || rows.length === 0) break;
      checked += rows.length;
      for (const row of rows) {
        const online = String(row.onlineOrderNumber ?? '');
        const tracking = row.trackingNumber ? String(row.trackingNumber) : '';
        if (!online || !tracking) continue;
        const order = await this.prisma.order.findUnique({ where: { orderNumber: online }, include: { shipments: true } });
        if (!order) { unmatched += 1; continue; }
        if (order.shipments.some(box => box.trackingNumber === tracking)) continue;
        await this.prisma.orderNote.create({ data: { orderId: order.id, noteType: 'WAREHOUSE',
          content: `Reconciliation: Qianyi reports tracking ${tracking} not present locally` } });
      }
      if (rows.length < 100 || page >= 30) break;
      page += 1;
    }
    return { checked, repaired: 0, unmatched };
  }

  async health() {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return {
      enabled: this.client.enabled,
      pending: await this.prisma.qianyiSyncJob.count({ where: { status: { in: ['PENDING', 'SENDING'] } } }),
      failed: await this.prisma.qianyiSyncJob.count({ where: { status: 'FAILED' } }),
      review: await this.prisma.qianyiSyncJob.count({ where: { pendingReview: true } }),
      sent24h: await this.prisma.qianyiSyncJob.count({ where: { status: 'SENT', sentAt: { gte: since } } }),
    };
  }
}
