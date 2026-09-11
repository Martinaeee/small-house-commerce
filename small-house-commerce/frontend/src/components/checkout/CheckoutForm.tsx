"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, cartStorage, type CartSummary } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { formatPrice } from "@/components/ui/PriceBox";
import { readAttribution, track } from "@/lib/tracking";

/**
 * COD checkout (CHECKOUT_SPEC §5, §8-§9, §13, §15).
 *
 * Items come from the cart (localStorage cartId) or from a Buy Now deep link
 * (?skuId&qty). The backend re-validates stock and rejects the whole order on
 * any shortfall; errors (e.g. insufficient stock) surface here.
 */

const inputCls =
  "w-full rounded-lg border border-border bg-card px-3 py-2.5 text-base text-ink placeholder:text-ink-muted focus:border-cta focus:outline-none";

interface CheckoutFormProps {
  skuId?: string;
  qty?: string;
}

export function CheckoutForm({ skuId, qty }: CheckoutFormProps) {
  const router = useRouter();
  const [cart, setCart] = useState<CartSummary | null>(null);
  const [cartLoading, setCartLoading] = useState(skuId === undefined);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: "",
    phone: "",
    province: "",
    city: "",
    barangay: "",
    postalCode: "",
    streetAddress: "",
    landmark: "",
  });

  // Buy Now quantity or first cart item quantity.
  const buyNowQty = Math.min(99, Math.max(1, Number(qty) || 1));

  useEffect(() => {
    if (skuId) return; // Buy Now path: items come from the URL
    const cartId = cartStorage.get();
    if (!cartId) {
      setCartLoading(false);
      return;
    }
    api
      .getCart(cartId)
      .then((summary) => setCart(summary))
      .catch(() => setError("Could not load your cart. Please try again."))
      .finally(() => setCartLoading(false));
  }, [skuId]);

  const items = useMemo(() => {
    if (skuId) return [{ skuId, quantity: buyNowQty }];
    return (
      cart?.items.map((item) => ({ skuId: item.skuId, quantity: item.quantity })) ?? []
    );
  }, [skuId, buyNowQty, cart]);

  const total = skuId ? null : cart ? cart.total : null;

  // TRACKING_SPEC §12 InitiateCheckout.
  useEffect(() => {
    if (items.length === 0) return;
    track("InitiateCheckout", {
      contents: items.map((item) => ({ id: item.skuId, quantity: item.quantity })),
      value: total ?? undefined,
      currency: "PHP",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skuId, items.length]);

  const set = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  async function placeOrder() {
    setError(null);

    if (!form.name.trim() || !form.phone.trim() || !form.province.trim() ||
        !form.city.trim() || !form.streetAddress.trim()) {
      setError("Please fill in your name, phone, province, city and full address.");
      return;
    }

    setSubmitting(true);
    try {
      // AID/UTM from the URL flow into the order attribution snapshot (§5).
      const order = await api.createOrder({
        customer: {
          name: form.name.trim(),
          phone: form.phone.trim(),
          province: form.province.trim(),
          city: form.city.trim(),
          barangay: form.barangay.trim() || null,
          postalCode: form.postalCode.trim() || null,
          streetAddress: form.streetAddress.trim(),
          landmark: form.landmark.trim() || null,
        },
        items,
        attribution: readAttribution(),
      });
      // Stash the total so the success page can fire the Purchase event.
      if (total !== null) sessionStorage.setItem("lastOrderTotal", String(total));
      // Fresh cart for the next order.
      cartStorage.set("");
      router.push(`/order-success/${order.orderNumber}`);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not place your order. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (cartLoading) {
    return <p className="py-16 text-center text-ink-secondary">Loading checkout…</p>;
  }

  if (items.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="mb-4 text-ink-secondary">Your cart is empty.</p>
        <a href="/collections" className="text-sm text-cta hover:underline">
          Start shopping
        </a>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6">
      <h1 className="mb-6 text-3xl font-semibold text-ink">Checkout</h1>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-5">
        {/* Order preview (§7) + summary (§13) */}
        <aside className="order-2 flex flex-col gap-4 lg:order-1 lg:col-span-2">
          <div className="rounded-lg border border-border bg-card p-5">
            <h2 className="mb-3 text-lg font-semibold text-ink">Your Order</h2>
            {skuId ? (
              <p className="text-sm text-ink-secondary">
                1 item × {buyNowQty} (Buy Now)
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {cart?.items.map((item) => (
                  <li key={item.itemId} className="flex justify-between gap-3 text-sm">
                    <span className="line-clamp-1 text-ink">
                      {item.productName} × {item.quantity}
                    </span>
                    <span className="shrink-0 font-medium text-ink">
                      {item.unitPrice !== null
                        ? formatPrice(item.unitPrice * item.quantity)
                        : "—"}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <dl className="mt-4 flex flex-col gap-2 border-t border-border pt-4 text-sm">
              {cart && cart.discount > 0 && (
                <div className="flex justify-between">
                  <dt className="text-ink-secondary">Discount</dt>
                  <dd className="font-medium text-sale">−{formatPrice(cart.discount)}</dd>
                </div>
              )}
              <div className="flex justify-between border-t border-border pt-3 text-base">
                <dt className="font-semibold text-ink">Total (COD)</dt>
                <dd className="font-bold text-ink">
                  {total !== null ? formatPrice(total) : "Calculated at checkout"}
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-lg border border-border bg-card p-5 text-sm text-ink-secondary">
            <p className="font-semibold text-ink">Cash on Delivery</p>
            <p className="mt-1">
              Pay in cash when your order arrives. Estimated delivery:
              Metro Manila 3-5 days, provinces 5-7 days.
            </p>
          </div>
        </aside>

        {/* Customer information (§8) + delivery address (§9) */}
        <div className="order-1 flex flex-col gap-4 lg:order-2 lg:col-span-3">
          <section className="rounded-lg border border-border bg-card p-5">
            <h2 className="mb-4 text-lg font-semibold text-ink">Contact Information</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm font-medium text-ink">
                Full Name *
                <input className={inputCls} value={form.name} onChange={set("name")} placeholder="Juan Dela Cruz" />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium text-ink">
                Mobile Number *
                <input
                  className={inputCls}
                  value={form.phone}
                  onChange={set("phone")}
                  placeholder="0917 123 4567"
                  inputMode="tel"
                  autoComplete="tel"
                />
              </label>
            </div>
            <p className="mt-2 text-xs text-ink-muted">
              We use your mobile number for delivery updates.
            </p>
          </section>

          <section className="rounded-lg border border-border bg-card p-5">
            <h2 className="mb-4 text-lg font-semibold text-ink">Delivery Address</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm font-medium text-ink">
                Province *
                <input className={inputCls} value={form.province} onChange={set("province")} placeholder="Metro Manila" />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium text-ink">
                City / Municipality *
                <input className={inputCls} value={form.city} onChange={set("city")} placeholder="Quezon City" />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium text-ink">
                Barangay
                <input className={inputCls} value={form.barangay} onChange={set("barangay")} placeholder="Barangay" />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium text-ink">
                Postal Code
                <input className={inputCls} value={form.postalCode} onChange={set("postalCode")} placeholder="1100" inputMode="numeric" />
              </label>
              <label className="col-span-full flex flex-col gap-1 text-sm font-medium text-ink">
                Full Address *
                <input
                  className={inputCls}
                  value={form.streetAddress}
                  onChange={set("streetAddress")}
                  placeholder="House no., street, subdivision"
                />
              </label>
              <label className="col-span-full flex flex-col gap-1 text-sm font-medium text-ink">
                Landmark
                <input className={inputCls} value={form.landmark} onChange={set("landmark")} placeholder="Near…" />
              </label>
            </div>
          </section>

          {error && (
            <p role="alert" className="rounded-lg border border-sale/40 bg-sale/5 px-3 py-2 text-sm text-sale">
              {error}
            </p>
          )}

          <Button onClick={placeOrder} disabled={submitting} className="w-full" data-testid="place-order">
            {submitting ? "Placing order…" : "PLACE COD ORDER"}
          </Button>
          <p className="text-center text-xs text-ink-muted">
            Cash on Delivery · No payment needed now
          </p>
        </div>
      </div>
    </div>
  );
}
