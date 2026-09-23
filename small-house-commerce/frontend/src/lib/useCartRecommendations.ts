// src/lib/useCartRecommendations.ts
"use client";

import { useEffect, useMemo, useState } from "react";
import { api, type CartSummary, type Product, type Sku } from "@/lib/api";
import { fetchProduct } from "@/lib/productCache";
import { createInitialSelection, resolveSelection } from "@/lib/product-selection";

/**
 * "You May Also Like" data for the cart page strip and the add-to-cart
 * drawer. Candidate sources, in priority order: the best-sellers collection,
 * general-catalog products from OTHER categories than the cart lines, and
 * same-category products only to fill gaps. Rationale: once a shopper buys
 * one type of home goods (e.g. a folding chair) the need is largely met, so
 * cross-type best sellers outrank near-duplicates. Discounted in-stock
 * products rank first within every source; same-product slugs and OOS
 * products are never recommended. Logic moved verbatim from
 * CartRecommendations.tsx.
 */
export const RECOMMENDATIONS_TAKE = 3;
const POOL_PAGE_SIZE = 24;

interface Pools {
  cartKey: string;
  cartCategoryIds: string[];
  bestSellers: Product[];
  general: Product[];
}

/**
 * The single sellable SKU for a direct quick-add, resolved through the shared
 * selection contract — never a positional pick (Task 20 sweep of the former
 * `firstSku`, which took variants[0]). A product with several sellable SKUs
 * has no honest direct-add SKU: the combination must be chosen through the
 * picker (or the PDP), so this returns null and the UI opens the picker.
 */
export function directAddSku(product: Product): Sku | null {
  const { selectableVariants } = resolveSelection(
    product,
    createInitialSelection(product, null),
  );
  if (selectableVariants.length !== 1) return null;
  return selectableVariants[0].sku ?? null;
}

/**
 * Recommendable product: at least one sellable (ACTIVE, priced) SKU with
 * inventory, regardless of its position in the payload.
 */
export function quickAddEligible(product: Product): boolean {
  const { selectableVariants } = resolveSelection(
    product,
    createInitialSelection(product, null),
  );
  return selectableVariants.some(
    (variant) =>
      variant.sku !== null &&
      variant.sku.price !== null &&
      variant.sku.availableInventory > 0,
  );
}

export function discountPct(sku: Sku): number {
  if (sku.price === null || !sku.compareAtPrice || sku.compareAtPrice <= sku.price) {
    return 0;
  }
  return Math.round((1 - sku.price / sku.compareAtPrice) * 100);
}

export function useCartRecommendations(cart: CartSummary | null): Product[] {
  const cartSlugs = useMemo(
    () => [...new Set((cart?.items ?? []).map((item) => item.productSlug))],
    [cart],
  );
  const cartKey = cartSlugs.join(",");
  const [pools, setPools] = useState<Pools | null>(null);

  // Resolve cart-line categories (detail payloads are session-cached), then
  // fetch the three candidate pools. State is only set after the awaits.
  useEffect(() => {
    if (cartKey === "") return;
    let cancelled = false;
    void (async () => {
      const cartProducts = (
        await Promise.all(cartSlugs.map((slug) => fetchProduct(slug)))
      ).filter((product): product is Product => product !== null);
      const cartCategoryIds = [...new Set(cartProducts.map((product) => product.categoryId))];

      const [bestSellersPage, generalPage] = await Promise.all([
        api.getCollectionProducts("best-sellers").catch(() => null),
        api.getProducts({ pageSize: POOL_PAGE_SIZE }).catch(() => null),
      ]);

      if (cancelled) return;

      setPools({
        cartKey,
        cartCategoryIds,
        bestSellers: bestSellersPage?.items ?? [],
        general: generalPage?.items ?? [],
      });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartKey]);

  return useMemo<Product[]>(() => {
    if (!pools || pools.cartKey !== cartKey) return [];
    const inCart = new Set(cartSlugs);
    const cartCategories = new Set(pools.cartCategoryIds);

    const eligible = (product: Product) => {
      if (inCart.has(product.slug)) return false;
      return quickAddEligible(product);
    };

    const ranked = (list: Product[]) =>
      list
        .filter(eligible)
        .map((product) => {
          // Discount ranking is only claimable for a direct-add SKU: a
          // multi-SKU product has no one honest price/compare-at pair, so it
          // ranks at 0 instead of borrowing the first SKU's discount.
          const sku = directAddSku(product);
          return { product, pct: sku ? discountPct(sku) : 0 };
        })
        .sort((a, b) => b.pct - a.pct)
        .map((entry) => entry.product);

    // Best sellers first (never same product as a cart line); then other
    // categories for cross-type discovery; same category only fills gaps.
    const otherCategory = pools.general.filter(
      (product) => !cartCategories.has(product.categoryId),
    );
    const sameCategory = pools.general.filter((product) =>
      cartCategories.has(product.categoryId),
    );

    const chosen: Product[] = [];
    const seen = new Set<string>();
    for (const product of [
      ...ranked(pools.bestSellers),
      ...ranked(otherCategory),
      ...ranked(sameCategory),
    ]) {
      if (seen.has(product.slug)) continue;
      seen.add(product.slug);
      chosen.push(product);
      if (chosen.length >= RECOMMENDATIONS_TAKE) break;
    }
    return chosen;
  }, [pools, cartKey, cartSlugs]);
}
