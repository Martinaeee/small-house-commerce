"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Product, ProductMedia } from "@/lib/api";
import { useCart } from "./CartContext";
import {
  addToCartEvent,
  emitCommerceEvent,
  variantConfirmEvent,
} from "@/lib/commerce-events";
import { formatPrice, PriceBox } from "@/components/ui/PriceBox";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";
import { cardPricePresentation } from "@/lib/product-card-presentation";
import {
  PdpPurchaseProvider,
  usePdpPurchase,
} from "@/components/product/PdpPurchaseProvider";
import { ProductOptionSelector } from "@/components/product/ProductOptionSelector";

interface QuickAddViewProps {
  product: Product;
  /** Called exactly once after a successful add; the drawer swaps to cart. */
  onAdded: () => void;
  /** Close the whole drawer (product link). */
  onClose: () => void;
}

/**
 * The cart drawer's variant picker. It rides the same shared contracts as the
 * PDP purchase island: PdpPurchaseProvider owns selection/quantity (a
 * multi-SKU product starts with nothing selected — never "the first SKU"),
 * ProductOptionSelector renders the IMAGE/SWATCH/TEXT controls, and media
 * resolves through the active media-driver option value's thumbnail down to
 * the product's effective cover. List payloads carry no scoped galleries, so
 * no positional variant→image mapping exists here. The Confirm click is the
 * explicit purchase confirmation; only a successful add fires AddToCart.
 */
export function QuickAddView({ product, onAdded, onClose }: QuickAddViewProps) {
  return (
    <PdpPurchaseProvider product={product} initialVariantId={null}>
      <QuickAddPicker product={product} onAdded={onAdded} onClose={onClose} />
    </PdpPurchaseProvider>
  );
}

/**
 * The picker header image follows the shared media resolution — exact variant
 * media is not part of list payloads, so the active media-driver option
 * value's thumbnail stands in until it exists, falling back to the product's
 * effective cover (shared media).
 */
function activeDriverMedia(
  product: Product,
  selectedValueIds: Readonly<Record<string, string>>,
): ProductMedia | null {
  const options = [...product.options].sort(
    (left, right) =>
      left.position - right.position || left.id.localeCompare(right.id),
  );
  for (const option of options) {
    if (!option.isMediaDriver) continue;
    const valueId = selectedValueIds[option.id];
    if (!valueId) continue;
    const value = option.values.find((candidate) => candidate.id === valueId);
    if (value?.thumbnailUrl) {
      return {
        id: `${option.id}:${value.id}`,
        url: value.thumbnailUrl,
        type: "IMAGE",
        altText: value.thumbnailAlt ?? value.label,
        sortOrder: 0,
      };
    }
  }
  return null;
}

