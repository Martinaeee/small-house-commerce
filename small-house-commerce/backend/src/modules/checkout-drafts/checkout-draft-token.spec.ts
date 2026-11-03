import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CHECKOUT_DRAFT_MAX_AGE_MS,
  CheckoutDraftExpiredError,
  CheckoutDraftTokenError,
  hashCheckoutDraftToken,
} from './checkout-draft-token.js';

const NOW = new Date('2026-11-03T00:00:00.000Z');
const RANDOM = 'A'.repeat(43);

function tokenAt(ms: number): string {
  return `${ms.toString(36)}.${RANDOM}`;
}

describe('hashCheckoutDraftToken', () => {
  it('hashes the whole token and keeps its issued time', () => {
    const raw = tokenAt(NOW.getTime());
    const parsed = hashCheckoutDraftToken(raw, NOW);
    expect(parsed.issuedAt.toISOString()).toBe(NOW.toISOString());
    expect(parsed.hash).toBe(createHash('sha256').update(raw).digest('hex'));
  });

  it('rejects a token without the random half', () => {
    expect(() => hashCheckoutDraftToken('abc', NOW)).toThrow(CheckoutDraftTokenError);
    expect(() => hashCheckoutDraftToken(`${NOW.getTime().toString(36)}.short`, NOW)).toThrow(
      CheckoutDraftTokenError,
    );
  });

  it('rejects a token dated in the future', () => {
    const future = NOW.getTime() + 10 * 60_000;
    expect(() => hashCheckoutDraftToken(tokenAt(future), NOW)).toThrow(CheckoutDraftTokenError);
  });

  it('rejects a token at the 30 day edge', () => {
    const old = NOW.getTime() - CHECKOUT_DRAFT_MAX_AGE_MS;
    expect(() => hashCheckoutDraftToken(tokenAt(old), NOW)).toThrow(CheckoutDraftExpiredError);
  });

  it('accepts a token one millisecond inside the window', () => {
    const old = NOW.getTime() - CHECKOUT_DRAFT_MAX_AGE_MS + 1;
    expect(() => hashCheckoutDraftToken(tokenAt(old), NOW)).not.toThrow();
  });
});
