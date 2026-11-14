"use client";

import { useState } from "react";
import Link from "next/link";
import type { Product } from "@/lib/api";
import { useCart } from "./CartContext";
import {
  defaultAddSku,
  useCartRecommendations,
} from "@/lib/useCartRecommendations";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";
import { formatPrice } from "@/components/ui/PriceBox";
import { cardPricePresentation } from "@/lib/product-card-presentation";
import { createInitialSelection, resolveSelection } from "@/lib/product-selection";
import { optimizedUploadImage } from "@/lib/image-url";
import styles from "./AddToCartSuccess.module.css";

/**
 * JD-style confirmation shown in the same drawer that held the picker: the
 * title rises from the middle into the header while cross-category picks fill
 * the body, and the footer offers "continue shopping" or the cart/checkout.
 * It deliberately fires no pixel events — AddToCart stays at the call sites.
 */
export function AddToCartSuccess({
  onContinue,
  onCheckout,
}: {
  onContinue: () => void;
  onCheckout: () => void;
}) {
  const { cart, addItem } = useCart();
  const recommendations = useCartRecommendations(cart, 3, true);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [addedSlug, setAddedSlug] = useState<string | null>(null);

  async function quickAdd(product: Product) {
    const sku = defaultAddSku(product);
    if (!sku || busySlug !== null) return;
    setBusySlug(product.slug);
    try {
      await addItem({ skuId: sku.id, quantity: 1 }, { openDrawer: false });
      setAddedSlug(product.slug);
      window.setTimeout(() => {
        setAddedSlug((current) => (current === product.slug ? null : current));
      }, 1400);
    } catch {
      /* the row stays put; the shopper can still open the PDP */
    } finally {
      setBusySlug(null);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={styles.hero} aria-live="polite">
        <div className={styles.title}>
          <span className={styles.check} aria-hidden="true">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
              <path d="M5 12.5 10 17.5 19 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <h2 className="text-base font-semibold text-ink">Added to cart</h2>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3">
        {recommendations.length > 0 ? (
          <>
            <h3 className="mb-2 text-sm font-semibold text-ink">More picks for you</h3>
            <ul className="flex flex-col gap-3" aria-label="Recommended products">
              {recommendations.map((product) => {
                const sku = defaultAddSku(product);
                const derived = resolveSelection(
                  product,
                  createInitialSelection(product, product.defaultDisplayVariantId),
                );
                const price = cardPricePresentation(derived);
                const image = product.effectiveCoverMedia;
                const direct = sku !== null;
                return (
                  <li key={product.id} className="flex items-center gap-3">
                    <Link
                      href={`/products/${product.slug}`}
                      onClick={onContinue}
                      className="h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-border"
                    >
                      {image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={optimizedUploadImage(image.url, 96)}
                          alt={image.altText ?? product.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <PlaceholderImage label={product.name} className="h-full w-full" />
                      )}
                    </Link>
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/products/${product.slug}`}
                        onClick={onContinue}
                        className="line-clamp-2 text-xs font-medium text-ink hover:text-cta"
                      >
                        {product.name}
                      </Link>
                      {price ? (
                        <p className="text-sm font-semibold text-ink">
                          {price.kind === "from" ? `From ${formatPrice(price.price)}` : formatPrice(price.price)}
                        </p>
                      ) : null}
                    </div>
                    {direct ? (
                      <button
                        type="button"
                        onClick={() => void quickAdd(product)}
                        disabled={busySlug !== null}
                        aria-label={`Add ${product.name} to cart`}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cta text-cta-foreground transition-colors hover:bg-cta-hover disabled:opacity-60"
                      >
                        {busySlug === product.slug ? (
                          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                        ) : addedSlug === product.slug ? (
                          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
                            <path d="M3 8.5 6.5 12 13 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        ) : (
                          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
                            <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          </svg>
                        )}
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
      </div>

      <div className="grid shrink-0 grid-cols-2 gap-2 border-t border-border p-3">
        <button
          type="button"
          onClick={onContinue}
          className="flex h-10 items-center justify-center rounded-lg border border-border text-sm font-semibold text-cta transition-colors hover:border-cta hover:bg-primary-light/40"
        >
          Continue shopping
        </button>
        <button
          type="button"
          onClick={onCheckout}
          className="flex h-10 items-center justify-center rounded-lg bg-cta text-sm font-semibold text-cta-foreground transition-colors hover:bg-cta-hover"
        >
          Go to cart
        </button>
      </div>
    </div>
  );
}
