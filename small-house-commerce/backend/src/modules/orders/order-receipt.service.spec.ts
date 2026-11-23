import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { OrderReceiptService } from './order-receipt.service.js';

const config = (deny: string[] = []) =>
  new ConfigService({
    jwt: { secret: 'order-receipt-only-unit-test-secret' },
    orders: { receiptDenyNumbers: deny },
  });

describe('OrderReceiptService', () => {
  it('issues a token that verifies only for the same order number', () => {
    const service = new OrderReceiptService(config());
    const issuedAt = new Date('2026-11-09T06:00:00Z');
    const token = service.issue('PH100030', issuedAt);

    expect(token).toEqual(expect.any(String));
    expect(service.verify(token, 'PH100030', issuedAt)).toBe(true);
    expect(service.verify(token, 'PH100031', issuedAt)).toBe(false);
  });

  it('refuses a token once the 72-hour window has passed', () => {
    const service = new OrderReceiptService(config());
    const issuedAt = new Date('2026-11-09T06:00:00Z');
    const token = service.issue('PH100030', issuedAt);

    expect(service.verify(token, 'PH100030', new Date('2026-11-12T05:59:00Z'))).toBe(true);
    expect(service.verify(token, 'PH100030', new Date('2026-11-12T06:01:00Z'))).toBe(false);
  });

  it('rejects a tampered payload and a token from a different secret', () => {
    const service = new OrderReceiptService(config());
    const issuedAt = new Date('2026-11-09T06:00:00Z');
    const token = service.issue('PH100030', issuedAt);
    if (token === null) throw new Error('expected a receipt token');
    const parts = token.split('.');
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    payload.orderNumber = 'PH100031';
    const forgedBody = Buffer.from(JSON.stringify(payload)).toString('base64url');

    expect(service.verify(`${forgedBody}.${parts[1]}`, 'PH100031', issuedAt)).toBe(false);
    // The reference time is passed explicitly: the token is only valid
    // inside its 72-hour window, so verifying it against the wall clock
    // would depend on the day the suite runs.
    expect(new OrderReceiptService(config()).verify(token, 'PH100030', issuedAt)).toBe(true);
    const other = new OrderReceiptService(
      new ConfigService({
        jwt: { secret: 'another-secret' },
        orders: { receiptDenyNumbers: [] },
      }),
    );
    expect(other.verify(token, 'PH100030', issuedAt)).toBe(false);
  });

  it('never issues or accepts a receipt for a denied (test) order number', () => {
    const service = new OrderReceiptService(config(['PH100020']));
    expect(service.issue('PH100020')).toBeNull();
    expect(service.issue('ph100020')).toBeNull();
    expect(service.verify(undefined, 'PH100020')).toBe(false);
  });

  it('rejects missing, malformed and expired tokens without throwing', () => {
    const service = new OrderReceiptService(config());
    expect(service.verify(null, 'PH100030')).toBe(false);
    expect(service.verify('', 'PH100030')).toBe(false);
    expect(service.verify('not-a-token', 'PH100030')).toBe(false);
    expect(service.verify('a.b.c', 'PH100030')).toBe(false);
  });
});
