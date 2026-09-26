"use client";

import { useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { readAttribution } from "@/lib/tracking";
import {
  emitCommerceEvent,
  initiateCheckoutEvent,
  purchaseEvent,
  storePurchasePayload,
  INITIATE_CHECKOUT_FIRED_KEY,
} from "@/lib/commerce-events";
import {
  CHECKOUT_FIELD_ORDER,
  validateCheckoutForm,
  type CheckoutErrors,
  type CheckoutField,
} from "@/lib/checkoutValidation";
import { formatPrice } from "@/components/ui/PriceBox";
import { Button } from "@/components/ui/Button";
import { PsgcAddressSelects } from "@/components/checkout/PsgcAddressSelects";
import { checkoutInputCls as inputCls } from "@/components/checkout/checkoutFieldStyles";
import { usePdpPurchase } from "./PdpPurchaseProvider";

/**
 * Inline COD order on the PDP (Phase 2).
 *
 * This is the SAME order path as the checkout page, one screen earlier: it
 * reads the shared purchase state for the SKU/quantity/price, validates with
 * the checkout's own rules, and posts to the one storefront order endpoint
 * (`api.createOrder`) so reservation, risk, duplicate detection and
 * attribution all run exactly as they do today. Nothing here re-implements
 * ordering.
 */

/** Focus target per invalid field, so a failed submit lands on the real input. */
const FIELD_ELEMENT_ID: Partial<Record<CheckoutField, string>> = {
  name: "quick-cod-name",
  phone: "quick-cod-phone",
  province: "quick-cod-province",
  city: "quick-cod-city",
  streetAddress: "quick-cod-street",
};

function FieldError({
  id,
  message,
}: {
  id: string;
  message?: string;
}): ReactNode {
  if (!message) return null;
  return (
    <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-sale">
      {message}
    </p>
  );
}

export function PdpQuickCodOrder(): ReactNode {
  const router = useRouter();
  const {
    product,
    primaryLine,
    primaryDerived,
    setPurchaseLocked,
  } = usePdpPurchase();

  const [form, setForm] = useState({
    name: "",
    phone: "",
    province: "",
    city: "",
    barangay: "",
    // The inline form has no postal-code input (the plan's field list stops at
    // the street); the order contract treats it as optional, so it is sent
    // empty rather than guessed.
    postalCode: "",
    streetAddress: "",
    landmark: "",
  });
  const [errors, setErrors] = useState<CheckoutErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [checkoutStarted, setCheckoutStarted] = useState(false);
  // Re-entry guard for the window between the click and the disabled render.
  const inFlightRef = useRef(false);

  const skuId = primaryDerived.resolvedVariant?.sku?.id ?? null;
  const quantity = primaryLine.quantity;
  const price = primaryDerived.price;
  const variantLabel = primaryDerived.displayVariant?.name ?? null;
  const outOfStock = primaryDerived.resolvedVariant !== null && !primaryDerived.purchasableVariant;
  const needsOptions = primaryDerived.resolvedVariant === null;
  const orderable = skuId !== null && !outOfStock && !submitting;

  const orderItems = skuId === null ? [] : [{ skuId, quantity }];

  /**
   * TRACKING_SPEC §12: InitiateCheckout fires at most once per checkout
   * session, and never merely because the form appeared — the shopper has to
   * start filling it in. Shares the checkout page's session key so the two
   * surfaces cannot double-fire.
   */
  const markCheckoutStarted = (): void => {
    if (checkoutStarted || outOfStock) return;
    if (orderItems.length === 0) return;
    setCheckoutStarted(true);
    try {
      if (sessionStorage.getItem(INITIATE_CHECKOUT_FIRED_KEY) === "1") return;
      sessionStorage.setItem(INITIATE_CHECKOUT_FIRED_KEY, "1");
    } catch {
      // Storage unavailable: proceed and fire.
    }
    emitCommerceEvent(
      initiateCheckoutEvent({
        items: orderItems,
        value: price === null ? null : price * quantity,
      }),
    );
  };

  const set =
    (field: keyof typeof form) =>
    (event: ChangeEvent<HTMLInputElement>): void => {
      const value = event.target.value;
      markCheckoutStarted();
      setForm((current) => ({ ...current, [field]: value }));
      // Clear the field's own error as soon as it is edited; a fresh verdict
      // arrives on blur or on the next submit.
      setErrors((current) => {
        if (!current[field]) return current;
        const next = { ...current };
        delete next[field];
        return next;
      });
    };

  const revalidate =
    (field: CheckoutField) => (): void =>
      setErrors((current) => {
        const fresh = validateCheckoutForm(form);
        return fresh[field]
          ? { ...current, [field]: fresh[field] }
          : Object.fromEntries(
              Object.entries(current).filter(([key]) => key !== field),
            );
      });

  async function placeOrder(): Promise<void> {
    if (inFlightRef.current) return;
    setSubmitError(null);
    const validation = validateCheckoutForm(form);
    setErrors(validation);
    if (Object.keys(validation).length > 0) {
      const firstInvalid = CHECKOUT_FIELD_ORDER.find(
        (field) => validation[field],
      );
      const focusId = firstInvalid ? FIELD_ELEMENT_ID[firstInvalid] : undefined;
      if (focusId) document.getElementById(focusId)?.focus();
      return;
    }
    if (skuId === null || outOfStock) return;

    markCheckoutStarted();
    inFlightRef.current = true;
    setPurchaseLocked(true);
    setSubmitting(true);
    try {
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
        items: orderItems,
        attribution: readAttribution(),
        preferredDeliveryDate: null,
      });
      try {
        // The success page only receives the order number, so the full
        // Purchase event is stashed tab-scoped BEFORE navigation; the
        // existing PurchaseTracking consumes it exactly once.
        storePurchasePayload(
          purchaseEvent({
            orderId: order.orderNumber,
            items: orderItems,
            value: price === null ? null : price * quantity,
          }),
        );
        sessionStorage.setItem("lastOrderPhone", form.phone.trim());
        // Same key the checkout page clears: the NEXT order in this tab must
        // be able to fire InitiateCheckout again.
        sessionStorage.removeItem(INITIATE_CHECKOUT_FIRED_KEY);
      } catch {
        // Storage unavailable: skip the success-page stashes; the order stands.
      }
      router.push(`/order-success/${order.orderNumber}`);
    } catch (error) {
      setSubmitError(
        error instanceof Error && error.message
          ? error.message
          : "Could not place your order. Please try again.",
      );
      inFlightRef.current = false;
      setPurchaseLocked(false);
      setSubmitting(false);
    }
  }

  return (
    <section
      id="quick-cod-order"
      aria-labelledby="quick-cod-order-title"
      className="scroll-mt-28 rounded-lg border border-border bg-card p-6"
    >
      <h2
        id="quick-cod-order-title"
        className="text-2xl font-semibold text-ink"
      >
        Order Now — Cash on Delivery
      </h2>
      <p className="mt-1 text-sm text-ink-secondary">
        Fill in your delivery details and we will call to confirm your order.
        Pay in cash when it arrives.
      </p>

      <div className="mt-5 flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* Selection summary — the same state the hero is using. */}
        <dl
          data-testid="quick-cod-summary"
          className="flex w-full flex-col gap-2 rounded-lg border border-border bg-background p-4 text-sm lg:w-64 lg:shrink-0"
        >
          {product.effectiveCoverMedia ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={product.effectiveCoverMedia.url}
              alt={product.effectiveCoverMedia.altText ?? product.name}
              className="h-20 w-20 rounded-md border border-border object-cover"
            />
          ) : null}
          <div className="flex justify-between gap-3">
            <dt className="text-ink-secondary">Item</dt>
            <dd className="text-right font-medium text-ink">{product.name}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-secondary">Variant</dt>
            <dd
              className="text-right font-medium text-ink"
              data-testid="quick-cod-variant"
            >
              {variantLabel ?? "—"}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-secondary">Quantity</dt>
            <dd
              className="text-right font-medium text-ink"
              data-testid="quick-cod-quantity"
            >
              {quantity}
            </dd>
          </div>
          <div className="flex justify-between gap-3 border-t border-border pt-2">
            <dt className="text-ink-secondary">Payment</dt>
            <dd className="text-right font-medium text-ink">
              Cash on Delivery
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-secondary">Total</dt>
            <dd
              className="text-right font-semibold text-ink"
              data-testid="quick-cod-total"
            >
              {price === null ? "—" : formatPrice(price * quantity)}
            </dd>
          </div>
        </dl>

        <form
          className="flex w-full flex-col gap-4 lg:max-w-md"
          onSubmit={(event) => {
            event.preventDefault();
            void placeOrder();
          }}
          noValidate
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label
                htmlFor="quick-cod-name"
                className="text-sm font-medium text-ink"
              >
                Full Name
              </label>
              <input
                id="quick-cod-name"
                name="name"
                className={`mt-1 ${inputCls}${errors.name ? " border-sale" : ""}`}
                value={form.name}
                onChange={set("name")}
                onBlur={revalidate("name")}
                aria-invalid={Boolean(errors.name)}
                aria-describedby={
                  errors.name ? "quick-cod-name-error" : undefined
                }
                autoComplete="name"
                placeholder="Juan Dela Cruz"
                disabled={submitting}
              />
              <FieldError id="quick-cod-name" message={errors.name} />
            </div>

            <div className="sm:col-span-2">
              <label
                htmlFor="quick-cod-phone"
                className="text-sm font-medium text-ink"
              >
                Phone Number
              </label>
              <input
                id="quick-cod-phone"
                name="phone"
                type="tel"
                inputMode="tel"
                className={`mt-1 ${inputCls}${errors.phone ? " border-sale" : ""}`}
                value={form.phone}
                onChange={set("phone")}
                onBlur={revalidate("phone")}
                aria-invalid={Boolean(errors.phone)}
                aria-describedby={
                  errors.phone ? "quick-cod-phone-error" : undefined
                }
                autoComplete="tel"
                placeholder="0917 123 4567"
                disabled={submitting}
              />
              <FieldError id="quick-cod-phone" message={errors.phone} />
            </div>
          </div>

          <PsgcAddressSelects
            province={form.province}
            city={form.city}
            barangay={form.barangay}
            onProvinceChange={(value) => {
              markCheckoutStarted();
              setForm((current) => ({
                ...current,
                province: value,
                city: "",
                barangay: "",
              }));
              setErrors((current) => {
                const next = { ...current };
                delete next.province;
                delete next.city;
                return next;
              });
            }}
            onCityChange={(value) => {
              markCheckoutStarted();
              setForm((current) => ({
                ...current,
                city: value,
                barangay: "",
              }));
              setErrors((current) => {
                const next = { ...current };
                delete next.city;
                return next;
              });
            }}
            onBarangayChange={(value) => {
              markCheckoutStarted();
              setForm((current) => ({ ...current, barangay: value }));
            }}
            errors={errors}
            onBlurField={(field) => revalidate(field)()}
            inputCls={inputCls}
            disabled={submitting}
          />

          <div>
            <label
              htmlFor="quick-cod-street"
              className="text-sm font-medium text-ink"
            >
              Street / House / Unit
            </label>
            <input
              id="quick-cod-street"
              name="streetAddress"
              className={`mt-1 ${inputCls}${errors.streetAddress ? " border-sale" : ""}`}
              value={form.streetAddress}
              onChange={set("streetAddress")}
              onBlur={revalidate("streetAddress")}
              aria-invalid={Boolean(errors.streetAddress)}
              aria-describedby={
                errors.streetAddress ? "quick-cod-street-error" : undefined
              }
              autoComplete="street-address"
              placeholder="House no., street, subdivision"
              disabled={submitting}
            />
            <FieldError
              id="quick-cod-street"
              message={errors.streetAddress}
            />
          </div>

          <div>
            <label
              htmlFor="quick-cod-landmark"
              className="text-sm font-medium text-ink"
            >
              Notes <span className="text-ink-muted">(optional)</span>
            </label>
            <input
              id="quick-cod-landmark"
              name="landmark"
              className={`mt-1 ${inputCls}`}
              value={form.landmark}
              onChange={set("landmark")}
              placeholder="Landmark, gate, delivery note"
              autoComplete="off"
              disabled={submitting}
            />
          </div>

          {needsOptions ? (
            <p
              role="status"
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-ink-secondary"
            >
              Choose your options above to order this item.
            </p>
          ) : null}

          {outOfStock ? (
            <p
              role="status"
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-sale"
            >
              This combination is out of stock. Pick another option, or email
              us to ask about restocking.
            </p>
          ) : null}

          {submitError ? (
            <p
              role="alert"
              data-testid="quick-cod-error"
              className="rounded-lg border border-sale/40 bg-sale/5 px-3 py-2 text-sm text-sale"
            >
              {submitError}
            </p>
          ) : null}

          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={!orderable}
            data-testid="quick-cod-submit"
          >
            {submitting ? "Placing order…" : "PLACE COD ORDER"}
          </Button>

          <ul className="flex flex-col gap-1.5 text-xs text-ink-muted">
            <li>Cash on Delivery — pay only when your order arrives.</li>
            <li>We call to confirm every order before it ships.</li>
            <li>Your details are used only to deliver this order.</li>
          </ul>
        </form>
      </div>
    </section>
  );
}
