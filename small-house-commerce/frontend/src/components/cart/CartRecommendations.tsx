// src/components/cart/CartRecommendations.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import type { Product } from "@/lib/api";
import { useCart } from "./CartContext";
import {
  discountPct,
  firstSku,
  useCartRecommendations,
} from "@/lib/useCartRecommendations";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";
import { formatPrice } from "@/components/ui/PriceBox";

/** Compact "You May Also Like" strip; pool fetch and ranking live in useCartRecommendations. */
export function CartRecommendations() {
  const { cart, addItem } = useCart();
  const recommendations = useCartRecommendations(cart);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [addedSlug, setAddedSlug] = useState<string | null>(null);

  if (recommendations.length === 0) return null;

  async function quickAdd(product: Product) {
    const sku = firstSku(product);
    if (!sku || busySlug) return;
    setBusySlug(product.slug);
    try {
      await addItem({ skuId: sku.id, quantity: 1 });
      setAddedSlug(product.slug);
      setTimeout(() => {
        setAddedSlug((current) => (current === product.slug ? null : current));
      }, 1400);
    } catch {
      /* the card stays put; the visitor can open the PDP */
    } finally {
      setBusySlug(null);
    }
  }

  return (
    <section className="mt-8" aria-label="Recommended products">
      <h2 className="mb-3 text-base font-semibold text-ink">You May Also Like</h2>
      <ul className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
        {recommendations.map((product) => {
          const sku = firstSku(product)!;
          const pct = discountPct(sku);
          const image = product.images[0];
          const busy = busySlug === product.slug;
          const added = addedSlug === product.slug;
          return (
            <li key={product.id} className="w-32 shrink-0 sm:w-auto">
              <div className="flex h-full flex-col rounded-lg border border-border bg-card p-2.5">
                <Link href={`/products/${product.slug}`} className="relative block">
                  {image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={image.url}
                      alt={image.altText ?? product.name}
                      className="aspect-square w-full rounded object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <PlaceholderImage
                      label={product.name}
                      className="aspect-square w-full rounded"
                    />
                  )}
                  {pct > 0 && (
                    <span className="absolute left-1.5 top-1.5 rounded bg-sale px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                      -{pct}%
                    </span>
                  )}
                </Link>

                <Link
                  href={`/products/${product.slug}`}
                  className="mt-2 line-clamp-1 text-xs font-medium text-ink hover:text-cta"
                >
                  {product.name}
                </Link>

                <div className="mt-auto flex items-end justify-between gap-1 pt-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">{formatPrice(sku.price!)}</p>
                    {pct > 0 && (
                      <p className="text-[11px] leading-tight text-ink-muted line-through">
                        {formatPrice(sku.compareAtPrice!)}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => quickAdd(product)}
                    disabled={busy}
                    aria-label={`Add ${product.name} to cart`}
                    data-testid={`rec-add-${product.slug}`}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cta text-white transition-colors hover:bg-cta-hover disabled:opacity-60"
                  >
                    {busy ? (
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                    ) : added ? (
                      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
                        <path
                          d="M3 8.5 6.5 12 13 4.5"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
                        <path
                          d="M8 3v10M3 8h10"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
