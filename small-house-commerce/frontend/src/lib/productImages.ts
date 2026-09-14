// src/lib/productImages.ts
"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

/**
 * The storefront cart payload carries product slugs but no image URLs (the
 * backend is frozen). Cart/checkout resolve the first product image via the
 * public product-by-slug endpoint, cached here for the whole session so each
 * product is fetched at most once even when it appears on several pages.
 */
const imageCache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

export function fetchProductImage(slug: string): Promise<string | null> {
  const cached = imageCache.get(slug);
  if (cached !== undefined) return Promise.resolve(cached);
  const existing = inflight.get(slug);
  if (existing) return existing;

  const promise = api
    .getProductBySlug(slug)
    .then((product) => {
      const url = product.images[0]?.url ?? null;
      imageCache.set(slug, url);
      return url;
    })
    .catch(() => {
      // A failed lookup renders the placeholder; don't retry on every render.
      imageCache.set(slug, null);
      return null;
    })
    .finally(() => {
      inflight.delete(slug);
    });
  inflight.set(slug, promise);
  return promise;
}

/**
 * Returns a slug -> first-image-url map (null/absent means "use placeholder").
 * Re-renders once when cached-missing slugs resolve.
 */
export function useProductImages(slugs: readonly string[]): Map<string, string | null> {
  const dedupedKey = [...new Set(slugs)].join(",");
  const [map, setMap] = useState<Map<string, string | null>>(() => {
    const initial = new Map<string, string | null>();
    for (const slug of new Set(slugs)) {
      const cached = imageCache.get(slug);
      if (cached !== undefined) initial.set(slug, cached);
    }
    return initial;
  });

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
