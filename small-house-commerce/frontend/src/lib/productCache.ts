// src/lib/productCache.ts
"use client";

import { api, type Product } from "@/lib/api";

/**
 * Session cache for full product detail payloads (the list endpoint carries
 * prices/stock but not everything; cart recommendations need each cart line's
 * categoryId). One request per product per session, de-duplicated in flight.
 */
const productCache = new Map<string, Product | null>();
const inflight = new Map<string, Promise<Product | null>>();

export function fetchProduct(slug: string): Promise<Product | null> {
  const cached = productCache.get(slug);
  if (cached !== undefined) return Promise.resolve(cached);
  const existing = inflight.get(slug);
  if (existing) return existing;

  const promise = api
    .getProductBySlug(slug)
    .then((product) => {
      productCache.set(slug, product);
      return product;
    })
    .catch(() => {
      productCache.set(slug, null);
      return null;
    })
    .finally(() => {
      inflight.delete(slug);
    });
  inflight.set(slug, promise);
  return promise;
}
