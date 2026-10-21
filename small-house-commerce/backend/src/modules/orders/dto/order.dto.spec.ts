import { describe, expect, it } from 'vitest';
import { checkoutSchema } from './order.dto.js';

const SKU = '66666666-6666-4666-a666-666666666666';
const base = {
  customer: {
    name: 'Jane',
    phone: '09171234567',
    province: 'Metro Manila',
    city: 'Manila',
    streetAddress: '1 Main St',
  },
  items: [{ skuId: SKU, quantity: 1 }],
  attribution: {},
};

describe('checkoutSchema customer note', () => {
  it('keeps a trimmed note', () => {
    expect(
      checkoutSchema.parse({ ...base, customerNote: '  Call before delivery  ' })
        .customerNote,
    ).toBe('Call before delivery');
  });

  it('normalizes empty and whitespace-only notes to null', () => {
    expect(checkoutSchema.parse({ ...base, customerNote: '' }).customerNote).toBeNull();
    expect(checkoutSchema.parse({ ...base, customerNote: '   ' }).customerNote).toBeNull();
    expect(checkoutSchema.parse({ ...base, customerNote: '\n\n' }).customerNote).toBeNull();
  });

  it('treats an omitted or explicit null note as null', () => {
    expect(checkoutSchema.parse(base).customerNote).toBeNull();
    expect(checkoutSchema.parse({ ...base, customerNote: null }).customerNote).toBeNull();
  });

  it('accepts 200 characters and rejects 201', () => {
    expect(
      checkoutSchema.parse({ ...base, customerNote: 'x'.repeat(200) }).customerNote,
    ).toBe('x'.repeat(200));
    expect(
      checkoutSchema.safeParse({ ...base, customerNote: 'x'.repeat(201) }).success,
    ).toBe(false);
  });

  it('counts a surrogate pair as two units, matching the browser maxLength', () => {
    // One emoji is two UTF-16 units; 100 of them is exactly 200 units.
    const hundred = '\u{1F600}'.repeat(100);
    expect(checkoutSchema.parse({ ...base, customerNote: hundred }).customerNote).toBe(
      hundred,
    );
    expect(
      checkoutSchema.safeParse({ ...base, customerNote: `${hundred}\u{1F600}` }).success,
    ).toBe(false);
  });

  it('rejects a non-string note', () => {
    expect(checkoutSchema.safeParse({ ...base, customerNote: 42 }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...base, customerNote: { text: 'x' } }).success).toBe(
      false,
    );
  });
});
