import { createHash } from 'node:crypto';

export const CHECKOUT_DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 60_000;
const TOKEN_PATTERN = /^([0-9a-z]{1,12})\.([A-Za-z0-9_-]{43})$/;

export class CheckoutDraftTokenError extends Error {
  constructor() {
    super('Invalid checkout draft token.');
    this.name = 'CheckoutDraftTokenError';
  }
}

export class CheckoutDraftExpiredError extends Error {
  constructor() {
    super('This checkout draft has expired.');
    this.name = 'CheckoutDraftExpiredError';
  }
}

export interface ParsedCheckoutDraftToken {
  hash: string;
  issuedAt: Date;
}

export function hashCheckoutDraftToken(
  raw: string,
  now: Date = new Date(),
): ParsedCheckoutDraftToken {
  const match = TOKEN_PATTERN.exec(raw.trim());
  if (!match) throw new CheckoutDraftTokenError();
  const issuedAtMs = Number.parseInt(match[1], 36);
  if (!Number.isSafeInteger(issuedAtMs) || issuedAtMs <= 0) {
    throw new CheckoutDraftTokenError();
  }
  if (issuedAtMs > now.getTime() + CLOCK_SKEW_MS) throw new CheckoutDraftTokenError();
  if (now.getTime() - issuedAtMs >= CHECKOUT_DRAFT_MAX_AGE_MS) {
    throw new CheckoutDraftExpiredError();
  }
  return {
    hash: createHash('sha256').update(raw.trim()).digest('hex'),
    issuedAt: new Date(issuedAtMs),
  };
}

/** Orders path: a malformed/expired token must never block a real order. */
export function tryHashCheckoutDraftToken(
  raw: string | null | undefined,
  now: Date = new Date(),
): ParsedCheckoutDraftToken | null {
  if (!raw) return null;
  try {
    return hashCheckoutDraftToken(raw, now);
  } catch {
    return null;
  }
}
