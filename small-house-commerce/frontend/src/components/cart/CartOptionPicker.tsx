"use client";

import { useEffect, useRef, useState } from "react";
import type { CartItem, Product } from "@/lib/api";
import { fetchProduct } from "@/lib/productCache";
import { useCart } from "./CartContext";
import { formatPrice } from "@/components/ui/PriceBox";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";
import {
  PdpPurchaseProvider,
  usePdpPurchase,
} from "@/components/product/PdpPurchaseProvider";
import { ProductOptionSelector } from "@/components/product/ProductOptionSelector";

/**
 * The cart line image slot, fed by the enriched summary's effective
 * thumbnail (Task 15) — never a product-by-slug fetch. The backend may
 * resolve a VIDEO (exact variant media → media-driver value → shared), so
 * the slot renders a muted, non-autoplaying <video> for those and falls back
 * to the shared placeholder when a line has no media at all.
 */
export function CartLineThumbnail({
  item,
  className = "h-14 w-14",
  placeholderLabel = "",
}: {
  item: CartItem;
  className?: string;
  placeholderLabel?: string;
}) {
  const thumb = item.thumbnail;
  return (
    <div
      className={`${className} shrink-0 overflow-hidden rounded-lg border border-border`}
    >
      {thumb ? (
        thumb.type === "VIDEO" ? (
          <video
            src={thumb.url}
            muted
            playsInline
            preload="metadata"
            aria-label={thumb.altText ?? item.productName}
            className="h-full w-full object-cover"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumb.url}
            alt={thumb.altText ?? ""}
            className="h-full w-full object-cover"
          />
        )
      ) : (
        <PlaceholderImage label={placeholderLabel} className="h-full w-full" />
      )}
    </div>
  );
}

/** "Color: Red · Size: Small", or the legacy variantName for old rows. */
export function lineOptionsLabel(item: CartItem): string {
  if (item.optionValues.length === 0) return item.variantName;
  return item.optionValues
    .map((value) => `${value.optionName}: ${value.label}`)
    .join(" · ");
}

/**
 * The cart drawer's Change Options view (Task 16). Rides the same shared
 * contracts as the PDP purchase island: PdpPurchaseProvider owns the
 * selection — prefilled from the line's current SKU via the deep-link path
 * ("prefilled picker without confirmation"; the Confirm click is the
 * confirmation) — and ProductOptionSelector renders the IMAGE/SWATCH/TEXT
 * controls. Confirm sends exactly one PATCH and adopts the merged summary
 * the backend returns; a rejected replace preserves the cart (the context
 * only adopts on success) and announces the server message for a retry.
 */
export function CartOptionPicker({
  item,
  onDone,
}: {
  item: CartItem;
  /** Called after confirm success or cancel; the surface returns to its cart view. */
  onDone: () => void;
}) {
  const [product, setProduct] = useState<Product | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  // The full product payload is needed for the typed options/variants that
  // drive the shared selector (session-cached, usually a hit because cart
  // recommendations warm it). Thumbnails never come from here. The picker
  // mounts fresh for every open (the drawer only renders it while a target
  // line is active), so initial state is null/false by construction and no
  // synchronous reset is needed.
  useEffect(() => {
    let alive = true;
    void fetchProduct(item.productSlug).then((loaded) => {
      if (!alive) return;
      if (loaded === null) {
        setLoadFailed(true);
        return;
      }
      setProduct(loaded);
    });
    return () => {
      alive = false;
    };
  }, [item.productSlug]);

  if (loadFailed) {
    return (
      <div className="flex flex-1 flex-col justify-between">
        <p className="p-4 text-sm text-ink-secondary">
          Sorry, we couldn&apos;t load the options for this item. Please try
          again later.
        </p>
        <div className="border-t border-border p-4">
          <button
            type="button"
            data-testid="cart-picker-cancel"
            onClick={onDone}
            className="w-full rounded-lg border border-border py-2.5 text-sm font-semibold text-ink hover:border-ink"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="flex-1 p-4">
        <p className="text-sm text-ink-secondary">Loading options…</p>
      </div>
    );
  }

  return (
    <PdpPurchaseProvider
      product={product}
      initialVariantId={initialVariantIdFor(product, item)}
    >
      <CartOptionPickerForm item={item} onDone={onDone} />
    </PdpPurchaseProvider>
  );
}

