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
}

export function cardPricePresentation(
  derived: ProductSelectionDerived,
): CardPricePresentation | null {
  const prices = derived.selectableVariants
    .map((variant) => variant.sku?.price ?? null)
    .filter((price): price is number => price !== null);
  if (prices.length === 0) return null;

  if (derived.resolvedVariant !== null) {
    return {
      kind: "exact",
      price: derived.price ?? prices[0],
      compareAtPrice: derived.compareAtPrice,
    };
  }

  const uniform = prices.every((price) => price === prices[0]);
  if (!uniform) {
    return { kind: "from", price: Math.min(...prices), compareAtPrice: null };
  }

  // Uniform price: the compare-at price is only shown when the default
  // display variant actually sells at that price, so the discount math
  // always matches the price on screen.
  const display = derived.displayVariant;
  const compareAtPrice =
    display?.sku && display.sku.price === prices[0]
      ? display.sku.compareAtPrice
      : null;
  return { kind: "exact", price: prices[0], compareAtPrice };
}
