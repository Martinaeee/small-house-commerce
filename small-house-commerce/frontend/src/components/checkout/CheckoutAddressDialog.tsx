"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { CheckoutField } from "@/lib/checkoutValidation";
import {
  fetchBarangays,
  listMunicipalities,
  listProvinces,
  matchPsgcName,
  searchAddressSuggestions,
  type NominatimSuggestion,
} from "@/lib/psgc";

type AddressValues = Record<
  "name" | "phone" | "province" | "city" | "barangay" | "postalCode" | "streetAddress" | "landmark",
  string
>;

type RegionTab = "province" | "city" | "barangay";

const TAB_LABELS: Record<RegionTab, string> = {
  province: "Province",
  city: "City",
  barangay: "Barangay",
};

/** Every one-line control shares this height so the sheet reads as a table. */
const CONTROL_CLS =
  "h-11 w-full rounded-md border px-3 text-base text-ink placeholder:text-ink-muted focus:border-cta focus:outline-none";

const TEXTAREA_CLS =
  "w-full rounded-md border px-3 py-2 text-base text-ink placeholder:text-ink-muted focus:border-cta focus:outline-none";

/**
 * Shopee-style address picker: one field that opens a searchable tab strip
 * (province → city → barangay). Every level is still plain PSGC names — the
 * same cascade the inline form used — but the picker reads as one control and
 * advances on selection.
 */
