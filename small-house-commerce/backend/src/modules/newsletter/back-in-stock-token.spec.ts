import { describe, expect, it } from 'vitest';
import {
  signBackInStockUnsubscribeToken,
  verifyBackInStockUnsubscribeToken,
} from './back-in-stock-token.js';

const SECRET = 'b'.repeat(32);
const ID = '018f4d9f-7b31-7a4d-8d64-3c6f8b889c11';

describe('back-in-stock unsubscribe token', () => {
  it('round-trips a subscription id in its own signing domain', () => {
    const token = signBackInStockUnsubscribeToken(ID, SECRET);

    expect(verifyBackInStockUnsubscribeToken(token, SECRET)).toBe(ID);
    expect(token).not.toContain(ID);
  });

  it('rejects tampering, another secret, and malformed payloads', () => {
    const token = signBackInStockUnsubscribeToken(ID, SECRET);
    const [payload, mac] = token.split('.');

    expect(
      verifyBackInStockUnsubscribeToken(`${payload}.${mac}x`, SECRET),
    ).toBeNull();
    expect(
      verifyBackInStockUnsubscribeToken(token, 'c'.repeat(32)),
    ).toBeNull();
    expect(
      verifyBackInStockUnsubscribeToken('not-a-uuid.invalid', SECRET),
    ).toBeNull();
  });
});