function QuickAddPicker({
  product,
  onAdded,
  onClose,
}: QuickAddViewProps) {
  const { addItem } = useCart();
  const { primaryLine, primaryDerived, confirmLine, setQuantity } =
    usePdpPurchase();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const sku = primaryDerived.resolvedVariant?.sku ?? null;
  const available = primaryDerived.availableInventory;
  const resolved = primaryDerived.resolvedVariant !== null;
  const outOfStock = resolved && available <= 0;
  const cover = product.effectiveCoverMedia;
  const media =
    activeDriverMedia(product, primaryLine.selectedValueIds) ?? cover;
  const price = cardPricePresentation(primaryDerived);
  const stockLabel =
    !resolved || sku === null || sku.price === null
      ? null
      : available <= 0
        ? "Out of Stock"
        : available <= 5
          ? `Only ${available} left`
          : null;

  async function confirmAdd() {
    if (!sku || sku.price === null || busy || !primaryDerived.resolvedVariant) {
      return;
    }
    const resolvedVariant = primaryDerived.resolvedVariant;
    setBusy(true);
    setError(null);
    // The Confirm click is the explicit confirmation for the chosen
    // combination (single-SKU products resolve and confirm automatically).
    confirmLine(primaryLine.clientLineId);
    try {
      await addItem(
        { skuId: sku.id, quantity: primaryLine.quantity },
        { openDrawer: false },
      );
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
          source: "QUICK_ADD",
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
      if (!aliveRef.current) return;
      onAdded();
    } catch {
      if (!aliveRef.current) return;
      setError("Sorry, we couldn't add that right now. Please try again.");
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto">
        <div className="flex gap-3 p-4">
          <Link
            href={`/products/${product.slug}`}
            onClick={onClose}
            className="h-32 w-28 shrink-0 overflow-hidden rounded-lg border border-border"
          >
            {media ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                data-testid={`picker-media-${product.slug}`}
                src={media.url}
                alt={media.altText ?? product.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <PlaceholderImage label={product.name} className="h-full w-full" />
            )}
          </Link>
          <div className="min-w-0 flex-1">
            <Link
              href={`/products/${product.slug}`}
              onClick={onClose}
              className="line-clamp-2 text-sm font-semibold text-ink hover:text-cta"
            >
              {product.name}
            </Link>
            {primaryDerived.resolvedVariant && (
              <p className="mt-0.5 text-xs text-ink-muted">
                {primaryDerived.resolvedVariant.name}
                {outOfStock ? " · Out of stock" : ""}
              </p>
            )}
            <div className="mt-1.5">
              {price ? (
                price.kind === "exact" ? (
                  <PriceBox
                    price={price.price}
                    compareAtPrice={price.compareAtPrice}
                  />
                ) : (
                  <p className="text-lg font-bold text-ink" data-testid="price">
                    From {formatPrice(price.price)}
                  </p>
                )
              ) : null}
            </div>
            {stockLabel && (
              <p
                data-testid={`picker-stock-${product.slug}`}
                className={`mt-1 text-xs font-medium ${available <= 0 ? "text-sale" : "text-ink-secondary"}`}
              >
                {stockLabel}
              </p>
            )}
          </div>
        </div>

        <div className="border-t border-border px-4 py-3">
          <ProductOptionSelector
            lineId={primaryLine.clientLineId}
            instanceId="quick-add"
          />
        </div>

        <div className="border-t border-border px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-ink-secondary">Quantity</span>
            <span className="inline-flex items-center rounded-lg border border-border">
              <button
                type="button"
                aria-label="Decrease quantity"
                disabled={busy || primaryLine.quantity <= 1}
                onClick={() =>
                  setQuantity(primaryLine.clientLineId, primaryLine.quantity - 1)
                }
                className="flex h-8 w-8 items-center justify-center text-ink-secondary hover:text-cta disabled:opacity-40"
              >
                −
              </button>
              <span
                data-testid={`picker-qty-${product.slug}`}
                className="w-9 text-center text-sm text-ink"
              >
                {primaryLine.quantity}
              </span>
              <button
                type="button"
                aria-label="Increase quantity"
                disabled={
                  busy ||
                  (sku !== null && available > 0 && primaryLine.quantity >= available)
                }
                onClick={() =>
                  setQuantity(primaryLine.clientLineId, primaryLine.quantity + 1)
                }
                className="flex h-8 w-8 items-center justify-center text-ink-secondary hover:text-cta disabled:opacity-40"
              >
                +
              </button>
            </span>
          </div>
          {outOfStock && (
            <p className="mt-2 text-xs text-ink-secondary">
              Out of stock — you can still save it to your cart for later.
            </p>
          )}
          {error && (
            <p role="alert" data-testid={`picker-error-${product.slug}`} className="mt-2 text-xs text-sale">
              {error}
            </p>
          )}
        </div>
      </div>

      <div className="border-t border-border p-4">
        <button
          type="button"
          onClick={confirmAdd}
          disabled={busy || !resolved}
          data-testid={`picker-confirm-${product.slug}`}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-cta py-2.5 text-sm font-semibold text-white transition-colors hover:bg-cta-hover disabled:cursor-not-allowed disabled:bg-border disabled:text-ink-muted"
        >
          {busy ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              Adding…
            </>
          ) : (
            "Confirm"
          )}
        </button>
      </div>
    </>
  );
}
