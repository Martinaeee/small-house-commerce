import type { ReactNode } from "react";

/**
 * DESIGN_SYSTEM §18 Price Component.
 * Current price, strikethrough compare-at price, and a sale badge (promotion
 * colour §5.6, used ONLY for discounts).
 */

interface PriceBoxProps {
  price: number | null;
  compareAtPrice?: number | null;
  /** PHP formatting is the only formatting here; prices come from the API. */
  currency?: string;
}

export function formatPrice(value: number, currency = "₱"): string {
  return `${currency}${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function PriceBox({ price, compareAtPrice, currency = "₱" }: PriceBoxProps) {
  if (price === null) return null;

  const hasDiscount =
    compareAtPrice !== null && compareAtPrice !== undefined && compareAtPrice > price;
  const discountPct = hasDiscount
    ? Math.round(((compareAtPrice - price) / compareAtPrice) * 100)
    : null;

  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <span className="text-lg font-bold text-ink" data-testid="price">
        {formatPrice(price, currency)}
      </span>
      {hasDiscount && (
        <>
          <span className="text-sm text-ink-muted line-through">
            {formatPrice(compareAtPrice!, currency)}
          </span>
          <span className="rounded bg-sale px-1.5 py-0.5 text-xs font-semibold text-white">
            {discountPct}% OFF
          </span>
        </>
      )}
    </div>
  );
}

export function PriceBoxSkeleton(): ReactNode {
  return (
    <div className="flex items-baseline gap-2">
      <div className="h-5 w-20 animate-pulse rounded bg-border" />
      <div className="h-4 w-14 animate-pulse rounded bg-border/60" />
    </div>
  );
}
