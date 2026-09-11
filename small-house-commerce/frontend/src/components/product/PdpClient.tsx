// src/components/product/PdpClient.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { Product } from "@/lib/api";
import { api, cartStorage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { formatPrice, PriceBox } from "@/components/ui/PriceBox";
import { track } from "@/lib/tracking";
import { RatingStars } from "./RatingStars";
import { ProductGallery } from "./ProductGallery";
import { ProductLightbox } from "./ProductLightbox";
import { ProductDetailsModal } from "./ProductDetailsModal";
import { MobileStickyCta } from "./MobileStickyCta";

/** Small inline cart glyph used for the mobile quick-add action. */
function CartGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M3 4h2l2.2 12.2a1.5 1.5 0 0 0 1.5 1.3h7.9a1.5 1.5 0 0 0 1.5-1.2L21 8H6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="10" cy="20.5" r="1.2" />
      <circle cx="18" cy="20.5" r="1.2" />
    </svg>
  );
}

export function PdpClient({ product, categoryName }: { product: Product; categoryName: string | null }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const variants = product.variants;
  const images = product.images;

  const firstSellable = useMemo(
    () => variants.find((v) => v.sku !== null) ?? null,
    [variants],
  );

  const initialVariant =
    variants.find((v) => v.id === searchParams.get("variant")) ?? firstSellable;
  const initialVariantId = initialVariant?.id ?? null;
  const initialIdRef = useRef(initialVariantId);

  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(
    initialVariantId,
  );
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [galleryActive, setGalleryActive] = useState(0);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const selectedVariant = variants.find((v) => v.id === selectedVariantId) ?? null;
  const sku = selectedVariant?.sku ?? null;
  const available = sku?.availableInventory ?? 0;
  const outOfStock = sku === null || available <= 0;
  const lowStock = !outOfStock && available <= 5;
  const price = sku?.price ?? null;
  const compareAt = sku?.compareAtPrice ?? null;
  const hasDimensions =
    product.width !== null || product.height !== null || product.depth !== null ||
    product.foldedWidth !== null || product.foldedHeight !== null ||
    product.foldedDepth !== null;

  // Refs guard the two-direction URL sync so neither side loops. Browser
  // Back/Forward is a popstate: reconcile state inside the subscription
  // (set-state-in-effect lint rule allows listeners), and swallow the one
  // state->URL push it would otherwise trigger in the same commit — sibling
  // effects still see the pre-reconciliation state snapshot.
  const urlVariant = searchParams.get("variant");
  const suppressPushRef = useRef(false);
  const variantsRef = useRef({ variants, firstSellable });
  const selectedVariantRef = useRef(selectedVariantId);

  // Mirrors for the popstate listener; updated outside of render.
  useEffect(() => {
    variantsRef.current = { variants, firstSellable };
    selectedVariantRef.current = selectedVariantId;
  });

  useEffect(() => {
    const syncFromUrl = () => {
      const next = new URLSearchParams(window.location.search).get("variant");
      const { variants: list, firstSellable: first } = variantsRef.current;
      const matched = next ? list.find((v) => v.id === next) : undefined;
      const target = matched?.id ?? first?.id ?? null;
      if (target && selectedVariantRef.current !== target) {
        suppressPushRef.current = true;
        setSelectedVariantId(target);
      }
    };
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, []);

  // Keep ?variant= in sync (push so browser back restores the previous selection).
  useEffect(() => {
    if (suppressPushRef.current) {
      suppressPushRef.current = false;
      return;
    }
    if (!selectedVariantId) return;
    // A clean URL in sync with the mount-time selection must not gain an entry.
    if (urlVariant === null && selectedVariantId === initialIdRef.current) return;
    if (urlVariant === selectedVariantId) return;
    const params = new URLSearchParams(window.location.search);
    params.set("variant", selectedVariantId);
    router.push(`/products/${product.slug}?${params.toString()}`, { scroll: false });
  }, [selectedVariantId, product.slug, router, urlVariant]);

  // Reserve space for the fixed mobile CTA so the footer stays reachable.
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const apply = () => {
      document.body.style.paddingBottom = mq.matches ? "108px" : "";
    };
    apply();
    mq.addEventListener("change", apply);
    return () => {
      mq.removeEventListener("change", apply);
      document.body.style.paddingBottom = "";
    };
  }, []);

  // TRACKING_SPEC ViewContent — once per product view.
  useEffect(() => {
    track("ViewContent", {
      content_ids: [product.id],
      content_name: product.name,
      content_type: "product",
      value: price ?? undefined,
      currency: "PHP",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id]);

  async function addToCart(qty: number) {
    if (!sku) return;
    setBusy(true);
    setNotice(null);
    try {
      const summary = await api.addToCart({ cartId: cartStorage.get(), skuId: sku.id, quantity: qty });
      cartStorage.set(summary.cartId);
      setNotice("Added to cart");
      track("AddToCart", {
        content_ids: [sku.id],
        content_name: product.name,
        content_type: "product",
        contents: [{ id: sku.id, quantity: qty }],
        value: price ? price * qty : undefined,
        currency: "PHP",
      });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not add to cart");
    } finally {
      setBusy(false);
    }
  }

  function orderNow() {
    if (!sku || sku.availableInventory <= 0) {
      setNotice("This item is out of stock");
      return;
    }
    router.push(`/checkout?skuId=${sku.id}&qty=${quantity}`);
  }

  const stockLabel = outOfStock ? "Out of Stock" : lowStock ? `Only ${available} left` : null;
  const overlayOpen = lightboxIndex !== null || detailsOpen;
  const ratingRow =
    product.reviewCount > 0 && product.ratingAverage !== null ? (
      <a href="#reviews" className="inline-flex items-center gap-2 text-sm text-ink-secondary">
        <RatingStars value={product.ratingAverage} className="text-sm" />
        {product.reviewCount} {product.reviewCount === 1 ? "review" : "reviews"}
      </a>
    ) : (
      <span className="text-sm text-ink-muted">No reviews yet</span>
    );

  return (
    <>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <ProductGallery
          images={images}
          active={galleryActive}
          onSelect={setGalleryActive}
          onOpenLightbox={(i) => setLightboxIndex(i)}
        />

        <div className="flex flex-col gap-4">
          {/* Breadcrumb */}
          {/* Categories have no storefront landing route in V1, so the
              category name is plain text; only Home is a link. */}
          <nav aria-label="Breadcrumb" className="text-xs text-ink-muted">
            <Link href="/" className="hover:text-cta">Home</Link>
            {categoryName && (
              <>
                {" › "}
                <span className="text-ink-secondary">{categoryName}</span>
              </>
            )}
            {" › "}
            <span className="text-ink-secondary">{product.name}</span>
          </nav>

          {/* Name row; quick-add glyph replaces the wishlist heart on mobile */}
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-2xl font-semibold text-ink sm:text-3xl">{product.name}</h1>
            <button
              type="button"
              onClick={() => addToCart(1)}
              disabled={outOfStock || busy}
              aria-label="Add to cart"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border text-cta hover:border-primary disabled:text-ink-muted md:hidden"
            >
              <CartGlyph />
            </button>
          </div>

          {ratingRow}

          <div>
            <PriceBox price={price} compareAtPrice={compareAt} />
            {price !== null && compareAt !== null && compareAt > price && (
              <p className="mt-1 text-sm font-medium text-sale">Save {formatPrice(compareAt - price)}</p>
            )}
          </div>

          {stockLabel && (
            <p className="text-sm font-semibold text-sale" data-testid="stock-state">{stockLabel}</p>
          )}

          {variants.length > 1 && (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-ink-secondary">Variant</span>
              <div className="flex flex-wrap gap-2">
                {variants.map((variant) => (
                  <button
                    key={variant.id}
                    type="button"
                    onClick={() => setSelectedVariantId(variant.id)}
                    disabled={variant.sku === null}
                    aria-pressed={variant.id === selectedVariantId}
                    className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:text-ink-muted ${
                      variant.id === selectedVariantId
                        ? "border-cta bg-primary-light/40 text-cta"
                        : "border-border bg-card text-ink hover:border-primary"
                    }`}
                  >
                    {variant.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {hasDimensions && (
            <button
              type="button"
              onClick={() => setDetailsOpen(true)}
              className="self-start text-sm font-medium text-cta underline-offset-2 hover:underline"
            >
              Size guide
            </button>
          )}

          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-ink-secondary">Qty</span>
            <div className="flex items-center rounded-lg border border-border bg-card">
              <button type="button" aria-label="Decrease quantity"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                className="h-11 w-11 text-lg text-ink hover:text-cta">−</button>
              <span className="w-8 text-center text-base font-semibold" data-testid="qty">{quantity}</span>
              <button type="button" aria-label="Increase quantity"
                onClick={() => setQuantity((q) => Math.min(99, q + 1))}
                className="h-11 w-11 text-lg text-ink hover:text-cta">+</button>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button onClick={orderNow} disabled={busy} className="flex-1" data-testid="order-now">ORDER NOW</Button>
            <Button variant="secondary" onClick={() => addToCart(quantity)} disabled={busy} className="flex-1">
              ADD TO CART
            </Button>
          </div>

          {notice && <p role="status" className="rounded-lg border border-primary bg-primary-light/40 px-3 py-2 text-sm text-cta">{notice}</p>}

          <ul className="mt-2 flex flex-col gap-1 text-sm text-ink-secondary">
            <li className="flex items-center gap-2"><span className="font-semibold text-cta">✓</span> Cash On Delivery Available</li>
            <li className="flex items-center gap-2"><span className="font-semibold text-cta">✓</span> Nationwide Delivery</li>
            <li className="flex items-center gap-2"><span className="font-semibold text-cta">✓</span> Customer Support Available</li>
          </ul>
        </div>
      </div>

      {lightboxIndex !== null && images.length > 0 && (
        <ProductLightbox
          images={images}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
        />
      )}
      {detailsOpen && <ProductDetailsModal product={product} onClose={() => setDetailsOpen(false)} />}
      {!overlayOpen && (
        <MobileStickyCta
          name={product.name}
          price={price}
          compareAtPrice={compareAt}
          outOfStock={outOfStock}
          busy={busy}
          onOrderNow={orderNow}
        />
      )}
    </>
  );
}
