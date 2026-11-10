import {
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { checkoutRequestMeta } from '../../meta-capi/request-meta.js';
import {
  MARKETING_FIRST_COOKIE,
  MARKETING_LAST_COOKIE,
  readCookie,
  requestIsSecure,
} from '../../marketing/marketing-touch-cookies.js';
import { OrdersService, type CheckoutTrace } from '../orders.service.js';
import {
  ORDER_RECEIPT_COOKIE,
  ORDER_RECEIPT_PATH,
  ORDER_RECEIPT_TTL_MS,
  OrderReceiptService,
} from '../order-receipt.service.js';
import {
  attemptStatusSchema,
  checkoutSchema,
  lookupSchema,
  type AttemptStatusInput,
  type CheckoutInput,
  type LookupInput,
} from '../dto/order.dto.js';

/**
 * Coarse device class for the redacted request log. The UA also feeds the
 * CAPI request meta; this only avoids a query-time join for the dashboard.
 */
function deviceTypeOf(userAgent: string | undefined): 'mobile' | 'tablet' | 'desktop' {
  const ua = String(userAgent ?? '').toLowerCase();
  if (/ipad|tablet/.test(ua)) return 'tablet';
  if (/mobile|android|iphone/.test(ua)) return 'mobile';
  return 'desktop';
}

/**
 * Guest COD checkout (API_SPEC §18). Buy Now on the PDP uses the same
 * endpoint: the backend re-validates stock for every submitted SKU and
 * rejects the order if anything is short.
 *
 * The successful response also sets the success-page receipt cookie. It is
 * HttpOnly and path-scoped, so the order number in the URL is never enough
 * on its own to render a "Thank You" page or fire a Purchase event.
 */
@Controller('storefront/orders')
export class StorefrontOrdersController {
  private readonly logger = new Logger(StorefrontOrdersController.name);
  private static readonly REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

  constructor(
    private readonly ordersService: OrdersService,
    private readonly receipts: OrderReceiptService,
  ) {}

  /** Client-supplied tracing id when sane, otherwise ours; echoed in the header. */
  private requestId(request: Request): string {
    const raw = request.headers['x-request-id'];
    return typeof raw === 'string' && StorefrontOrdersController.REQUEST_ID.test(raw)
      ? raw
      : randomUUID();
  }

  @Post()
  async checkout(
    @Body(new ZodValidationPipe(checkoutSchema)) body: CheckoutInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const requestId = this.requestId(request);
    const startedAt = Date.now();
    response.setHeader('X-Request-Id', requestId);
    const cookieLast = readCookie(request.headers.cookie, MARKETING_LAST_COOKIE);
    const cookieFirst = readCookie(request.headers.cookie, MARKETING_FIRST_COOKIE);
    const trace: CheckoutTrace = { phaseMs: {}, replayed: false };
    try {
      const result = await this.ordersService.checkout(
        {
          ...body,
          marketingCredential: cookieLast ?? body.marketingCredential,
          marketingFirstCredential: cookieFirst ?? body.marketingFirstCredential,
        },
        checkoutRequestMeta(request),
        undefined,
        trace,
      );

      const orderNumber = 'orderNumber' in result ? result.orderNumber : null;
      // Redacted reconciliation line: ids and durations only — never name,
      // phone, address, cookies or the idempotency key.
      this.logger.log(
        JSON.stringify({
          requestId,
          route: 'POST /storefront/orders',
          outcome: trace.replayed ? 'REPLAYED' : 'RESPONDED',
          httpStatus: 201,
          durationMs: Date.now() - startedAt,
          phaseMs: trace.phaseMs,
          orderNumber,
          deviceType: deviceTypeOf(request.headers['user-agent']),
          attemptReplayCandidate: Boolean(body.idempotencyKey),
        }),
      );
      const token = orderNumber ? this.receipts.issue(orderNumber) : null;
      if (token) {
        response.cookie(ORDER_RECEIPT_COOKIE, token, {
          httpOnly: true,
          sameSite: 'lax',
          secure: requestIsSecure(request),
          path: ORDER_RECEIPT_PATH,
          maxAge: ORDER_RECEIPT_TTL_MS,
        });
      }
      return result;
    } catch (error) {
      this.logger.log(
        JSON.stringify({
          requestId,
          route: 'POST /storefront/orders',
          outcome: 'FAILED',
          httpStatus:
            typeof (error as { getStatus?: () => number }).getStatus === 'function'
              ? (error as { getStatus: () => number }).getStatus()
              : 500,
          durationMs: Date.now() - startedAt,
          phaseMs: trace.phaseMs,
          deviceType: deviceTypeOf(request.headers['user-agent']),
          attemptReplayCandidate: Boolean(body.idempotencyKey),
        }),
      );
      throw error;
    }
  }

  /**
   * Success-page proof: the signed receipt cookie plus a real, non-cancelled
   * order. Every failure is the same 404, so the endpoint is never an order
   * number oracle. The response carries no name, phone, address or amount.
   */
  @Get(':orderNumber/receipt')
  @HttpCode(200)
  async receipt(
    @Param('orderNumber') orderNumber: string,
    @Req() request: Request,
  ) {
    const token = readCookie(request.headers.cookie, ORDER_RECEIPT_COOKIE);
    if (!this.receipts.verify(token, orderNumber)) throw new NotFoundException();
    const status = await this.ordersService.receiptStatus(orderNumber);
    if (!status) throw new NotFoundException();
    return status;
  }

  /**
   * F04 result recovery. The browser holds the checkout idempotency key; presenting
   * it in the body (never the URL, so access logs do not record it) asks
   * whether that attempt already produced an order. ORDERED also re-issues the
   * success-page receipt cookie, so a lost order response still lands on a
   * confirmable receipt. PENDING is the honest "not visible yet" answer for
   * an in-flight or failed attempt; it carries no data and no cookie.
   */
  @Post('attempt-status')
  @HttpCode(200)
  async attemptStatus(
    @Body(new ZodValidationPipe(attemptStatusSchema)) body: AttemptStatusInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const requestId = this.requestId(request);
    const startedAt = Date.now();
    response.setHeader('X-Request-Id', requestId);
    const status = await this.ordersService.attemptStatus(body.idempotencyKey);
    this.logger.log(
      JSON.stringify({
        requestId,
        route: 'POST /storefront/orders/attempt-status',
        outcome: status ? 'RECOVERY_ORDERED' : 'RECOVERY_PENDING',
        httpStatus: 200,
        durationMs: Date.now() - startedAt,
        orderNumber: status?.orderNumber ?? null,
      }),
    );
    if (!status) return { state: 'PENDING' as const };
    const token = this.receipts.issue(status.orderNumber);
    if (token) {
      response.cookie(ORDER_RECEIPT_COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: requestIsSecure(request),
        path: ORDER_RECEIPT_PATH,
        maxAge: ORDER_RECEIPT_TTL_MS,
      });
    }
    return { state: 'ORDERED' as const, ...status };
  }

  // Guest order tracking (spec §3.1): no guard — the order number OR the
  // mobile number identifies the order. Distinct static path, no conflict
  // with @Post().
  @Post('lookup')
  @HttpCode(200)
  lookup(@Body(new ZodValidationPipe(lookupSchema)) body: LookupInput) {
    return this.ordersService.lookup(body.orderNumber ?? null, body.phone ?? null);
  }
}
