"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { type Product, type StorefrontProductVariant } from "@/lib/api";
import {
  addBusinessDays,
  defaultPreferredDeliveryDate,
  deliveryWindowFor,
  manilaWallDate,
  toDateInputValue,
} from "@/lib/deliveryWindow";
import {
  emitCommerceEvent,
  initiateCheckoutEvent,
  INITIATE_CHECKOUT_FIRED_KEY,
} from "@/lib/commerce-events";
import {
  CHECKOUT_FIELD_ORDER,
  validateCheckoutForm,
  validatePreferredDate,
  type CheckoutErrors,
  type CheckoutField,
} from "@/lib/checkoutValidation";
import { readCheckoutDraft, writeCheckoutDraft } from "@/lib/checkoutDraft";
import { lookupPostalCode } from "@/lib/postalCodes";
import {
  fetchBarangays,
  listMunicipalities,
  listProvinces,
  matchPsgcName,
  reverseGeocode,
} from "@/lib/psgc";
import { totalsFor } from "@/components/checkout/checkoutItems";
import { formatPrice } from "@/components/ui/PriceBox";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";
import { Button } from "@/components/ui/Button";
import { PsgcAddressSelects } from "@/components/checkout/PsgcAddressSelects";
import { checkoutInputCls as inputCls } from "@/components/checkout/checkoutFieldStyles";
import { usePdpPurchase } from "./PdpPurchaseProvider";

/**
 * Inline COD order on the PDP (Phase 2; item-list form per the 2026-09-27
 * revision).
 *
 * This is the same two-step order path as checkout: the shopper picks one or
 * more styles and fills the shared delivery fields here, then reviews the
 * canonical product/SKU data in CheckoutConfirmView before that page calls the
 * one storefront order endpoint. The PDP never creates an order itself.
 *
 * The list starts from the hero's current selection (variant + quantity) so a
 * chosen combination is never re-picked; after that it is the shopper's own
 * basket and the two do not overwrite each other.
 */

/** Focus target per invalid field, so a failed submit lands on the real input. */
const FIELD_ELEMENT_ID: Partial<Record<CheckoutField, string>> = {
  name: "quick-cod-name",
  phone: "quick-cod-phone",
  province: "quick-cod-province",
  city: "quick-cod-city",
  streetAddress: "quick-cod-street",
  preferredDeliveryDate: "quick-cod-preferred-date",
};

interface CodRow {
  variant: StorefrontProductVariant;
  skuId: string;
  price: number;
  compareAt: number | null;
  available: number;
  media: { url: string; altText: string | null } | null;
}

/**
 * Row thumbnail: the media-driver option value's thumbnail for the variant's
 * combination, then the product's effective cover — the same resolution the
 * drawer picker uses. Exact variant media is not part of this payload.
 */
