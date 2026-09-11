"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, cartStorage, type CartSummary } from "@/lib/api";
import { Button, ButtonLink } from "@/components/ui/Button";
import { formatPrice } from "@/components/ui/PriceBox";

/**
 * Cart page (FRONTEND_SPEC §13).
 *
 * Decided cart rules: carts may hold out-of-stock SKUs; each item shows its
 * unavailable state, and when ANY item is unavailable the Proceed to Checkout
 * button is disabled with a stock notice. The backend checkout re-validates
 * as the authoritative gate.
 */

export function CartView() {
  const router = useRouter();
  const [cart, setCart] = useState<CartSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // CHECKOUT_SPEC §14 promo code: collapsed by default.
  const [promoOpen, setPromoOpen] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [promoMessage, setPromoMessage] = useState<string | null>(null);

  const cartId = typeof window !== "undefined" ? cartStorage.get() : undefined;

  const refresh = useCallback(async () => {
    if (!cartId) {
      setCart(null);
      setLoading(false);
      return;
    }
    try {
      const summary = await api.getCart(cartId);
      setCart(summary);
      if (summary.items.length === 0) cartStorage.set(""); // stale cart id
      setError(null);
    } catch {
      setError("Could not load your cart. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [cartId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const anyUnavailable = cart?.items.some((item) => item.unavailable) ?? false;

  async function setQuantity(itemId: string, quantity: number) {
    if (!cartId || quantity < 1) return;
    setBusyId(itemId);
    try {
      const summary = await api.updateCartItem(cartId, itemId, quantity);
      setCart(summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update quantity");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(itemId: string) {
    if (!cartId) return;
    setBusyId(itemId);
    try {
      const summary = await api.removeCartItem(cartId, itemId);
      setCart(summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove item");
    } finally {
      setBusyId(null);
    }
  }

  function proceedToCheckout() {
    if (anyUnavailable || !cart || cart.items.length === 0) return;
    router.push("/checkout");
  }

  function applyPromo() {
    // CHECKOUT_SPEC §14: the backend promo engine is not built yet; the UI
    // entry exists so the collapsed pattern is in place.
    setPromoMessage(promoCode.trim() ? "Promo codes are coming soon." : "Enter a code to apply it.");
  }

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

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6">
      <h1 className="mb-6 text-3xl font-semibold text-ink">Your Cart</h1>

      {error && (
        <p role="alert" className="mb-4 rounded-lg border border-sale/40 bg-sale/5 px-3 py-2 text-sm text-sale">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Items */}
        <ul className="flex flex-col gap-4 lg:col-span-2">
          {cart.items.map((item) => (
            <li
              key={item.itemId}
              className={`flex gap-4 rounded-lg border bg-card p-4 ${
                item.unavailable ? "border-sale/50" : "border-border"
              }`}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <Link
                  href={`/products/${item.productSlug}`}
                  className="line-clamp-2 text-sm font-semibold text-ink hover:text-cta"
                >
                  {item.productName}
                </Link>
                <span className="text-xs text-ink-muted">
                  {item.variantName} · {item.skuCode}
                </span>
                {item.unavailable && (
                  <span className="text-xs font-semibold text-sale" data-testid={`unavailable-${item.skuId}`}>
                    Out of stock — remove to checkout
                  </span>
                )}

                {/* quantity controls */}
                <div className="mt-2 flex items-center gap-3">
                  <div className="flex items-center rounded-lg border border-border">
                    <button
                      type="button"
                      aria-label="Decrease quantity"
                      onClick={() => setQuantity(item.itemId, item.quantity - 1)}
                      disabled={busyId === item.itemId}
                      className="h-9 w-9 text-ink hover:text-cta disabled:opacity-50"
                    >
                      −
                    </button>
                    <span className="w-7 text-center text-sm font-semibold">{item.quantity}</span>
                    <button
                      type="button"
                      aria-label="Increase quantity"
                      onClick={() => setQuantity(item.itemId, item.quantity + 1)}
                      disabled={busyId === item.itemId}
                      className="h-9 w-9 text-ink hover:text-cta disabled:opacity-50"
                    >
                      +
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(item.itemId)}
                    className="text-sm text-ink-muted hover:text-sale"
                  >
                    Remove
                  </button>
                </div>
              </div>

              <div className="text-right">
                {item.unitPrice !== null && (
                  <p className="text-sm font-semibold text-ink">
                    {formatPrice(item.unitPrice * item.quantity)}
                  </p>
                )}
                {item.unitPrice !== null && item.quantity > 1 && (
                  <p className="text-xs text-ink-muted">{formatPrice(item.unitPrice)} each</p>
                )}
              </div>
            </li>
          ))}
        </ul>

        {/* Summary */}
        <aside className="h-fit rounded-lg border border-border bg-card p-5 lg:sticky lg:top-24">
          <h2 className="mb-4 text-lg font-semibold text-ink">Order Summary</h2>
          <dl className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-secondary">Subtotal</dt>
              <dd className="font-medium text-ink">{formatPrice(cart.subtotal)}</dd>
            </div>
            {cart.discount > 0 && (
              <div className="flex justify-between">
                <dt className="text-ink-secondary">Discount</dt>
                <dd className="font-medium text-sale">−{formatPrice(cart.discount)}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-ink-secondary">Shipping</dt>
              <dd className="font-medium text-ink">Calculated at checkout</dd>
            </div>
            <div className="flex justify-between border-t border-border pt-3 text-base">
              <dt className="font-semibold text-ink">Total</dt>
              <dd className="font-bold text-ink">{formatPrice(cart.total)}</dd>
            </div>
          </dl>

          {anyUnavailable && (
            <p role="alert" className="mt-4 rounded-lg border border-sale/40 bg-sale/5 px-3 py-2 text-sm text-sale">
              Some items are out of stock. Remove them to continue to checkout.
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
            disabled={anyUnavailable || cart.items.length === 0}
            className="mt-4 w-full"
            data-testid="proceed-checkout"
          >
            Proceed to Checkout
          </Button>
          <p className="mt-3 text-center text-xs text-ink-muted">
            Cash on Delivery · Pay when your order arrives
          </p>
        </aside>
      </div>
    </div>
  );
}
