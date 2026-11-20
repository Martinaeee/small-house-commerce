import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { MetaCapiService, type PurchaseEnqueueInput } from '../meta-capi/meta-capi.service.js';

/**
 * A verified gateway result, either from the notification or from a query.
 * Every field is the gateway's own; nothing here comes from the browser.
 */
export interface VerifiedResultInput {
  merchantOrderNum: string;
  transId: string;
  respCode: string;
  /** Decimal string as the gateway sent it. */
  amount: string;
  currency: string;
  paymentBrand?: string;
  /** Gateway time, "yyyyMMddHHmmss" in Manila. */
  gwTime: string;
  merId?: string;
  transType?: string;
  source: 'NOTIFY' | 'QUERY';
}

export type VerifiedOutcome =
  | 'APPLIED'
  | 'DUPLICATE'
  | 'REVIEW'
  | 'IGNORED_LATE_FAILURE';

/** What the transaction hands back: the outcome and, for a paid order, the Purchase facts. */
interface ApplyResult {
  outcome: VerifiedOutcome;
  purchase?: PurchaseEnqueueInput;
}

/**
 * The brands each channel may be paid with (docs.acq.sunrate.com/v5
 * appendixes/payment_methods). A notification that names another brand did
 * not pay this order.
 */
const CHANNEL_BRANDS: Record<string, string[]> = {
  card: ['visa', 'mastercard', 'jcb', 'amex', 'dnc', 'unionpay'],
  gcash: ['gcash'],
  bpi: ['bpi'],
};

const asObject = (value: Prisma.JsonValue | null | undefined): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** Two decimals, so "199" and "199.00" are the same amount. */
const normalizeAmount = (value: string): string | null => {
  try {
    const parsed = new Prisma.Decimal(String(value ?? '').trim());
    if (!parsed.isFinite()) return null;
    return parsed.toFixed(2);
  } catch {
    return null;
  }
};

/** Manila wall clock "yyyyMMddHHmmss" as a UTC instant. */
export const parseGatewayTime = (value: string): Date | null => {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour) - 8, Number(minute), Number(second)),
  );
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * Applies a verified gateway result to an order (design 2026-11-20 §6).
 *
 * One transaction, one lock on the merchant order number: two deliveries of
 * the same notification must not both pay the order. A payment that is
 * already PAID is never downgraded, and anything that does not match the
 * order exactly is parked in REVIEW for a human instead of being applied.
 */
@Injectable()
export class ApplyVerifiedResultService {
  private readonly logger = new Logger(ApplyVerifiedResultService.name);

  constructor(
    private readonly prisma: PrismaService,
    // Optional so a direct unit construction keeps working; Nest injects it.
    @Optional() private readonly metaCapi?: MetaCapiService,
  ) {}

  async applyVerifiedResult(input: VerifiedResultInput): Promise<VerifiedOutcome> {
    const applied = await this.prisma.$transaction(async (tx): Promise<ApplyResult> => {
      // One lock per merchant order number: the same notification delivered
      // twice must not be applied twice.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.merchantOrderNum}, 0))`;

      const attempt = await tx.sunratePaymentAttempt.findUnique({
        where: { merchantOrderNum: input.merchantOrderNum },
      });
      if (!attempt) return { outcome: 'REVIEW' };

      const order = await tx.order.findUnique({
        where: { id: attempt.orderId },
        include: {
          payments: true,
          items: { select: { skuId: true, quantity: true, unitPrice: true } },
          customer: { select: { normalizedPhone: true } },
        },
      });
      if (!order) return { outcome: 'REVIEW' };

      const mismatch = this.mismatch(attempt, input);
      if (mismatch) return { outcome: await this.markReview(tx, attempt, mismatch) };

      // A paid payment is never downgraded: a late failure says nothing
      // about money that already arrived.
      if (attempt.status === 'SUCCEEDED' || order.paymentStatus === 'PAID') {
        return { outcome: input.respCode === '00' ? 'DUPLICATE' : 'IGNORED_LATE_FAILURE' };
      }

      // A cancelled order is not paid by a notification; it goes to a human.
      if (order.orderStatus === 'CANCELLED') {
        return { outcome: await this.markReview(tx, attempt, 'ORDER_CANCELLED') };
      }

      if (input.respCode === '00') return this.markPaid(tx, attempt, order, input);
      if (input.respCode === '01') return { outcome: await this.markFailed(tx, attempt, order) };
      return {
        outcome: await this.markReview(tx, attempt, `UNEXPECTED_RESP_CODE_${input.respCode}`),
      };
    });

    if (applied.purchase) {
      try {
        await this.metaCapi?.enqueuePurchase(applied.purchase);
      } catch (error) {
        // A measurement hiccup must never undo a payment that already
        // arrived; the row is retried by the worker when it lands.
        this.logger.warn(`meta purchase enqueue failed: ${(error as Error).message}`);
      }
    }
    return applied.outcome;
  }

