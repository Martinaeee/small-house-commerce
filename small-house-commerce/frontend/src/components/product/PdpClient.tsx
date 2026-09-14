// src/components/product/PdpClient.tsx
"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { Product } from "@/lib/api";
import { Button, ButtonLink } from "@/components/ui/Button";
import { useCart } from "@/components/cart/CartContext";
import { formatPrice, PriceBox } from "@/components/ui/PriceBox";
import type { DeliveryWindows } from "@/lib/deliveryWindow";
import { track } from "@/lib/tracking";

const SUPPORT_EMAIL = "support@smallhouse.ph";
import { RatingStars } from "./RatingStars";
import { ProductGallery } from "./ProductGallery";
import { ProductLightbox } from "./ProductLightbox";
import { ProductDetailsModal } from "./ProductDetailsModal";
import { MobileStickyCta } from "./MobileStickyCta";

/** Small inline truck glyph for the delivery estimate card. */
function TruckGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="mt-0.5 h-5 w-5 shrink-0 text-cta" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M3 6h11v9H3zM14 9h4l3 3v3h-7" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="7" cy="18" r="1.6" />
      <circle cx="17" cy="18" r="1.6" />
    </svg>
  );
}

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

export function PdpClient({
  product,
  category,
  delivery,
  productPath,
  promoSlot,
}: {
  product: Product;
  category: { name: string; slug: string } | null;
  delivery: DeliveryWindows;
  /** Base path for ?variant= sync; LP pages pass /lp/<slug>, PDP defaults to /products/<slug>. */
  productPath?: string;
  /** Optional promotional block rendered between breadcrumb and H1 (LP only). */
  promoSlot?: ReactNode;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { addItem } = useCart();
  const variants = product.variants;
  const images = product.images;

  const firstSellable = useMemo(
    () => variants.find((v) => v.sku !== null) ?? null,
    [variants],
  );

  const urlVariant = searchParams.get("variant");

  // Initial selection comes from a valid ?variant= deep link, else the first
  // sellable variant.
  const initialVariantId =
    variants.find((v) => v.id === urlVariant)?.id ?? firstSellable?.id ?? null;
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(
    initialVariantId,
  );
  const [prevUrlVariant, setPrevUrlVariant] = useState<string | null>(urlVariant);

  // Browser Back/Forward changes useSearchParams. Reconcile during render via
  // React's "adjust state when a prop changes" pattern: the restarted render
  // is discarded without firing effects, so the state->URL effect below never
  // sees the transient mismatch and cannot re-push a history entry.
  if (urlVariant !== prevUrlVariant) {
    setPrevUrlVariant(urlVariant);
    const matched = urlVariant ? variants.find((v) => v.id === urlVariant) : undefined;
    const target = matched?.id ?? firstSellable?.id ?? null;
    if (target && target !== selectedVariantId) setSelectedVariantId(target);
  }
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

  // Keep ?variant= in sync (push so browser Back restores the previous selection).
  useEffect(() => {
    if (!selectedVariantId) return;
    if (urlVariant === selectedVariantId) return;
    // A clean URL in sync with the mount-time selection must not gain an entry.
    if (urlVariant === null && selectedVariantId === initialVariantId) return;
    const params = new URLSearchParams(window.location.search);
    params.set("variant", selectedVariantId);
    const basePath = productPath ?? `/products/${product.slug}`;
    const url = `${basePath}?${params.toString()}`;
    // Garbage ?variant= is normalized without growing history.
    const urlIsInvalid = urlVariant !== null && !variants.some((v) => v.id === urlVariant);
    if (urlIsInvalid) router.replace(url, { scroll: false });
    else router.push(url, { scroll: false });
  }, [selectedVariantId, urlVariant, initialVariantId, variants, productPath, product.slug, router]);

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
      await addItem({ skuId: sku.id, quantity: qty });
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
    router.push(
      `/checkout?skuId=${sku.id}&qty=${quantity}&slug=${encodeURIComponent(product.slug)}`,
    );
  }

  const stockLabel = outOfStock ? "Out of Stock" : lowStock ? `Only ${available} left` : null;
  const variantSuffix =
    selectedVariant && variants.length > 1 ? ` — ${selectedVariant.name}` : "";
  const restockHref = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
    `Restock request: ${product.name}${variantSuffix}`,
  )}`;
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
          <nav aria-label="Breadcrumb" className="text-xs text-ink-muted">
            <Link href="/" className="hover:text-cta">Home</Link>
            {category && (
              <>
                {" › "}
                <Link
                  href={`/categories/${category.slug}`}
                  className="text-ink-secondary hover:text-cta"
                >
                  {category.name}
                </Link>
              </>
            )}
            {" › "}
            <span className="text-ink-secondary">{product.name}</span>
          </nav>

          {promoSlot}

          {/* Name row; quick-add glyph replaces the wishlist heart on mobile */}
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-2xl font-semibold text-ink sm:text-3xl">{product.name}</h1>
            <button
              type="button"
              onClick={() => addToCart(1)}
              disabled={busy}
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

          {/* Out-of-stock variants can still be added to the cart (the cart
              flags them unavailable and blocks checkout until restocked);
              ORDER NOW is hidden then, and the contact card stays below. */}
          <div className="flex items-start gap-2.5 rounded-lg border border-border bg-background p-3 text-sm">
            <TruckGlyph />
            <div>
              <p className="font-semibold text-ink">Estimated delivery</p>
              <p className="text-ink-secondary">Metro Manila: {delivery.metro}</p>
              <p className="text-ink-secondary">Provinces: {delivery.provincial}</p>
            </div>
          </div>

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
            {!outOfStock && (
              <Button onClick={orderNow} disabled={busy} className="flex-1" data-testid="order-now">ORDER NOW</Button>
            )}
            <Button
              variant={outOfStock ? "primary" : "secondary"}
              onClick={() => addToCart(quantity)}
              disabled={busy}
              className="flex-1"
              data-testid="add-to-cart"
            >
              ADD TO CART
            </Button>
          </div>

          {outOfStock && (
            <div className="rounded-lg border border-border bg-background p-4" data-testid="oos-contact">
              <p className="text-sm font-semibold text-ink">Currently out of stock</p>
              <p className="mt-1 text-sm text-ink-secondary">
                You can still add it to your cart to save it — checkout stays unavailable until
                the item is restocked — or email us to ask about restocking or a special order.
              </p>
              <ButtonLink
                href={restockHref}
                size="md"
                variant="secondary"
                className="mt-3"
                data-testid="contact-restock"
              >
                Contact us to order
              </ButtonLink>
              <p className="mt-2 text-xs text-ink-muted">
                {SUPPORT_EMAIL} · Mon–Sat, 9am–6pm PHT
              </p>
            </div>
          )}

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
          contactHref={restockHref}
          onOrderNow={orderNow}
          onAddToCart={() => addToCart(quantity)}
        />
      )}
    </>
  );
}