function RegionPicker({
  values,
  onProvince,
  onCity,
  onBarangay,
  onDone,
}: {
  values: AddressValues;
  onProvince: (value: string) => void;
  onCity: (value: string) => void;
  onBarangay: (value: string) => void;
  onDone: () => void;
}): ReactNode {
  const [tab, setTab] = useState<RegionTab>(
    values.province === "" ? "province" : values.city === "" ? "city" : "barangay",
  );
  const [query, setQuery] = useState("");
  const [barangays, setBarangays] = useState<{ name: string }[]>([]);
  const [loadingBarangays, setLoadingBarangays] = useState(false);

  const provinces = useMemo(() => listProvinces(), []);
  const cities = useMemo(
    () => (values.province ? listMunicipalities(values.province) : []),
    [values.province],
  );

  useEffect(() => {
    if (tab !== "barangay" || !values.province || !values.city) return;
    let alive = true;
    setLoadingBarangays(true);
    void fetchBarangays(values.province, values.city)
      .then((list) => {
        if (alive) setBarangays(list);
      })
      .catch(() => {
        if (alive) setBarangays([]);
      })
      .finally(() => {
        if (alive) setLoadingBarangays(false);
      });
    return () => {
      alive = false;
    };
  }, [tab, values.province, values.city]);

  const options: { value: string; hint?: string }[] = tab === "province"
    ? provinces.map((name) => ({ value: name }))
    : tab === "city"
      ? cities.map((name) => ({ value: name }))
      : barangays.map((barangay) => ({ value: barangay.name }));

  const filtered = query.trim()
    ? options.filter((option) =>
        option.value.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : options;

  const unavailable =
    (tab === "city" && !values.province) ||
    (tab === "barangay" && (!values.province || !values.city));

  function select(value: string) {
    setQuery("");
    if (tab === "province") {
      onProvince(value);
      setTab("city");
      return;
    }
    if (tab === "city") {
      onCity(value);
      setTab("barangay");
      return;
    }
    onBarangay(value);
    onDone();
  }

  return (
    <div className="border-t border-border bg-background">
      <div className="flex border-b border-border" role="tablist" aria-label="Region selector">
        {(["province", "city", "barangay"] as RegionTab[]).map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            onClick={() => {
              setTab(name);
              setQuery("");
            }}
            className={`flex-1 px-2 py-2.5 text-sm ${
              tab === name
                ? "border-b-2 border-cta font-semibold text-ink"
                : "text-ink-secondary"
            }`}
          >
            {TAB_LABELS[name]}
          </button>
        ))}
      </div>
      {unavailable ? (
        <p className="px-4 py-4 text-sm text-ink-muted">
          {tab === "city"
            ? "Choose a province first."
            : "Choose a city first."}
        </p>
      ) : (
        <>
          <div className="p-3">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${TAB_LABELS[tab].toLowerCase()}`}
              className="h-10 w-full rounded-md border border-border bg-card px-3 text-sm text-ink placeholder:text-ink-muted focus:border-cta focus:outline-none"
            />
          </div>
          <ul className="max-h-52 overflow-y-auto" role="listbox">
            {tab === "barangay" && loadingBarangays ? (
              <li className="px-4 py-3 text-sm text-ink-muted">Loading barangays…</li>
            ) : filtered.length === 0 ? (
              <li className="px-4 py-3 text-sm text-ink-muted">No match — adjust the search.</li>
            ) : (
              filtered.slice(0, 200).map((option) => (
                <li key={option.value}>
                  <button
                    type="button"
                    onClick={() => select(option.value)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm text-ink hover:bg-primary-light/40"
                  >
                    <span>{option.value}</span>
                    {option.hint ? (
                      <span className="text-xs text-ink-muted">{option.hint}</span>
                    ) : null}
                  </button>
                </li>
              ))
            )}
          </ul>
        </>
      )}
    </div>
  );
}

/** New Address dialog — the checkout collects who/where here, in one modal. */
export function CheckoutAddressDialog({
  open,
  values,
  errors,
  postalAuto,
  postalOptions,
  locating,
  locationError,
  locationNotice,
  onChange,
  onProvinceChange,
  onCityChange,
  onBarangayChange,
  onUseMyLocation,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  values: AddressValues;
  errors: Partial<Record<CheckoutField, string>>;
  postalAuto: string | null;
  postalOptions: { label: string; zip: string }[];
  locating: boolean;
  locationError: string | null;
  locationNotice: string | null;
  onChange: (field: CheckoutField, value: string) => void;
  onProvinceChange: (value: string) => void;
  onCityChange: (value: string) => void;
  onBarangayChange: (value: string) => void;
  onUseMyLocation: () => void;
  onCancel: () => void;
  onSubmit: () => void;
}): ReactNode {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [touchedAny, setTouchedAny] = useState(false);
  // Street type-ahead (Shopee-style): the text the shopper typed drives a
  // debounced OSM lookup; picking a suggestion fills street + region.
  const [streetQuery, setStreetQuery] = useState("");
  const [suggestions, setSuggestions] = useState<NominatimSuggestion[]>([]);

  useEffect(() => {
    if (open) {
      setPickerOpen(false);
      setTouchedAny(false);
      setStreetQuery("");
      setSuggestions([]);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const query = streetQuery.trim();
    if (query.length < 5) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchAddressSuggestions(query, controller.signal)
        .then((list) => {
          if (!controller.signal.aborted) setSuggestions(list);
        })
        .catch(() => {
          /* suggestions are a convenience; never block typing */
        });
    }, 500);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [open, streetQuery]);

  const applySuggestion = async (suggestion: NominatimSuggestion) => {
    setStreetQuery("");
    setSuggestions([]);
    const streetText = suggestion.street || suggestion.displayName.split(",")[0]?.trim() || "";
    const province = matchPsgcName(listProvinces(), suggestion.province);
    if (province) {
      onProvinceChange(province);
      const city = matchPsgcName(listMunicipalities(province), suggestion.city);
      if (city) {
        onCityChange(city);
        const rawBarangay = suggestion.barangay;
        if (rawBarangay) {
          try {
            const barangays = await fetchBarangays(province, city);
            const barangay = matchPsgcName(
              barangays.map((b) => b.name),
              rawBarangay,
            );
            if (barangay) onBarangayChange(barangay);
          } catch {
            /* barangay stays for the shopper to pick */
          }
        }
      }
    }
    if (streetText) onChange("streetAddress", streetText);
  };

  if (!open) return null;

  const regionText = [values.province, values.city, values.barangay]
    .filter(Boolean)
    .join(", ");

  const field =
    (name: CheckoutField) =>
      (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setTouchedAny(true);
        onChange(name, event.target.value);
      };

  const suggestedPostalValue = postalOptions.some(
    (option) => option.zip === values.postalCode,
  )
    ? values.postalCode
    : "";

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-ink/50 sm:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="checkout-address-title"
        className="flex max-h-[92dvh] w-full flex-col overflow-hidden bg-card sm:max-w-[560px] sm:rounded-xl"
      >
        <div className="flex items-start justify-between gap-4 px-4 pb-2 pt-4 sm:px-5">
          <h2 id="checkout-address-title" className="text-xl font-semibold text-ink">
            New Address
          </h2>
          <button
            type="button"
            aria-label="Close address dialog"
            onClick={onCancel}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-ink-muted transition hover:bg-background hover:text-ink"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 sm:px-5">
          <div className="flex flex-col gap-3">
            {locationError ? (
              <p role="alert" data-testid="location-error" className="text-xs text-sale">
                {locationError}
              </p>
            ) : null}
            {locationNotice ? (
              <p role="status" data-testid="location-notice" className="text-xs text-ink-secondary">
                {locationNotice}
              </p>
            ) : null}

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-[13px] font-medium text-ink">
                Full Name *
                <input
                  id="checkout-name"
                  value={values.name}
                  onChange={field("name")}
                  aria-invalid={Boolean(errors.name)}
                  placeholder="Full Name"
                  className={`${CONTROL_CLS} ${errors.name ? "border-sale" : "border-border"}`}
                />
                {errors.name ? (
                  <span id="checkout-name-error" role="alert" className="text-xs text-sale">
                    {errors.name}
                  </span>
                ) : null}
              </label>
              <label className="flex flex-col gap-1 text-[13px] font-medium text-ink">
                Phone Number *
                <input
                  id="checkout-phone"
                  value={values.phone}
                  onChange={field("phone")}
                  inputMode="tel"
                  autoComplete="tel"
                  aria-invalid={Boolean(errors.phone)}
                  placeholder="Phone Number"
                  className={`${CONTROL_CLS} ${errors.phone ? "border-sale" : "border-border"}`}
                />
                {errors.phone ? (
                  <span id="checkout-phone-error" role="alert" className="text-xs text-sale">
                    {errors.phone}
                  </span>
                ) : null}
              </label>
            </div>

            <div className="rounded-md border border-border">
              <button
                type="button"
                data-testid="checkout-region-trigger"
                aria-expanded={pickerOpen}
                onClick={() => setPickerOpen((current) => !current)}
                className="flex h-11 w-full items-center justify-between gap-3 px-3 text-left text-sm"
              >
                <span className={regionText ? "text-ink" : "text-ink-muted"}>
                  {regionText || "Region, Province, City, Barangay"}
                </span>
                <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-ink-muted" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="m7 10 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {errors.province || errors.city ? (
                <p className="px-3 pb-2 text-xs text-sale">
                  {errors.province || errors.city}
                </p>
              ) : null}
              {pickerOpen ? (
                <RegionPicker
                  values={values}
                  onProvince={onProvinceChange}
                  onCity={onCityChange}
                  onBarangay={onBarangayChange}
                  onDone={() => setPickerOpen(false)}
                />
              ) : null}
            </div>

            <div className="flex flex-col gap-1 text-[13px] font-medium text-ink">
              <label htmlFor="checkout-postal-code">
                Postal Code (Optional)
              </label>
              <div className="flex gap-2">
                <input
                  id="checkout-postal-code"
                  data-testid="checkout-postal-code"
                  value={values.postalCode}
                  onChange={field("postalCode")}
                  placeholder="Postal Code"
                  inputMode="numeric"
                  className={`${CONTROL_CLS} min-w-0 flex-1 border-border`}
                />
                {postalOptions.length > 0 ? (
                  <select
                    data-testid="checkout-postal-options"
                    aria-label="Suggested postal codes"
                    value={suggestedPostalValue}
                    onChange={(event) => {
                      if (event.target.value) onChange("postalCode", event.target.value);
                    }}
                    className="h-11 w-[46%] shrink-0 rounded-md border border-border bg-card px-2 text-[13px] text-ink focus:border-cta focus:outline-none"
                  >
                    <option value="">Pick a suggested ZIP</option>
                    {postalOptions.map((option) => (
                      <option key={option.zip} value={option.zip}>
                        {`${option.label} — ${option.zip}`}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
              {postalAuto && values.postalCode === postalAuto ? (
                <span data-testid="checkout-postal-code-hint" className="text-xs font-normal text-ink-muted">
                  Filled in from your address — you can change it.
                </span>
              ) : null}
            </div>

            <label className="flex flex-col gap-1 text-[13px] font-medium text-ink">
              Street Name, Building, House No. *
              <textarea
                id="checkout-address"
                rows={2}
                value={values.streetAddress}
                onChange={(event) => {
                  setTouchedAny(true);
                  setStreetQuery(event.target.value);
                  onChange("streetAddress", event.target.value);
                }}
                aria-invalid={Boolean(errors.streetAddress)}
                placeholder="Street Name, Building, House No."
                className={`${TEXTAREA_CLS} resize-y ${
                  errors.streetAddress ? "border-sale" : "border-border"
                }`}
              />
              {suggestions.length > 0 ? (
                <ul
                  data-testid="checkout-street-suggestions"
                  className="mt-1 max-h-44 overflow-y-auto rounded-md border border-border bg-card"
                >
                  {suggestions.map((suggestion) => (
                    <li key={suggestion.displayName}>
                      <button
                        type="button"
                        onClick={() => {
                          void applySuggestion(suggestion);
                        }}
                        className="block w-full px-3 py-2 text-left text-sm leading-5 text-ink hover:bg-primary-light/40"
                      >
                        {suggestion.displayName}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {errors.streetAddress ? (
                <span id="checkout-address-error" role="alert" className="text-xs text-sale">
                  {errors.streetAddress}
                </span>
              ) : null}
            </label>

            <div className="flex items-end gap-3">
              <label className="flex min-w-0 flex-1 flex-col gap-1 text-[13px] font-medium text-ink">
                Landmark (Optional)
                <input
                  id="checkout-landmark"
                  value={values.landmark}
                  onChange={field("landmark")}
                  placeholder="Nearby building or landmark"
                  className="h-10 w-full rounded-md border border-border px-3 text-sm text-ink placeholder:text-ink-muted focus:border-cta focus:outline-none"
                />
              </label>
              <button
                type="button"
                data-testid="use-my-location"
                onClick={onUseMyLocation}
                disabled={locating}
                className="inline-flex h-10 shrink-0 items-center text-[13px] font-medium text-cta hover:underline disabled:opacity-60"
              >
                {locating ? "Locating…" : "Use my location"}
              </button>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-3 border-t border-border bg-card px-4 py-3 sm:px-5">
          <button
            type="button"
            onClick={onCancel}
            className="h-11 rounded-lg border border-border px-6 text-sm font-semibold text-ink transition hover:border-cta"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="checkout-address-submit"
            onClick={onSubmit}
            className="h-11 rounded-lg bg-cta px-6 text-sm font-semibold text-cta-foreground transition hover:bg-cta-hover"
          >
            Submit
          </button>
        </div>
      </div>
    </div>
  );
}
