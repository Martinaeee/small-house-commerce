import type { ProductSelectionDerived } from "./product-selection";

/**
 * Price presentation for surfaces where the visitor has not chosen options
 * yet (product cards, the Quick Add picker). Derived exclusively from the
 * shared selection state — never from a positionally-picked SKU:
 *
 * - A resolved selection (single sellable SKU auto-resolves) shows its exact
 *   price and compare-at price.
 * - Unresolved selections show one price when every sellable SKU shares it,
 *   otherwise the lowest price as "From ₱X" (DESIGN §10.1, one site-wide
 *   form).
 */
export interface CardPricePresentation {
  /** "exact" = one price; "from" = starting-at floor for differing prices. */
  kind: "exact" | "from";
  price: number;
  compareAtPrice: number | null;
  /**
   * Integer percent off derived from a strictly higher compare-at price
   * (rounded to the nearest integer). Null whenever there is no honest
   * discount: absent/equal/lower compare-at, non-positive or malformed
   * inputs, or a percentage that would round to 0 ("0% OFF" is noise).
   */
  discountPercent: number | null;
}

function discountPercentFor(
  price: number,
  compareAtPrice: number | null,
): number | null {
  if (compareAtPrice === null) return null;
  if (!Number.isFinite(price) || !Number.isFinite(compareAtPrice)) return null;
  if (price <= 0 || compareAtPrice <= 0) return null;
  if (compareAtPrice <= price) return null;
  const percent = Math.round(((compareAtPrice - price) / compareAtPrice) * 100);
  // A discount chip must never claim 100% OFF on a positive price: 99.5+%
  // rounds to 100, so cap the integer at 99.
  return percent > 0 ? Math.min(percent, 99) : null;
}

export function cardPricePresentation(
  derived: ProductSelectionDerived,
): CardPricePresentation | null {
  const prices = derived.selectableVariants
    .map((variant) => variant.sku?.price ?? null)
    .filter((price): price is number => price !== null);
  if (prices.length === 0) return null;

  if (derived.resolvedVariant !== null) {
    const price = derived.price ?? prices[0];
    return {
      kind: "exact",
      price,
      compareAtPrice: derived.compareAtPrice,
      discountPercent: discountPercentFor(price, derived.compareAtPrice),
    };
  }

  const uniform = prices.every((price) => price === prices[0]);
  if (!uniform) {
    return {
      kind: "from",
      price: Math.min(...prices),
      compareAtPrice: null,
      discountPercent: null,
    };
  }

  // Uniform price: the compare-at price is only shown when the default
  // display variant actually sells at that price, so the discount math
  // always matches the price on screen.
  const display = derived.displayVariant;
  const compareAtPrice =
    display?.sku && display.sku.price === prices[0]
      ? display.sku.compareAtPrice
      : null;
  return {
    kind: "exact",
    price: prices[0],
    compareAtPrice,
    discountPercent: discountPercentFor(prices[0], compareAtPrice),
  };
}
