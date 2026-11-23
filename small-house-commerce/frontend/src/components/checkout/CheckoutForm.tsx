"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  defaultPreferredDeliveryDate,
  deliveryWindowFor,
} from "@/lib/deliveryWindow";
import { Button } from "@/components/ui/Button";
import { formatPrice } from "@/components/ui/PriceBox";
import { useSiteSettings } from "@/components/site/SiteSettingsProvider";
import {
  emitCommerceEvent,
  initiateCheckoutEvent,
  INITIATE_CHECKOUT_FIRED_KEY,
} from "@/lib/commerce-events";
import { readCheckoutDraft, writeCheckoutDraft } from "@/lib/checkoutDraft";
import type { PaymentMethodId } from "@/lib/api";
import { recordSubmitAttempt, recordSubmitFailure } from "@/lib/checkout-events";
import {
  buildCheckoutSnapshot,
  checkoutAttemptKey,
  resolveCheckoutAttempt,
  restoreCheckoutDraft,
  restoredFormState,
} from "@/lib/checkoutAutosave";
import { useCheckoutDraftAutosave } from "./useCheckoutDraftAutosave";
import { lookupPostalCode } from "@/lib/postalCodes";
import { useCheckoutLines } from "./useCheckoutLines";
import { OrderPreview } from "./OrderPreview";
import { CheckoutTrustStrip } from "./CheckoutTrustStrip";
import { checkoutQueryString } from "./checkoutItems";
import { PromoCodeField, type AppliedPromo } from "./PromoCodeField";
import { CheckoutAddressDialog } from "./CheckoutAddressDialog";
import { PaymentMethodSelector, usePaymentMethods } from "./PaymentMethodSelector";
import { NewsletterOfferPrompt } from "@/components/newsletter/NewsletterOfferPrompt";

import {
  fetchBarangays,
  listMunicipalities,
  listProvinces,
  matchPsgcName,
  reverseGeocode,
} from "@/lib/psgc";
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

interface CheckoutFormProps {
  skuId?: string;
  qty?: string;
  itemsParam?: string;
  slug?: string;
}

const FIELD_ELEMENT_ID: Partial<Record<CheckoutField, string>> = {
  name: "checkout-name",
  phone: "checkout-phone",
  province: "checkout-province",
  city: "checkout-city",
  streetAddress: "checkout-address",
};

/**
 * The checkout page mounts its real form only after the cart/product request
 * resolves. Reserving the viewport's height while it loads keeps the footer
 * below the fold, so mounting the form does not push already-painted content
 * down (the 0.6 CLS the page used to show). Content loads above this minimum
 * on every viewport, so the reservation collapses without a second shift.
 */
