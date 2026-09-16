"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { deliveryWindowFor } from "@/lib/deliveryWindow";
import { Button } from "@/components/ui/Button";
import { formatPrice } from "@/components/ui/PriceBox";
import { useSiteSettings } from "@/components/site/SiteSettingsProvider";
import { useProductImages } from "@/lib/productImages";
import { track } from "@/lib/tracking";
import { readCheckoutDraft, writeCheckoutDraft } from "@/lib/checkoutDraft";
import { useCheckoutLines } from "./useCheckoutLines";
import { OrderPreview } from "./OrderPreview";
import { CheckoutTrustStrip } from "./CheckoutTrustStrip";
import { checkoutQueryString } from "./checkoutItems";
import {
  CHECKOUT_FIELD_ORDER,
  validateCheckoutForm,
  type CheckoutField,
} from "@/lib/checkoutValidation";

/**
 * COD checkout (CHECKOUT_SPEC §5, §8-§9, §13, §15).
 *
 * Two entries:
 * - PDP Buy Now: ?skuId&qty&slug (image/variant/price resolved from the
 *   public product endpoint, cart untouched by ordering);
 * - cart: ?items=<itemId,itemId> — only selected cart lines are shown and
 *   ordered; after success those lines are removed while unselected lines
 *   stay in the cart. The backend re-validates stock for every submitted SKU.
 */

const inputCls =
  "w-full rounded-lg border border-border bg-card px-3 py-2.5 text-base text-ink placeholder:text-ink-muted focus:border-cta focus:outline-none";

interface CheckoutFormProps {
  skuId?: string;
  qty?: string;
  itemsParam?: string;
  slug?: string;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-sale">
      {message}
    </p>
  );
}

const FIELD_ELEMENT_ID: Partial<Record<CheckoutField, string>> = {
  name: "checkout-name",
  phone: "checkout-phone",
  province: "checkout-province",
  city: "checkout-city",
  streetAddress: "checkout-address",
};

