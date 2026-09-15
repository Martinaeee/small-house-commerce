"use client";

import { useState } from "react";
import Link from "next/link";
import type { Product } from "@/lib/api";
import type { CardBadge } from "@/lib/plpBadges";
import { useCart } from "@/components/cart/CartContext";
import { sellableVariants, sortedProductImages } from "@/lib/variantImages";
import { track } from "@/lib/tracking";
import { PriceBox } from "@/components/ui/PriceBox";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";
import { RatingStars } from "./RatingStars";

/**
 * Castlery-style PLP card (category pages only; the shared static ProductCard
 * still serves homepage/collections). Merchandise badges (Best Seller/New and
 * an optional promo chip) come from collection membership passed by the
 * parent — never invented.
 * Multi-style products open the quick-add variant picker; single-style
 * products add directly. The picker owns the positional variant→image mapping
 * until the backend links images to variants directly.
 */

interface PlpProductCardProps {
  product: Product;
  badges: CardBadge[];
}

export function PlpProductCard({ product, badges }: PlpProductCardProps) {
  const { addItem, openPicker } = useCart();
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);

  const sellable = sellableVariants(product);
  const hasMultipleStyles = sellable.length > 1;
  const sku = sellable[0]?.sku ?? null;
  const inStock = sku !== null && sku.availableInventory > 0;
  const hasAnySellable = sellable.length > 0;

  const image = sortedProductImages(product)[0] ?? null;

  async function quickAdd() {
    if (!sku || busy || !inStock) return;
    setBusy(true);
    try {
      await addItem({ skuId: sku.id, quantity: 1 });
      track("AddToCart", {
        content_ids: [sku.id],
        content_name: product.name,
        content_type: "product",
        contents: [{ id: sku.id, quantity: 1 }],
        value: sku.price,
        currency: "PHP",
      });
      setAdded(true);
      setTimeout(() => {
        setAdded((current) => (current ? false : current));
      }, 1400);
    } catch {
      /* the card stays put; the visitor can open the PDP */
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="group flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-primary focus-within:border-primary">
      <Link href={`/products/${product.slug}`} className="relative block">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image.url}
            alt={image.altText ?? product.name}
            className="aspect-[4/5] w-full object-cover"
            loading="lazy"
          />
        ) : (
          <PlaceholderImage label={product.name} className="aspect-[4/5] w-full" />
        )}

        {(() => {
          // An out-of-stock card replaces the merchandise badge; multi-style
          // cards keep product badges (the picker shows per-style stock).
          const showOos = !hasAnySellable || (!hasMultipleStyles && !inStock);
          if (showOos) {
            return (
              <span className="absolute left-3 top-3 rounded bg-ink/85 px-2 py-1 text-xs font-semibold text-white">
                Out of Stock
              </span>
            );
          }
          if (badges.length === 0) return null;
          return (
            <span className="absolute left-3 top-3 flex gap-1.5">
              {badges.slice(0, 2).map((badge) => (
                <span
                  key={`${badge.kind}-${badge.label}`}
                  className={`rounded px-2 py-1 text-xs font-semibold text-white ${
                    badge.kind === "promo"
                      ? "bg-sale"
                      : badge.kind === "new"
                        ? "bg-primary-dark/90"
                        : "bg-ink/85"
                  }`}
                >
                  {badge.label}
                </span>
              ))}
            </span>
          );
        })()}
      </Link>

      <div className="flex flex-1 flex-col gap-1.5 p-3 sm:p-4">
        <h3 className="line-clamp-2 text-sm font-semibold text-ink">
          <Link href={`/products/${product.slug}`} className="hover:text-cta">
            {product.name}
          </Link>
        </h3>

        <PriceBox price={sku?.price ?? null} compareAtPrice={sku?.compareAtPrice ?? null} />
        {product.reviewCount > 0 && (
          <div className="flex items-center gap-1">
            <RatingStars value={product.ratingAverage ?? 0} className="text-xs" />
            <span className="text-xs text-ink-muted">({product.reviewCount})</span>
          </div>
        )}

        <div className="mt-auto pt-2">
          {hasAnySellable ? (
            <button
              type="button"
              onClick={hasMultipleStyles ? () => openPicker(product) : quickAdd}
              disabled={hasMultipleStyles ? false : !inStock || busy}
              data-testid={`plp-add-${product.slug}`}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-cta py-2 text-sm font-medium text-white transition-colors hover:bg-cta-hover disabled:cursor-not-allowed disabled:bg-border disabled:text-ink-muted"
            >
              {hasMultipleStyles
                ? "Add to Cart"
                : busy ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                    Adding…
                  </>
                ) : added ? (
                  <>
                    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
                      <path
                        d="M3 8.5 6.5 12 13 4.5"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    Added
                  </>
                ) : inStock ? (
                  "Add to Cart"
                ) : (
                  "Out of Stock"
                )}
            </button>
          ) : (
            <Link
              href={`/products/${product.slug}`}
              className="block w-full rounded-lg border border-border bg-card py-2 text-center text-sm font-medium text-ink-secondary transition-colors hover:border-primary hover:text-cta"
            >
              View Details
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}
