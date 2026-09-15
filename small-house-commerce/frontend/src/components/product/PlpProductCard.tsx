"use client";

import { useState } from "react";
import Link from "next/link";
import type { Product, ProductVariant } from "@/lib/api";
import type { CardBadge } from "@/lib/plpBadges";
import { useCart } from "@/components/cart/CartContext";
import { track } from "@/lib/tracking";
import { PriceBox } from "@/components/ui/PriceBox";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";
import { RatingStars } from "./RatingStars";

/**
 * Castlery-style PLP card (category pages only; the shared static ProductCard
 * still serves homepage/collections). Merchandise badges (Best Seller/New and
 * an optional promo chip) come from collection membership passed by the
 * parent — never invented.
 * Variant-name buttons switch the main image by positional mapping
 * (variant index -> images sorted by sortOrder, fallback to the first image)
 * until the backend links images to variants directly.
 */

interface PlpProductCardProps {
  product: Product;
  badges: CardBadge[];
}

function firstSellableIndex(variants: readonly ProductVariant[]): number {
  const i = variants.findIndex((v) => v.sku !== null && v.sku.price !== null);
  return i === -1 ? 0 : i;
}

export function PlpProductCard({ product, badges }: PlpProductCardProps) {
  const { addItem } = useCart();
  const [selectedIndex, setSelectedIndex] = useState(() => firstSellableIndex(product.variants));
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);

  const variant = product.variants[selectedIndex] ?? null;
  const sku = variant?.sku ?? null;
  const sellable = sku !== null && sku.price !== null;
  const inStock = sellable && sku!.availableInventory > 0;
  const hasAnySellable = product.variants.some((v) => v.sku !== null && v.sku!.price !== null);

  const sortedImages = [...product.images].sort((a, b) => a.sortOrder - b.sortOrder);
  const image =
    sortedImages[selectedIndex] ?? sortedImages[0] ?? null;

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
          // Selecting an out-of-stock style replaces the merchandise badge.
          const showOos = !hasAnySellable || (sellable && !inStock);
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
        {product.variants.length > 1 && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={`${product.name} styles`}>
            {product.variants.map((v, i) => {
              const disabled = v.sku === null;
              const active = i === selectedIndex;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => !disabled && setSelectedIndex(i)}
                  disabled={disabled}
                  aria-pressed={active}
                  data-testid={`plp-variant-${product.slug}-${i}`}
                  className={`max-w-[8rem] truncate rounded-full border px-2.5 py-1 text-[11px] leading-none transition-colors ${
                    active
                      ? "border-cta bg-cta text-white"
                      : "border-border bg-card text-ink-secondary hover:border-primary hover:text-cta"
                  } ${disabled ? "cursor-not-allowed opacity-40 hover:border-border hover:text-ink-secondary" : ""}`}
                >
                  {v.name}
                </button>
              );
            })}
          </div>
        )}

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
              onClick={quickAdd}
              disabled={!inStock || busy}
              data-testid={`plp-add-${product.slug}`}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-cta py-2 text-sm font-medium text-white transition-colors hover:bg-cta-hover disabled:cursor-not-allowed disabled:bg-border disabled:text-ink-muted"
            >
              {busy ? (
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
