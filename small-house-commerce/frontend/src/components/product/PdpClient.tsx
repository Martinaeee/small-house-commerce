"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { Product, ProductImage } from "@/lib/api";
import type { ProductMediaScope } from "@/lib/product-media";
import { loadProductMedia } from "@/lib/product-media";
import { Button, ButtonLink } from "@/components/ui/Button";
import { useCart } from "@/components/cart/CartContext";
import { useSiteSettings } from "@/components/site/SiteSettingsProvider";
import { formatPrice, PriceBox } from "@/components/ui/PriceBox";
import type { DeliveryWindows } from "@/lib/deliveryWindow";
import { track } from "@/lib/tracking";
import { recordProductView } from "@/lib/recently-viewed";

import { RatingStars } from "./RatingStars";
import { ProductGallery } from "./ProductGallery";
import { ProductLightbox } from "./ProductLightbox";
import { ProductDetailsModal } from "./ProductDetailsModal";
import { MobileStickyCta } from "./MobileStickyCta";
import { ProductOptionSelector } from "./ProductOptionSelector";
import { VariantPickerDialog } from "./VariantPickerDialog";
import { usePdpPurchase } from "./PdpPurchaseProvider";

function TruckGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="mt-0.5 h-5 w-5 shrink-0 text-cta" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M3 6h11v9H3zM14 9h4l3 3v3h-7" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="7" cy="18" r="1.6" />
      <circle cx="17" cy="18" r="1.6" />
    </svg>
  );
}

function CartGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M3 4h2l2.2 12.2a1.5 1.5 0 0 0 1.5 1.3h7.9a1.5 1.5 0 0 0 1.5-1.2L21 8H6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="10" cy="20.5" r="1.2" />
      <circle cx="18" cy="20.5" r="1.2" />
    </svg>
  );
}

type PurchaseIntent = "ADD_TO_CART" | "ORDER_NOW";

function isSelectableVariant(product: Product, variantId: string): boolean {
  const variant = product.variants.find(({ id }) => id === variantId);
  return variant?.sku?.status === "ACTIVE" && variant.sku.price !== null;
}

function scopeKey(scope: ProductMediaScope | null): string {
  if (!scope) return "shared";
  return "variantId" in scope
    ? `variant:${scope.variantId}`
    : `option:${scope.optionValueId}`;
}

function mediaScopeForSelection(
  product: Product,
  selectedValueIds: Readonly<Record<string, string>>,
  resolvedVariantId: string | null,
): ProductMediaScope | null {
  const scopes = product.availableMediaScopes;
  if (!scopes) return null;
  if (resolvedVariantId && scopes.variantIds.includes(resolvedVariantId)) {
    return { variantId: resolvedVariantId };
  }
  for (const option of [...product.options].sort(
    (left, right) => left.position - right.position,
  )) {
    if (!option.isMediaDriver) continue;
    const valueId = selectedValueIds[option.id];
    if (valueId && scopes.optionValueIds.includes(valueId)) {
      return { optionValueId: valueId };
    }
  }
  return null;
}

function initialMediaMatchesScope(
  product: Product,
  scope: ProductMediaScope,
): boolean {
  const mediaSet = product.initialMediaSet;
  if (!mediaSet || mediaSet.catalogGraphVersion !== product.catalogGraphVersion) {
    return false;
  }
  if (mediaSet.resolvedScope === "VARIANT") {
    return scope.variantId !== undefined && mediaSet.scopeId === scope.variantId;
  }
  if (mediaSet.resolvedScope === "OPTION_VALUE") {
    if (scope.optionValueId !== undefined) {
      return mediaSet.scopeId === scope.optionValueId;
    }
    const variant = product.variants.find(({ id }) => id === scope.variantId);
    return variant?.optionValueIds.includes(mediaSet.scopeId ?? "") ?? false;
  }
  if (scope.variantId !== undefined) {
    const variant = product.variants.find(({ id }) => id === scope.variantId);
    const hasScopedOption = variant?.optionValueIds.some((valueId) =>
      product.availableMediaScopes?.optionValueIds.includes(valueId),
    );
    return (
      !product.availableMediaScopes?.variantIds.includes(scope.variantId) &&
      !hasScopedOption
    );
  }
  return !product.availableMediaScopes?.optionValueIds.includes(
    scope.optionValueId,
  );
}

