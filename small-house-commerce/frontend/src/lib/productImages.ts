// src/lib/productImages.ts
"use client";

import { useEffect, useState } from "react";
import { fetchProduct } from "@/lib/productCache";

/**
 * The storefront cart payload carries product slugs but no image URLs (the
 * backend is frozen). Cart/checkout resolve the first product image via the
 * public product-by-slug endpoint; the product payload is cached for the
 * whole session in productCache, so each product is fetched at most once even
 * when it appears on several pages.
 */
export function fetchProductImage(slug: string): Promise<string | null> {
  return fetchProduct(slug).then((product) => product?.images[0]?.url ?? null);
}

/**
 * Returns a slug -> first-image-url map (null/absent means "use placeholder").
 * Re-renders once when cached-missing slugs resolve.
 */
export function useProductImages(slugs: readonly string[]): Map<string, string | null> {
  const dedupedKey = [...new Set(slugs)].join(",");
  const [map, setMap] = useState<Map<string, string | null>>(new Map());

  useEffect(() => {
    let cancelled = false;
    const unique = dedupedKey ? dedupedKey.split(",") : [];
    if (unique.length === 0) return;

    // Cached lookups resolve on the microtask queue, so this always sets
    // state from a settlement callback, never synchronously.
    void Promise.all(
      unique.map(async (slug) => [slug, await fetchProductImage(slug)] as const),
    ).then((entries) => {
      if (cancelled) return;
      setMap(new Map(entries));
    });

    return () => {
      cancelled = true;
    };
  }, [dedupedKey]);

  return map;
}
