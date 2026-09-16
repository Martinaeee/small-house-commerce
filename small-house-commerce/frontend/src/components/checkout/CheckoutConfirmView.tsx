"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { deliveryWindowFor } from "@/lib/deliveryWindow";
import { Button } from "@/components/ui/Button";
import { formatPrice } from "@/components/ui/PriceBox";
import { useCart } from "@/components/cart/CartContext";
import { useSiteSettings } from "@/components/site/SiteSettingsProvider";
import { useProductImages } from "@/lib/productImages";
import { readAttribution } from "@/lib/tracking";
import { validateCheckoutForm } from "@/lib/checkoutValidation";
import {
  readCheckoutDraft,
  clearCheckoutDraft,
  type CheckoutDraft,
} from "@/lib/checkoutDraft";
import { useCheckoutLines } from "./useCheckoutLines";
import { OrderPreview } from "./OrderPreview";
import { CheckoutTrustStrip } from "./CheckoutTrustStrip";
import { checkoutQueryString } from "./checkoutItems";

/**
 * COD review step (design spec §3.4): the form page validates and stashes the
 * customer in sessionStorage, then pushes here. With no draft (or an invalid
 * one, e.g. storage unavailable) we replace back to the form so the standalone
 * route can never dead-end. PLACE COD ORDER submits the same payload the
 * single-step flow used to; on success the draft is cleared alongside the
 * existing cart-line removal and total stash.
 */

interface CheckoutConfirmViewProps {
  skuId?: string;
  qty?: string;
  itemsParam?: string;
  slug?: string;
}

