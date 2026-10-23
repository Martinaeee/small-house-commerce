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
import { Button } from "@/components/ui/Button";
import { useCart } from "@/components/cart/CartContext";
import { useSiteSettings } from "@/components/site/SiteSettingsProvider";
import { RestockNotifyAction } from "@/components/back-in-stock/RestockNotifyAction";
import { Toast } from "@/components/ui/Toast";
import { formatPrice, PriceBox } from "@/components/ui/PriceBox";
import type { DeliveryWindows } from "@/lib/deliveryWindow";
import {
  addToCartEvent,
  emitCommerceEvent,
  variantConfirmEvent,
  variantUnavailableEvent,
  viewContentEvent,
} from "@/lib/commerce-events";
import { recordProductView } from "@/lib/recently-viewed";

import { RatingStars } from "./RatingStars";
import { ProductGallery } from "./ProductGallery";
import { ProductLightbox } from "./ProductLightbox";
import { ProductDetailsModal } from "./ProductDetailsModal";
import { PdpStickyBuy } from "./PdpStickyBuy";
import { ProductOptionSelector } from "./ProductOptionSelector";
import { VariantPickerDialog } from "./VariantPickerDialog";
import { usePdpPurchase } from "./PdpPurchaseProvider";
import { pdpSolutionBadges } from "./pdp-facts";
import {
  analyzePdpSpecifications,
  formatBundleComponentDimensions,
  formatFoldedLine,
  formatSkuDimensions,
  pdpFoldedEntries,
  pdpInformationVisible,
} from "./pdp-specification-display";
import { SolutionIcon } from "./pdp-solution-icons";

function RulerGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path d="M3 9.5 9.5 3 21 14.5 14.5 21z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m7 9 1.5 1.5M10 6l1.5 1.5M13 12l1.5 1.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Service assurances shown beside the delivery estimate. Current policy only —
 * never invent a guarantee the shop does not honour.
 */
