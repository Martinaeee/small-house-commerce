import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import { checkoutFailureReason, recordSubmitFailure, recordSubmitAttempt, checkoutAttemptId, clearSubmitAttempt } from './checkout-events';

const analyticsMock = vi.hoisted(() => ({
  trackFirstParty: vi.fn(),
  flushAnalytics: vi.fn(),
}));
vi.mock('./analytics', () => analyticsMock);

const customer = {
  name: 'Ana Cruz',
  phone: '+639171234567',
  province: 'Cebu',
  city: 'Cebu City',
  barangay: null,
  postalCode: '6000',
  streetAddress: '12 Mabini St',
  landmark: null,
  note: null,
};
const items = [{ skuId: '11111111-1111-4111-8111-111111111111', quantity: 2, variantName: 'Walnut' }];

beforeEach(() => {
  sessionStorage.clear();
  analyticsMock.trackFirstParty.mockClear();
  analyticsMock.flushAnalytics.mockClear();
});

describe('checkoutFailureReason', () => {
  it('maps backend codes to stock failures', () => {
    expect(checkoutFailureReason(new ApiError('x', 400, 'INSUFFICIENT_STOCK'))).toBe('STOCK');
    expect(checkoutFailureReason(new ApiError('x', 400, 'SKU_UNAVAILABLE'))).toBe('STOCK');
    expect(checkoutFailureReason(new ApiError('x', 400, null))).toBe('VALIDATION');
  });

  it('maps transport and server faults', () => {
    expect(checkoutFailureReason(new TypeError('Failed to fetch'))).toBe('NETWORK');
    expect(checkoutFailureReason(new DOMException('aborted', 'AbortError'))).toBe('NETWORK');
    expect(checkoutFailureReason(new ApiError('x', 502, null))).toBe('SERVER');
    expect(checkoutFailureReason(new ApiError('x', 409, null))).toBe('UNKNOWN');
  });
});

describe('recordSubmitFailure', () => {
  it('pairs each attempt and failure with the same retry and keeps PII out of attempts', () => {
    const occurrence = recordSubmitAttempt({ step: 'confirm', items, scope: 'cart:a' });
    recordSubmitFailure({ occurrence, step: 'confirm', reason: 'STOCK', error: new Error('x'), customer, items, idempotencyKey: 'k' });
    const a = analyticsMock.trackFirstParty.mock.calls[0][1].metadata;
    const b = analyticsMock.trackFirstParty.mock.calls[1][1].metadata;
    expect(a.retry).toBe(1);
    expect(b.retry).toBe(1);
    expect(a.attemptId).toBe(b.attemptId);
    expect(a).not.toHaveProperty('customer');
    expect(recordSubmitAttempt({ step: 'confirm', items, scope: 'cart:a' })?.retry).toBe(2);
  });
  it('shares a flow between form and confirm and starts afresh after success', () => {
    history.replaceState(null, '', '/checkout?skuId=a');
    const a = checkoutAttemptId();
    history.replaceState(null, '', '/checkout/confirm?skuId=a');
    expect(checkoutAttemptId()).toBe(a);
    clearSubmitAttempt();
    expect(checkoutAttemptId()).not.toBe(a);
    history.replaceState(null, '', '/');
  });
  it('bounds a multibyte large basket while keeping the key and SKU ids', () => {
    const many = Array.from({length: 15}, (_,i) => ({...items[0], skuId: `11111111-1111-4111-8111-${String(i).padStart(12,'0')}`, variantName: '变体'.repeat(300)}));
    recordSubmitFailure({ step: 'confirm', reason: 'UNKNOWN', error: new Error('a'.repeat(500)), customer: {...customer, name: '名'.repeat(120), streetAddress: '路'.repeat(300)}, items: many, idempotencyKey: 'k'.repeat(120) });
    const metadata = analyticsMock.trackFirstParty.mock.calls[0][1].metadata;
    expect(new TextEncoder().encode(JSON.stringify(metadata)).length).toBeLessThanOrEqual(4096);
    expect(metadata.skuIds).toHaveLength(15);
    expect(metadata.idempotencyKey).toBe('k'.repeat(120));
  });
  it('sends one failed event carrying the customer snapshot and the full key', () => {
    recordSubmitFailure({
      step: 'confirm',
      reason: 'STOCK',
      error: new ApiError('Insufficient stock', 400, 'INSUFFICIENT_STOCK'),
      customer,
      items,
      idempotencyKey: 'abc-key',
    });
    expect(analyticsMock.trackFirstParty).toHaveBeenCalledTimes(1);
    const [name, payload] = analyticsMock.trackFirstParty.mock.calls[0] as [string, Record<string, unknown>];
    expect(name).toBe('CHECKOUT_SUBMIT_FAILED');
    expect(payload.entityId).toBe(items[0].skuId);
    expect(payload.metadata).toMatchObject({
      step: 'confirm',
      reason: 'STOCK',
      httpStatus: 400,
      skuIds: [items[0].skuId],
      idempotencyKey: 'abc-key',
      customer: { name: 'Ana Cruz', phone: '+639171234567' },
    });
    expect(analyticsMock.flushAnalytics).toHaveBeenCalled();
  });

  it('never sends a payload over the server metadata cap', () => {
    const huge = { ...customer, streetAddress: 'x'.repeat(3000), note: 'y'.repeat(3000) };
    recordSubmitFailure({ step: 'confirm', reason: 'UNKNOWN', error: new Error('boom'), customer: huge, items, idempotencyKey: 'k' });
    const payload = analyticsMock.trackFirstParty.mock.calls[0][1] as Record<string, unknown>;
    expect(JSON.stringify(payload.metadata).length).toBeLessThanOrEqual(4096);
  });

  it('scrubs phone and email shapes out of the message', () => {
    recordSubmitFailure({ step: 'confirm', reason: 'SERVER', error: new Error('call +639171234567 a@b.com failed'), customer, items, idempotencyKey: 'k' });
    const metadata = analyticsMock.trackFirstParty.mock.calls[0][1].metadata as Record<string, unknown>;
    expect(String(metadata.message)).not.toContain('+639171234567');
    expect(String(metadata.message)).not.toContain('a@b.com');
  });

  it('keeps one attempt id across calls and counts retries inside it', () => {
    recordSubmitFailure({ step: 'confirm', reason: 'STOCK', error: new Error('x'), customer, items, idempotencyKey: 'k' });
    recordSubmitFailure({ step: 'confirm', reason: 'STOCK', error: new Error('x'), customer, items, idempotencyKey: 'k' });
    const first = analyticsMock.trackFirstParty.mock.calls[0][1].metadata as Record<string, unknown>;
    const second = analyticsMock.trackFirstParty.mock.calls[1][1].metadata as Record<string, unknown>;
    expect(first.attemptId).toBe(second.attemptId);
    expect(first.retry).toBe(1);
    expect(second.retry).toBe(2);
  });
});