  /** Everything that must match the order exactly, or the result is a guess. */
  private mismatch(
    attempt: { merchantId: string; channel: string; amount: Prisma.Decimal },
    input: VerifiedResultInput,
  ): string | null {
    if (input.merId && input.merId !== attempt.merchantId) return 'MERCHANT_MISMATCH';
    if (input.transType && input.transType !== 'PURC') return 'TRANS_TYPE_MISMATCH';
    if (String(input.currency ?? '').trim().toUpperCase() !== 'PHP') return 'CURRENCY_MISMATCH';
    const amount = normalizeAmount(input.amount);
    if (!amount || amount !== normalizeAmount(attempt.amount.toFixed(2))) return 'AMOUNT_MISMATCH';
    if (input.paymentBrand) {
      const allowed = CHANNEL_BRANDS[attempt.channel] ?? [];
      if (!allowed.includes(input.paymentBrand.trim().toLowerCase())) return 'BRAND_MISMATCH';
    }
    return null;
  }

  private async markPaid(
    tx: Prisma.TransactionClient,
    attempt: {
      id: string;
      status: string;
      lastResult: Prisma.JsonValue | null;
    },
    order: {
      id: string;
      orderNumber: string;
      grandTotal: Prisma.Decimal;
      payments: { id: string }[];
      items: { skuId: string; quantity: number; unitPrice: Prisma.Decimal }[];
      customer: { normalizedPhone: string } | null;
    },
    input: VerifiedResultInput,
  ): Promise<ApplyResult> {
    const gatewayTime = parseGatewayTime(input.gwTime);
    // An unreadable gateway time is noted, but the money still arrived:
    // the order is paid and the moment is the moment we heard about it.
    const paidAt = gatewayTime ?? new Date();
    const payment = order.payments[0];
    if (payment) {
      await tx.payment.update({ where: { id: payment.id }, data: { status: 'PAID', paidAt } });
    }
    await tx.order.update({ where: { id: order.id }, data: { paymentStatus: 'PAID' } });
    const saved = asObject(attempt.lastResult);
    await tx.sunratePaymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: 'SUCCEEDED',
        transId: input.transId,
        // The brand is only kept when the gateway sent one.
        ...(input.paymentBrand ? { cardBrand: input.paymentBrand } : {}),
        lastResult: {
          ...saved,
          payment: {
            respCode: input.respCode,
            transId: input.transId,
            gwTime: input.gwTime,
            appliedAt: new Date().toISOString(),
          },
          ...(gatewayTime ? {} : { review: 'GWTIME_UNPARSED' }),
        },
      },
    });

    // The Purchase event is the money event, and an online order never sent
    // one at checkout: it is queued here, with the facts the checkout saved.
    // The shopper's address and browser are never borrowed from the server.
    const eventSourceUrl =
      typeof saved.eventSourceUrl === 'string' && saved.eventSourceUrl.length > 0
        ? saved.eventSourceUrl
        : null;
    return {
      outcome: 'APPLIED',
      ...(eventSourceUrl
        ? {
            purchase: {
              orderNumber: order.orderNumber,
              items: order.items.map((item) => ({
                skuId: item.skuId,
                quantity: item.quantity,
                unitPrice: Number(item.unitPrice),
              })),
              value: Number(order.grandTotal),
              phone: order.customer?.normalizedPhone ?? null,
              consent: saved.metaConsent === true,
              fbp: typeof saved.fbp === 'string' ? saved.fbp : null,
              fbc: typeof saved.fbc === 'string' ? saved.fbc : null,
              clientIp: null,
              clientUserAgent: null,
              eventSourceUrl,
            },
          }
        : {}),
    };
  }

  private async markFailed(
    tx: Prisma.TransactionClient,
    attempt: { id: string; lastResult: Prisma.JsonValue | null },
    order: { id: string; payments: { id: string }[] },
  ): Promise<VerifiedOutcome> {    const payment = order.payments[0];
    if (payment) {
      await tx.payment.update({ where: { id: payment.id }, data: { status: 'FAILED' } });
    }
    await tx.order.update({ where: { id: order.id }, data: { paymentStatus: 'FAILED' } });
    await tx.sunratePaymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: 'FAILED',
        lastResult: {
          ...asObject(attempt.lastResult),
          payment: { respCode: '01', failedAt: new Date().toISOString() },
        },
      },
    });
    return 'APPLIED';
  }

  /** Parks the attempt for a human and keeps the reason. */
  private async markReview(
    tx: Prisma.TransactionClient,
    attempt: { id: string; lastResult: Prisma.JsonValue | null },
    reason: string,
  ): Promise<VerifiedOutcome> {
    await tx.sunratePaymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: 'REVIEW',
        lastResult: {
          ...asObject(attempt.lastResult),
          review: reason,
          reviewedAt: new Date().toISOString(),
        },
      },
    });
    return 'REVIEW';
  }
}
