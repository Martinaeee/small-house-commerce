// src/lib/useCartRecommendations.ts
"use client";

import { useEffect, useMemo, useState } from "react";
import { api, type CartSummary, type Product, type Sku } from "@/lib/api";
import { fetchProduct } from "@/lib/productCache";

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

export function firstSku(product: Product): Sku | null {
  return product.variants.find((variant) => variant.sku)?.sku ?? null;
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
      const sku = firstSku(product);
      return sku !== null && sku.price !== null && sku.availableInventory > 0;
    };

    const ranked = (list: Product[]) =>
      list
        .filter(eligible)
        .map((product) => ({ product, pct: discountPct(firstSku(product)!) }))
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
