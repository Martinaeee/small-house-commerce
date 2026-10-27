import { describe, expect, it } from 'vitest';
import { metaEventSchema } from './meta-event.dto.js';

function valid(overrides: Record<string, unknown> = {}) {
  return {
    name: 'ViewContent',
    eventId: 'c0ffee00-aaaa-4bbb-8ccc-1234567890ab',
    eventSourceUrl: 'https://luwag.shop/products/oak-chair',
    customData: {
      content_ids: ['sku-1'],
      content_type: 'product',
      value: 1299,
      currency: 'PHP',
    },
    fbp: 'fb.1.1753000000000.1098115397',
    fbc: null,
    consent: true,
    ...overrides,
  };
}

describe('metaEventSchema', () => {
  it('accepts a bounded, consented storefront event', () => {
    const parsed = metaEventSchema.parse(valid());
    expect(parsed.name).toBe('ViewContent');
  });

  it('refuses Purchase, which only the order outbox may enqueue', () => {
    expect(metaEventSchema.safeParse(valid({ name: 'Purchase' })).success).toBe(false);
  });

  it('refuses unknown event names', () => {
    expect(
      metaEventSchema.safeParse(valid({ name: 'PageView' })).success,
    ).toBe(false);
  });

  it('drops custom_data keys the pixel never sends', () => {
    const parsed = metaEventSchema.parse(
      valid({
        customData: {
          content_ids: ['sku-1'],
          value: 1299,
          currency: 'PHP',
          evil: 'payload',
          order_id: 'PH100001',
        },
      }),
    );
    expect(parsed.customData).not.toHaveProperty('evil');
    expect(parsed.customData).not.toHaveProperty('order_id');
  });

  it('bounds identifiers, values and arrays', () => {
    expect(
      metaEventSchema.safeParse(valid({ eventId: 'x' })).success,
    ).toBe(false);
    expect(
      metaEventSchema.safeParse(
        valid({ customData: { content_ids: Array.from({ length: 51 }, (_, i) => `s${i}`), currency: 'PHP' } }),
      ).success,
    ).toBe(false);
    expect(
      metaEventSchema.safeParse(
        valid({ customData: { content_ids: ['s'], currency: 'PHP', value: 10_000_001 } }),
      ).success,
    ).toBe(false);
  });

  it('refuses malformed Meta cookies and arbitrary source URLs', () => {
    expect(
      metaEventSchema.safeParse(valid({ fbp: 'garbage' })).success,
    ).toBe(false);
    expect(
      metaEventSchema.safeParse(valid({ eventSourceUrl: 'not-a-url' })).success,
    ).toBe(false);
  });

  it('requires the consent flag to be present and boolean', () => {
    const withoutConsent = valid();
    delete (withoutConsent as Record<string, unknown>).consent;
    expect(metaEventSchema.safeParse(withoutConsent).success).toBe(false);
    expect(
      metaEventSchema.safeParse(valid({ consent: 'yes' })).success,
    ).toBe(false);
  });
});
