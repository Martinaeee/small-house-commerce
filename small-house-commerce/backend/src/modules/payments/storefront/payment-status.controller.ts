import { Controller, Get, Header, NotFoundException, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { Prisma } from '../../../generated/prisma/client.js';
import { readCookie } from '../../marketing/marketing-touch-cookies.js';
import {
  PAYMENT_CAPABILITY_COOKIE,
  PaymentCapabilityService,
} from '../payment-capability.service.js';

/**
 * What the payment return page needs to know. It never carries customer or
 * address data, and it never carries the raw gateway answer.
 */
export interface PaymentStatusResponse {
  orderNumber: string;
  /** The order's payment status, or CANCELLED when the order was cancelled. */
  paymentStatus: string;
  attemptStatus: string | null;
  /**
   * The gateway environment the attempt belongs to. The card checkout needs
   * it to mount the right SDK; it is never guessed on the client.
   */
  env: string | null;
  paidAt?: string;
  amount: number;
  currency: string;
  /** Present once the payment is verified as paid: the Purchase payload. */
  value?: number;
  items?: { skuId: string; quantity: number }[];
  metaConsent?: boolean;
}

const asObject = (value: Prisma.JsonValue | null | undefined): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/**
 * The payment state of one order, read through a capability cookie.
 *
 * The cookie names the order, so an order number in the URL is never enough
 * on its own. Every failure answers the same 404: a missing cookie, a forged
 * one, a cookie for another order and an order that does not exist must not
 * be distinguishable from each other.
 */
@Controller('payments')
export class PaymentStatusController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly capability: PaymentCapabilityService,
  ) {}

  @Get('status')
  @Header('Cache-Control', 'no-store')
  async status(
    @Req() request: Request,
    @Query('orderNumber') orderNumber?: string,
  ): Promise<PaymentStatusResponse> {
    const token = readCookie(request.headers.cookie, PAYMENT_CAPABILITY_COOKIE);
    const claimed = this.capability.read(token);
    if (!claimed) throw new NotFoundException();
    if (orderNumber && orderNumber.trim().toUpperCase() !== claimed.orderNumber) {
      throw new NotFoundException();
    }

    const order = await this.prisma.order.findUnique({
      where: { orderNumber: claimed.orderNumber },
      include: {
        payments: { orderBy: { createdAt: 'desc' }, take: 1 },
        items: { select: { skuId: true, quantity: true } },
        sunrateAttempts: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (!order) throw new NotFoundException();

    const attempt = order.sunrateAttempts[0] ?? null;
    const payment = order.payments[0] ?? null;
    const cancelled = order.orderStatus === 'CANCELLED';
    const amount = Number(order.grandTotal);

    const body: PaymentStatusResponse = {
      orderNumber: order.orderNumber,
      paymentStatus: cancelled ? 'CANCELLED' : order.paymentStatus,
      attemptStatus: attempt?.status ?? null,
      env: attempt?.env ?? null,
      amount,
      currency: attempt?.currency ?? 'PHP',
      ...(payment?.paidAt ? { paidAt: payment.paidAt.toISOString() } : {}),
    };

    if (!cancelled && order.paymentStatus === 'PAID') {
      // The browser fires the Purchase event from these server-side facts:
      // the online flow never went through the COD purchase path, so this
      // is the authoritative amount and item list for the event.
      body.value = amount;
      body.items = order.items.map((item) => ({ skuId: item.skuId, quantity: item.quantity }));
      body.metaConsent = asObject(attempt?.lastResult).metaConsent === true;
    }
    return body;
  }
}