/** The line's SKU → variant id, for the provider's prefilled deep-link state. */
function initialVariantIdFor(product: Product, item: CartItem): string | null {
  return (
    product.variants.find((variant) => variant.sku?.id === item.skuId)?.id ??
    null
  );
}

function CartOptionPickerForm({
  item,
  onDone,
}: {
  item: CartItem;
  onDone: () => void;
}) {
  const { replaceItem } = useCart();
  const { primaryLine, primaryDerived, confirmLine } = usePdpPurchase();
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
  const resolved = primaryDerived.resolvedVariant !== null;
  const available = primaryDerived.availableInventory;
  const outOfStock = resolved && available <= 0;
  const stockLabel =
    !resolved || sku === null || sku.price === null
      ? null
      : available <= 0
        ? "Out of Stock"
        : available <= 5
          ? `Only ${available} left`
          : null;

  async function confirmChange() {
    if (!sku || !resolved || busy) return;
    setBusy(true);
    setError(null);
    // The Confirm click is the explicit confirmation for the chosen
    // combination (the prefill itself never confirms).
    confirmLine(primaryLine.clientLineId);
    try {
      await replaceItem({
        itemId: item.itemId,
        skuId: sku.id,
        quantity: item.quantity,
      });
      if (!aliveRef.current) return;
      onDone();
    } catch (err) {
      if (!aliveRef.current) return;
      // The cart was preserved (replaceItem adopts only on success); surface
      // the server message so the visitor can pick a different combination.
      setError(
        err instanceof Error && err.message !== ""
          ? err.message
          : "Sorry, we couldn't update that item. Please try again.",
      );
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto">
        <div className="flex gap-3 p-4">
          <CartLineThumbnail
            item={item}
            className="h-32 w-28"
            placeholderLabel={item.productName}
          />
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-sm font-semibold text-ink">
              {item.productName}
            </p>
            <p
              data-testid="cart-picker-current"
              className="mt-0.5 text-xs text-ink-muted"
            >
              {lineOptionsLabel(item)}
            </p>
            <p className="text-xs text-ink-muted">SKU: {item.skuCode}</p>
            {item.unavailable && (
              <p className="mt-1 text-xs font-semibold text-sale">
                Out of stock
              </p>
            )}
          </div>
        </div>

        <div className="border-t border-border px-4 py-3">
          <ProductOptionSelector
            lineId={primaryLine.clientLineId}
            instanceId="cart-change"
          />
        </div>

        <div className="border-t border-border px-4 py-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-ink-secondary">
              Quantity {item.quantity}
            </span>
            {resolved && sku !== null && sku.price !== null && (
              <span data-testid="cart-picker-price" className="font-semibold text-ink">
                {formatPrice(sku.price * item.quantity)}
              </span>
            )}
          </div>
          {stockLabel && (
            <p
              className={`mt-1 text-xs font-medium ${outOfStock ? "text-sale" : "text-ink-secondary"}`}
            >
              {stockLabel}
            </p>
          )}
          {outOfStock && (
            <p className="mt-1 text-xs text-ink-secondary">
              Out of stock — you can still save it to your cart for later.
            </p>
          )}
          {error && (
            <p
              role="alert"
              data-testid="cart-picker-error"
              className="mt-2 text-xs text-sale"
            >
              {error}
            </p>
          )}
        </div>
      </div>

      <div className="flex gap-2 border-t border-border p-4">
        <button
          type="button"
          data-testid="cart-picker-cancel"
          onClick={onDone}
          disabled={busy}
          className="rounded-lg border border-border px-4 py-2.5 text-sm font-semibold text-ink hover:border-ink disabled:opacity-40"
        >
          Cancel
        </button>
        <button
          type="button"
          data-testid="cart-picker-confirm"
          onClick={confirmChange}
          disabled={busy || !resolved}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-cta py-2.5 text-sm font-semibold text-white transition-colors hover:bg-cta-hover disabled:cursor-not-allowed disabled:bg-border disabled:text-ink-muted"
        >
          {busy ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              Saving…
            </>
          ) : (
            "Confirm"
          )}
        </button>
      </div>
    </>
  );
}
