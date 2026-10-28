import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { signQianyiRequest } from './qianyi.client.js';
import { readQianyiConfig, type QianyiConfig } from './qianyi.config.js';
import type { QianyiInboundService } from './qianyi-inbound.service.js';

/** How far a callback timestamp may drift before we treat it as a replay. */
const MAX_CLOCK_SKEW_MS = 15 * 60 * 1000;

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

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly inbound: QianyiInboundService,
  ) {
    this.config = readQianyiConfig(config);
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
      await this.prisma.qianyiWebhookEvent.create({
        data: {
          serviceType: fields.serviceType,
          signValid: false,
          externalKey: `${externalKey}:bad-sign:${Date.now()}`,
          payload: payload as Prisma.InputJsonValue,
          error: 'invalid signature or stale timestamp',
        },
      });
      this.logger.warn(`qianyi webhook rejected: ${fields.serviceType}`);
      return { ok: false, duplicated: false };
    }

    const seen = await this.prisma.qianyiWebhookEvent.findUnique({ where: { externalKey } });
    // Only a callback we actually FINISHED counts as a duplicate. A row left
    // with `processedAt = null` is a failed dispatch, and Qianyi's retry must
    // be allowed to run it again.
    if (seen?.processedAt) return { ok: true, duplicated: true };

    if (!seen) {
      await this.prisma.qianyiWebhookEvent.create({
        data: {
          serviceType: fields.serviceType,
          signValid: true,
          externalKey,
          payload: payload as Prisma.InputJsonValue,
        },
      });
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

  private externalKey(serviceType: string, payload: Record<string, unknown>): string {
    const identity =
      payload.orderNumber ??
      payload.onlineOrderNumber ??
      payload.onlineOrderId ??
      payload.trackingNumber ??
      'unknown';
    const state = payload.status ?? payload.erpStatus ?? '';
    return `${serviceType}:${String(identity)}:${String(state)}`.slice(0, 200);
  }
}
