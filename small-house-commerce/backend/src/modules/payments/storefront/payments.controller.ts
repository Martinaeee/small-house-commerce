import {
  ConflictException,
  Controller,
  NotFoundException,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { Prisma } from '../../../generated/prisma/client.js';
import { Throttle, ThrottleGuard } from '../../../common/throttle.guard.js';
import { readCookie, requestIsSecure } from '../../marketing/marketing-touch-cookies.js';
import {
  PAYMENT_CAPABILITY_COOKIE,
  PAYMENT_CAPABILITY_PATH,
  PAYMENT_CAPABILITY_TTL_MS,
  PaymentCapabilityService,
} from '../payment-capability.service.js';
import { PaymentMethodsService } from '../payment-methods.service.js';
import { PaymentsService } from '../payments.service.js';
import { newMerchantOrderNum } from '../sunrate.merchant-order-num.js';

/** An attempt in one of these states still owns the order. */
const ACTIVE_STATUSES = ['CREATING', 'PENDING', 'UNKNOWN', 'REVIEW'];

const CHANNEL_METHODS: Record<string, 'CARD' | 'GCASH' | 'BPI'> = {
  card: 'CARD',
  gcash: 'GCASH',
  bpi: 'BPI',
};

/** The stored JSON of the previous attempt, ready to be written again. */
const asInput = (value: Prisma.JsonValue | null | undefined): Prisma.InputJsonObject =>
  (
    value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  ) as unknown as Prisma.InputJsonObject;

/**
 * The shopper's way back into a payment that failed. Only the order the
 * capability cookie names can be retried, only a payment that actually
 * failed can be retried, and the retry opens a NEW attempt with a new
 * merchant order number — the failed one is never reused.
 */
@Controller('payments')
export class StorefrontPaymentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly capability: PaymentCapabilityService,
    private readonly payments: PaymentsService,
    private readonly methods: PaymentMethodsService,
  ) {}

  @Post('retry')
  @UseGuards(ThrottleGuard)
  @Throttle({ key: 'payment-retry:ip', bucket: 'ip', limit: 5, windowMs: 60_000 })
  async retry(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const token = readCookie(request.headers.cookie, PAYMENT_CAPABILITY_COOKIE);
    const claimed = this.capability.read(token);
    if (!claimed) throw new NotFoundException();

    const order = await this.prisma.order.findUnique({
      where: { orderNumber: claimed.orderNumber },
      include: { sunrateAttempts: { orderBy: { createdAt: 'desc' } } },
    });
    if (!order) throw new NotFoundException();
    if (order.paymentStatus === 'PAID') throw new ConflictException('ALREADY_PAID');

    const active = order.sunrateAttempts.find((attempt) =>
      ACTIVE_STATUSES.includes(attempt.status),
    );
    if (active) throw new ConflictException('PAYMENT_STILL_PENDING');

    const previous = order.sunrateAttempts[0];
    if (!previous || previous.status !== 'FAILED') {
      throw new ConflictException('PAYMENT_NOT_RETRYABLE');
    }

    // A channel that was switched off is not offered again.
    const method = CHANNEL_METHODS[previous.channel];
    const effective = await this.methods.listEffectiveMethods();
    if (!method || !effective.methods.find((entry) => entry.id === method)?.enabled) {
      throw new ConflictException('PAYMENT_METHOD_DISABLED');
    }

    await this.prisma.sunratePaymentAttempt.create({
      data: {
        orderId: order.id,
        channel: previous.channel,
        env: previous.env,
        merchantId: previous.merchantId,
        merchantOrderNum: newMerchantOrderNum(),
        amount: order.grandTotal,
        currency: previous.currency,
        status: 'CREATING',
        // The checkout facts travel with the new attempt: without them the
        // Purchase event of a later paid retry would have no consent flag.
        lastResult: asInput(previous.lastResult),
      },
    });

    const session = await this.payments.initiateGatewaySession(order.orderNumber);
    response.cookie(
      PAYMENT_CAPABILITY_COOKIE,
      this.capability.issue(order.orderNumber, session.attemptId),
      {
        httpOnly: true,
        sameSite: 'lax',
        secure: requestIsSecure(request),
        path: PAYMENT_CAPABILITY_PATH,
        maxAge: PAYMENT_CAPABILITY_TTL_MS,
      },
    );
    return {
      orderNumber: order.orderNumber,
      payment: {
        attemptId: session.attemptId,
        channel: session.channel,
        env: session.env,
        ...(session.paySession ? { paySession: session.paySession } : {}),
        ...(session.payUrl ? { payUrl: session.payUrl } : {}),
      },
    };
  }
}
