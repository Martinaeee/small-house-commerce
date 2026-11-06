import { describe, it, expect } from 'vitest';
import { checkoutMetadata } from './checkout-metadata.js';

describe('checkout diagnostic metadata boundary', () => {
  it('only permits customer and the full key on failure events', () => {
    const m = {
      step: 'form',
      attemptId: 'attempt-123',
      retry: 1,
      skuIds: [],
      quantities: [],
      customer: {
        name: 'Ana',
        phone: '09171234567',
        streetAddress: 'Full address',
      },
      idempotencyKey: 'full-key',
    };
    expect(checkoutMetadata('CHECKOUT_SUBMIT_ATTEMPT', m)).not.toHaveProperty(
      'customer',
    );
    expect(checkoutMetadata('CHECKOUT_SUBMIT_ATTEMPT', m)).not.toHaveProperty(
      'idempotencyKey',
    );
    expect(
      checkoutMetadata('CHECKOUT_SUBMIT_FAILED', {
        ...m,
        reason: 'VALIDATION',
      }),
    ).toMatchObject({ customer: { name: 'Ana' }, idempotencyKey: 'full-key' });
  });
  it('sanitizes messages server side and strips unknown metadata fields', () => {
    const m = checkoutMetadata('CHECKOUT_SUBMIT_FAILED', {
      step: 'confirm',
      reason: 'SERVER',
      message: 'Ana 09171234567 ana@test.com failed',
      customer: { name: 'Ana', phone: '09171234567' },
      sql: 'private',
      skuIds: [],
      quantities: [],
    });
    expect(m?.message).not.toContain('09171234567');
    expect(m?.message).not.toContain('ana@test.com');
    expect(m?.message).not.toContain('Ana');
    expect(m).not.toHaveProperty('sql');
  });
});
