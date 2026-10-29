import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { signQianyiRequest } from './qianyi.client.js';
import { readQianyiConfig, type QianyiConfig } from './qianyi.config.js';
import { QianyiInboundService } from './qianyi-inbound.service.js';
import { qianyiEventKey } from './qianyi-event.js';

// Qianyi retries and queue outages can deliver a signed callback days later.
// The archive dedupes by event key, so a late event still applies once; past
// this window it is archived for inspection instead of being applied.
const MAX_CALLBACK_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const STALE_CALLBACK = 'STALE_CALLBACK';
const HANDLED = new Set(['PUSH_ODO_ORDER', 'PUSH_SALES_ORDER_SHIPPING_INFO', 'PUSH_TRACKING_PACKAGE', 'PUSH_RETURN_ORDER_INFO']);

/** Qianyi has sent both 10-digit seconds and 13-digit milliseconds. */
function timestampMs(raw: string): number {
  const value = Number(raw);
  return raw.length <= 10 ? value * 1000 : value;
}

export interface QianyiWebhookFields {
  appId: string;
  serviceType: string;
  bizParam: string;
  timestamp: string;
  sign: string;
}

export interface QianyiWebhookResult {
  ok: boolean;
  duplicated: boolean;
  retryable?: boolean;
  deferred?: boolean;
}

@Injectable()
export class QianyiWebhookService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(QianyiWebhookService.name);
  private readonly config: QianyiConfig;
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(config: ConfigService, private readonly prisma: PrismaService, private readonly inbound: QianyiInboundService) {
    this.config = readQianyiConfig(config);
  }

  onModuleInit(): void {
    if (!this.config.enabled || process.env.NODE_ENV === 'test') return;
    const replay = () => { void this.processDeferred().catch(() => this.logger.error('Deferred callback replay failed')); };
    replay();
    this.timer = setInterval(replay, 30_000);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  allow(clientKey: string, now = Date.now()): boolean {
    if (this.hits.size > 1000) {
      for (const [key, bucket] of this.hits) if (now >= bucket.resetAt) this.hits.delete(key);
    }
    const bucket = this.hits.get(clientKey) ?? { count: 0, resetAt: now + 60_000 };
    if (now >= bucket.resetAt) { bucket.count = 0; bucket.resetAt = now + 60_000; }
    if (bucket.count >= 240) return false;
    bucket.count += 1;
    this.hits.set(clientKey, bucket);
    return true;
  }

  async ingest(fields: QianyiWebhookFields): Promise<QianyiWebhookResult> {
    if (!this.config.secret || fields.appId !== this.config.appId ||
        !/^[a-f0-9]{32}$/i.test(fields.sign) || !/^\d{10,13}$/.test(fields.timestamp) ||
        !/^[A-Z_]{1,60}$/.test(fields.serviceType) || Buffer.byteLength(fields.bizParam) > 65_536) {
      return { ok: false, duplicated: false };
    }
    const expected = signQianyiRequest(fields, this.config.secret);
    if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(fields.sign, 'hex'))) {
      return { ok: false, duplicated: false };
    }
    let payload: Record<string, unknown>;
    let externalKey: string;
    try {
      const parsed: unknown = JSON.parse(fields.bizParam);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, duplicated: false };
      payload = parsed as Record<string, unknown>;
      externalKey = qianyiEventKey(fields.serviceType, payload);
    } catch {
      return { ok: false, duplicated: false };
    }
    const event = await this.prisma.qianyiWebhookEvent.upsert({
      where: { externalKey },
      create: { serviceType: fields.serviceType, signValid: true, externalKey, payload: payload as Prisma.InputJsonValue,
        error: this.config.enabled ? null : 'INTEGRATION_DISABLED' },
      update: {},
    });
    if (Math.abs(Date.now() - timestampMs(fields.timestamp)) > MAX_CALLBACK_AGE_MS) {
      await this.prisma.qianyiWebhookEvent.updateMany({ where: { id: event.id, processedAt: null },
        data: { error: STALE_CALLBACK } });
      return { ok: true, duplicated: false };
    }
    if (!this.config.enabled) {
      await this.prisma.qianyiWebhookEvent.updateMany({ where: { id: event.id, processedAt: null }, data: { error: 'INTEGRATION_DISABLED' } });
      return { ok: true, duplicated: Boolean(event.processedAt), deferred: !event.processedAt };
    }
    return this.processArchived(event.id);
  }

  async processDeferred(): Promise<number> {
    if (!this.config.enabled) return 0;
    const events = await this.prisma.qianyiWebhookEvent.findMany({
      where: { signValid: true, processedAt: null, error: 'INTEGRATION_DISABLED' },
      orderBy: { receivedAt: 'asc' }, take: 50,
    });
    let processed = 0;
    for (const event of events) {
      const result = await this.processArchived(event.id);
      if (result.ok && !result.duplicated) processed += 1;
    }
    return processed;
  }

  private async processArchived(id: string): Promise<QianyiWebhookResult> {
    if (!this.config.enabled) return { ok: true, duplicated: false, deferred: true };
    try {
      return await this.prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM qianyi_webhook_events WHERE id=${id}::uuid FOR UPDATE`;
        const event = await tx.qianyiWebhookEvent.findUniqueOrThrow({ where: { id } });
        if (event.processedAt) return { ok: true, duplicated: true };
        if (!event.signValid) return { ok: false, duplicated: false };
        if (HANDLED.has(event.serviceType)) {
          await this.inbound.handle(event.serviceType, event.payload as Record<string, unknown>, tx);
        }
        await tx.qianyiWebhookEvent.update({ where: { id }, data: { processedAt: new Date(), error: null } });
        return { ok: true, duplicated: false };
      }, { timeout: 20_000, maxWait: 10_000 });
    } catch (error) {
      await this.prisma.qianyiWebhookEvent.updateMany({ where: { id, processedAt: null },
        data: { error: (error as Error).message.slice(0, 1024) } });
      this.logger.error('Qianyi callback transaction failed');
      return { ok: false, duplicated: false, retryable: true };
    }
  }
}