export function CheckoutConfirmView({
  skuId,
  qty,
  itemsParam,
  slug,
}: CheckoutConfirmViewProps) {
  const router = useRouter();
  const checkout = useCheckoutLines({ skuId, qty, itemsParam, slug });
  const { removeItems } = useCart();
  const { messengerUrl, supportEmail, supportHours } = useSiteSettings();
  const images = useProductImages(checkout.lines.map((l) => l.slug));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<CheckoutDraft | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      // sessionStorage is browser-only; the await also keeps the setState out
      // of the effect's synchronous body (react-hooks/set-state-in-effect;
      // same convention as AuthProvider/CartContext).
      await Promise.resolve();
      if (!alive) return;
      const d = readCheckoutDraft();
      let invalid = false;
      if (d) {
        try {
          invalid = Object.keys(validateCheckoutForm(d.customer)).length > 0;
        } catch {
          // A structurally corrupt draft (e.g. fields missing/null) must never
          // reject this effect and strand the reviewer on "Loading…" — treat
          // it as invalid and fall back to the form page.
          invalid = true;
        }
      }
      if (!d || invalid) {
        router.replace(`/checkout${checkoutQueryString({ skuId, qty, itemsParam, slug })}`);
        return;
      }
      setDraft(d);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function placeOrder() {
    if (!draft) return;
    setError(null);
    if (submitting) return;
    if (checkout.orderItems.length === 0) {
      setError("No items to check out.");
      return;
    }
    setSubmitting(true);
    try {
      const order = await api.createOrder({
        customer: {
          name: draft.customer.name,
          phone: draft.customer.phone,
          province: draft.customer.province,
          city: draft.customer.city,
          barangay: draft.customer.barangay || null,
          postalCode: draft.customer.postalCode || null,
          streetAddress: draft.customer.streetAddress,
          landmark: draft.customer.landmark || null,
        },
        items: checkout.orderItems,
        attribution: readAttribution(),
      });
      if (!checkout.isBuyNow) await removeItems(checkout.cartItemIds);
      try {
        if (checkout.total !== null) sessionStorage.setItem("lastOrderTotal", String(checkout.total));
      } catch {
        // Storage unavailable: skip the success-page total stash; the order stands.
      }
      clearCheckoutDraft();
      router.push(`/order-success/${order.orderNumber}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not place your order. Please try again.");
      setSubmitting(false);
    }
  }

  if (draft === null) {
    return <p className="py-16 text-center text-ink-secondary">Loading…</p>;
  }

  // Cart-path lines/totals are only meaningful once the cart has loaded;
  // otherwise the cold cart briefly renders an empty list and a ₱0.00 total
  // (cart-path total is 0, not null). Same gate as CheckoutForm.
  if (!checkout.isBuyNow && checkout.cartLoading) {
    return <p className="py-16 text-center text-ink-secondary">Loading…</p>;
  }

  const area = [draft.customer.barangay, draft.customer.city].filter(Boolean).join(", ");

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6">
      <h1 className="mb-6 text-3xl font-semibold text-ink">Confirm your order</h1>

      <div className="mb-6">
        <CheckoutTrustStrip deliveryRange={deliveryWindowFor(draft.customer.province)} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5 lg:gap-8">
        {/* Your Order */}
        <div className="lg:col-start-1 lg:col-span-2 lg:row-start-1">
          <div data-testid="confirm-items" className="rounded-lg border border-border bg-card p-5">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-ink">Your Order</h2>
              <Link href="/cart" className="text-sm text-cta hover:underline">
                Edit
              </Link>
            </div>
            <OrderPreview lines={checkout.lines} images={images} />
          </div>
        </div>

        {/* Delivery address */}
        <div className="lg:col-start-3 lg:col-span-3 lg:row-start-1">
          <div data-testid="confirm-address" className="rounded-lg border border-border bg-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-ink">Delivery Address</h2>
              <Link
                href={`/checkout${checkoutQueryString({ skuId, qty, itemsParam, slug })}`}
                className="text-sm text-cta hover:underline"
              >
                Edit
              </Link>
            </div>
            <div className="text-sm text-ink-secondary">
              <p>
                {draft.customer.name} · {draft.customer.phone}
              </p>
              <p className="mt-1">{draft.customer.streetAddress}</p>
              {area ? <p className="mt-1">{area}</p> : null}
              <p className="mt-1">
                {draft.customer.province}
                {draft.customer.postalCode ? ` ${draft.customer.postalCode}` : ""}
              </p>
              {draft.customer.landmark ? (
                <p className="mt-1">{`Landmark: ${draft.customer.landmark}`}</p>
              ) : null}
            </div>
            <p data-testid="checkout-privacy-note" className="mt-3 text-xs text-ink-secondary">
              Your information is used only to process and deliver your order.
            </p>
          </div>
        </div>

        {/* Payment + totals */}
        <div className="flex flex-col gap-4 lg:col-start-1 lg:col-span-2 lg:row-start-2">
          <div className="rounded-lg border border-border bg-card p-5">
            <p className="text-sm font-medium text-ink">Cash on Delivery · No payment needed now</p>
            <dl className="mt-3 flex flex-col gap-2 border-t border-border pt-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-secondary">Shipping</dt>
                <dd className="font-medium text-ink">COD — calculated at checkout</dd>
              </div>
              <div className="flex justify-between border-t border-border pt-3 text-base">
                <dt className="font-semibold text-ink">Total (COD)</dt>
                <dd className="font-bold text-ink">
                  {checkout.total !== null ? formatPrice(checkout.total) : "Calculated at checkout"}
                </dd>
              </div>
            </dl>
          </div>

          <p
            data-testid="checkout-need-help"
            className="text-xs leading-relaxed text-ink-secondary sm:max-w-[420px] sm:text-right"
          >
            <span className="font-semibold text-ink">Need help? </span>
            {messengerUrl ? (
              <>
                <a
                  href={messengerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cta hover:underline"
                >
                  Chat on Messenger
                </a>
                {" · "}
              </>
            ) : null}
            <a href={`mailto:${supportEmail}`} className="text-cta hover:underline">
              {supportEmail}
            </a>
            {" · "}
            {supportHours}
          </p>
        </div>

        {/* Submit */}
        <div className="lg:col-start-3 lg:col-span-3 lg:row-start-2">
          {error && (
            <p
              role="alert"
              className="mb-3 rounded-lg border border-sale/40 bg-sale/5 px-3 py-2 text-sm text-sale"
            >
              {error}
            </p>
          )}

          <Button
            onClick={placeOrder}
            disabled={submitting}
            className="w-full"
            data-testid="confirm-place-order"
          >
            {submitting ? "Placing order…" : "PLACE COD ORDER"}
          </Button>
          <p className="mt-2 text-center text-xs text-ink-muted">
            Cash on Delivery · No payment needed now
          </p>
        </div>
      </div>
    </div>
  );
}