export function CheckoutForm({ skuId, qty, itemsParam, slug }: CheckoutFormProps) {
  const router = useRouter();
  const { messengerUrl, supportEmail, supportHours } = useSiteSettings();
  const [errors, setErrors] = useState<Partial<Record<CheckoutField, string>>>({});

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

  const {
    isBuyNow,
    cartLoading,
    product,
    productError,
    cartBlocked,
    buyNowMatchedSku,
    ready,
    lines,
    orderItems,
    totals,
    total,
  } = useCheckoutLines({ skuId, qty, itemsParam, slug });

  const slugs = useMemo(() => lines.map((line) => line.slug), [lines]);
  const images = useProductImages(slugs);

  // Restore a draft left by an earlier REVIEW ORDER (back-button / re-entry).
  useEffect(() => {
    let alive = true;
    void (async () => {
      // The await keeps the setState out of the effect's synchronous body
      // (react-hooks/set-state-in-effect; same convention as
      // AuthProvider/CartContext/CheckoutConfirmView).
      await Promise.resolve();
      if (!alive) return;
      const d = readCheckoutDraft();
      if (d) {
        setForm((f) => ({ ...f, ...d.customer }));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // TRACKING_SPEC §12 InitiateCheckout.
  useEffect(() => {
    if (orderItems.length === 0 || (isBuyNow && !buyNowMatchedSku)) return;
    track("InitiateCheckout", {
      contents: orderItems.map((item) => ({ id: item.skuId, quantity: item.quantity })),
      value: total ?? undefined,
      currency: "PHP",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBuyNow, orderItems.length, buyNowMatchedSku]);

  const set =
    (field: CheckoutField) => (e: ChangeEvent<HTMLInputElement>) => {
      setForm((f) => ({ ...f, [field]: e.target.value }));
      setErrors((current) => {
        if (!current[field]) return current;
        const next = { ...current };
        delete next[field];
        return next;
      });
    };

  // Re-validate one field on blur so a corrected-but-still-bad value gets
  // flagged before submit.
  const revalidate = (field: CheckoutField) => () =>
    setErrors((current) => {
      const fresh = validateCheckoutForm(form);
      const next = { ...current };
      if (fresh[field]) next[field] = fresh[field];
      else delete next[field];
      return next;
    });

  function goToReview() {
    const validation = validateCheckoutForm(form);
    setErrors(validation);
    if (Object.keys(validation).length > 0) {
      const firstInvalid = CHECKOUT_FIELD_ORDER.find((field) => validation[field]);
      const focusId = firstInvalid ? FIELD_ELEMENT_ID[firstInvalid] : undefined;
      if (focusId) document.getElementById(focusId)?.focus();
      return;
    }
    if (orderItems.length === 0) return; // ready 门禁已挡住，双保险
    writeCheckoutDraft({
      name: form.name.trim(),
      phone: form.phone.trim(),
      province: form.province.trim(),
      city: form.city.trim(),
      barangay: form.barangay.trim() || "",
      postalCode: form.postalCode.trim() || "",
      streetAddress: form.streetAddress.trim(),
      landmark: form.landmark.trim() || "",
    });
    router.push(`/checkout/confirm${checkoutQueryString({ skuId, qty, itemsParam, slug })}`);
  }

  if (!isBuyNow && cartLoading) {
    return <p className="py-16 text-center text-ink-secondary">Loading checkout…</p>;
  }

  if (cartBlocked) {
    return (
      <div className="mx-auto max-w-[600px] px-4 py-16 text-center">
        <h1 className="mb-3 text-2xl font-semibold text-ink">Checkout unavailable</h1>
        <p className="mb-6 text-ink-secondary">
          Some selected items are out of stock or no longer in your cart. Return to your cart
          to review your selection.
        </p>
        <Link
          href="/cart"
          className="inline-flex h-12 items-center justify-center rounded-lg bg-cta px-6 text-base font-semibold text-white hover:bg-cta-hover"
        >
          Back to Cart
        </Link>
      </div>
    );
  }

  if (isBuyNow && product === null && !productError) {
    return <p className="py-16 text-center text-ink-secondary">Loading item…</p>;
  }

  if (isBuyNow && (productError || (product !== null && !buyNowMatchedSku))) {
    return (
      <div className="mx-auto max-w-[600px] px-4 py-16 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-sale/10">
          <svg viewBox="0 0 20 20" className="h-6 w-6 text-sale" fill="none" aria-hidden="true">
            <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.6" />
            <path d="M10 6v5M10 13.5v.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </div>
        <h1 className="mb-3 text-2xl font-semibold text-ink">We couldn&apos;t load this item.</h1>
        <p className="mb-6 text-ink-secondary">
          The product may be unavailable or the link was incomplete. You can go back to the
          product page or continue shopping.
        </p>
        <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
          {slug && (
            <Link
              href={`/products/${slug}`}
              className="inline-flex h-12 items-center justify-center rounded-lg bg-cta px-6 text-base font-semibold text-white hover:bg-cta-hover"
            >
              Back to product
            </Link>
          )}
          <Link href="/collections" className="text-sm text-cta hover:underline">
            Continue shopping
          </Link>
        </div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="py-16 text-center">
        <p className="mb-4 text-ink-secondary">Your cart is empty.</p>
        <Link href="/collections" className="text-sm text-cta hover:underline">
          Start shopping
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <h1 className="text-3xl font-semibold text-ink">Checkout</h1>
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5 lg:gap-8">
        {/* 1. Order preview (mobile first; desktop left column, row 1) */}
        <div className="lg:col-start-1 lg:col-span-2 lg:row-start-1">
          <div className="rounded-lg border border-border bg-card p-5">
            <h2 className="mb-1 text-lg font-semibold text-ink">Your Order</h2>
            {isBuyNow && product === null && !productError ? (
              <p className="py-2 text-sm text-ink-muted">Loading item…</p>
            ) : lines.length === 0 ? (
              <p className="py-2 text-sm text-ink-muted">Item details unavailable.</p>
            ) : (
              <OrderPreview lines={lines} images={images} />
            )}
          </div>
        </div>

        {/* 2. Contact information — existing <section> card moved here verbatim */}
        <div className="lg:col-start-3 lg:col-span-3 lg:row-start-1">
          <section className="rounded-lg border border-border bg-card p-5">
            <h2 className="mb-4 text-lg font-semibold text-ink">Contact Information</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm font-medium text-ink">
                Full Name *
                <input
                  id="checkout-name"
                  className={`${inputCls}${errors.name ? " border-sale" : ""}`}
                  value={form.name}
                  onChange={set("name")}
                  onBlur={revalidate("name")}
                  aria-invalid={Boolean(errors.name)}
                  aria-describedby={errors.name ? "checkout-name-error" : undefined}
                  placeholder="Juan Dela Cruz"
                />
                <FieldError id="checkout-name" message={errors.name} />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium text-ink">
                Mobile Number *
                <input
                  id="checkout-phone"
                  className={`${inputCls}${errors.phone ? " border-sale" : ""}`}
                  value={form.phone}
                  onChange={set("phone")}
                  onBlur={revalidate("phone")}
                  aria-invalid={Boolean(errors.phone)}
                  aria-describedby={errors.phone ? "checkout-phone-error" : undefined}
                  placeholder="0917 123 4567"
                  inputMode="tel"
                  autoComplete="tel"
                />
                <FieldError id="checkout-phone" message={errors.phone} />
              </label>
            </div>
            <p className="mt-2 text-xs text-ink-muted">
              We use your mobile number for delivery updates.
            </p>
          </section>
        </div>

        {/* 3. Delivery address — existing <section> card moved here verbatim */}
        <div className="lg:col-start-3 lg:col-span-3 lg:row-start-2">
          <section className="rounded-lg border border-border bg-card p-5">
            <h2 className="mb-4 text-lg font-semibold text-ink">Delivery Address</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm font-medium text-ink">
                Province *
                <input
                  id="checkout-province"
                  className={`${inputCls}${errors.province ? " border-sale" : ""}`}
                  value={form.province}
                  onChange={set("province")}
                  onBlur={revalidate("province")}
                  aria-invalid={Boolean(errors.province)}
                  aria-describedby={errors.province ? "checkout-province-error" : undefined}
                  placeholder="Metro Manila"
                />
                <FieldError id="checkout-province" message={errors.province} />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium text-ink">
                City / Municipality *
                <input
                  id="checkout-city"
                  className={`${inputCls}${errors.city ? " border-sale" : ""}`}
                  value={form.city}
                  onChange={set("city")}
                  onBlur={revalidate("city")}
                  aria-invalid={Boolean(errors.city)}
                  aria-describedby={errors.city ? "checkout-city-error" : undefined}
                  placeholder="Quezon City"
                />
                <FieldError id="checkout-city" message={errors.city} />
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
                  id="checkout-address"
                  className={`${inputCls}${errors.streetAddress ? " border-sale" : ""}`}
                  value={form.streetAddress}
                  onChange={set("streetAddress")}
                  onBlur={revalidate("streetAddress")}
                  aria-invalid={Boolean(errors.streetAddress)}
                  aria-describedby={
                    errors.streetAddress ? "checkout-address-error" : undefined
                  }
                  placeholder="House no., street, subdivision"
                />
                <FieldError id="checkout-address" message={errors.streetAddress} />
              </label>
              <label className="col-span-full flex flex-col gap-1 text-sm font-medium text-ink">
                Landmark
                <input className={inputCls} value={form.landmark} onChange={set("landmark")} placeholder="Near…" />
              </label>
              <p data-testid="checkout-privacy-note" className="col-span-full mt-3 text-xs text-ink-secondary">
                Your information is used only to process and deliver your order.
              </p>
            </div>
          </section>
        </div>

        {/* 4. Totals + COD assurance (desktop left column, row 2) */}
        <div className="flex flex-col gap-4 lg:col-start-1 lg:col-span-2 lg:row-start-2">
          <div className="rounded-lg border border-border bg-card p-5">
            <dl className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-secondary">Subtotal</dt>
                <dd className="font-medium text-ink">
                  {isBuyNow && total === null
                    ? "Calculated at checkout"
                    : formatPrice(totals.subtotal)}
                </dd>
              </div>
              {totals.discount > 0 && (
                <div className="flex justify-between">
                  <dt className="text-ink-secondary">Discount</dt>
                  <dd className="font-medium text-sale">−{formatPrice(totals.discount)}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-ink-secondary">Shipping</dt>
                <dd className="font-medium text-ink">COD — calculated at checkout</dd>
              </div>
              <div className="flex justify-between border-t border-border pt-3 text-base">
                <dt className="font-semibold text-ink">Total (COD)</dt>
                <dd className="font-bold text-ink">
                  {total !== null ? formatPrice(total) : "Calculated at checkout"}
                </dd>
              </div>
            </dl>
          </div>

          <CheckoutTrustStrip
            deliveryRange={
              form.province.trim()
                ? deliveryWindowFor(form.province)
                : "Metro Manila 3-5 days · provinces 5-7 days"
            }
          />

          <div className="rounded-lg border border-border bg-card p-5 text-sm text-ink-secondary">
            <p className="font-semibold text-ink">Cash on Delivery</p>
            <p className="mt-1">
              Pay in cash when your order arrives.{" "}
              {form.province.trim()
                ? `Estimated delivery: ${deliveryWindowFor(form.province)}`
                : "Estimated delivery: Metro Manila 3-5 days, provinces 5-7 days."}
            </p>
          </div>
        </div>

        {/* 5. Review CTA (mobile bottom; desktop right column, row 3) */}
        <div className="lg:col-start-3 lg:col-span-3 lg:row-start-3">
          <Button
            onClick={goToReview}
            className="w-full"
            data-testid="review-order"
          >
            REVIEW ORDER
          </Button>
          <p className="mt-2 text-center text-xs text-ink-muted">
            Cash on Delivery · No payment needed now
          </p>
        </div>
      </div>
    </div>
  );
}
