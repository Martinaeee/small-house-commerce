"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Product } from "@/lib/api";
import { api, cartStorage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { formatPrice, PriceBox } from "@/components/ui/PriceBox";

/**
 * PDP_SPEC §6.4/§8/§10/§11/§18 + §12 (mobile sticky CTA).
 *
 * ORDER NOW stock gate (PDP_SPEC §18 ORDER NOW Inventory Check, decided
 * rules): the frontend reads the selected SKU's availableInventory and does
 * not enter checkout when it is <= 0; the backend checkout re-validates as
 * the authoritative safety net.
 *
 * ADD TO CART stays enabled for out-of-stock SKUs (decided rules: carts may
 * hold unavailable items, flagged per item; checkout refuses on any short).
 */

export function ProductPurchase({ product }: { product: Product }) {
  const router = useRouter();
  const variants = product.variants;

  const firstSellable = useMemo(
    () => variants.find((variant) => variant.sku !== null) ?? null,
    [variants],
  );

  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(
    firstSellable?.id ?? null,
  );
  const [quantity, setQuantity] = useState(1);
  const [notice, setNotice] = useState<{ kind: "ok" | "error" | "stock"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const selectedVariant = variants.find((variant) => variant.id === selectedVariantId) ?? null;
  const sku = selectedVariant?.sku ?? null;
  const available = sku?.availableInventory ?? 0;
  const outOfStock = sku === null || available <= 0;
  const lowStock = !outOfStock && available <= 5;
  const price = sku?.price ?? null;
  const compareAt = sku?.compareAtPrice ?? null;

  async function handleAddToCart() {
    if (!sku) return;
    setBusy(true);
    setNotice(null);
    try {
      const summary = await api.addToCart({
        cartId: cartStorage.get(),
        skuId: sku.id,
        quantity,
      });
      cartStorage.set(summary.cartId);
      setNotice({ kind: "ok", text: "Added to cart" });
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "Could not add to cart",
      });
    } finally {
      setBusy(false);
    }
  }

  /**
   * PDP_SPEC §18 ORDER NOW Inventory Check: the frontend gate. The backend
   * checkout endpoint re-validates stock as the safety net.
   */
  function handleOrderNow() {
    if (!sku) return;
    if (sku.availableInventory <= 0) {
      setNotice({ kind: "stock", text: "This item is out of stock" });
      return;
    }
    setNotice(null);
    router.push(`/checkout?skuId=${sku.id}&qty=${quantity}`);
  }

  const stockLabel = outOfStock
    ? "Out of Stock"
    : lowStock
      ? `Only ${available} left`
      : null;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold text-ink sm:text-3xl">{product.name}</h1>

      {/* PDP_SPEC §8 Price Module: original -> discounted -> saving */}
      <PriceBox price={price} compareAtPrice={compareAt} />
      {price !== null && compareAt !== null && compareAt > price && (
        <p className="text-sm font-medium text-sale">
          Save {formatPrice(compareAt - price)}
        </p>
      )}

      {/* §18 stock state */}
      {stockLabel && (
        <p
          className={`text-sm font-semibold ${outOfStock ? "text-sale" : "text-sale"}`}
          data-testid="stock-state"
        >
          {stockLabel}
        </p>
      )}

      {/* Variant selection */}
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

      {/* Quantity */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-ink-secondary">Qty</span>
        <div className="flex items-center rounded-lg border border-border bg-card">
          <button
            type="button"
            aria-label="Decrease quantity"
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            className="h-11 w-11 text-lg text-ink hover:text-cta"
          >
            −
          </button>
          <span className="w-8 text-center text-base font-semibold" data-testid="qty">
            {quantity}
          </span>
          <button
            type="button"
            aria-label="Increase quantity"
            onClick={() => setQuantity((q) => Math.min(99, q + 1))}
            className="h-11 w-11 text-lg text-ink hover:text-cta"
          >
            +
          </button>
        </div>
      </div>

      {/* CTA (PDP_SPEC §11: ORDER NOW primary, ADD TO CART secondary) */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          onClick={handleOrderNow}
          disabled={busy}
          className="flex-1"
          data-testid="order-now"
        >
          ORDER NOW
        </Button>
        <Button variant="secondary" onClick={handleAddToCart} disabled={busy} className="flex-1">
          ADD TO CART
        </Button>
      </div>

      {/* Notice (stock-out prompt / add feedback / errors) */}
      {notice && (
        <p
          role={notice.kind === "error" ? "alert" : "status"}
          className={`rounded-lg border px-3 py-2 text-sm ${
            notice.kind === "ok"
              ? "border-primary bg-primary-light/40 text-cta"
              : "border-sale/40 bg-sale/5 text-sale"
          }`}
        >
          {notice.text}
        </p>
      )}

      {/* PDP_SPEC §10 COD Trust Module */}
      <ul className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 text-sm text-ink-secondary">
        <li className="flex items-center gap-2">
          <span className="font-semibold text-cta">✓</span> Cash On Delivery Available
        </li>
        <li className="flex items-center gap-2">
          <span className="font-semibold text-cta">✓</span> Nationwide Delivery
        </li>
        <li className="flex items-center gap-2">
          <span className="font-semibold text-cta">✓</span> Customer Support Available
        </li>
      </ul>

      {/* PDP_SPEC §12 Mobile Sticky CTA: name + price + ORDER NOW, fixed bottom */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card px-4 py-3 md:hidden">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink">{product.name}</p>
            <PriceBox price={price} compareAtPrice={compareAt} />
          </div>
          <Button onClick={handleOrderNow} disabled={busy} size="md" className="shrink-0">
            ORDER NOW
          </Button>
        </div>
      </div>
    </div>
  );
}
