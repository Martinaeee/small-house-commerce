"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import type { Product } from "@/lib/api";
import { useCart } from "@/components/cart/CartContext";
import { useCartRecommendations, directAddSku, quickAddEligible, discountPct } from "@/lib/useCartRecommendations";
import { addToCartEvent, emitCommerceEvent } from "@/lib/commerce-events";
import { formatPrice } from "@/components/ui/PriceBox";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";
import { optimizedUploadImage } from "@/lib/image-url";
import { useDesktopViewport } from "./useDesktopViewport";
import styles from "./PdpMobile.module.css";

/** Three compact cards fit one phone screen without becoming a second product rail. */
const QUICK_TAKE = 3;

function lowestPrice(product: Product): number | null {
  const prices = product.variants
    .filter(variant => variant.sku !== null && variant.sku.price !== null && variant.sku.status === "ACTIVE")
    .map(variant => variant.sku!.price!);
  return prices.length ? Math.min(...prices) : null;
}

/**
 * Phone-only quick-add strip ahead of the long-form details: the shopper can
 * add a complement without scrolling to the bottom rail. Products come from
 * the page's related list, then the shared cart recommender; the current
 * product, cart lines and sold-out products never appear.
 */
export function PdpQuickRecommendations({ currentProduct, fallback }: {
  currentProduct: Product;
  fallback: Product[];
}): ReactNode {
  const { cart, addItem, openPicker } = useCart();
  const desktop = useDesktopViewport();
  const fromCart = useCartRecommendations(cart, QUICK_TAKE, true);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [addedSlug, setAddedSlug] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const alive = useRef(true);

  const list = useMemo(() => {
    const cartSlugs = new Set((cart?.items ?? []).map(item => item.productSlug));
    const chosen: Product[] = [];
    const seen = new Set<string>();
    for (const product of [...fallback, ...fromCart]) {
      if (product.id === currentProduct.id || cartSlugs.has(product.slug) || seen.has(product.slug)) continue;
      if (!quickAddEligible(product)) continue;
      seen.add(product.slug);
      chosen.push(product);
      if (chosen.length >= QUICK_TAKE) break;
    }
    return chosen;
  }, [cart, currentProduct.id, fromCart, fallback]);

  if (desktop || list.length === 0) return null;

  async function quickAdd(product: Product) {
    if (busySlug !== null) return;
    const sku = directAddSku(product);
    if (!sku) {
      // Several sellable combinations have no honest one-click SKU; the shared
      // picker asks the shopper instead of adding an arbitrary variant.
      openPicker(product, { intent: "ADD_TO_CART" });
      return;
    }
    setBusySlug(product.slug);
    setNotice(null);
    alive.current = true;
    try {
      await addItem({ skuId: sku.id, quantity: 1 }, { openDrawer: false });
      emitCommerceEvent(addToCartEvent({
        productId: product.id,
        productName: product.name,
        skuId: sku.id,
        quantity: 1,
        price: sku.price,
      }));
      if (!alive.current) return;
      setAddedSlug(product.slug);
      setNotice({ text: "Added to cart", ok: true });
      window.setTimeout(() => {
        setAddedSlug(current => current === product.slug ? null : current);
      }, 1400);
    } catch {
      if (alive.current) setNotice({ text: "Could not add. Try again.", ok: false });
    } finally {
      if (alive.current) setBusySlug(null);
    }
  }

  return (
    <section className={styles.quickRail} aria-label="Quick add recommendations">
      <div className={styles.quickRailHead}>
        <span>Complete the room</span>
        {notice && <p role="status" data-ok={notice.ok ? "true" : "false"} className={styles.quickNotice}>{notice.text}</p>}
      </div>
      <ul className={styles.quickRailTrack}>
        {list.map(product => {
          const direct = directAddSku(product);
          const price = direct?.price ?? lowestPrice(product);
          const off = direct ? discountPct(direct) : 0;
          const busy = busySlug === product.slug;
          const added = addedSlug === product.slug;
          return (
            <li key={product.id} className={styles.quickCard}>
              <Link href={`/products/${product.slug}`} className={styles.quickMedia} aria-label={`View ${product.name}`}>
                {product.effectiveCoverMedia ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={optimizedUploadImage(product.effectiveCoverMedia.url, 256)}
                    alt={product.effectiveCoverMedia.altText ?? product.name}
                    loading="lazy"
                  />
                ) : <PlaceholderImage label={product.name} />}
                {off > 0 && <span className={styles.quickOff}>-{off}%</span>}
              </Link>
              <div className={styles.quickCopy}>
                <Link href={`/products/${product.slug}`} className={styles.quickName}>{product.name}</Link>
                <span className={styles.quickPrice}>
                  {direct ? formatPrice(price!) : <><span className={styles.quickFrom}>From</span> {price === null ? "—" : formatPrice(price)}</>}
                </span>
              </div>
              <button
                type="button"
                className={styles.quickAdd}
                aria-label={`Add ${product.name} to cart`}
                disabled={busy || busySlug !== null}
                onClick={() => void quickAdd(product)}
              >
                {busy
                  ? <span className={styles.quickSpin} aria-hidden="true" />
                  : added
                    ? <span aria-hidden="true">✓</span>
                    : <span aria-hidden="true">+</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
