import { describe, expect, it } from 'vitest';
import {
  createPromotionSchema,
  updatePromotionSchema,
} from './promotion.dto.js';

const base = {
  code: 'welcome10',
  discountType: 'PERCENT' as const,
  discountValue: 10,
};

describe('promotion DTOs', () => {
  it('uppercases the code and applies defaults', () => {
    expect(createPromotionSchema.parse(base)).toMatchObject({
      code: 'WELCOME10',
      minSpend: 0,
      maxUses: null,
      perCustomerLimit: null,
      validFrom: null,
      validUntil: null,
    });
  });

  it('rejects a code with illegal characters', () => {
    expect(() =>
      createPromotionSchema.parse({ ...base, code: 'WELCOME 10' }),
    ).toThrow();
    expect(() =>
      createPromotionSchema.parse({ ...base, code: 'ab' }),
    ).toThrow();
  });

  it('rejects a percentage above 100 and a non-positive value', () => {
    expect(() =>
      createPromotionSchema.parse({ ...base, discountValue: 120 }),
    ).toThrow();
    expect(() =>
      createPromotionSchema.parse({ ...base, discountValue: 0 }),
    ).toThrow();
    expect(() =>
      createPromotionSchema.parse({ ...base, discountValue: -5 }),
    ).toThrow();
  });

  it('allows a fixed amount above 100', () => {
    expect(
      createPromotionSchema.parse({
        ...base,
        discountType: 'FIXED',
        discountValue: 200,
      }),
    ).toMatchObject({ discountType: 'FIXED', discountValue: 200 });
  });

  it('rejects a validity window that ends before it starts', () => {
    expect(() =>
      createPromotionSchema.parse({
        ...base,
        validFrom: '2026-10-20T00:00:00.000Z',
        validUntil: '2026-10-10T00:00:00.000Z',
      }),
    ).toThrow();
  });

  it('rejects non-positive usage limits', () => {
    expect(() =>
      createPromotionSchema.parse({ ...base, maxUses: 0 }),
    ).toThrow();
    expect(() =>
      updatePromotionSchema.parse({ perCustomerLimit: 0 }),
    ).toThrow();
  });
});
