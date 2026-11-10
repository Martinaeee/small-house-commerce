import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

/** Receipt cookie set on the checkout response, scoped to the success page. */
export const ORDER_RECEIPT_COOKIE = 'luwag_order_receipt';
export const ORDER_RECEIPT_PATH = '/order-success';
export const ORDER_RECEIPT_TTL_MS = 72 * 60 * 60 * 1000;

interface ReceiptPayload {
  purpose: 'order-receipt';
  orderNumber: string;
  issuedAt: string;
  expiresAt: string;
}

/**
 * Signs a short-lived capability that lets the success page prove the order
 * number it was handed is real. The token travels in an HttpOnly cookie, not
 * the URL, so it can never leak through access logs, Referer headers or the
 * analytics page_url.
 *
 * The payload is intentionally minimal: an order number and a time window.
 * Verification is signature + expiry + exact order-number equality; whether
 * the order actually exists is checked against the database by the caller.
 */
@Injectable()
export class OrderReceiptService {
  private readonly key: Buffer;
  private readonly deny: Set<string>;

  constructor(config: ConfigService) {
    this.key = Buffer.from(
      hkdfSync(
        'sha256',
        config.getOrThrow<string>('jwt.secret'),
        'luwag.orders',
        'order-receipt:v1',
        32,
      ),
    );
    const denied = config.get<string[]>('orders.receiptDenyNumbers') ?? [];
    this.deny = new Set(denied.map((value) => value.trim().toUpperCase()).filter(Boolean));
  }

  /** Null when the order number is on the operator deny list (test orders). */
  issue(orderNumber: string, now = new Date()): string | null {
    const canonical = orderNumber.trim().toUpperCase();
    if (this.deny.has(canonical)) return null;

    const payload: ReceiptPayload = {
      purpose: 'order-receipt',
      orderNumber: canonical,
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ORDER_RECEIPT_TTL_MS).toISOString(),
    };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${body}.${this.sign(body)}`;
  }

  verify(token: string | null | undefined, orderNumber: string, now = new Date()): boolean {
    if (typeof token !== 'string' || token.length === 0 || token.length > 4096) return false;
    const canonical = orderNumber.trim().toUpperCase();
    if (this.deny.has(canonical)) return false;

    const parts = token.split('.');
    if (parts.length !== 2 || parts[0] === '' || parts[1] === '') return false;

    let payload: ReceiptPayload;
    try {
      payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as ReceiptPayload;
    } catch {
      return false;
    }
    if (
      payload === null ||
      typeof payload !== 'object' ||
      payload.purpose !== 'order-receipt' ||
      payload.orderNumber !== canonical ||
      typeof payload.expiresAt !== 'string'
    ) {
      return false;
    }
    if (new Date(payload.expiresAt).getTime() <= now.getTime()) return false;

    const expected = Buffer.from(this.sign(parts[0]));
    const actual = Buffer.from(parts[1]);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  private sign(body: string): string {
    return createHmac('sha256', this.key).update(body).digest('base64url');
  }
}
