"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useCart } from "./CartContext";
import { useProductImages } from "@/lib/productImages";
import {
  firstSku,
  useCartRecommendations,
} from "@/lib/useCartRecommendations";
import { ButtonLink } from "@/components/ui/Button";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";
import { formatPrice } from "@/components/ui/PriceBox";
import type { CartItem, Product } from "@/lib/api";

/**
 * Slide-in "Your Cart" drawer after every add-to-cart (spec §4.4). Right-side
 * panel, backdrop click-to-close, scroll lock, Escape and a focus trap mirror
 * the mobile nav drawer (components/layout/MainNav.tsx). The drawer fires no
 * pixel events itself: AddToCart stays at the PDP/card call sites.
 */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled])';

const SERVICE_LINES = [
  "Cash on Delivery — no payment now",
  "Nationwide delivery 3–7 days",
  "Phone confirmation before delivery",
];

export function CartDrawer() {
  const {
    cart,
    isOpen,
    closeCart,
    updateItem,
    removeItem,
    reload,
    addItem,
    takeDrawerOpener,
  } = useCart();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [lineError, setLineError] = useState<string | null>(null);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [addedSlug, setAddedSlug] = useState<string | null>(null);

  // Every exit path clears per-line transient state before close, so a
  // reopen never flashes a stale remove-confirm or line error.
  const handleClose = useCallback(() => {
    setConfirmId(null);
    setLineError(null);
    closeCart();
  }, [closeCart]);

  const recommendations = useCartRecommendations(cart);
  const slugs = useMemo(
    () => [...new Set((cart?.items ?? []).map((item) => item.productSlug))],
    [cart],
  );
  const images = useProductImages(slugs);
  const unitCount = (cart?.items ?? []).reduce((sum, item) => sum + item.quantity, 0);

  // Scroll lock, initial focus, focus trap, Escape, and focus restoration.
  useEffect(() => {
    if (!isOpen) return;
    // Prefer the opener captured synchronously in the add-to-cart click task
    // (FAIL-1: by effect time the disabled trigger has lost focus to <body>).
    // Effect-time capture stays the fallback for the openCart() path.
    openerRef.current = takeDrawerOpener();
    if (!openerRef.current) {
      const active = document.activeElement;
      openerRef.current =
        active instanceof HTMLElement && active !== document.body ? active : null;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusables = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((el) => el.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      // Pull back from the backdrop button / <body>, which are reachable by
      // Tab even though they live outside the panel.
      const inside = active !== null && panelRef.current.contains(active);
      if (e.shiftKey && (!inside || active === first)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (!inside || active === last)) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      openerRef.current?.focus();
    };
  }, [isOpen, handleClose, takeDrawerOpener]);

  async function changeQty(item: CartItem, quantity: number) {
    if (busyId) return;
    const clamped = Math.min(Math.max(1, quantity), item.availableInventory || quantity);
    setLineError(null);
    setBusyId(item.itemId);
    try {
      await updateItem(item.itemId, clamped);
    } catch {
      setLineError("Could not update quantity. Please try again.");
      await reload();
    } finally {
      setBusyId(null);
    }
  }

  async function confirmRemove(item: CartItem) {
    if (busyId) return;
    setBusyId(item.itemId);
    try {
      await removeItem(item.itemId);
      setConfirmId(null);
    } catch {
      setLineError("Could not remove the item. Please try again.");
      await reload();
    } finally {
      setBusyId(null);
    }
  }

  async function quickAdd(product: Product) {
    const sku = firstSku(product);
    if (!sku || busySlug) return;
    setBusySlug(product.slug);
    try {
      await addItem({ skuId: sku.id, quantity: 1 }, { openDrawer: false });
      setAddedSlug(product.slug);
      setTimeout(() => {
        setAddedSlug((current) => (current === product.slug ? null : current));
      }, 1400);
    } catch {
      /* the row stays put; the visitor can open the PDP */
    } finally {
      setBusySlug(null);
    }
  }

  if (!isOpen) return null;

  const items = cart?.items ?? [];
  const hasItems = items.length > 0;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Your cart">
      <button
        type="button"
        aria-label="Close cart"
        className="absolute inset-0 bg-ink/40"
        onClick={handleClose}
      />
      <aside
        ref={panelRef}
        className="absolute right-0 top-0 flex h-full w-full max-w-[400px] flex-col bg-card shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-base font-bold uppercase tracking-wide text-ink">
            Your Cart ({unitCount})
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={handleClose}
            aria-label="Close cart"
            className="text-ink-secondary hover:text-ink"
          >
            <svg viewBox="0 0 16 16" className="h-5 w-5" fill="none" aria-hidden="true">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <ul className="border-b border-border bg-background px-4 py-2">
          {SERVICE_LINES.map((line) => (
            <li key={line} className="flex items-center gap-2 py-1 text-xs text-ink-secondary">
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 text-cta" fill="none" aria-hidden="true">
                <path
                  d="M3 8.5 6.5 12 13 4.5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {line}
            </li>
          ))}
        </ul>

        <div className="flex-1 overflow-y-auto">
          {hasItems ? (
            <>
              <ul className="divide-y divide-border px-4">
                {items.map((item) => (
                  <li key={item.itemId} className="flex gap-3 py-3">
                    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-border">
                      {images.get(item.productSlug) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={images.get(item.productSlug) ?? ""} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <PlaceholderImage label="" className="h-full w-full" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/products/${item.productSlug}`}
                        onClick={handleClose}
                        className="line-clamp-2 text-sm font-medium text-ink hover:text-cta"
                      >
                        {item.productName}
                      </Link>
                      <p className="mt-0.5 text-xs text-ink-muted">{item.variantName}</p>
                      {item.unavailable && (
                        <p role="alert" className="mt-1 text-xs text-sale">Out of stock</p>
                      )}
                      <div className="mt-1.5 flex items-center gap-2">
                        {confirmId === item.itemId ? (
                          <span className="flex items-center gap-2 text-xs">
                            <span className="text-ink-secondary">Remove item?</span>
                            <button
                              type="button"
                              disabled={busyId === item.itemId}
                              onClick={() => confirmRemove(item)}
                              className="font-semibold text-sale hover:underline"
                            >
                              Remove
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmId(null)}
                              className="text-ink-secondary hover:underline"
                            >
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-lg border border-border">
                            <button
                              type="button"
                              aria-label={`Decrease quantity of ${item.productName}`}
                              disabled={busyId === item.itemId || item.unavailable}
                              onClick={() =>
                                item.quantity <= 1
                                  ? setConfirmId(item.itemId)
                                  : changeQty(item, item.quantity - 1)
                              }
                              className="flex h-7 w-7 items-center justify-center text-ink-secondary hover:text-cta disabled:opacity-40"
                            >
                              −
                            </button>
                            <span className="w-8 text-center text-sm text-ink">
                              {busyId === item.itemId ? (
                                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-ink/20 border-t-ink" />
                              ) : (
                                item.quantity
                              )}
                            </span>
                            <button
                              type="button"
                              aria-label={`Increase quantity of ${item.productName}`}
                              disabled={
                                busyId === item.itemId ||
                                item.unavailable ||
                                item.quantity >= item.availableInventory
                              }
                              onClick={() => changeQty(item, item.quantity + 1)}
                              className="flex h-7 w-7 items-center justify-center text-ink-secondary hover:text-cta disabled:opacity-40"
                            >
                              +
                            </button>
                          </span>
                        )}
                        <button
                          type="button"
                          aria-label={`Remove ${item.productName}`}
                          onClick={() => setConfirmId(item.itemId)}
                          className="text-xs text-ink-muted hover:text-sale"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-sm font-semibold text-ink">
                      {formatPrice(item.lineTotal)}
                    </div>
                  </li>
                ))}
              </ul>

              {lineError && (
                <p role="alert" className="px-4 pt-2 text-xs text-sale">{lineError}</p>
              )}

              {recommendations.length > 0 && (
                <section className="border-t border-border px-4 py-3" aria-label="Recommended products">
                  <h3 className="mb-2 text-sm font-semibold text-ink">You May Also Like</h3>
                  <ul className="flex flex-col gap-3">
                    {recommendations.map((product) => {
                      const sku = firstSku(product)!;
                      const image = product.images[0];
                      const busy = busySlug === product.slug;
                      const added = addedSlug === product.slug;
                      return (
                        <li key={product.id} className="flex items-center gap-3">
                          <Link
                            href={`/products/${product.slug}`}
                            onClick={handleClose}
                            className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-border"
                          >
                            {image ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={image.url} alt={image.altText ?? product.name} className="h-full w-full object-cover" />
                            ) : (
                              <PlaceholderImage label={product.name} className="h-full w-full" />
                            )}
                          </Link>
                          <div className="min-w-0 flex-1">
                            <Link
                              href={`/products/${product.slug}`}
                              onClick={handleClose}
                              className="line-clamp-2 text-xs font-medium text-ink hover:text-cta"
                            >
                              {product.name}
                            </Link>
                            <p className="text-sm font-semibold text-ink">{formatPrice(sku.price!)}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => quickAdd(product)}
                            disabled={busy}
                            aria-label={`Add ${product.name} to cart`}
                            data-testid={`drawer-rec-add-${product.slug}`}
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cta text-white transition-colors hover:bg-cta-hover disabled:opacity-60"
                          >
                            {busy ? (
                              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                            ) : added ? (
                              <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
                                <path d="M3 8.5 6.5 12 13 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            ) : (
                              <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
                                <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                              </svg>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
            </>
          ) : (
            <div className="px-4 py-12 text-center">
              <p className="mb-4 text-sm text-ink-secondary">Your cart is empty</p>
              <button
                type="button"
                onClick={handleClose}
                className="text-sm font-semibold text-cta hover:underline"
              >
                Continue shopping
              </button>
            </div>
          )}
        </div>

        {hasItems && cart && (
          <div className="border-t border-border p-4">
            <dl className="mb-3 flex flex-col gap-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-secondary">Subtotal</dt>
                <dd className="font-medium text-ink">{formatPrice(cart.subtotal)}</dd>
              </div>
              {cart.discount > 0 && (
                <div className="flex justify-between">
                  <dt className="text-ink-secondary">You save</dt>
                  <dd className="font-medium text-sale">−{formatPrice(cart.discount)}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-ink-secondary">Shipping</dt>
                <dd className="font-medium text-ink">COD — calculated at checkout</dd>
              </div>
            </dl>
            <ButtonLink href="/cart" className="w-full" onClick={handleClose}>
              CHECKOUT
            </ButtonLink>
            <button
              type="button"
              onClick={handleClose}
              className="mt-2 w-full text-center text-sm text-ink-secondary hover:text-ink"
            >
              Continue shopping
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}
