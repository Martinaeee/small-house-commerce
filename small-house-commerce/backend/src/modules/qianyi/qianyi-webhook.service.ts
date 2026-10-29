import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { signQianyiRequest } from './qianyi.client.js';
import { readQianyiConfig, type QianyiConfig } from './qianyi.config.js';
import { QianyiInboundService } from './qianyi-inbound.service.js';

/**
 * How far a callback timestamp may drift.
 *
 * 千易 retries land hours after the event, so a 15-minute window would drop
 * legitimate business callbacks. The signature is the security boundary; this
 * window only bounds how long a captured request stays replayable, and every
 * business write is idempotent.
 */
const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

/** Per-IP budget for the public endpoint. 千易 sends a handful per order. */
const RATE_LIMIT_MAX = 240;
const RATE_WINDOW_MS = 60 * 1000;

const HANDLED = new Set([
  'PUSH_ODO_ORDER',
  'PUSH_SALES_ORDER_SHIPPING_INFO',
  'PUSH_TRACKING_PACKAGE',
  'PUSH_RETURN_ORDER_INFO',
]);

export interface QianyiWebhookFields {
  appId: string;
  serviceType: string;
  bizParam: string;
  timestamp: string;
  sign: string;
}

/**
 * Verifies and dispatches Qianyi callbacks.
 *
 * Every callback is archived before dispatch — including ones we reject — so a
 * bad signature or an unknown service type can be inspected later instead of
 * disappearing. A repeated callback is acknowledged without running twice.
 */
@Injectable()
export class QianyiWebhookService {
  private readonly logger = new Logger(QianyiWebhookService.name);
  private readonly config: QianyiConfig;
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly inbound: QianyiInboundService,
  ) {
    this.config = readQianyiConfig(config);
  }

  /**
   * Cheap per-IP budget checked BEFORE any parsing, so an unauthenticated
   * caller cannot make us hash, parse and query on every request.
   */
  allow(clientKey: string, now = Date.now()): boolean {
    if (this.hits.size > 1000) {
      for (const [key, bucket] of this.hits) {
        if (now >= bucket.resetAt) this.hits.delete(key);
      }
    }
    const bucket = this.hits.get(clientKey) ?? {
      count: 0,
      resetAt: now + RATE_WINDOW_MS,
    };
    if (now >= bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = now + RATE_WINDOW_MS;
    }
    if (bucket.count >= RATE_LIMIT_MAX) {
      this.hits.set(clientKey, bucket);
      return false;
    }
    bucket.count += 1;
    this.hits.set(clientKey, bucket);
    return true;
  }

  async ingest(
    fields: QianyiWebhookFields,
  ): Promise<{ ok: boolean; duplicated: boolean; retryable?: boolean }> {
    const expected = signQianyiRequest(
      {
        appId: fields.appId,
        bizParam: fields.bizParam,
        serviceType: fields.serviceType,
        timestamp: fields.timestamp,
      },
      this.config.secret,
    );
    const skew = Math.abs(Date.now() - Number(fields.timestamp));
    const signValid =
      Boolean(this.config.secret) && expected === fields.sign && skew <= MAX_CLOCK_SKEW_MS;

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(fields.bizParam) as Record<string, unknown>;
    } catch {
      payload = { raw: fields.bizParam };
    }

    const externalKey = this.externalKey(fields.serviceType, payload);

    if (!signValid) {
      // Deliberately NOT archived: this endpoint is public, and writing a row
      // per unauthenticated request would let anyone grow the table. The log
      // line names the callback type only — never the payload or the app id.
      this.logger.warn(
        `qianyi webhook rejected: ${fields.serviceType || '(no serviceType)'}`,
      );
      return { ok: false, duplicated: false };
    }

    const seen = await this.prisma.qianyiWebhookEvent.findUnique({ where: { externalKey } });
    // Only a callback we actually FINISHED counts as a duplicate. A row left
    // with `processedAt = null` is a failed dispatch, and Qianyi's retry must
    // be allowed to run it again.
    if (seen?.processedAt) return { ok: true, duplicated: true };

    if (!seen) {
      try {
        await this.prisma.qianyiWebhookEvent.create({
          data: {
            serviceType: fields.serviceType,
            signValid: true,
            externalKey,
            payload: payload as Prisma.InputJsonValue,
          },
        });
      } catch (error) {
        // A concurrent copy of the same callback won the insert. It owns the
        // dispatch, so we acknowledge and stop rather than run it twice.
        if ((error as { code?: string }).code === 'P2002') {
          return { ok: true, duplicated: true };
        }
        throw error;
      }
    }

    if (!HANDLED.has(fields.serviceType)) {
      // Unknown types are archived and acknowledged: a non-2xx would make
      // Qianyi retry a callback we will never understand.
      await this.prisma.qianyiWebhookEvent.update({
        where: { externalKey },
        data: { processedAt: new Date() },
      });
      return { ok: true, duplicated: false };
    }

    try {
      await this.inbound.handle(fields.serviceType, payload);
    } catch (error) {
      // Keep the row (so the payload is still inspectable) but leave it
      // unfinished, and tell the caller to retry: swallowing this would lose
      // the shipment permanently.
      await this.prisma.qianyiWebhookEvent.update({
        where: { externalKey },
        data: { error: (error as Error).message.slice(0, 1024) },
      });
      this.logger.error(
        `qianyi ${fields.serviceType} dispatch failed: ${(error as Error).message}`,
      );
      return { ok: false, duplicated: false, retryable: true };
    }

    await this.prisma.qianyiWebhookEvent.update({
      where: { externalKey },
      data: { processedAt: new Date(), error: null },
    });
    return { ok: true, duplicated: false };
  }

  /**
   * Event fingerprint used as the idempotency key.
   *
   * 千易 sends no stable event id, so the identity is composed explicitly and
   * hashed to a bounded length (truncating a joined string could silently drop
   * the tail and collapse two real events):
   *
   *   order identity | tracking number | status | occurred-at | place
   *
   * A status name alone is never enough: one parcel passes the same status
   * twice at different times or places, and one order can carry two shipments.
   * Identical tuples are the same event and are collapsed.
   */
  private externalKey(serviceType: string, payload: Record<string, unknown>): string {
    const first = (...keys: string[]): string => {
      for (const key of keys) {
        const value = payload[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
        if (typeof value === 'number' && Number.isFinite(value)) return String(value);
      }
      return '';
    };

    const parts = [
      serviceType,
      first('orderNumber', 'onlineOrderNumber', 'onlineOrderId'),
      first('trackingNumber', 'trackNumber'),
      first('status', 'erpStatus'),
      first('shippingTime', 'eventTime', 'finishedTime'),
      [first('city'), first('province'), first('warehouseName')].filter(Boolean).join('/'),
    ].join('|');

    const digest = createHash('sha256').update(parts, 'utf8').digest('hex').slice(0, 40);
    return `${serviceType}:${digest}`.slice(0, 200);
  }
}