function sameScopeFallback(
  product: Product,
  selectedValueIds: Readonly<Record<string, string>>,
): ProductImage[] {
  for (const option of product.options) {
    if (!option.isMediaDriver) continue;
    const valueId = selectedValueIds[option.id];
    const value = option.values.find(({ id }) => id === valueId);
    if (value?.thumbnailUrl) {
      return [
        {
          id: `option-thumbnail-${value.id}`,
          url: value.thumbnailUrl,
          type: "IMAGE",
          altText: value.thumbnailAlt ?? value.label,
          sortOrder: 0,
        },
      ];
    }
  }
  return [];
}

export function PdpClient({
  product,
  category,
  delivery,
  productPath,
  promoSlot,
}: {
  product: Product;
  category: { name: string; slug: string }[] | null;
  delivery: DeliveryWindows;
  productPath?: string;
  promoSlot?: ReactNode;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { addItem } = useCart();
  const { supportEmail, supportHours } = useSiteSettings();
  const {
    primaryLine,
    primaryDerived,
    confirmLine,
    setQuantity,
  } = usePdpPurchase();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [gallerySelection, setGallerySelection] = useState({
    scopeKey: "shared",
    index: 0,
  });
  const [lightboxSelection, setLightboxSelection] = useState<{
    scopeKey: string;
    index: number;
  } | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [pendingIntent, setPendingIntent] = useState<PurchaseIntent | null>(null);
  const [loadedGallery, setLoadedGallery] = useState<{
    scopeKey: string;
    images: ProductImage[];
  } | null>(null);
  const [mediaErrorScope, setMediaErrorScope] = useState<string | null>(null);
  const [mediaRetry, setMediaRetry] = useState(0);
  const intentTriggerRef = useRef<HTMLElement | null>(null);
  const intentExecutingRef = useRef(false);
  const mediaRequestRef = useRef(0);

  const resolvedVariant = primaryDerived.resolvedVariant;
  const displayVariant = primaryDerived.displayVariant;
  const sku = resolvedVariant?.sku ?? null;
  const available = primaryDerived.availableInventory;
  const resolvedOutOfStock = resolvedVariant !== null && available <= 0;
  const displayOutOfStock = displayVariant === null || available <= 0;
  const lowStock = !displayOutOfStock && available <= 5;
  const price = primaryDerived.price;
  const compareAt = primaryDerived.compareAtPrice;
  const selectableCount = primaryDerived.selectableVariants.length;
  const hasDimensions =
    product.width !== null || product.height !== null || product.depth !== null ||
    product.foldedWidth !== null || product.foldedHeight !== null ||
    product.foldedDepth !== null;
  const basePath = productPath ?? `/products/${product.slug}`;
  const urlVariantValues = searchParams.getAll("variant");
  const hasVariantParam = urlVariantValues.length > 0;
  const urlVariant =
    urlVariantValues.length === 1 ? urlVariantValues[0] : null;

  const requestedMediaScope = useMemo(
    () =>
      mediaScopeForSelection(
        product,
        primaryLine.selectedValueIds,
        resolvedVariant?.id ?? null,
      ),
    [product, primaryLine.selectedValueIds, resolvedVariant?.id],
  );
  const requestedMediaScopeKey = scopeKey(requestedMediaScope);

  useEffect(() => {
    if (
      !hasVariantParam ||
      (urlVariant !== null && isSelectableVariant(product, urlVariant))
    ) {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    params.delete("variant");
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      query ? `${basePath}?${query}` : basePath,
    );
  }, [basePath, hasVariantParam, product, urlVariant]);

  useEffect(() => {
    if (primaryLine.selectionSource !== "USER") return;
    const params = new URLSearchParams(window.location.search);
    if (!resolvedVariant) {
      if (!params.has("variant")) return;
      params.delete("variant");
      const query = params.toString();
      window.history.replaceState(
        null,
        "",
        query ? `${basePath}?${query}` : basePath,
      );
      return;
    }
    if (urlVariant === resolvedVariant.id) return;
    params.set("variant", resolvedVariant.id);
    const query = params.toString();
    window.history.pushState(null, "", `${basePath}?${query}`);
  }, [basePath, primaryLine.selectionSource, resolvedVariant, urlVariant]);

  const initialMediaMatches =
    requestedMediaScope !== null &&
    primaryLine.selectionSource === "DEEP_LINK" &&
    initialMediaMatchesScope(product, requestedMediaScope);
  const fallbackGalleryImages = useMemo(() => {
    const media = requestedMediaScope
      ? initialMediaMatches
        ? (product.initialMediaSet?.media ?? [])
        : sameScopeFallback(product, primaryLine.selectedValueIds)
      : productPath?.startsWith("/lp/")
        ? product.images
        : (product.initialMediaSet?.media ?? product.images);
    return [...media].sort((left, right) => left.sortOrder - right.sortOrder);
  }, [
    initialMediaMatches,
    product,
    productPath,
    primaryLine.selectedValueIds,
    requestedMediaScope,
  ]);
  const galleryImages =
    loadedGallery?.scopeKey === requestedMediaScopeKey
      ? loadedGallery.images
      : fallbackGalleryImages;
  const galleryActive =
    gallerySelection.scopeKey === requestedMediaScopeKey
      ? Math.min(gallerySelection.index, Math.max(0, galleryImages.length - 1))
      : 0;
  const lightboxIndex =
    lightboxSelection?.scopeKey === requestedMediaScopeKey
      ? lightboxSelection.index
      : null;
  const mediaError = mediaErrorScope === requestedMediaScopeKey;

  useEffect(() => {
    if (!requestedMediaScope || initialMediaMatches) return;
    const requestId = mediaRequestRef.current + 1;
    mediaRequestRef.current = requestId;
    let active = true;
    void loadProductMedia(product, requestedMediaScope)
      .then((mediaSet) => {
        if (!active || mediaRequestRef.current !== requestId) return;
        setLoadedGallery({
          scopeKey: requestedMediaScopeKey,
          images: [...mediaSet.media].sort(
            (left, right) => left.sortOrder - right.sortOrder,
          ),
        });
        setMediaErrorScope(null);
      })
      .catch(() => {
        if (!active || mediaRequestRef.current !== requestId) return;
        setMediaErrorScope(requestedMediaScopeKey);
      });
    return () => {
      active = false;
    };
  }, [
    initialMediaMatches,
    mediaRetry,
    product,
    requestedMediaScope,
    requestedMediaScopeKey,
  ]);

  useEffect(() => {
    recordProductView(product.id);
  }, [product.id]);

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

  useEffect(() => {
    track("ViewContent", {
      content_ids: [product.id],
      content_name: product.name,
      content_type: "product",
      value: price ?? undefined,
      currency: "PHP",
    });
    // ViewContent is once per product view, not once per option change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id]);

  const restoreIntentFocus = useCallback(() => {
    const trigger = intentTriggerRef.current;
    intentTriggerRef.current = null;
    window.setTimeout(() => trigger?.focus(), 0);
  }, []);

  const closePicker = useCallback(() => {
    if (intentExecutingRef.current) return;
    setPendingIntent(null);
    restoreIntentFocus();
  }, [restoreIntentFocus]);

  const executeAddToCart = useCallback(async () => {
    if (!sku) return;
    setBusy(true);
    setNotice(null);
    try {
      await addItem({ skuId: sku.id, quantity: primaryLine.quantity });
      setNotice("Added to cart");
      track("AddToCart", {
        content_ids: [sku.id],
        content_name: product.name,
        content_type: "product",
        contents: [{ id: sku.id, quantity: primaryLine.quantity }],
        value: sku.price ? sku.price * primaryLine.quantity : undefined,
        currency: "PHP",
      });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not add to cart");
    } finally {
      setBusy(false);
    }
  }, [addItem, primaryLine.quantity, product.name, sku]);

  const executeOrderNow = useCallback(() => {
    if (!sku || sku.availableInventory <= 0) {
      setNotice("This item is out of stock");
      return;
    }
    router.push(
      `/checkout?skuId=${sku.id}&qty=${primaryLine.quantity}&slug=${encodeURIComponent(product.slug)}`,
    );
  }, [primaryLine.quantity, product.slug, router, sku]);

  const requestIntent = useCallback(
    (intent: PurchaseIntent, trigger: HTMLElement) => {
      if (busy) return;
      intentTriggerRef.current = trigger;
      if (
        primaryDerived.purchaseConfirmed &&
        resolvedVariant &&
        (intent === "ADD_TO_CART" || primaryDerived.purchasableVariant)
      ) {
        if (intent === "ADD_TO_CART") void executeAddToCart();
        else executeOrderNow();
        return;
      }
      setPendingIntent(intent);
    },
    [
      busy,
      executeAddToCart,
      executeOrderNow,
      primaryDerived.purchaseConfirmed,
      primaryDerived.purchasableVariant,
      resolvedVariant,
    ],
  );

  const confirmPendingIntent = useCallback(async () => {
    if (intentExecutingRef.current || !pendingIntent || !resolvedVariant) return;
    if (pendingIntent === "ORDER_NOW" && !primaryDerived.purchasableVariant) {
      setNotice("This item is out of stock");
      return;
    }
    intentExecutingRef.current = true;
    confirmLine(primaryLine.clientLineId);
    if (pendingIntent === "ADD_TO_CART") await executeAddToCart();
    else executeOrderNow();
    setPendingIntent(null);
    intentExecutingRef.current = false;
    restoreIntentFocus();
  }, [
    confirmLine,
    executeAddToCart,
    executeOrderNow,
    pendingIntent,
    primaryDerived.purchasableVariant,
    primaryLine.clientLineId,
    resolvedVariant,
    restoreIntentFocus,
  ]);

  const stockLabel = displayOutOfStock
    ? "Out of Stock"
    : lowStock
      ? `Only ${available} left`
      : null;
  const variantSuffix =
    displayVariant && product.variants.length > 1
      ? ` — ${displayVariant.name}`
      : "";
  const restockHref = `mailto:${supportEmail}?subject=${encodeURIComponent(
    `Restock request: ${product.name}${variantSuffix}`,
  )}`;
  const overlayOpen =
    lightboxIndex !== null || detailsOpen || pendingIntent !== null;
  const addLabel =
    selectableCount > 1 && !resolvedVariant ? "CHOOSE OPTIONS" : "ADD TO CART";
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
      <nav aria-label="Breadcrumb" className="mb-4 text-xs text-ink-muted">
        <Link href="/" className="hover:text-cta">Home</Link>
        {(category ?? []).map((crumb) => (
          <span key={crumb.slug}>
            {" › "}
            <Link href={`/categories/${crumb.slug}`} className="text-ink-secondary hover:text-cta">
              {crumb.name}
            </Link>
          </span>
        ))}
        {" › "}
        <span className="text-ink-secondary">{product.name}</span>
      </nav>

      {promoSlot}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <div>
          <ProductGallery
            images={galleryImages}
            active={galleryActive}
            onSelect={(index) =>
              setGallerySelection({ scopeKey: requestedMediaScopeKey, index })
            }
            onOpenLightbox={(index) =>
              setLightboxSelection({ scopeKey: requestedMediaScopeKey, index })
            }
          />
          {mediaError && requestedMediaScope && (
            <button
              type="button"
              onClick={() => setMediaRetry((retry) => retry + 1)}
              className="mt-2 text-sm font-medium text-cta underline-offset-2 hover:underline"
            >
              Retry images
            </button>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-product-title font-semibold text-ink lg:text-product-title-desktop">{product.name}</h1>
            <button
              type="button"
              onClick={(event) => requestIntent("ADD_TO_CART", event.currentTarget)}
              disabled={busy}
              aria-label="Add to cart"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border text-cta hover:border-primary disabled:text-ink-muted md:hidden"
            >
              <CartGlyph />
            </button>
          </div>

          {product.tagline?.trim() && (
            <p className="text-product-subtitle text-ink-secondary lg:text-product-subtitle-desktop">
              {product.tagline}
            </p>
          )}

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

          <ProductOptionSelector lineId={primaryLine.clientLineId} instanceId="pdp" />

          {hasDimensions && (
            <button
              type="button"
              onClick={() => setDetailsOpen(true)}
              className="self-start text-sm font-medium text-cta underline-offset-2 hover:underline"
            >
              Size guide
            </button>
          )}

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
              <button
                type="button"
                aria-label="Decrease quantity"
                onClick={() => setQuantity(primaryLine.clientLineId, primaryLine.quantity - 1)}
                className="h-11 w-11 text-lg text-ink hover:text-cta"
              >−</button>
              <span className="w-8 text-center text-base font-semibold" data-testid="qty">{primaryLine.quantity}</span>
              <button
                type="button"
                aria-label="Increase quantity"
                onClick={() => setQuantity(primaryLine.clientLineId, primaryLine.quantity + 1)}
                className="h-11 w-11 text-lg text-ink hover:text-cta"
              >+</button>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            {!resolvedOutOfStock && (
              <Button
                onClick={(event) => requestIntent("ORDER_NOW", event.currentTarget)}
                disabled={busy || selectableCount === 0}
                className="flex-1"
                data-testid="order-now"
              >
                {resolvedVariant ? "ORDER NOW" : "CHOOSE OPTIONS"}
              </Button>
            )}
            <Button
              variant={resolvedOutOfStock ? "primary" : "secondary"}
              onClick={(event) => requestIntent("ADD_TO_CART", event.currentTarget)}
              disabled={busy || selectableCount === 0}
              className="flex-1"
              data-testid="add-to-cart"
            >
              {addLabel}
            </Button>
          </div>

          {resolvedOutOfStock && (
            <div className="rounded-lg border border-border bg-background p-4" data-testid="oos-contact">
              <p className="text-sm font-semibold text-ink">Currently out of stock</p>
              <p className="mt-1 text-sm text-ink-secondary">
                You can still add it to your cart to save it — checkout stays unavailable until
                the item is restocked — or email us to ask about restocking or a special order.
              </p>
              <ButtonLink href={restockHref} size="md" variant="secondary" className="mt-3" data-testid="contact-restock">
                Contact us to order
              </ButtonLink>
              <p className="mt-2 text-xs text-ink-muted">{supportEmail} · {supportHours}</p>
            </div>
          )}

          {notice && (
            <p role="status" className="rounded-lg border border-primary bg-primary-light/40 px-3 py-2 text-sm text-cta">
              {notice}
            </p>
          )}

          <ul className="mt-2 flex flex-col gap-1 text-sm text-ink-secondary">
            <li className="flex items-center gap-2"><span className="font-semibold text-cta">✓</span> Cash On Delivery Available</li>
            <li className="flex items-center gap-2"><span className="font-semibold text-cta">✓</span> Nationwide Delivery</li>
            <li className="flex items-center gap-2"><span className="font-semibold text-cta">✓</span> Customer Support Available</li>
          </ul>
        </div>
      </div>

      {lightboxIndex !== null && galleryImages.length > 0 && (
        <ProductLightbox
          images={galleryImages}
          productName={product.name}
          index={lightboxIndex}
          onClose={() => setLightboxSelection(null)}
          onNavigate={(index) =>
            setLightboxSelection({ scopeKey: requestedMediaScopeKey, index })
          }
        />
      )}
      {detailsOpen && <ProductDetailsModal product={product} onClose={() => setDetailsOpen(false)} />}
      {pendingIntent && (
        <VariantPickerDialog
          lineId={primaryLine.clientLineId}
          busy={busy}
          onConfirm={() => void confirmPendingIntent()}
          onClose={closePicker}
        />
      )}
      {!overlayOpen && (
        <MobileStickyCta
          name={product.name}
          price={price}
          compareAtPrice={compareAt}
          outOfStock={resolvedOutOfStock}
          busy={busy}
          contactHref={restockHref}
          orderLabel={resolvedVariant ? "ORDER NOW" : "CHOOSE OPTIONS"}
          addLabel={addLabel}
          onOrderNow={(event) => requestIntent("ORDER_NOW", event.currentTarget)}
          onAddToCart={(event) => requestIntent("ADD_TO_CART", event.currentTarget)}
        />
      )}
    </>
  );
}
