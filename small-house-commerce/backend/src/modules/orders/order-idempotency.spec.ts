import { describe, expect, it } from 'vitest';
import { checkoutSchema } from './dto/order.dto.js';
import { idempotencyFingerprint } from './order-idempotency.js';

const SKU_A = '00000000-0000-4000-8000-0000000000a1';
const SKU_B = '00000000-0000-4000-8000-0000000000b2';

/** A date the checkout DTO accepts: seven Manila days out, never a Sunday. */
function nextDeliveryDate(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date());
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? '0');
  const date = new Date(Date.UTC(value('year'), value('month') - 1, value('day')));
  date.setUTCDate(date.getUTCDate() + 7);
  if (date.getUTCDay() === 0) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function checkoutInput(overrides: Record<string, unknown> = {}) {
  return checkoutSchema.parse({
    customer: {
      name: 'Jane',
      phone: '09171234567',
      province: 'Metro Manila',
      city: 'Manila',
      streetAddress: '1 Main St',
    },
    items: [{ skuId: SKU_A, quantity: 1 }],
    attribution: { sourceType: 'ORGANIC' },
    ...overrides,
  });
}

describe('checkout idempotency fingerprint', () => {
  it('is a stable sha256 of the order-defining content', () => {
    const first = idempotencyFingerprint(checkoutInput());
    const second = idempotencyFingerprint(checkoutInput());
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toBe(first);
  });

  it('treats the same items in a different order as the same order', () => {
    const forward = checkoutInput({
      items: [{ skuId: SKU_A, quantity: 1 }, { skuId: SKU_B, quantity: 2 }],
    });
    const reversed = checkoutInput({
      items: [{ skuId: SKU_B, quantity: 2 }, { skuId: SKU_A, quantity: 1 }],
    });
    expect(idempotencyFingerprint(reversed)).toBe(idempotencyFingerprint(forward));
  });

  it('canonicalizes the phone the same way the order does', () => {
    const local = checkoutInput();
    const e164 = checkoutInput({
      customer: {
        name: 'Jane',
        phone: '+639171234567',
        province: 'Metro Manila',
        city: 'Manila',
        streetAddress: '1 Main St',
      },
    });
    expect(idempotencyFingerprint(e164)).toBe(idempotencyFingerprint(local));
  });

  it('changes when the items, customer or order details change', () => {
    const base = idempotencyFingerprint(checkoutInput());
    const variants = [
      checkoutInput({ items: [{ skuId: SKU_A, quantity: 2 }] }),
      checkoutInput({ customer: { name: 'Jane', phone: '09171234567', province: 'Cebu', city: 'Cebu City', streetAddress: '1 Main St' } }),
      checkoutInput({ customerNote: 'Leave at the gate' }),
      checkoutInput({ promoCode: 'WELCOME10' }),
      checkoutInput({ preferredDeliveryDate: nextDeliveryDate() }),
    ];
    for (const variant of variants) {
      expect(idempotencyFingerprint(variant)).not.toBe(base);
    }
  });

  it('ignores request metadata that does not change what was ordered', () => {
    const base = idempotencyFingerprint(checkoutInput());
    const decorated = checkoutInput({
      trackingSessionId: 'tab-12345678',
      fbp: 'fb.1.1753000000000.1098115397',
      fbc: 'fb.1.1753000000000.2098115397',
      metaConsent: true,
      marketingCredential: 'server.credential',
      attribution: { sourceType: 'META_AD', campaignId: 'campaign-1' },
    });
    expect(idempotencyFingerprint(decorated)).toBe(base);
  });
});

describe('checkout idempotency key validation', () => {
  it('accepts a UUID key', () => {
    const result = checkoutSchema.safeParse({
      customer: { name: 'Jane', phone: '09171234567', province: 'Metro Manila', city: 'Manila', streetAddress: '1 Main St' },
      items: [{ skuId: SKU_A, quantity: 1 }],
      attribution: { sourceType: 'ORGANIC' },
      idempotencyKey: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    });
    expect(result.success).toBe(true);
  });

  it('rejects keys that are too short or contain unsafe characters', () => {
    for (const key of ['short', 'has space', 'x'.repeat(121), 'key/with/slash']) {
      const result = checkoutSchema.safeParse({
        customer: { name: 'Jane', phone: '09171234567', province: 'Metro Manila', city: 'Manila', streetAddress: '1 Main St' },
        items: [{ skuId: SKU_A, quantity: 1 }],
        idempotencyKey: key,
      });
      expect(result.success).toBe(false);
    }
  });
});
