import { HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Prisma, type SunratePaymentAttempt } from '../../generated/prisma/client.js';
import { SunrateClient, SunrateGatewayError, isOfficialSunratePayUrl } from './sunrate.client.js';
import { readSunrateConfig } from './sunrate.config.js';

/** What the shopper needs to pay: the card session or the wallet pay url. */
export interface GatewaySession {
  attemptId: string;
  channel: string;
  env: string;
  paySession?: string;
  payUrl?: string;
}

const asObject = (value: Prisma.JsonValue | null | undefined): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** The session a previous initiation stored on the attempt, if any. */
const readStoredSession = (
  lastResult: Prisma.JsonValue | null | undefined,
): { paySession?: string; payUrl?: string } | null => {
  const session = asObject(lastResult).session;
  if (!session || typeof session !== 'object' || Array.isArray(session)) return null;
  const record = session as Record<string, unknown>;
  const paySession =
    typeof record.paySession === 'string' && record.paySession.length > 0
      ? record.paySession
      : undefined;
  const payUrl =
    typeof record.payUrl === 'string' && record.payUrl.length > 0 ? record.payUrl : undefined;
  if (!paySession && !payUrl) return null;
  return { ...(paySession ? { paySession } : {}), ...(payUrl ? { payUrl } : {}) };
};

/**
 * The reason is logged without any payload from the gateway: an id, a state
 * and the failure kind are enough to reconcile, and nothing sensitive ever
 * reaches the log.
 */
const errorReason = (error: unknown): string => {
  if (error instanceof SunrateGatewayError) return `gateway_${error.respCode || 'unknown'}`;
  if (error instanceof Error) return error.name || 'error';
  return 'unknown';
};

/** The device class the gateway's risk check expects; never invented. */
const osTypeOf = (userAgent: string | null | undefined): 'IOS' | 'ANDROID' | 'WINDOWS' => {
  const ua = String(userAgent ?? '').toLowerCase();
  if (/iphone|ipad|ipod|ios/.test(ua)) return 'IOS';
  if (/android/.test(ua)) return 'ANDROID';
  return 'WINDOWS';
};

/**
 * Drives the SUNRATE payment session for an order (design 2026-11-20).
 *
 * The attempt row is the handle: it carries the merchant order number, the
 * environment and the amount snapshot, and it is the row the gateway
 * notification and every query are matched against. The session itself is
 * started outside the database transaction, because a gateway call must never
 * hold a transaction open.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly client: SunrateClient,
  ) {}

  /**
   * Opens the payment session for an order that has an attempt but no
   * session yet. Returns the stored session when one exists, so a repeated
   * checkout never asks the gateway for a second one.
   */
  async initiateGatewaySession(
    orderNumber: string,
    options: { userIp?: string | null; userAgent?: string | null } = {},
  ): Promise<GatewaySession> {
    const attempt = await this.readAttempt(orderNumber);
    if (!attempt) throw new NotFoundException('This order has no payment attempt');

    const handle = { attemptId: attempt.id, channel: attempt.channel, env: attempt.env };
    const stored = readStoredSession(attempt.lastResult);
    if (attempt.status === 'PENDING' && stored) return { ...handle, ...stored };
    if (attempt.status === 'UNKNOWN') {
      // The gateway may or may not have accepted the request. Opening a
      // second session for the same order number could be paid twice, so the
      // attempt stays untouched until reconciliation decides what happened.
      throw new HttpException('GATEWAY_INITIATION_FAILED', 502);
    }
    if (attempt.status !== 'CREATING') {
      // The payment is already settled; there is nothing left to open.
      return handle;
    }

    const cfg = readSunrateConfig(this.config);
    if (!cfg) throw new HttpException('GATEWAY_INITIATION_FAILED', 502);

    const frontURL = `${cfg.publicBaseUrl}/payment-return/${encodeURIComponent(orderNumber)}`;
    const backURL = `${cfg.publicBaseUrl}/api/v1/payments/sunrate/notify`;
    const amount = attempt.amount.toFixed(2);

    let session: { paySession?: string; payUrl?: string };
    try {
      session =
        attempt.channel === 'card'
          ? await this.client.createCardCashier({
              orderNum: attempt.merchantOrderNum,
              amount,
              currency: attempt.currency,
              detailInfo: Buffer.from(
                JSON.stringify([{ goods_name: 'LUWAG order', quantity: '1' }]),
              ).toString('base64'),
              userIP: options.userIp || '127.0.0.1',
              userID: attempt.orderId,
              osType: osTypeOf(options.userAgent),
              frontURL,
              backURL,
            })
          : await this.client.createWalletOrder({
              orderNum: attempt.merchantOrderNum,
              amount,
              currency: attempt.currency,
              paymentMethod: attempt.channel as 'gcash' | 'bpi',
              frontURL,
              backURL,
              userIP: options.userIp || '127.0.0.1',
              userID: attempt.orderId,
              osType: osTypeOf(options.userAgent),
            });
    } catch (error) {
      throw await this.failInitiation(attempt, orderNumber, error);
    }

    if (session.payUrl && !isOfficialSunratePayUrl(session.payUrl)) {
      // A pay url on a host we do not trust is never shown to a shopper.
      throw await this.failInitiation(attempt, orderNumber, new Error('pay_url_not_allowed'));
    }

    await this.prisma.sunratePaymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: 'PENDING',
        // The checkout facts (consent flag, click ids) must survive the
        // gateway summary: the Purchase event still needs them once the
        // payment is verified.
        lastResult: {
          ...asObject(attempt.lastResult),
          session: { ...session, initiatedAt: new Date().toISOString() },
        },
      },
    });

    return { ...handle, ...session };
  }

  /**
   * Reads the attempt under a row lock. A second initiation must not read a
   * half-written session.
   */
  private async readAttempt(orderNumber: string): Promise<SunratePaymentAttempt | null> {
    return this.prisma.$transaction(async (tx) => {
      const attempt = await tx.sunratePaymentAttempt.findFirst({
        where: { order: { orderNumber } },
        orderBy: { createdAt: 'desc' },
      });
      if (!attempt) return null;
      await tx.$queryRaw`SELECT id FROM sunrate_payment_attempts WHERE id = ${attempt.id} FOR UPDATE`;
      return attempt;
    });
  }

  /**
   * Records a failed initiation. A gateway that answered with a rejection
   * is definitive — no session exists. A timeout, a dropped connection or a
   * 5xx leaves the outcome unknown, so the attempt waits for reconciliation.
   */
  private async failInitiation(
    attempt: SunratePaymentAttempt,
    orderNumber: string,
    error: unknown,
  ): Promise<HttpException> {
    const status =
      error instanceof SunrateGatewayError && error.httpStatus !== undefined && error.httpStatus >= 500
        ? 'UNKNOWN'
        : error instanceof SunrateGatewayError
          ? 'FAILED'
          : 'UNKNOWN';
    const reason = errorReason(error);
    await this.prisma.sunratePaymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status,
        // The merchant order number is never swapped: the gateway may have
        // accepted the request, and reconciliation looks the payment up by
        // this number.
        lastResult: { ...asObject(attempt.lastResult), gatewayError: reason },
      },
    });
    this.logger.error(
      JSON.stringify({
        event: 'sunrate.initiation.failed',
        orderNumber,
        attemptId: attempt.id,
        channel: attempt.channel,
        status,
        reason,
      }),
    );
    return new HttpException('GATEWAY_INITIATION_FAILED', 502);
  }
}
