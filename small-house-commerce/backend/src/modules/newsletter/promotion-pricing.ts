export interface DiscountRule {
  discountType: 'PERCENT' | 'FIXED';
  discountValue: number;
}

/**
 * Money math shared by the preview endpoint and the authoritative checkout.
 * Always clamped to [0, subtotal] so a fixed amount larger than the cart can
 * never drive the grand total negative.
 */
export function computeDiscount(rule: DiscountRule, subtotal: number): number {
  if (!Number.isFinite(subtotal) || subtotal <= 0) return 0;

  const raw =
    rule.discountType === 'PERCENT'
      ? (subtotal * rule.discountValue) / 100
      : rule.discountValue;
  if (!Number.isFinite(raw)) return 0;

  const rounded = Math.round(raw * 100) / 100;
  return Math.max(0, Math.min(rounded, subtotal));
}
