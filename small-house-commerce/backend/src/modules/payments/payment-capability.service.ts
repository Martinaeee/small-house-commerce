import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

/**
 * Capability cookie for the payment return path. It proves that the caller
 * owns the order it asks about, so the payment status endpoint can answer
 * without leaking whether an order number exists.
 *
 * The cookie is HttpOnly and scoped to the payment endpoints: the order
 * number in a URL is never enough on its own.
 */
export const PAYMENT_CAPABILITY_COOKIE = 'luwag_pay_return';
export const PAYMENT_CAPABILITY_PATH = '/api/v1/payments';
export const PAYMENT_CAPABILITY_TTL_MS = 24 * 60 * 60 * 1000;

interface CapabilityPayload {
  purpose: 'pay-return';
  orderNumber: string;
  attemptId: string;
  expiresAt: string;
}

/**
 * Signs a short-lived capability that names one payment attempt of one
 * order. Verification is signature + expiry + exact order-number equality;
 * whether the order or the attempt really exists is checked against the
 * database by the caller.
 */
@Injectable()
export class PaymentCapabilityService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    this.key = Buffer.from(
      hkdfSync(
        'sha256',
        config.getOrThrow<string>('jwt.secret'),
        'luwag.payments',
        'payment-capability:v1',
        32,
      ),
    );
  }

  issue(orderNumber: string, attemptId: string, now = new Date()): string {
    const payload: CapabilityPayload = {
      purpose: 'pay-return',
      orderNumber: orderNumber.trim().toUpperCase(),
      attemptId,
      expiresAt: new Date(now.getTime() + PAYMENT_CAPABILITY_TTL_MS).toISOString(),
    };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${body}.${this.sign(body)}`;
  }

  /**
   * Reads the capability a token carries, or null when the token is missing,
   * forged or expired. The caller decides what to do with the order it
   * names — the database is the only authority on whether that order exists.
   */
  read(token: string | null | undefined, now = new Date()): { orderNumber: string; attemptId: string } | null {
    if (typeof token !== 'string' || token.length === 0 || token.length > 4096) return null;

    const parts = token.split('.');
    if (parts.length !== 2 || parts[0] === '' || parts[1] === '') return null;

    let payload: CapabilityPayload;
    try {
      payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as CapabilityPayload;
    } catch {
      return null;
    }
    if (
      payload === null ||
      typeof payload !== 'object' ||
      payload.purpose !== 'pay-return' ||
      typeof payload.orderNumber !== 'string' ||
      payload.orderNumber.length === 0 ||
      typeof payload.attemptId !== 'string' ||
      payload.attemptId.length === 0 ||
      typeof payload.expiresAt !== 'string'
    ) {
      return null;
    }
    if (new Date(payload.expiresAt).getTime() <= now.getTime()) return null;

    const expected = Buffer.from(this.sign(parts[0]));
    const actual = Buffer.from(parts[1]);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

    return { orderNumber: payload.orderNumber, attemptId: payload.attemptId };
  }

  verify(token: string | null | undefined, orderNumber: string, now = new Date()): boolean {
    const claimed = this.read(token, now);
    if (!claimed) return false;
    return claimed.orderNumber === orderNumber.trim().toUpperCase();
  }

  private sign(body: string): string {
    return createHmac('sha256', this.key).update(body).digest('base64url');
  }
}