function variantRowMedia(
  product: Product,
  variant: StorefrontProductVariant,
): { url: string; altText: string | null } | null {
  for (const option of product.options) {
    if (!option.isMediaDriver) continue;
    const value = option.values.find((candidate) =>
      variant.optionValueIds.includes(candidate.id),
    );
    if (value?.thumbnailUrl) {
      return {
        url: value.thumbnailUrl,
        altText: value.thumbnailAlt ?? value.label,
      };
    }
  }
  const cover = product.effectiveCoverMedia;
  return cover ? { url: cover.url, altText: cover.altText } : null;
}

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
  const { product, primaryLine, primaryDerived, setPurchaseLocked } =
    usePdpPurchase();

  const rows = useMemo<CodRow[]>(
    () =>
      product.variants.flatMap((variant) => {
        const sku = variant.sku;
        if (!sku || sku.status !== "ACTIVE" || sku.price === null) return [];
        return [
          {
            variant,
            skuId: sku.id,
            price: sku.price,
            compareAt: sku.compareAtPrice,
            available: sku.availableInventory,
            media: variantRowMedia(product, variant),
          },
        ];
      }),
    [product],
  );

  // Re-entry guard for the window between the click and the disabled render.
  const inFlightRef = useRef(false);
  // "Has the shopper taken over" flags for the basket, the form and the
  // one-shot InitiateCheckout. State (not refs): they are read during render
  // by the hero-mirroring reconciliation below, which the react-hooks rules
  // only allow for state.
  const [listTouched, setListTouched] = useState(false);
  const [formTouched, setFormTouched] = useState(false);
  const [checkoutStarted, setCheckoutStarted] = useState(false);

  // The basket mirrors the hero's combination + quantity until the shopper
  // edits it here; after that it is their own basket and the two never
  // overwrite each other. Reconciled during render (not an effect), per the
  // react-hooks rules this repo follows.
  const heroKey =
    primaryDerived.resolvedVariant === null
      ? null
      : `${primaryDerived.resolvedVariant.id}:${primaryLine.quantity}`;
  const [syncedHeroKey, setSyncedHeroKey] = useState<string | null>(heroKey);
  const [quantities, setQuantities] = useState<Record<string, number>>(() => {
    const resolved = primaryDerived.resolvedVariant;
    if (!resolved) return {};
    return { [resolved.id]: Math.max(1, primaryLine.quantity) };
  });
  if (!listTouched && heroKey !== syncedHeroKey) {
    setSyncedHeroKey(heroKey);
    const resolved = primaryDerived.resolvedVariant;
    setQuantities(
      resolved ? { [resolved.id]: Math.max(1, primaryLine.quantity) } : {},
    );
  }

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
  });
  const [dateBounds] = useState(() => {
    const { year, month, day } = manilaWallDate(new Date());
    const manilaToday = new Date(Date.UTC(year, month - 1, day));
    return {
      min: toDateInputValue(addBusinessDays(manilaToday, 3)),
      max: toDateInputValue(
        new Date(manilaToday.getTime() + 30 * 24 * 60 * 60 * 1000),
      ),
    };
  });
  const postalAutoRef = useRef<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locationNotice, setLocationNotice] = useState<string | null>(null);
  const [errors, setErrors] = useState<CheckoutErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [promoOpen, setPromoOpen] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [promoMessage, setPromoMessage] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      await Promise.resolve();
      if (!alive) return;
      const draft = readCheckoutDraft();
      const selection = draft?.selection;
      if (
        !draft ||
        selection?.kind !== "PDP_INLINE" ||
        selection.productSlug !== product.slug
      ) {
        return;
      }
      setForm({
        ...draft.customer,
        preferredDeliveryDate: draft.preferredDeliveryDate ?? "",
      });
      const bySku = new Map(
        selection.items.map((item) => [item.skuId, item.quantity]),
      );
      setQuantities(
        Object.fromEntries(
          rows.map((row) => [
            row.variant.id,
            Math.max(
              0,
              Math.min(bySku.get(row.skuId) ?? 0, row.available, 99),
            ),
          ]),
        ),
      );
      setListTouched(true);
      setFormTouched(true);
      setCheckoutStarted(true);
    })();
    return () => {
      alive = false;
    };
  }, [product.slug, rows]);

  const selected = useMemo(
    () =>
      rows
        .map((row) => ({ row, quantity: quantities[row.variant.id] ?? 0 }))
        .filter(({ quantity }) => quantity > 0),
    [rows, quantities],
  );
  const items = selected.map(({ row, quantity }) => ({
    skuId: row.skuId,
    quantity,
  }));
  const totals = totalsFor(
    selected.map(({ row, quantity }) => ({
      unitPrice: row.price,
      compareAtPrice: row.compareAt,
      quantity,
    })),
  );
  const needsItems = items.length === 0;
  const orderable = !needsItems && !submitting;

  function withDerivedPostal(next: typeof form, previous: string): string {
    const isManualEntry = previous !== "" && previous !== postalAutoRef.current;
    if (isManualEntry) return previous;
    const { auto } = lookupPostalCode(
      next.province,
      next.city,
      next.barangay,
    );
    if (auto !== null) {
      postalAutoRef.current = auto;
      return auto;
    }
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

  /**
   * TRACKING_SPEC §12: InitiateCheckout fires at most once per checkout
   * session, and never merely because the form appeared — the shopper has to
   * start filling it in (or, if the form was touched before any item was
   * picked, when the first item is added). Shares the checkout page's
   * session key so the two surfaces cannot double-fire.
   */
  const fireInitiate = (
    itemsNow: { skuId: string; quantity: number }[],
    valueNow: number,
  ): void => {
    if (checkoutStarted || itemsNow.length === 0) return;
    setCheckoutStarted(true);
    try {
      if (sessionStorage.getItem(INITIATE_CHECKOUT_FIRED_KEY) === "1") return;
      sessionStorage.setItem(INITIATE_CHECKOUT_FIRED_KEY, "1");
    } catch {
      // Storage unavailable: proceed and fire.
    }
    emitCommerceEvent(
      initiateCheckoutEvent({ items: itemsNow, value: valueNow }),
    );
  };

  const set =
    (field: keyof typeof form) =>
    (event: ChangeEvent<HTMLInputElement>): void => {
      const value = event.target.value;
      setFormTouched(true);
      fireInitiate(items, totals.subtotal);
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

  const setRowQuantity = (row: CodRow, next: number): void => {
    setListTouched(true);
    const ceiling = Math.max(0, Math.min(row.available, 99));
    const clamped = Math.max(0, Math.min(next, ceiling));
    const nextQuantities = {
      ...quantities,
      [row.variant.id]: clamped,
    };
    setQuantities(nextQuantities);
    if (formTouched) {
      const nextSelected = rows
        .map((candidate) => ({
          row: candidate,
          quantity: nextQuantities[candidate.variant.id] ?? 0,
        }))
        .filter(({ quantity }) => quantity > 0);
      fireInitiate(
        nextSelected.map(({ row: candidate, quantity }) => ({
          skuId: candidate.skuId,
          quantity,
        })),
        totalsFor(
          nextSelected.map(({ row: candidate, quantity }) => ({
            unitPrice: candidate.price,
            compareAtPrice: candidate.compareAt,
            quantity,
          })),
        ).subtotal,
      );
    }
  };

  const handleProvinceChange = (value: string): void => {
    setFormTouched(true);
    fireInitiate(items, totals.subtotal);
    setLocationError(null);
    setLocationNotice(null);
    setForm((current) => {
      const next = { ...current, province: value, city: "", barangay: "" };
      return {
        ...next,
        postalCode: withDerivedPostal(next, current.postalCode),
      };
    });
    setErrors((current) => {
      const next = { ...current };
      delete next.province;
      delete next.city;
      return next;
    });
  };

  const handleCityChange = (value: string): void => {
    setFormTouched(true);
    fireInitiate(items, totals.subtotal);
    setLocationError(null);
    setLocationNotice(null);
    setForm((current) => {
      const next = { ...current, city: value, barangay: "" };
      return {
        ...next,
        postalCode: withDerivedPostal(next, current.postalCode),
      };
    });
    setErrors((current) => {
      const next = { ...current };
      delete next.city;
      return next;
    });
  };

  const handleBarangayChange = (value: string): void => {
    setFormTouched(true);
    fireInitiate(items, totals.subtotal);
    setForm((current) => {
      const next = { ...current, barangay: value };
      return {
        ...next,
        postalCode: withDerivedPostal(next, current.postalCode),
      };
    });
  };

  const handlePreferredDateChange = (
    event: ChangeEvent<HTMLInputElement>,
  ): void => {
    setFormTouched(true);
    fireInitiate(items, totals.subtotal);
    const value = event.target.value;
    const dateError = validatePreferredDate(value);
    if (dateError) {
      setForm((current) => ({ ...current, preferredDeliveryDate: "" }));
      setErrors((current) => ({
        ...current,
        preferredDeliveryDate: dateError,
      }));
      return;
    }
    setForm((current) => ({ ...current, preferredDeliveryDate: value }));
    setErrors((current) => {
      if (!current.preferredDeliveryDate) return current;
      const next = { ...current };
      delete next.preferredDeliveryDate;
      return next;
    });
  };

  const handleUseMyLocation = (): void => {
    setLocationError(null);
    setLocationNotice(null);
    if (!("geolocation" in navigator)) {
      setLocationError(
        "Could not detect your location. Please select your province and city.",
      );
      return;
    }
    setFormTouched(true);
    fireInitiate(items, totals.subtotal);
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const address = await reverseGeocode(
            position.coords.latitude,
            position.coords.longitude,
          );
          const province = matchPsgcName(listProvinces(), address.province);
          if (!province) {
            setLocationError(
              "Could not detect your location. Please select your province and city.",
            );
            return;
          }
          handleProvinceChange(province);
          const city = matchPsgcName(
            listMunicipalities(province),
            address.city,
          );
          if (city) {
            handleCityChange(city);
            if (address.barangay) {
              try {
                const barangays = await fetchBarangays(province, city);
                const barangay = matchPsgcName(
                  barangays.map((candidate) => candidate.name),
                  address.barangay,
                );
                if (barangay) handleBarangayChange(barangay);
              } catch {
                // Barangay remains available for manual selection.
              }
            }
          } else {
            setLocationNotice(
              "We filled in your province. Please select your city.",
            );
          }
        } catch {
          setLocationError(
            "Could not detect your location. Please select your province and city.",
          );
        } finally {
          setLocating(false);
        }
      },
      () => {
        setLocating(false);
        setLocationError(
          "Could not detect your location. Please select your province and city.",
        );
      },
      { timeout: 10000, maximumAge: 60000 },
    );
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

  const applyPromo = (): void => {
    // CHECKOUT_SPEC §14: the backend promo engine is not built yet; the UI
    // entry exists so the collapsed pattern is in place, exactly like the
    // cart's.
    setPromoMessage(
      promoCode.trim()
        ? "Promo codes are coming soon."
        : "Enter a code to apply it.",
    );
  };

  function goToReview(): void {
    if (inFlightRef.current) return;
    const validation = validateCheckoutForm(form);
    const preferredDateError = validatePreferredDate(
      form.preferredDeliveryDate,
    );
    if (preferredDateError) {
      validation.preferredDeliveryDate = preferredDateError;
    }
    setErrors(validation);
    if (Object.keys(validation).length > 0) {
      const firstInvalid =
        CHECKOUT_FIELD_ORDER.find((field) => validation[field]) ??
        (validation.preferredDeliveryDate
          ? "preferredDeliveryDate"
          : undefined);
      const focusId = firstInvalid ? FIELD_ELEMENT_ID[firstInvalid] : undefined;
      if (focusId) document.getElementById(focusId)?.focus();
      return;
    }
    if (items.length === 0) return;

    inFlightRef.current = true;
    setPurchaseLocked(true);
    setSubmitting(true);
    // Attribution is URL-backed by contract. Carry the PDP query through the
    // review step and back through Edit so aid/campaign/utm snapshots survive.
    const query = typeof window === "undefined" ? "" : window.location.search;
    writeCheckoutDraft(
      {
        name: form.name.trim(),
        phone: form.phone.trim(),
        province: form.province.trim(),
        city: form.city.trim(),
        barangay: form.barangay.trim(),
        postalCode: form.postalCode.trim(),
        streetAddress: form.streetAddress.trim(),
        landmark: form.landmark.trim(),
      },
      form.preferredDeliveryDate.trim() || null,
      {
        kind: "PDP_INLINE",
        productSlug: product.slug,
        productQuery: query,
        items,
      },
    );
    router.push(`/checkout/confirm${query}`);
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

      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-start">
        {/* Items — one row per sellable style, each with its own quantity. */}
        <div
          data-testid="quick-cod-items"
          className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4"
        >
          <p className="text-sm font-semibold text-ink">Choose your items</p>
          <p className="text-xs text-ink-muted">
            Pick a style and set how many you need — mix styles freely, one COD
            total.
          </p>

          <ul className="flex flex-col divide-y divide-border">
            {rows.map((row) => {
              const quantity = quantities[row.variant.id] ?? 0;
              const outOfStock = row.available <= 0;
              const atCeiling = quantity >= Math.min(row.available, 99);
              return (
                <li
                  key={row.variant.id}
                  data-testid={`quick-cod-row-${row.variant.id}`}
                  className="flex items-center gap-3 py-3"
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (quantity === 0) setRowQuantity(row, 1);
                    }}
                    disabled={submitting || outOfStock}
                    aria-pressed={quantity > 0}
                    className={`flex min-w-0 flex-1 items-center gap-3 rounded-lg border p-2 text-left transition-colors disabled:cursor-not-allowed ${
                      quantity > 0
                        ? "border-cta bg-card"
                        : "border-transparent hover:border-border"
                    }`}
                  >
                    {row.media ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={row.media.url}
                        alt={row.media.altText ?? row.variant.name}
                        className="h-14 w-14 shrink-0 rounded-md border border-border object-cover"
                      />
                    ) : (
                      <PlaceholderImage
                        label=""
                        className="h-14 w-14 shrink-0 rounded-md border border-border"
                      />
                    )}
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-ink">
                        {row.variant.name}
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
                        <span className="text-sm font-semibold text-ink">
                          {formatPrice(row.price)}
                        </span>
                        {row.compareAt !== null && row.compareAt > row.price && (
                          <span className="text-xs text-ink-muted line-through">
                            {formatPrice(row.compareAt)}
                          </span>
                        )}
                      </span>
                      {outOfStock ? (
                        <span className="mt-0.5 block text-xs font-medium text-sale">
                          Out of stock
                        </span>
                      ) : row.available <= 5 ? (
                        <span className="mt-0.5 block text-xs text-ink-muted">
                          Only {row.available} left
                        </span>
                      ) : null}
                    </span>
                  </button>

                  <div
                    role="group"
                    aria-label={`${row.variant.name} quantity`}
                    className="flex shrink-0 items-center rounded-lg border border-border bg-card"
                  >
                    <button
                      type="button"
                      aria-label={`Decrease ${row.variant.name} quantity`}
                      disabled={submitting || quantity === 0}
                      onClick={() => setRowQuantity(row, quantity - 1)}
                      className="flex h-9 w-9 items-center justify-center text-lg text-ink hover:text-cta disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      −
                    </button>
                    <span
                      data-testid={`quick-cod-row-qty-${row.variant.id}`}
                      className="w-9 text-center text-sm font-medium text-ink"
                    >
                      {quantity}
                    </span>
                    <button
                      type="button"
                      aria-label={`Increase ${row.variant.name} quantity`}
                      disabled={submitting || outOfStock || atCeiling}
                      onClick={() => setRowQuantity(row, quantity + 1)}
                      className="flex h-9 w-9 items-center justify-center text-lg text-ink hover:text-cta disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      +
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>

          <dl className="flex flex-col gap-2 border-t border-border pt-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-secondary">Subtotal</dt>
              <dd className="font-medium text-ink">
                {totals.savings > 0 && (
                  <span
                    data-testid="quick-cod-compare-total"
                    className="mr-2 text-xs font-normal text-ink-muted line-through"
                  >
                    {formatPrice(totals.compareAtTotal)}
                  </span>
                )}
                <span data-testid="quick-cod-subtotal">
                  {formatPrice(totals.subtotal)}
                </span>
              </dd>
            </div>
            {totals.savings > 0 && (
              <div className="flex justify-between">
                <dt className="text-ink-secondary">You save</dt>
                <dd
                  data-testid="quick-cod-save"
                  className="font-medium text-sale"
                >
                  −{formatPrice(totals.savings)}
                </dd>
              </div>
            )}
            <div className="flex justify-between border-t border-border pt-2 text-base">
              <dt className="font-semibold text-ink">Total (COD)</dt>
              <dd
                data-testid="quick-cod-total"
                className="font-bold text-ink"
              >
                {formatPrice(totals.total)}
              </dd>
            </div>
          </dl>

          {/* CHECKOUT_SPEC §14 promo code — collapsed by default, same
              honest entry the cart uses. */}
          <div>
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
            {promoMessage && (
              <p className="mt-2 text-xs text-ink-muted">{promoMessage}</p>
            )}
          </div>
        </div>

        {/* Delivery form */}
        <form
          className="flex w-full flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            goToReview();
          }}
          noValidate
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label
                htmlFor="quick-cod-name"
                className="text-sm font-medium text-ink"
              >
                Full Name *
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
                Mobile Number *
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

            <p className="-mt-2 text-xs text-ink-muted sm:col-span-2">
              We use your mobile number for delivery updates.
            </p>

            <div className="sm:col-span-2">
              <button
                type="button"
                onClick={handleUseMyLocation}
                disabled={submitting || locating}
                className="text-sm font-medium text-cta hover:underline disabled:cursor-not-allowed disabled:opacity-50"
              >
                {locating ? "Locating…" : "Use my location"}
              </button>
              {locationError ? (
                <p role="alert" className="mt-1 text-xs text-sale">
                  {locationError}
                </p>
              ) : null}
              {locationNotice ? (
                <p role="status" className="mt-1 text-xs text-ink-muted">
                  {locationNotice}
                </p>
              ) : null}
            </div>

            <PsgcAddressSelects
              province={form.province}
              city={form.city}
              barangay={form.barangay}
              onProvinceChange={handleProvinceChange}
              onCityChange={handleCityChange}
              onBarangayChange={handleBarangayChange}
              errors={errors}
              onBlurField={(field) => revalidate(field)()}
              inputCls={inputCls}
              disabled={submitting}
            />

            <div className="flex flex-col gap-1 sm:col-span-2">
              <label
                htmlFor="quick-cod-postal"
                className="text-sm font-medium text-ink"
              >
                Postal Code
              </label>
              <input
                id="quick-cod-postal"
                name="postalCode"
                className={inputCls}
                value={form.postalCode}
                onChange={set("postalCode")}
                placeholder="1100"
                inputMode="numeric"
                disabled={submitting}
              />
              {postalLookup.options.length > 1 ? (
                <select
                  aria-label="Pick a postal code"
                  className={inputCls}
                  value={
                    postalLookup.options.some(
                      (option) => option.zip === form.postalCode,
                    )
                      ? form.postalCode
                      : ""
                  }
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      postalCode: event.target.value,
                    }))
                  }
                  disabled={submitting}
                >
                  <option value="">
                    {postalLookup.auto
                      ? "Change postal code"
                      : `This city has ${postalLookup.options.length} ZIPs — pick one`}
                  </option>
                  {postalLookup.options.map((option) => (
                    <option key={option.zip} value={option.zip}>
                      {`${option.zip} — ${option.label}`}
                    </option>
                  ))}
                </select>
              ) : null}
              {postalLookup.auto && form.postalCode === postalLookup.auto ? (
                <span className="text-xs font-normal text-ink-muted">
                  Filled in from your address — you can change it.
                </span>
              ) : null}
            </div>

            <div className="sm:col-span-2">
              <label
                htmlFor="quick-cod-street"
                className="text-sm font-medium text-ink"
              >
                Full Address *
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

            <div className="sm:col-span-2">
              <label
                htmlFor="quick-cod-landmark"
                className="text-sm font-medium text-ink"
              >
                Landmark
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

            <div className="sm:col-span-2">
              <label
                htmlFor="quick-cod-preferred-date"
                className="text-sm font-medium text-ink"
              >
                Preferred delivery date (optional)
              </label>
              <input
                id="quick-cod-preferred-date"
                name="preferredDeliveryDate"
                type="date"
                min={dateBounds.min}
                max={dateBounds.max}
                className={`mt-1 ${inputCls}${
                  errors.preferredDeliveryDate ? " border-sale" : ""
                }`}
                value={form.preferredDeliveryDate}
                onChange={handlePreferredDateChange}
                aria-invalid={Boolean(errors.preferredDeliveryDate)}
                aria-describedby={
                  errors.preferredDeliveryDate
                    ? "quick-cod-preferred-date-error"
                    : undefined
                }
                disabled={submitting}
              />
              <FieldError
                id="quick-cod-preferred-date"
                message={errors.preferredDeliveryDate}
              />
              <p className="mt-1 text-xs text-ink-muted">
                {form.province.trim()
                  ? `Estimated delivery: ${deliveryWindowFor(form.province)} · Choose a preferred date (optional).`
                  : "Choose a preferred date (optional)."}
              </p>
            </div>
          </div>

          {needsItems ? (
            <p
              role="status"
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-ink-secondary"
            >
              Select at least one item to order.
            </p>
          ) : null}

          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={!orderable}
            data-testid="quick-cod-submit"
          >
            {submitting ? "Opening review…" : "REVIEW ORDER"}
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
