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
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
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
    const payload =
      kind === 'PUSH_ORDER'
        ? buildCreateOrderPayload(order as unknown as QianyiOrderSource, {
            shop,
            warehouseId,
            warehouse,
            logistics,
          })
        : { shop, onlineOrderNumber: order.orderNumber };

    await tx.qianyiSyncJob.upsert({
      where: { orderId_kind: { orderId, kind } },
      create: { orderId, kind, requestPayload: payload as Prisma.InputJsonValue },
      update: {
        status: 'PENDING',
        attempts: 0,
        nextAttemptAt: new Date(),
        requestPayload: payload as Prisma.InputJsonValue,
        lastError: null,
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
          const result = await this.client.call(
            job.kind === 'PUSH_ORDER' ? 'CREATE_AND_AUDIT_SALES_ORDER' : 'CLOSE_SALES_ORDER',
            'salesOrder',
            job.requestPayload as Record<string, unknown>,
          );
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

  /** Pulls a FAILED job back into the queue. */
  async retry(jobId: string): Promise<void> {
    await this.prisma.qianyiSyncJob.update({
      where: { id: jobId },
      data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), lastError: null },
    });
    void this.processPending().catch(() => undefined);
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
