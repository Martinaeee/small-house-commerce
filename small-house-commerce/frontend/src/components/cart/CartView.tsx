"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CartItem } from "@/lib/api";
import { useCart } from "./CartContext";
import { Button, ButtonLink } from "@/components/ui/Button";
import { formatPrice } from "@/components/ui/PriceBox";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";
import { useProductImages } from "@/lib/productImages";

/**
 * Cart page — Shopee/Taobao selection model (FRONTEND_SPEC §13):
 * - every checkable line has a checkbox; only selected lines go to checkout,
 *   unselected lines simply stay in the cart;
 * - unavailable lines (stock 0 or quantity above stock) can't be selected,
 *   show "Out of Stock" / "Only N available", and can only be removed;
 * - quantities support − / + plus manual entry clamped to available stock;
 * - the summary and the checkout CTA count selected lines only.
 *
 * Selection persists per cart id in localStorage and defaults to "all
 * checkable selected". The backend checkout accepts an explicit item subset,
 * so no backend change is required.
 */

function selectionKey(cartId: string) {
  return `cartSelection:${cartId}`;
}

/**
 * Persisted decision: `selected` are the checked line ids; `decided` is every
 * checkable line id the visitor had on screen when the choice was saved. A new
 * line added from the PDP is in neither set and therefore defaults to
 * selected, matching Shopee/Taobao. Legacy values were plain string arrays.
 */
type SavedSelection = { selected: string[]; decided: string[] };

function loadSelection(cartId: string): SavedSelection | string[] | null {
  try {
    const raw = window.localStorage.getItem(selectionKey(cartId));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) {
      return parsed.filter((x): x is string => typeof x === "string");
    }
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as SavedSelection).selected) &&
      Array.isArray((parsed as SavedSelection).decided)
    ) {
      const strings = (xs: unknown[]) => xs.filter((x): x is string => typeof x === "string");
      return {
        selected: strings((parsed as SavedSelection).selected),
        decided: strings((parsed as SavedSelection).decided),
      };
    }
    return null;
  } catch {
    return null;
  }
}

function saveSelection(
  cartId: string,
  selected: readonly string[],
  decided: readonly string[],
) {
  try {
    const value: SavedSelection = { selected: [...selected], decided: [...decided] };
    window.localStorage.setItem(selectionKey(cartId), JSON.stringify(value));
  } catch {
    /* private mode etc. — selection just won't persist */
  }
}