function CheckoutLoading({ label }: { label: string }) {
  return (
    <div
      className="flex min-h-[calc(100dvh-120px)] items-start justify-center px-4 py-16"
      role="status"
      aria-live="polite"
    >
      <p className="text-center text-ink-secondary">{label}</p>
    </div>
  );
}

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
    preferredDeliveryDate: defaultPreferredDeliveryDate(),
    notes: "",
  });

  // Use-my-location (spec §3.4): geolocation is requested only on button click
  // (checkout-only decision); reverse geocoding is confidence-fill, failures
  // surface an inline hint and never block ordering.
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  // Informational (not an error): province filled, city left for the user.
  const [locationNotice, setLocationNotice] = useState<string | null>(null);
  const [initialPromoCode, setInitialPromoCode] = useState("");
  const [appliedPromo, setAppliedPromo] = useState<AppliedPromo | null>(null);
  const [promoChecking, setPromoChecking] = useState(false);
  // The payment the shopper chooses. COD stays the default; the server owns
  // which methods exist at all.
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodId>("COD");
  const paymentMethods = usePaymentMethods();

  // The chosen method has to exist. When the server took it away, the page
  // falls back to the first method it still offers instead of promising a
  // payment the backend would refuse.
  useEffect(() => {
    let alive = true;
    void (async () => {
      // The await keeps the setState out of the effect's synchronous body
      // (react-hooks/set-state-in-effect; the same convention the draft
      // restore below uses).
      await Promise.resolve();
      if (!alive) return;
      if (paymentMethods.loading || paymentMethods.error !== null) return;
      const offered = paymentMethods.methods.filter((method) => method.enabled);
      if (offered.length === 0) return;
      if (offered.some((method) => method.id === paymentMethod)) return;
      setPaymentMethod(offered[0]!.id);
    })();
    return () => {
      alive = false;
    };
  }, [
    paymentMethods.loading,
    paymentMethods.error,
    paymentMethods.methods,
    paymentMethod,
  ]);
  // The summary block can be collapsed so the shopper reaches the form first.
  const [summaryOpen, setSummaryOpen] = useState(true);
  // Address-first checkout: the address is collected in a modal (Shopee-style)
  // and the page keeps a compact card once it is saved.
  const [addressOpen, setAddressOpen] = useState(false);
  const addressReady = Boolean(
    form.name.trim() &&
      form.phone.trim() &&
      form.province.trim() &&
      form.city.trim() &&
      form.streetAddress.trim(),
  );
  const addressAutoOpenedRef = useRef(false);

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

  const summaryUnits = lines.reduce((count, line) => count + line.quantity, 0);

  const attemptKey = useMemo(
    () => checkoutAttemptKey({ skuId, qty, itemsParam, slug }),
    [skuId, qty, itemsParam, slug],
  );
  const attempt = useMemo(() => resolveCheckoutAttempt(attemptKey), [attemptKey]);
  const [promoInput, setPromoInput] = useState("");
  const [draftTouched, setDraftTouched] = useState(false);
  const [autosaveRestored, setAutosaveRestored] = useState(false);
  // Address-first checkout: open the address modal once the draft restore has
  // settled and the form still has no saved address. Guarded by a ref so a
  // cancelled dialog is not reopened by a later render.
  useEffect(() => {
    if (!ready || !autosaveRestored || addressReady) return;
    if (addressAutoOpenedRef.current) return;
    addressAutoOpenedRef.current = true;
    setAddressOpen(true);
  }, [ready, autosaveRestored, addressReady]);
  // Synchronous twin of draftTouched: the restore promise must not overwrite
  // a field the shopper has already edited in this visit.
  const draftTouchedRef = useRef(false);
  const markDraftTouched = useCallback(() => {
    draftTouchedRef.current = true;
    setDraftTouched(true);
  }, []);
  // Display-only preview of the promo discount; the order endpoint recomputes
  // the authoritative amount when the order is created.
  const discountedTotal =
    total === null ? null : Math.max(0, total - (appliedPromo?.discountAmount ?? 0));
  // Checkout lines carry their own enriched thumbnails (cart summary data /
  // Buy Now product cover), so no product-by-slug image recovery is needed.

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
        setForm((f) => ({
          ...f,
          ...d.customer,
          preferredDeliveryDate: d.preferredDeliveryDate ?? "",
          notes: d.customerNote ?? "",
        }));
        setInitialPromoCode(d.promoCode ?? "");
        // The payment choice survives a back-button or a re-entry.
        setPaymentMethod(d.paymentMethod ?? "COD");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Autosave restore: the server copy wins when it is newer than the local
  // one. It runs after the review-payload restore above, and never resets a
  // field the shopper has already started typing in this session.
  useEffect(() => {
    let alive = true;
    void restoreCheckoutDraft(attemptKey).then((restored) => {
      if (!alive || !restored) return;
      // The shopper started typing while the request was in flight: their
      // input wins over the saved copy.
      if (draftTouchedRef.current) return;
      const next = restoredFormState(restored);
      setForm((f) => ({
        ...f,
        name: next.name,
        phone: next.phone,
        province: next.province,
        city: next.city,
        barangay: next.barangay,
        postalCode: next.postalCode,
        streetAddress: next.streetAddress,
        landmark: next.landmark,
        preferredDeliveryDate: next.preferredDeliveryDate,
        notes: next.notes,
      }));
      setInitialPromoCode(next.promoCodeApplied ?? next.promoCodeInput);
      setPromoInput(next.promoCodeInput);
      if (Object.values(restored.customer).some(Boolean) ||
          restored.customerNote || restored.promoCodeInput || restored.preferredDeliveryDate) {
        draftTouchedRef.current = true;
        setDraftTouched(true);
      }
    }).finally(() => {
      // Never persist the initial blank form while a saved copy is loading.
      if (alive) setAutosaveRestored(true);
    });
    return () => {
      alive = false;
    };
  }, [attemptKey]);

  const autosaveSnapshot = useMemo(
    () =>
      buildCheckoutSnapshot(form, orderItems, {
        input: promoInput,
        applied: appliedPromo?.code ?? null,
      }),
    [form, orderItems, promoInput, appliedPromo],
  );
  const { flush: flushAutosave } =
    useCheckoutDraftAutosave({
      attempt,
      snapshot: autosaveSnapshot,
      active: (autosaveRestored || draftTouched) && !cartLoading && !cartBlocked,
      hasUserInput: draftTouched,
    });

  // TRACKING_SPEC §12 InitiateCheckout — at most once per checkout session
  // (see INITIATE_CHECKOUT_FIRED_KEY). Fail-open: if sessionStorage is unavailable the event
  // still fires, and a storage write must never throw into the effect.
  useEffect(() => {
    if (orderItems.length === 0 || (isBuyNow && !buyNowMatchedSku)) return;
    try {
      if (sessionStorage.getItem(INITIATE_CHECKOUT_FIRED_KEY) === "1") return;
      sessionStorage.setItem(INITIATE_CHECKOUT_FIRED_KEY, "1");
    } catch {
      // Storage unavailable: proceed and fire.
    }
    // Final SKU list (cart or Buy Now), at most once per checkout session.
    emitCommerceEvent(initiateCheckoutEvent({ items: orderItems, value: total }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBuyNow, orderItems.length, buyNowMatchedSku]);

  // Postal code follows the address (province → city → barangay → ZIP).
  // `postalAutoRef` remembers the last value WE filled, so an address change
  // can drop a now-stale auto value while leaving the shopper's own edit alone.
  const postalAutoRef = useRef<string | null>(null);

  function withDerivedPostal(next: typeof form, previous: string): string {
    // A value that is neither empty nor one we filled is the shopper's own
    // edit — leave it alone for the rest of the session.
    const isManualEntry = previous !== "" && previous !== postalAutoRef.current;
    if (isManualEntry) return previous;
    const { auto } = lookupPostalCode(next.province, next.city, next.barangay);
    if (auto !== null) {
      postalAutoRef.current = auto;
      return auto;
    }
    // No ZIP for the new address: drop a value we filled earlier (now stale).
    if (previous !== "") {
      postalAutoRef.current = null;
      return "";
    }
    return previous;
  }

  const postalLookup = useMemo(
    () => lookupPostalCode(form.province, form.city, form.barangay),
    [form.province, form.city, form.barangay],
  );

  // PSGC cascade change handlers (spec §3.3): reset downstream levels and
  // clear any stale location error when the user edits these fields manually.
  const handleProvinceChange = (v: string) => {
    markDraftTouched();
    setLocationError(null);
    setLocationNotice(null);
    setForm((f) => {
      const next = { ...f, province: v, city: "", barangay: "" };
      return { ...next, postalCode: withDerivedPostal(next, f.postalCode) };
    });
    setErrors((cur) => {
      const n = { ...cur };
      delete n.province;
      return n;
    });
  };

  const handleCityChange = (v: string) => {
    markDraftTouched();
    setLocationError(null);
    setLocationNotice(null);
    setForm((f) => {
      const next = { ...f, city: v, barangay: "" };
      return { ...next, postalCode: withDerivedPostal(next, f.postalCode) };
    });
    setErrors((cur) => {
      const n = { ...cur };
      delete n.city;
      return n;
    });
  };

  const handleBarangayChange = (v: string) => {
    markDraftTouched();
    return setForm((f) => {
      const next = { ...f, barangay: v };
      return { ...next, postalCode: withDerivedPostal(next, f.postalCode) };
    });
  };

  // Use my location (spec §3.4): geolocation → Nominatim reverse geocode →
  // confidence-fill province/city via the same handlers as manual selection.
  // Barangay is left blank for the user to pick (spec §3.4: 命中才填; the
  // per-city barangay list is only fetched by the address dialog).
  const handleUseMyLocation = () => {
    setLocationError(null);
    setLocationNotice(null);
    if (!("geolocation" in navigator)) {
      setLocationError("Could not detect your location. Please select your province and city.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        try {
          const addr = await reverseGeocode(latitude, longitude);
          // Province MUST match exactly — the fuzzy pass can bind a shorter
          // OSM name to the wrong province ("Samar" → "Eastern Samar");
          // municipalities keep the fuzzy pass so "Quezon City" → "Quezon".
          const province = matchPsgcName(listProvinces(), addr.province);
          if (!province) {
            setLocationError("Could not detect your location. Please select your province and city.");
            return;
          }
          handleProvinceChange(province); // resets city/barangay + clears the province error
          const city = matchPsgcName(listMunicipalities(province), addr.city);
          if (city) {
            handleCityChange(city); // clears the city error
            // Best-effort barangay backfill (spec §3.4 "命中才填"). MUST run
            // after handleCityChange, which blanks the barangay. The list is
            // fetched through the shared province|city cache; only a confident
            // name match is written. Its own try/catch keeps a failure (network,
            // timeout, no match) from disturbing the province/city fill above.
            if (addr.barangay) {
              try {
                const barangays = await fetchBarangays(province, city);
                const barangay = matchPsgcName(
                  barangays.map((b) => b.name),
                  addr.barangay,
                );
                if (barangay) handleBarangayChange(barangay);
              } catch {
                // Silent: barangay stays blank for the user to pick.
              }
            }
          } else {
            // Spec §3.4/§5.3: province matched but city did not → leave the
            // city blank and PROMPT (never leave the user guessing why the
            // city they had typed disappeared).
            setLocationNotice("We filled in your province. Please select your city.");
          }
          // NOTE: no revalidate() here — the change handlers above already
          // deleted the field errors, and revalidating against the STALE
          // pre-click `form` snapshot would re-flag the empty province/city.
        } catch {
          setLocationError("Could not detect your location. Please select your province and city.");
        } finally {
          setLocating(false);
        }
      },
      () => {
        setLocating(false);
        setLocationError("Could not detect your location. Please select your province and city.");
      },
      { timeout: 10000, maximumAge: 60000 },
    );
  };

  const setField = (field: CheckoutField, value: string) => {
    markDraftTouched();
    setForm((f) => ({ ...f, [field]: value }));
    setErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  function submitAddress() {
    const validation = validateCheckoutForm(form);
    setErrors(validation);
    if (Object.keys(validation).length > 0) {
      const firstInvalid = CHECKOUT_FIELD_ORDER.find((field) => validation[field]);
      const focusId = firstInvalid ? FIELD_ELEMENT_ID[firstInvalid] : undefined;
      if (focusId) document.getElementById(focusId)?.focus();
      return;
    }
    setAddressOpen(false);
  }

  function goToReview() {
    if (promoChecking) return;
    const trackingItems = orderItems.map((item, index) => ({ ...item, variantName: lines[index]?.variant ?? null }));
    const occurrence = recordSubmitAttempt({ step: "form", items: trackingItems, scope: attemptKey });
    const validation = validateCheckoutForm(form);
    setErrors(validation);
    if (Object.keys(validation).length > 0) {
      const firstInvalid = CHECKOUT_FIELD_ORDER.find((field) => validation[field]);
      const focusId = firstInvalid ? FIELD_ELEMENT_ID[firstInvalid] : undefined;
      if (!addressReady) {
        // The address fields live in the modal; open it so the shopper sees
        // the errors instead of a focus() into an unmounted input.
        setAddressOpen(true);
      } else if (focusId) {
        document.getElementById(focusId)?.focus();
      }
      recordSubmitFailure({
        occurrence, step: "form", reason: "VALIDATION", field: firstInvalid,
        error: new Error(firstInvalid ? validation[firstInvalid] : "Checkout form is incomplete"),
        items: trackingItems, customer: { ...form, note: form.notes }, idempotencyKey: "",
      });
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
    }, null, undefined, appliedPromo?.code ?? null, form.notes.trim() || null, paymentMethod);
    flushAutosave();
    const query = checkoutQueryString({ skuId, qty, itemsParam, slug });
    // The shopper already reviewed the address and the summary here: the
    // confirmation page places the order itself instead of asking again.
    router.push(`/checkout/confirm${query}${query ? "&" : "?"}auto=1`);
  }

  if (!isBuyNow && cartLoading) {
    return <CheckoutLoading label="Loading checkout…" />;
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
          className="inline-flex h-12 items-center justify-center rounded-lg bg-cta px-6 text-base font-semibold text-cta-foreground hover:bg-cta-hover"
        >
          Back to Cart
        </Link>
      </div>
    );
  }

  if (isBuyNow && product === null && !productError) {
    return <CheckoutLoading label="Loading item…" />;
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
              className="inline-flex h-12 items-center justify-center rounded-lg bg-cta px-6 text-base font-semibold text-cta-foreground hover:bg-cta-hover"
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
    <div data-checkout-page className="mx-auto max-w-[760px] px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <h1 className="text-[2rem] font-bold tracking-[-0.02em] text-ink sm:text-[2.25rem]">Checkout</h1>
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

      <div className="flex flex-col gap-4">
        {/* 1. Delivery address — a compact card; the address itself is edited
            in the New Address dialog (Shopee layout). */}
        <section className="overflow-hidden rounded-lg border border-border bg-card" aria-label="Delivery address">
          <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 sm:px-4">
            <h2 className="flex items-center gap-1.5 text-[15px] font-semibold text-ink">
              <svg viewBox="0 0 24 24" className="h-4 w-4 text-cta" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <path d="M12 21s7-5.1 7-11a7 7 0 1 0-14 0c0 5.9 7 11 7 11z" strokeLinejoin="round" />
                <circle cx="12" cy="10" r="2.5" />
              </svg>
              Delivery Address
            </h2>
            <button
              type="button"
              data-testid="checkout-open-address"
              onClick={() => setAddressOpen(true)}
              className="text-[13px] font-medium text-cta hover:underline"
            >
              {addressReady ? "Change" : "Add address"}
            </button>
          </div>
          <div className="px-3 py-2.5 sm:px-4">
            {addressReady ? (
              <>
                <p className="text-[13px] font-semibold text-ink">
                  {form.name}
                  <span className="font-normal text-ink-secondary"> · {form.phone}</span>
                </p>
                <p className="mt-0.5 text-[13px] leading-5 text-ink-secondary">
                  {[form.streetAddress, form.barangay, form.city, form.province, form.postalCode]
                    .filter(Boolean)
                    .join(", ")}
                </p>
                {form.landmark ? (
                  <p className="mt-0.5 text-xs text-ink-muted">Landmark: {form.landmark}</p>
                ) : null}
              </>
            ) : (
              <p className="text-[13px] text-ink-secondary">
                No delivery address yet — add one to continue.
              </p>
            )}
          </div>
        </section>

        {/* 2. Order summary — items, the money rows and the promo field in one
            collapsible receipt block. */}
        <section className="overflow-hidden rounded-lg border border-border bg-card" aria-label="Order summary">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
            <h2 className="text-lg font-semibold text-ink">
              Order Summary
              <span className="ml-2 text-sm font-normal text-ink-muted">
                ({summaryUnits} {summaryUnits === 1 ? "Item" : "Items"})
              </span>
            </h2>
            <button
              type="button"
              data-testid="checkout-summary-toggle"
              aria-expanded={summaryOpen}
              onClick={() => setSummaryOpen((open) => !open)}
              className="inline-flex items-center gap-1 text-sm font-medium text-ink-secondary transition hover:text-cta"
            >
              {summaryOpen ? "Hide" : "Show"}
              <svg
                viewBox="0 0 24 24"
                className={`h-4 w-4 transition-transform ${summaryOpen ? "rotate-180" : ""}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                aria-hidden="true"
              >
                <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          {summaryOpen ? (
            <>
              <div className="px-4 py-1 sm:px-5">
                {isBuyNow && product === null && !productError ? (
                  <p className="py-2 text-sm text-ink-muted">Loading item…</p>
                ) : lines.length === 0 ? (
                  <p className="py-2 text-sm text-ink-muted">Item details unavailable.</p>
                ) : (
                  <OrderPreview lines={lines} />
                )}
              </div>

              <div
                data-testid="checkout-totals"
                className="border-t border-border px-4 py-4 sm:px-5"
              >
                {/* The payment choice sits above the totals: what the shopper
                    pays by is part of what they are buying. */}
                <div className="mb-4">
                  <PaymentMethodSelector
                    methods={paymentMethods.methods}
                    value={paymentMethod}
                    onChange={setPaymentMethod}
                    disabled={paymentMethods.loading || paymentMethods.error !== null}
                  />
                  {paymentMethods.error !== null && (
                    <div
                      data-testid="payment-methods-error"
                      className="mt-2 flex items-center justify-between gap-3 text-xs text-sale"
                    >
                      <span>{paymentMethods.error}</span>
                      <button
                        type="button"
                        onClick={paymentMethods.reload}
                        className="font-medium underline"
                      >
                        Try again
                      </button>
                    </div>
                  )}
                </div>
                <dl className="flex flex-col gap-2.5 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-ink-secondary">Item Subtotal</dt>
                    <dd data-testid="checkout-subtotal-compare" className="font-medium text-ink">
                      {isBuyNow && total === null
                        ? "Calculated at checkout"
                        : totals.savings > 0
                          ? formatPrice(totals.compareAtTotal)
                          : formatPrice(totals.subtotal)}
                    </dd>
                  </div>
                  {totals.savings > 0 && !(isBuyNow && total === null) && (
                    <div className="flex justify-between">
                      <dt className="text-ink-secondary">You save</dt>
                      <dd className="font-medium text-sale">−{formatPrice(totals.savings)}</dd>
                    </div>
                  )}
                  {totals.discount > 0 && (
                    <div className="flex justify-between">
                      <dt className="text-ink-secondary">Discount</dt>
                      <dd className="font-medium text-sale">−{formatPrice(totals.discount)}</dd>
                    </div>
                  )}
                  {appliedPromo && appliedPromo.discountAmount > 0 && (
                    <div className="flex justify-between" data-testid="checkout-promo-discount">
                      <dt className="text-ink-secondary">Promo discount</dt>
                      <dd className="font-medium text-sale">−{formatPrice(appliedPromo.discountAmount)}</dd>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <dt className="text-ink-secondary">Shipping</dt>
                    <dd className="font-semibold text-ink">Free</dd>
                  </div>
                  <div className="flex justify-between border-t border-border pt-3 text-base">
                    <dt className="font-semibold text-ink">
                      {paymentMethod === "COD" ? "Total (COD)" : "Total"}
                    </dt>
                    <dd className="font-bold text-ink">
                      {discountedTotal !== null ? formatPrice(discountedTotal) : "Calculated at checkout"}
                    </dd>
                  </div>
                </dl>

                <PromoCodeField
                  subtotal={totals.subtotal}
                  initialCode={initialPromoCode}
                  onApplied={setAppliedPromo}
                  onCheckingChange={setPromoChecking}
                  onInputChange={(value, edited) => {
                    if (edited) markDraftTouched();
                    setPromoInput(value);
                  }}
                />
                <NewsletterOfferPrompt appliedCode={appliedPromo?.code ?? null} />
              </div>
            </>
          ) : null}

          {/* The note stays visible even when the items/totals block is collapsed. */}
          <div className="border-t border-border px-4 py-3 sm:px-5">
            <label className="flex flex-col gap-1 text-[13px] font-medium text-ink">
              Order Notes (Optional)
              <textarea
                id="checkout-notes"
                data-testid="checkout-notes"
                className="h-10 w-full resize-none rounded-lg border border-border bg-card px-3 py-1 text-sm text-ink placeholder:text-ink-muted focus:border-cta focus:outline-none"
                rows={2}
                maxLength={200}
                value={form.notes}
                onChange={(e) => {
                  markDraftTouched();
                  setForm((f) => ({ ...f, notes: e.target.value }));
                }}
                placeholder="Any special delivery instructions?"
              />
            </label>
          </div>
        </section>

        {/* 3. Submit — the address and summary were just reviewed, so the
            confirmation step places the order itself. */}
        <div>
          <Button
            onClick={goToReview}
            className="w-full"
            data-testid="review-order"
            disabled={promoChecking || paymentMethods.loading || paymentMethods.error !== null}
          >
            PLACE ORDER
          </Button>
          <p className="mt-2 text-center text-xs text-ink-muted">
            {paymentMethod === "COD" ? "Cash on Delivery" : "Paid online"}
          </p>
        </div>

        <CheckoutTrustStrip
          deliveryRange={
            form.province.trim()
              ? deliveryWindowFor(form.province)
              : "as fast as 7 days"
          }
        />
      </div>

      <CheckoutAddressDialog
        open={addressOpen}
        values={{
          name: form.name,
          phone: form.phone,
          province: form.province,
          city: form.city,
          barangay: form.barangay,
          postalCode: form.postalCode,
          streetAddress: form.streetAddress,
          landmark: form.landmark,
        }}
        errors={errors}
        postalAuto={postalLookup.auto}
        postalOptions={postalLookup.options}
        locating={locating}
        locationError={locationError}
        locationNotice={locationNotice}
        onChange={setField}
        onProvinceChange={handleProvinceChange}
        onCityChange={handleCityChange}
        onBarangayChange={handleBarangayChange}
        onUseMyLocation={handleUseMyLocation}
        onCancel={() => setAddressOpen(false)}
        onSubmit={submitAddress}
      />
    </div>
  );
}