const SERVICE_ASSURANCES = [
  "COD & Free Shipping",
  "Arrives as fast as 7 days",
  "7-Day Free Return & Exchange",
] as const;

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
  productPath,
  promoSlot,
  purchaseOnly = false,
  preview = false,
}: {
  product: Product;
  category: { name: string; slug: string }[] | null;
  /**
   * Still accepted so the landing page's runtime context compiles unchanged,
   * but the purchase island no longer prints a delivery estimate: the
   * shopper sees the service promises only.
   */
  delivery: DeliveryWindows;
  productPath?: string;
  promoSlot?: ReactNode;
  purchaseOnly?: boolean;
  preview?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { addItem, openPicker, cart } = useCart();
  const { backInStockEnabled } = useSiteSettings();
  const {
    primaryLine,
    primaryDerived,
    purchaseLocked,
    confirmLine,
    setQuantity,
    syncLineFromUrl,
  } = usePdpPurchase();
  const [busy, setBusy] = useState(false);
  const purchaseBusy = busy || purchaseLocked || preview;
  const [notice, setNotice] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
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
  const heroRef = useRef<HTMLDivElement | null>(null);

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
  const displaySku = displayVariant?.sku ?? null;
  const isBundle = displaySku?.specificationSource === "BUNDLE_COMPONENTS";
  const componentSummary = isBundle
    ? (displaySku?.bundleComponents ?? [])
        .flatMap((component) => {
          const value = formatBundleComponentDimensions(component);
          return value === null
            ? []
            : [`${component.productName} × ${component.quantity}: ${value}`];
        })
        .join(" · ")
    : "";
  const assembledSummary = isBundle ? null : formatSkuDimensions(product, displaySku);
  const foldedEntry = isBundle ? undefined : pdpFoldedEntries(product, displaySku)[0];
  const foldedSummary = foldedEntry ? formatFoldedLine(foldedEntry) : null;
  const specificationModel = useMemo(() => analyzePdpSpecifications(product), [product]);
  const hasGuideMeasurements = specificationModel.rows.some((row) => row.cells.dimensions.status !== "missing") ||
    primaryDerived.selectableVariants.some((variant) => pdpFoldedEntries(product, variant.sku).length > 0);
  const hasSizeGuide = hasGuideMeasurements || pdpInformationVisible(product);
  const dimensionLine = !resolvedVariant
    ? hasGuideMeasurements ? { label: "Dimensions:", value: "Select a configuration" } : null
    : componentSummary
      ? { label: "Component dimensions:", value: componentSummary }
      : assembledSummary !== null
        ? { label: "Dimensions:", value: assembledSummary }
        : foldedSummary !== null
          ? { label: "Folded size:", value: foldedSummary }
          : null;
  const sellingPoints = pdpSolutionBadges(product);
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
      basePath.startsWith("/lp/") ||
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
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const variantValues = params.getAll("variant");
      const candidate = variantValues.length === 1 ? variantValues[0] : null;
      const poppedVariantId =
        candidate !== null && (basePath.startsWith("/lp/") || isSelectableVariant(product, candidate))
          ? candidate
          : null;
      // A fragment-only navigation (in-page anchor) and any pop whose variant
      // is already canonical must not reconcile or invalidate a confirmed
      // combination. Compare the search portion; the hash is irrelevant.
      if (poppedVariantId === (resolvedVariant?.id ?? null)) return;
      syncLineFromUrl(primaryLine.clientLineId, poppedVariantId);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [
    basePath,
    primaryLine.clientLineId,
    product,
    resolvedVariant,
    syncLineFromUrl,
  ]);

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
  const stickyCoverMedia =
    [galleryImages[galleryActive], ...galleryImages].find(
      (media) =>
        media?.type === "IMAGE" && media.url.trim() !== "",
    ) ?? null;
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
    if (preview) return;
    recordProductView(product.id);
  }, [product.id, preview]);

  useEffect(() => {
    if (preview) return;
    // ViewContent is once per product view, not once per option change: the
    // SKU captured here is what the page FIRST displays — the deep-linked
    // variant or the default display variant (design spec §12.3). Later
    // option changes are covered by option_select, never a second ViewContent.
    emitCommerceEvent(
      viewContentEvent({
        productId: product.id,
        productName: product.name,
        skuId: displayVariant?.sku?.id ?? null,
        price: displayVariant?.sku?.price ?? null,
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id, preview]);

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

  const executeAddToCart = useCallback(
    async (opts?: { openDrawer?: boolean; silent?: boolean }) => {
      if (!sku || !resolvedVariant) return;
      setBusy(true);
      setNotice(null);
      try {
        const input = { skuId: sku.id, quantity: primaryLine.quantity };
        // The drawer option is only passed when it matters, so the ordinary
        // add keeps its original single-argument call.
        await (opts ? addItem(input, opts) : addItem(input));
        // A silent add is confirmed elsewhere (the restock toast), so it does
        // not also print the inline notice.
        if (!opts?.silent) setNotice("Added to cart");
        // The add succeeded: exactly one variant_confirm + AddToCart pair,
        // both keyed by the final SKU. A failed add emits nothing.
        // Out-of-stock save-for-later adds intentionally keep firing this
        // pair (ACCEPT decision, final review): the cart mutation is real,
        // and the add is strong purchase intent for retargeting. Purchase can
        // never result (checkout blocks unavailable items), so no revenue is
        // mis-attributed.
        emitCommerceEvent(
          variantConfirmEvent({
            productId: product.id,
            variantId: resolvedVariant.id,
            skuId: sku.id,
            source: "PDP",
          }),
        );
        emitCommerceEvent(
          addToCartEvent({
            productId: product.id,
            productName: product.name,
            skuId: sku.id,
            quantity: primaryLine.quantity,
            price: sku.price,
          }),
        );
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not add to cart");
      } finally {
        setBusy(false);
      }
    },
    [addItem, primaryLine.quantity, product.id, product.name, resolvedVariant, sku],
  );

  /**
   * A restock alert is how a shopper keeps an unavailable item: the alert and
   * the saved cart line are one action. The line is only added when it is not
   * already in the cart, so a shopper who added it first does not end up
   * holding two of them. The drawer stays closed — the toast is the
   * confirmation.
   */
  const keepOutOfStockItemInCart = useCallback(async () => {
    if (!sku) return;
    const alreadySaved = cart?.items.some((item) => item.skuId === sku.id) ?? false;
    if (alreadySaved) return;
    await executeAddToCart({ openDrawer: false, silent: true });
  }, [cart, executeAddToCart, sku]);

  /**
   * The alert is saved: the item goes into the cart and the shopper is told
   * what happens next.
   */
  const handleRestockSaved = useCallback(async () => {
    await keepOutOfStockItemInCart();
    setToast("We’ll notify you when it’s back in stock.");
  }, [keepOutOfStockItemInCart]);

  const executeOrderNow = useCallback(() => {
    if (!sku || sku.availableInventory <= 0) {
      setNotice("This item is out of stock");
      // A purchase attempt hit an unavailable combination: diagnostic only,
      // never a conversion event.
      emitCommerceEvent(
        variantUnavailableEvent({
          productId: product.id,
          selectedValueIds: primaryLine.selectedValueIds,
          reason: sku ? "OOS" : "MISSING",
        }),
      );
      return;
    }
    // Order Now requires a confirmed combination; name it before navigating.
    emitCommerceEvent(
      variantConfirmEvent({
        productId: product.id,
        variantId: resolvedVariant?.id ?? null,
        skuId: sku.id,
        source: "PDP",
      }),
    );
    router.push(
      `/checkout?skuId=${sku.id}&qty=${primaryLine.quantity}&slug=${encodeURIComponent(product.slug)}`,
    );
  }, [
    primaryLine.quantity,
    primaryLine.selectedValueIds,
    product.id,
    product.slug,
    resolvedVariant,
    router,
    sku,
  ]);

  const requestIntent = useCallback(
    (intent: PurchaseIntent, trigger: HTMLElement) => {
      if (purchaseBusy) return;
      intentTriggerRef.current = trigger;
      // Multi-variant products always route through an explicit picker, even
      // when a combination is already chosen. Both purchase actions open the
      // SAME picker (the one the PLP uses), pre-set to the current selection,
      // so the two behave identically; only the confirmation differs — ADD TO
      // CART adds the line, ORDER NOW goes straight to checkout.
      // Single-variant products have nothing to pick and keep the direct
      // paths below.
      if (selectableCount > 1) {
        openPicker(product, {
          initialVariantId: resolvedVariant?.id ?? null,
          initialQuantity: primaryLine.quantity,
          intent,
        });
        return;
      }
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
      purchaseBusy,
      executeAddToCart,
      executeOrderNow,
      openPicker,
      primaryDerived.purchaseConfirmed,
      primaryDerived.purchasableVariant,
      primaryLine.quantity,
      product,
      resolvedVariant,
      selectableCount,
    ],
  );

  const confirmPendingIntent = useCallback(async () => {
    if (intentExecutingRef.current || !pendingIntent || !resolvedVariant) return;
    if (pendingIntent === "ORDER_NOW" && !primaryDerived.purchasableVariant) {
      setNotice("This item is out of stock");
      // The shopper confirmed a sold-out combination for immediate order:
      // diagnostic event only, no conversion.
      emitCommerceEvent(
        variantUnavailableEvent({
          productId: product.id,
          selectedValueIds: primaryLine.selectedValueIds,
          reason: "OOS",
        }),
      );
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
    primaryLine.selectedValueIds,
    product.id,
    resolvedVariant,
    restoreIntentFocus,
  ]);

  const stockLabel = displayOutOfStock
    ? "Out of Stock"
    : lowStock
      ? `Only ${available} left`
      : null;
  const overlayOpen =
    lightboxIndex !== null || detailsOpen || pendingIntent !== null;
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
      {!purchaseOnly && <nav aria-label="Breadcrumb" className="mb-4 text-xs text-ink-muted">
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
      </nav>}

      {!purchaseOnly && promoSlot}

      <div className={purchaseOnly ? undefined : "grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-8"}>
        {!purchaseOnly && <div>
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
        </div>}

        <div
          ref={heroRef}
          id="pdp-purchase"
          data-testid="pdp-purchase"
          className="flex min-w-0 scroll-mt-32 flex-col gap-3 lg:gap-4"
        >
          {!purchaseOnly && <>
          <div className="flex min-w-0 flex-col gap-2">
            <h1 className="break-words text-xl font-semibold leading-snug text-ink lg:text-product-title lg:leading-snug">
              {product.name}
            </h1>
            {product.tagline?.trim() && (
              // Hidden on phones to keep the first screen compact.
              <p className="hidden text-base leading-relaxed text-ink-secondary sm:block">
                {product.tagline}
              </p>
            )}
            {ratingRow}
          </div>

          {sellingPoints.length > 0 && (
            <ul
              aria-label="Selling points"
              tabIndex={0}
              className="flex flex-nowrap gap-2 overflow-x-auto overscroll-x-contain rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-cta"
            >
              {sellingPoints.map((point) => (
                <li
                  key={point.value}
                  className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-semibold text-ink"
                >
                  <SolutionIcon value={point.value} />
                  {point.label}
                </li>
              ))}
            </ul>
          )}
          </>}

          {purchaseOnly ? (
            <div>
              <PriceBox price={price} compareAtPrice={compareAt} />
              {price !== null && compareAt !== null && compareAt > price && (
                <p className="mt-1 text-sm font-medium text-sale">Save {formatPrice(compareAt - price)}</p>
              )}
            </div>
          ) : <PriceBox price={price} compareAtPrice={compareAt} size="lg" showSavings />}

          {stockLabel && (
            <p className="text-sm font-semibold text-sale" data-testid="stock-state">{stockLabel}</p>
          )}

          <ProductOptionSelector lineId={primaryLine.clientLineId} instanceId="pdp" preview={preview} sizeCards />

          {hasSizeGuide && (
            <div
              data-testid="pdp-dimensions-summary"
              className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm"
            >
              {dimensionLine && <p
                data-testid="pdp-dimensions-line"
                className="text-ink"
              >
                <span className="font-semibold text-ink">{dimensionLine.label}</span>{" "}
                {dimensionLine.value}
              </p>}
              <button
                type="button"
                onClick={() => setDetailsOpen(true)}
                className="inline-flex items-center gap-1.5 font-medium text-cta underline-offset-2 hover:underline"
              >
                <RulerGlyph />
                Size guide
              </button>
            </div>
          )}

          <div
            data-testid="pdp-buy-row"
            className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:gap-3"
          >
            <div
              aria-label="Quantity"
              role="group"
              className="flex shrink-0 items-center rounded-lg border border-border bg-card"
            >
              <button
                type="button"
                aria-label="Decrease quantity"
                onClick={() => setQuantity(primaryLine.clientLineId, primaryLine.quantity - 1)}
                disabled={purchaseLocked}
                className="h-11 w-8 text-lg text-ink hover:text-cta disabled:cursor-not-allowed disabled:opacity-50 sm:w-11"
              >−</button>
              <span className="w-6 text-center text-base font-semibold sm:w-7" data-testid="qty">{primaryLine.quantity}</span>
              <button
                type="button"
                aria-label="Increase quantity"
                onClick={() => setQuantity(primaryLine.clientLineId, primaryLine.quantity + 1)}
                disabled={purchaseLocked}
                className="h-11 w-8 text-lg text-ink hover:text-cta disabled:cursor-not-allowed disabled:opacity-50 sm:w-11"
              >+</button>
            </div>

            {!resolvedOutOfStock && (
              <Button
                onClick={(event) => requestIntent("ORDER_NOW", event.currentTarget)}
                disabled={purchaseBusy || selectableCount === 0}
                // The shared md size pins min-w-[120px]; below sm the stepper
                // shares the row, so the buttons shrink instead of overflowing.
                className="min-w-0! flex-1 whitespace-nowrap px-2 text-[13px] leading-tight sm:min-w-[120px]! sm:px-5 sm:text-sm lg:text-base"
                data-testid="order-now"
              >
                ORDER NOW
              </Button>
            )}
            {resolvedOutOfStock && sku && !preview && backInStockEnabled ? (
              // One action for an unavailable item: register the restock
              // alert and keep the item saved. The alert service is only
              // offered when it can actually save one, so the button never
              // promises an email the shop cannot send.
              <RestockNotifyAction
                skuId={sku.id}
                productName={product.name}
                label="Notify me when available"
                variant="primary"
                className="min-w-0! flex-1 whitespace-nowrap px-2 text-[13px] leading-tight sm:min-w-[120px]! sm:px-5 sm:text-sm lg:text-base"
                onSaved={handleRestockSaved}
                data-testid="notify-me"
              />
            ) : (
              <Button
                variant={resolvedOutOfStock ? "primary" : "secondary"}
                onClick={(event) => requestIntent("ADD_TO_CART", event.currentTarget)}
                disabled={purchaseBusy || selectableCount === 0}
                // The secondary label is the longer of the two, so it takes a
                // slightly larger share of the phone row and stays on one line.
                className="min-w-0! flex-[1.2] whitespace-nowrap px-2 text-[13px] leading-tight sm:min-w-[120px]! sm:flex-1 sm:px-5 sm:text-sm lg:text-base"
                data-testid="add-to-cart"
              >
                ADD TO CART
              </Button>
            )}
          </div>

          <ul
            id="pdp-delivery"
            data-testid="pdp-delivery"
            aria-label="Service assurances"
            // Just the promises, without a card around them: the delivery
            // estimate is gone, so the assurances stand on their own. They
            // stay on ONE row; a phone that is too narrow scrolls the row
            // sideways instead of stacking the lines.
            className="flex scroll-mt-32 flex-nowrap items-center gap-x-4 overflow-x-auto overscroll-x-contain text-xs text-ink-secondary [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:gap-x-6 sm:text-sm"
          >
            {SERVICE_ASSURANCES.map((line) => (
              <li
                key={line}
                className="flex shrink-0 items-center gap-1.5 whitespace-nowrap"
              >
                <span className="font-semibold text-cta">✓</span>
                {line}
              </li>
            ))}
          </ul>

          {notice && (
            <p role="status" className="rounded-lg border border-primary bg-primary-light/40 px-3 py-2 text-sm text-cta">
              {notice}
            </p>
          )}
        </div>
      </div>

      <Toast message={toast} onDismiss={() => setToast(null)} />

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
      {detailsOpen && <ProductDetailsModal product={product} onClose={() => setDetailsOpen(false)} preview={preview} />}
      {pendingIntent && (
        <VariantPickerDialog
          lineId={primaryLine.clientLineId}
          busy={purchaseBusy}
          onConfirm={() => void confirmPendingIntent()}
          onClose={closePicker}
        />
      )}
      {!preview && !overlayOpen ? (
        <PdpStickyBuy
          product={product}
          coverMedia={stickyCoverMedia}
          heroRef={heroRef}
          line={primaryLine}
          derived={primaryDerived}
          busy={purchaseBusy}
          variantLabel={displayVariant?.name ?? null}
          onQuantityChange={(quantity) =>
            setQuantity(primaryLine.clientLineId, quantity)
          }
          onIntent={requestIntent}
          onRestockSaved={handleRestockSaved}
        />
      ) : null}
    </>
  );
}