/** Brand-styled tri-state checkbox (checked / mixed / unchecked). */
function CheckBox({
  state,
  disabled = false,
  onToggle,
  ariaLabel,
}: {
  state: boolean | "mixed";
  disabled?: boolean;
  onToggle: () => void;
  ariaLabel: string;
}) {
  const active = state !== false;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state === "mixed" ? "mixed" : state}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onToggle}
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "border-cta bg-cta text-white"
          : "border-ink-muted bg-card text-transparent hover:border-cta"
      }`}
    >
      {state === "mixed" ? (
        <svg viewBox="0 0 16 16" className="h-3 w-3" aria-hidden>
          <path d="M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
          <path
            d="M3.5 8.5 7 12l5.5-7"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      )}
    </button>
  );
}

/** Minus/plus with manual numeric entry; value clamps to [1, available] on commit. */
function QtyControl({
  item,
  busy,
  onCommit,
}: {
  item: CartItem;
  busy: boolean;
  onCommit: (quantity: number) => void;
}) {
  const max = Math.min(99, Math.max(0, item.availableInventory));
  const [draft, setDraft] = useState<string | null>(null);
  const disabled = item.availableInventory <= 0 || busy;

  const commit = (raw: string) => {
    const parsed = Number.parseInt(raw, 10);
    const next = Number.isNaN(parsed)
      ? item.quantity
      : Math.min(max, Math.max(1, parsed));
    setDraft(null);
    if (next !== item.quantity) onCommit(next);
  };

  return (
    <div className="flex items-center rounded-lg border border-border" aria-label="Quantity control">
      <button
        type="button"
        aria-label="Decrease quantity"
        onClick={() => onCommit(item.quantity - 1)}
        disabled={disabled || item.quantity <= 1}
        className="h-9 w-9 text-ink hover:text-cta disabled:cursor-not-allowed disabled:opacity-40"
      >
        −
      </button>
      <input
        value={draft ?? String(item.quantity)}
        disabled={item.availableInventory <= 0}
        inputMode="numeric"
        aria-label="Quantity"
        onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="h-9 w-10 border-x border-border bg-card text-center text-sm font-semibold text-ink outline-none focus:border-cta disabled:text-ink-muted"
      />
      <button
        type="button"
        aria-label="Increase quantity"
        onClick={() => onCommit(item.quantity + 1)}
        disabled={disabled || item.quantity >= max}
        className="h-9 w-9 text-ink hover:text-cta disabled:cursor-not-allowed disabled:opacity-40"
      >
        +
      </button>
    </div>
  );
}

function ItemThumb({ item, imageUrl }: { item: CartItem; imageUrl: string | null | undefined }) {
  const oos = item.availableInventory <= 0;
  return (
    <Link
      href={`/products/${item.productSlug}`}
      className={`block h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-border sm:h-20 sm:w-20 ${
        oos ? "opacity-60 grayscale" : ""
      }`}
      aria-label={item.productName}
    >
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <PlaceholderImage label="" className="h-full w-full" />
      )}
    </Link>
  );
}

function totalsFor(items: CartItem[]) {
  let subtotal = 0;
  let discount = 0;
  for (const item of items) {
    if (item.unitPrice === null) continue;
    subtotal += item.unitPrice * item.quantity;
    if (item.compareAtPrice !== null && item.compareAtPrice > item.unitPrice) {
      discount += (item.compareAtPrice - item.unitPrice) * item.quantity;
    }
  }
  return { subtotal, discount, total: subtotal - discount };
}

export function CartView() {
  const router = useRouter();
  const { cart, loading, updateItem, removeItem } = useCart();
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [promoOpen, setPromoOpen] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [promoMessage, setPromoMessage] = useState<string | null>(null);

  const loadedCartRef = useRef<string | null>(null);
  const seenItemsRef = useRef<Set<string>>(new Set());

  // Reconcile selection with every fresh cart summary: stored choice on first
  // load (default = all checkable), auto-select newly added lines, drop lines
  // that vanished or became unavailable.
  useEffect(() => {
    if (!cart) return;
    const checkableIds = () =>
      cart.items.filter((item) => !item.unavailable).map((item) => item.itemId);
    const persist = (next: Set<string>) =>
      saveSelection(cart.cartId, [...next], checkableIds());

    if (loadedCartRef.current !== cart.cartId) {
      loadedCartRef.current = cart.cartId;
      seenItemsRef.current = new Set(cart.items.map((item) => item.itemId));
      const checkable = new Set(checkableIds());
      const stored = loadSelection(cart.cartId);
      // Lines the visitor never decided on (added from the PDP after the last
      // cart visit) default to selected; legacy string[] values select all.
      const initial =
        stored == null
          ? [...checkable]
          : Array.isArray(stored)
            ? [...checkable]
            : [...checkable].filter(
                (id) =>
                  !stored.decided.includes(id) || stored.selected.includes(id),
              );
      const next = new Set(initial);
      persist(next);
      setSelection(next);
      return;
    }

    setSelection((prev) => {
      const next = new Set(prev);
      let changed = false;
      const currentIds = new Set(cart.items.map((item) => item.itemId));
      for (const id of [...next]) {
        if (!currentIds.has(id)) {
          next.delete(id);
          changed = true;
        }
      }
      for (const item of cart.items) {
        if (!seenItemsRef.current.has(item.itemId)) {
          seenItemsRef.current.add(item.itemId);
          if (!item.unavailable) {
            next.add(item.itemId);
            changed = true;
          }
        }
        if (item.unavailable && next.has(item.itemId)) {
          next.delete(item.itemId);
          changed = true;
        }
      }
      if (changed) persist(next);
      return changed ? next : prev;
    });
  }, [cart]);

  const slugs = useMemo(() => cart?.items.map((item) => item.productSlug) ?? [], [cart]);
  const images = useProductImages(slugs);

  if (loading) {
    return <p className="py-16 text-center text-ink-secondary">Loading your cart…</p>;
  }

  if (!cart || cart.items.length === 0) {
    return (
      <div className="mx-auto flex max-w-[600px] flex-col items-center gap-4 px-4 py-16 text-center">
        <h1 className="text-3xl font-semibold text-ink">Your Cart</h1>
        <p className="text-ink-secondary">Your cart is empty.</p>
        <ButtonLink href="/collections" variant="primary">
          Start Shopping
        </ButtonLink>
      </div>
    );
  }

  const checkableItems = cart.items.filter((item) => !item.unavailable);
  const selectedItems = cart.items.filter((item) => selection.has(item.itemId));
  const selectedIds = selectedItems.map((item) => item.itemId);
  const selectedCount = selectedItems.length;
  const selectedPieces = selectedItems.reduce((sum, item) => sum + item.quantity, 0);
  const allState: boolean | "mixed" =
    checkableItems.length > 0 && selectedIds.length === checkableItems.length
      ? true
      : selectedIds.length > 0
        ? "mixed"
        : false;
  const selectedTotals = totalsFor(selectedItems);
  const oosCount = cart.items.filter((item) => item.availableInventory <= 0).length;
  const unselectedCount = checkableItems.length - selectedCount;

  function toggleItem(item: CartItem) {
    if (item.unavailable) return;
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(item.itemId)) next.delete(item.itemId);
      else next.add(item.itemId);
      saveSelection(cart!.cartId, [...next], checkableItems.map((i) => i.itemId));
      return next;
    });
  }

  function toggleAll() {
    if (!cart) return;
    setSelection((prev) => {
      const allSelected = checkableItems.length > 0 &&
        checkableItems.every((item) => prev.has(item.itemId));
      const next = new Set(allSelected ? [] : checkableItems.map((item) => item.itemId));
      saveSelection(cart.cartId, [...next], checkableItems.map((item) => item.itemId));
      return next;
    });
  }

  async function commitQuantity(item: CartItem, quantity: number) {
    setError(null);
    setBusyId(item.itemId);
    try {
      await updateItem(item.itemId, quantity);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update quantity");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(item: CartItem) {
    setError(null);
    setBusyId(item.itemId);
    try {
      await removeItem(item.itemId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove item");
    } finally {
      setBusyId(null);
    }
  }

  function proceedToCheckout() {
    if (selectedCount === 0) return;
    router.push(`/checkout?items=${encodeURIComponent(selectedIds.join(","))}`);
  }

  function applyPromo() {
    // CHECKOUT_SPEC §14: the backend promo engine is not built yet; the UI
    // entry exists so the collapsed pattern is in place.
    setPromoMessage(promoCode.trim() ? "Promo codes are coming soon." : "Enter a code to apply it.");
  }

  return (
    <div className="mx-auto max-w-[1200px] px-4 pb-28 py-8 sm:px-6 md:pb-8">
      <h1 className="mb-6 text-3xl font-semibold text-ink">Your Cart</h1>

      {error && (
        <p role="alert" className="mb-4 rounded-lg border border-sale/40 bg-sale/5 px-3 py-2 text-sm text-sale">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="flex flex-col gap-3 lg:col-span-2">
          {/* Select-all toolbar */}
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
            <CheckBox
              state={allState}
              onToggle={toggleAll}
              ariaLabel="Select all items"
            />
            <span className="text-sm font-medium text-ink">Select all</span>
            <span className="ml-auto text-xs text-ink-muted">
              {cart.items.length} {cart.items.length === 1 ? "item" : "items"} in cart
            </span>
          </div>

          <ul className="flex flex-col gap-3">
            {cart.items.map((item) => {
              const oos = item.availableInventory <= 0;
              const selected = selection.has(item.itemId);
              return (
                <li
                  key={item.itemId}
                  className={`flex gap-3 rounded-lg border bg-card p-3 sm:gap-4 sm:p-4 ${
                    selected ? "border-cta/50" : "border-border"
                  }`}
                >
                  <div className="pt-1">
                    <CheckBox
                      state={selected}
                      disabled={item.unavailable}
                      onToggle={() => toggleItem(item)}
                      ariaLabel={`Select ${item.productName}`}
                    />
                  </div>

                  <ItemThumb item={item} imageUrl={images.get(item.productSlug)} />

                  <div className="flex min-w-0 flex-1 flex-col">
                    <Link
                      href={`/products/${item.productSlug}`}
                      className="line-clamp-2 text-sm font-semibold text-ink hover:text-cta"
                    >
                      {item.productName}
                    </Link>
                    <span className="mt-0.5 truncate text-xs text-ink-muted">
                      {item.variantName} · {item.skuCode}
                    </span>
                    {oos ? (
                      <span
                        className="mt-1 text-xs font-semibold text-sale"
                        data-testid={`oos-${item.itemId}`}
                      >
                        Out of Stock
                      </span>
                    ) : (
                      item.unavailable && (
                        <span className="mt-1 text-xs font-semibold text-sale">
                          Only {item.availableInventory} available
                        </span>
                      )
                    )}

                    <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                      <div className="flex items-center gap-3">
                        <QtyControl
                          item={item}
                          busy={busyId === item.itemId}
                          onCommit={(quantity) => commitQuantity(item, quantity)}
                        />
                        <button
                          type="button"
                          onClick={() => remove(item)}
                          disabled={busyId === item.itemId}
                          className="text-sm text-ink-muted hover:text-sale disabled:opacity-50"
                        >
                          Remove
                        </button>
                      </div>
                      <div className="text-right">
                        {item.unitPrice !== null && (
                          <p className="text-sm font-semibold text-ink">
                            {formatPrice(item.unitPrice * item.quantity)}
                          </p>
                        )}
                        {item.unitPrice !== null && item.quantity > 1 && (
                          <p className="text-xs text-ink-muted">
                            {formatPrice(item.unitPrice)} each
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Summary — selected lines only */}
        <aside className="h-fit rounded-lg border border-border bg-card p-5 lg:sticky lg:top-24">
          <h2 className="mb-4 text-lg font-semibold text-ink">Order Summary</h2>
          <dl className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-secondary">
                Subtotal{selectedCount > 0 && ` (${selectedPieces})`}
              </dt>
              <dd className="font-medium text-ink">{formatPrice(selectedTotals.subtotal)}</dd>
            </div>
            {selectedTotals.discount > 0 && (
              <div className="flex justify-between">
                <dt className="text-ink-secondary">Discount</dt>
                <dd className="font-medium text-sale">−{formatPrice(selectedTotals.discount)}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-ink-secondary">Shipping</dt>
              <dd className="font-medium text-ink">Calculated at checkout</dd>
            </div>
            <div className="flex justify-between border-t border-border pt-3 text-base">
              <dt className="font-semibold text-ink">Total</dt>
              <dd className="font-bold text-ink">{formatPrice(selectedTotals.total)}</dd>
            </div>
          </dl>

          {unselectedCount > 0 && (
            <p className="mt-3 text-xs text-ink-muted">
              {unselectedCount} {unselectedCount === 1 ? "item is" : "items are"} not selected and
              will stay in your cart.
            </p>
          )}
          {oosCount > 0 && (
            <p className="mt-1 text-xs text-ink-muted">
              {oosCount} out-of-stock {oosCount === 1 ? "item is" : "items are"} saved in your cart
              but can&apos;t be checked out.
            </p>
          )}

          {/* CHECKOUT_SPEC §14 promo code — collapsed by default */}
          <div className="mt-4">
            <button
              type="button"
              onClick={() => {
                setPromoOpen((open) => !open);
                setPromoMessage(null);
              }}
              className="text-sm text-cta hover:underline"
              aria-expanded={promoOpen}
            >
              {promoOpen ? "Hide promo code" : "Have a promo code?"}
            </button>
            {promoOpen && (
              <div className="mt-2 flex gap-2">
                <input
                  value={promoCode}
                  onChange={(e) => setPromoCode(e.target.value)}
                  placeholder="Enter code"
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-cta focus:outline-none"
                  aria-label="Promo code"
                />
                <button
                  type="button"
                  onClick={applyPromo}
                  className="shrink-0 rounded-lg border border-cta/40 px-4 text-sm font-medium text-cta hover:bg-primary-light/40"
                >
                  Apply
                </button>
              </div>
            )}
            {promoMessage && <p className="mt-2 text-xs text-ink-muted">{promoMessage}</p>}
          </div>

          <Button
            onClick={proceedToCheckout}
            disabled={selectedCount === 0}
            className="mt-4 w-full"
            data-testid="proceed-checkout"
          >
            {selectedCount > 0 ? `Proceed to Checkout (${selectedCount})` : "Proceed to Checkout"}
          </Button>
          <p className="mt-3 text-center text-xs text-ink-muted">
            Cash on Delivery · Pay when your order arrives
          </p>
        </aside>
      </div>

      {/* Mobile fixed checkout bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden">
        <div className="mx-auto flex max-w-[1200px] items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-ink">
            <CheckBox state={allState} onToggle={toggleAll} ariaLabel="Select all items" />
            <button type="button" onClick={toggleAll} className="font-medium">
              All
            </button>
          </div>
          <div className="ml-auto text-right">
            <p className="text-xs text-ink-muted">Total</p>
            <p className="text-base font-bold text-ink">{formatPrice(selectedTotals.total)}</p>
          </div>
          <Button
            onClick={proceedToCheckout}
            disabled={selectedCount === 0}
            size="md"
            className="shrink-0"
            data-testid="mobile-checkout"
          >
            CHECK OUT{selectedCount > 0 ? ` (${selectedCount})` : ""}
          </Button>
        </div>
      </div>
    </div>
  );
}
