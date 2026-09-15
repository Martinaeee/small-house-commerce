"use client";

import { useState } from "react";
import Link from "next/link";
import type { Product } from "@/lib/api";
import { useCart } from "./CartContext";
import { track } from "@/lib/tracking";
import { PriceBox } from "@/components/ui/PriceBox";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";
import { sellableVariants, variantImage } from "@/lib/variantImages";

interface QuickAddViewProps {
  product: Product;
  /** Called exactly once after a successful add; the drawer swaps to cart. */
  onAdded: () => void;
  /** Close the whole drawer (product link). */
  onClose: () => void;
}

function clampQty(qty: number, available: number): number {
  const max = Math.max(1, available);
  return Math.min(Math.max(1, qty), max);
}

export function QuickAddView({ product, onAdded, onClose }: QuickAddViewProps) {
  const { addItem } = useCart();
  const [selectedId, setSelectedId] = useState<string>(
    () => sellableVariants(product)[0]?.id ?? product.variants[0]?.id ?? "",
  );
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedIndex = product.variants.findIndex((v) => v.id === selectedId);
  const variant = selectedIndex >= 0 ? product.variants[selectedIndex] : null;
  const sku = variant?.sku ?? null;
  const available = sku?.availableInventory ?? 0;
  const outOfStock = sku === null || sku.price === null || available <= 0;
  const image = selectedIndex >= 0 ? variantImage(product, selectedIndex) : null;
  const stockLabel =
    sku === null || sku.price === null
      ? null
      : available <= 0
        ? "Out of Stock"
        : available <= 5
          ? `Only ${available} left`
          : null;

  function selectVariant(id: string, index: number, variantAvailable: number) {
    setSelectedId(id);
    setQty((current) => clampQty(current, Math.max(1, variantAvailable)));
    setError(null);
  }

  async function confirmAdd() {
    if (!sku || sku.price === null || busy || available <= 0) return;
    setBusy(true);
    setError(null);
    try {
      await addItem({ skuId: sku.id, quantity: qty }, { openDrawer: false });
      track("AddToCart", {
        content_ids: [sku.id],
        content_name: product.name,
        content_type: "product",
        contents: [{ id: sku.id, quantity: qty }],
        value: sku.price,
        currency: "PHP",
      });
      onAdded();
    } catch {
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
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={image.url}
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
              onClick={onClose}
              className="line-clamp-2 text-sm font-semibold text-ink hover:text-cta"
            >
              {product.name}
            </Link>
            {variant && (
              <p className="mt-0.5 text-xs text-ink-muted">{variant.name}</p>
            )}
            <div className="mt-1.5">
              <PriceBox price={sku?.price ?? null} compareAtPrice={sku?.compareAtPrice ?? null} />
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
          <span className="text-sm font-medium text-ink-secondary">Color/Style</span>
          <div className="mt-2 flex flex-wrap gap-2.5">
            {product.variants.map((v, i) => {
              const thumb = variantImage(product, i);
              const disabled = v.sku === null;
              const active = v.id === selectedId;
              return (
                <button
                  key={v.id}
                  type="button"
                  disabled={disabled}
                  aria-pressed={active}
                  data-testid={`picker-variant-${product.slug}-${i}`}
                  onClick={() =>
                    selectVariant(v.id, i, v.sku?.availableInventory ?? 1)
                  }
                  className="flex w-16 flex-col items-center gap-1"
                >
                  <span
                    className={`h-16 w-16 overflow-hidden rounded-lg border-2 bg-card transition-colors ${
                      active
                        ? "border-cta"
                        : "border-border hover:border-primary"
                    } ${disabled ? "opacity-40" : ""}`}
                  >
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={thumb.url}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <PlaceholderImage label="" className="h-full w-full" />
                    )}
                  </span>
                  <span
                    className={`w-full truncate text-center text-[11px] leading-tight ${
                      active ? "font-semibold text-cta" : "text-ink-secondary"
                    } ${disabled ? "opacity-40" : ""}`}
                  >
                    {v.name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="border-t border-border px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-ink-secondary">Quantity</span>
            <span className="inline-flex items-center rounded-lg border border-border">
              <button
                type="button"
                aria-label="Decrease quantity"
                disabled={outOfStock || qty <= 1}
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                className="flex h-8 w-8 items-center justify-center text-ink-secondary hover:text-cta disabled:opacity-40"
              >
                −
              </button>
              <span className="w-9 text-center text-sm text-ink">{qty}</span>
              <button
                type="button"
                aria-label="Increase quantity"
                disabled={outOfStock || qty >= available}
                onClick={() => setQty((q) => clampQty(q + 1, available))}
                className="flex h-8 w-8 items-center justify-center text-ink-secondary hover:text-cta disabled:opacity-40"
              >
                +
              </button>
            </span>
          </div>
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
          disabled={outOfStock || busy}
          data-testid={`picker-confirm-${product.slug}`}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-cta py-2.5 text-sm font-semibold text-white transition-colors hover:bg-cta-hover disabled:cursor-not-allowed disabled:bg-border disabled:text-ink-muted"
        >
          {busy ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              Adding…
            </>
          ) : outOfStock ? (
            "Out of Stock"
          ) : (
            "Confirm"
          )}
        </button>
      </div>
    </>
  );
}
