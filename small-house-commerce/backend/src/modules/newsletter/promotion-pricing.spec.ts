import { describe, expect, it } from 'vitest';
import { computeDiscount } from './promotion-pricing.js';

describe('computeDiscount', () => {
  it('applies a percentage of the subtotal', () => {
    expect(computeDiscount({ discountType: 'PERCENT', discountValue: 10 }, 250)).toBe(25);
  });

  it('applies a fixed amount', () => {
    expect(computeDiscount({ discountType: 'FIXED', discountValue: 200 }, 500)).toBe(200);
  });

  it('clamps a fixed amount larger than the subtotal', () => {
    expect(computeDiscount({ discountType: 'FIXED', discountValue: 999 }, 100)).toBe(100);
  });

  it('rounds a percentage to two decimals', () => {
    expect(computeDiscount({ discountType: 'PERCENT', discountValue: 7.5 }, 33.33)).toBe(2.5);
  });

  it('never returns a negative or non-finite discount', () => {
    expect(computeDiscount({ discountType: 'PERCENT', discountValue: 10 }, 0)).toBe(0);
    expect(computeDiscount({ discountType: 'FIXED', discountValue: 0 }, 100)).toBe(0);
  });
});
