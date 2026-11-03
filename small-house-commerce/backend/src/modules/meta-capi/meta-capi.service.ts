import {
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { MetaCapiClient, type MetaOutboxEvent } from './meta-capi.client.js';
import { hashMetaPhone, isAdminSource } from './meta-user-data.js';

/** Failure #n waits this many minutes before attempt n+1. */
const RETRY_DELAYS_MINUTES = [1, 5, 15, 60, 360, 720, 1440, 2880];
const MAX_ATTEMPTS = RETRY_DELAYS_MINUTES.length;
const BATCH_SIZE = 25;
const WORKER_INTERVAL_MS = 60_000;
/** Meta accepts events up to 7 days old; rows are kept 30 days for audit. */
const RETENTION_DAYS = 30;
/** Public bridge flood guard, same shape as the analytics sink. */
const RATE_LIMIT_MAX = 120;
const RATE_LIMIT_WINDOW_MS = 60_000;

export interface StoreMetaEventInput {
  eventName: string;
  eventId: string;
  eventTime?: Date;
  eventSourceUrl: string;
  customData: Prisma.InputJsonValue;
  fbp?: string | null;
  fbc?: string | null;
  clientIp?: string | null;
  clientUserAgent?: string | null;
  phoneHash?: string | null;
}

export interface PurchaseOrderLine {
  skuId: string;
  quantity: number;
  unitPrice: number;
}

export interface PurchaseEnqueueInput {
  orderNumber: string;
  items: PurchaseOrderLine[];
  value: number;
  phone: string | null;
  /** The shopper's ads-cookie choice at the time of checkout. */
  consent: boolean;
  fbp?: string | null;
  fbc?: string | null;
  clientIp?: string | null;
  clientUserAgent?: string | null;
  eventSourceUrl: string;
}

/**
 * Durable outbox in front of the Conversions API.
 *
 * Events are written first and delivered by an in-process worker with
 * backoff; a failed delivery keeps the row and retries it, so a Purchase is
 * never lost to a Meta hiccup. The worker is intentionally per-process — the
 * deployment runs one backend container, and a duplicate delivery would be
 * harmless anyway because Meta dedupes on `event_id`.
 */
@Injectable()
export class MetaCapiService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(MetaCapiService.name);
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastPruneDay: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: MetaCapiClient,
  ) {}

  get enabled(): boolean {
    return this.client.enabled;
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

  isRateLimited(clientKey: string): boolean {
    const bucket = this.hits.get(clientKey);
    return Boolean(
      bucket && Date.now() < bucket.resetAt && bucket.count >= RATE_LIMIT_MAX,
    );
  }

  private allowed(clientKey: string): boolean {
    const now = Date.now();
    if (this.hits.size > 1000) {
      for (const [key, bucket] of this.hits) {
        if (now >= bucket.resetAt) this.hits.delete(key);
      }
    }
    const bucket = this.hits.get(clientKey) ?? {
      count: 0,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    };
    if (now >= bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = now + RATE_LIMIT_WINDOW_MS;
    }
    if (bucket.count >= RATE_LIMIT_MAX) {
      this.hits.set(clientKey, bucket);
      return false;
    }
    bucket.count += 1;
    this.hits.set(clientKey, bucket);
    return true;
  }

  /** Charges one event against the caller's minute bucket. */
  takeRateLimitToken(clientKey: string): boolean {
    return this.allowed(clientKey);
  }

  /** Stores one consented browser event; false when nothing was queued. */
  async enqueue(input: StoreMetaEventInput): Promise<boolean> {
    if (!this.client.enabled) return false;
    try {
      await this.prisma.metaConversionEvent.create({
        data: {
          eventName: input.eventName,
          eventId: input.eventId,
          eventTime: input.eventTime ?? new Date(),
          actionSource: 'website',
          eventSourceUrl: input.eventSourceUrl,
          customData: input.customData,
          fbp: input.fbp ?? null,
          fbc: input.fbc ?? null,
          clientIp: input.clientIp ?? null,
          clientUserAgent: input.clientUserAgent ?? null,
          phoneHash: input.phoneHash ?? null,
          status: 'PENDING',
        },
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') return false;
      this.logger.warn(
        `meta event enqueue failed: ${(error as Error).message}`,
      );
      return false;
    }
    // Try immediately; the periodic worker is only the fallback.
    void this.processPending().catch(() => undefined);
    return true;
  }

  /**
   * The money event: enqueued by the order flow after a successful checkout,
   * keyed by `purchase-<orderNumber>` so the success page's Pixel event
   * dedupes against it. Admin-entered orders and unconsented shoppers are
   * never sent.
   */
  async enqueuePurchase(input: PurchaseEnqueueInput): Promise<boolean> {
    if (!input.consent) return false;
    if (!this.client.enabled) return false;
    if (isAdminSource(input.eventSourceUrl)) return false;
    // Keep this shape identical to the browser Purchase event. Meta documents
    // num_items for InitiateCheckout only; adding it here would make the CAPI
    // copy differ from the Pixel copy for the same order.
    const customData: Prisma.InputJsonValue = {
      content_type: 'product',
      order_id: input.orderNumber,
      content_ids: input.items.map((item) => item.skuId),
      contents: input.items.map((item) => ({
        id: item.skuId,
        quantity: item.quantity,
      })),
      value: input.value,
      currency: 'PHP',
    };
    return this.enqueue({
      eventName: 'Purchase',
      eventId: `purchase-${input.orderNumber}`,
      eventSourceUrl: input.eventSourceUrl,
      customData,
      fbp: input.fbp ?? null,
      fbc: input.fbc ?? null,
      clientIp: input.clientIp ?? null,
      clientUserAgent: input.clientUserAgent ?? null,
      phoneHash: input.phone ? hashMetaPhone(input.phone) : null,
    });
  }

  /** Delivers every due row; returns how many were attempted. */
  async processPending(now = new Date()): Promise<number> {
    if (!this.client.enabled || this.running) return 0;
    this.running = true;
    try {
      await this.prune(now);
      const due = await this.prisma.metaConversionEvent.findMany({
        where: { status: 'PENDING', nextAttemptAt: { lte: now } },
        orderBy: { nextAttemptAt: 'asc' },
        take: BATCH_SIZE,
      });
      for (const row of due) {
        try {
          await this.client.send(row as MetaOutboxEvent);
          await this.prisma.metaConversionEvent.update({
            where: { id: row.id },
            data: {
              status: 'SENT',
              attempts: { increment: 1 },
              sentAt: new Date(),
              lastError: null,
            },
          });
        } catch (error) {
          const attempts = row.attempts + 1;
          const failed = attempts >= MAX_ATTEMPTS;
          const delayMinutes = RETRY_DELAYS_MINUTES[attempts - 1] ?? 60;
          await this.prisma.metaConversionEvent.update({
            where: { id: row.id },
            data: {
              status: failed ? 'FAILED' : 'PENDING',
              attempts: { increment: 1 },
              nextAttemptAt: failed
                ? row.nextAttemptAt
                : new Date(now.getTime() + delayMinutes * 60_000),
              lastError: (error as Error).message.slice(0, 1024),
            },
          });
        }
      }
      return due.length;
    } finally {
      this.running = false;
    }
  }

  async health(): Promise<{
    enabled: boolean;
    pending: number;
    failed: number;
    sent24h: number;
    lastSentAt: string | null;
    lastError: string | null;
    lastErrorAt: string | null;
  }> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const pending = await this.prisma.metaConversionEvent.count({
      where: { status: 'PENDING' },
    });
    const failed = await this.prisma.metaConversionEvent.count({
      where: { status: 'FAILED' },
    });
    const sent24h = await this.prisma.metaConversionEvent.count({
      where: { status: 'SENT', sentAt: { gte: since } },
    });
    const lastSent = await this.prisma.metaConversionEvent.findFirst({
      where: { status: 'SENT' },
      orderBy: { sentAt: 'desc' },
      select: { sentAt: true },
    });
    const lastFailure = await this.prisma.metaConversionEvent.findFirst({
      where: { status: 'FAILED' },
      orderBy: { createdAt: 'desc' },
      select: { lastError: true, createdAt: true },
    });
    return {
      enabled: this.client.enabled,
      pending,
      failed,
      sent24h,
      lastSentAt: lastSent?.sentAt?.toISOString() ?? null,
      lastError: lastFailure?.lastError ?? null,
      lastErrorAt: lastFailure?.createdAt?.toISOString() ?? null,
    };
  }

  /** Drops old delivered rows once a day; failed rows stay visible 30 days. */
  private async prune(now: Date): Promise<void> {
    const day = now.toISOString().slice(0, 10);
    if (this.lastPruneDay === day) return;
    this.lastPruneDay = day;
    const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    try {
      await this.prisma.metaConversionEvent.deleteMany({
        where: {
          createdAt: { lt: cutoff },
          status: { in: ['SENT', 'FAILED'] },
        },
      });
    } catch {
      // Pruning is housekeeping; the next daily tick retries it.
    }
  }
}
