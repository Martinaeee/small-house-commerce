"use client";

import { useEffect, useRef, useState } from "react";
import {
  fetchBarangays,
  listMunicipalities,
  listProvinces,
  type PsgcBarangay,
} from "@/lib/psgc";
import { SearchableSelect } from "./SearchableSelect";

/**
 * PSGC province → city/municipality → barangay cascade for the checkout form
 * (spec §3.3). Each level is a single searchable dropdown (type to filter or
 * pick from the list; zero-dep ruling). Values stay plain PSGC name strings.
 * Barangay is optional and degrades to a free-text input when the backend
 * lookup fails (spec §5.3).
 */
interface PsgcAddressSelectsProps {
  province: string;
  city: string;
  barangay: string;
  onProvinceChange: (value: string) => void;
  onCityChange: (value: string) => void;
  onBarangayChange: (value: string) => void;
  errors?: { province?: string; city?: string };
  onBlurField?: (field: "province" | "city") => void;
  inputCls: string;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-sale">
      {message}
    </p>
  );
}

function LegacyNote({ value, testid }: { value: string; testid: string }) {
  return (
    <p data-testid={testid} className="mt-1 text-xs text-ink-muted">
      Current: <span className="font-medium text-ink">{value}</span> (not in
      list — reselect)
    </p>
  );
}

export function PsgcAddressSelects({
  province,
  city,
  barangay,
  onProvinceChange,
  onCityChange,
  onBarangayChange,
  errors,
  onBlurField,
  inputCls,
}: PsgcAddressSelectsProps) {
  const provinces = listProvinces();
  const cities = province ? listMunicipalities(province) : [];

  const [barangayState, setBarangayState] = useState<{
    status: "idle" | "loading" | "ready" | "error";
    options: PsgcBarangay[];
  }>({ status: "idle", options: [] });
  const [retryNonce, setRetryNonce] = useState(0);
  const seqRef = useRef(0);

  // Load barangays whenever the province|city pair changes (cached in psgc.ts).
  useEffect(() => {
    let alive = true;
    void (async () => {
      // The await keeps the setState calls out of the effect's synchronous
      // body (react-hooks/set-state-in-effect; same convention as CheckoutForm).
      await Promise.resolve();
      if (!alive) return;
      if (!province || !city) {
        setBarangayState((cur) =>
          cur.status === "idle" ? cur : { status: "idle", options: [] },
        );
        return;
      }
      const seq = seqRef.current + 1;
      seqRef.current = seq;
      setBarangayState({ status: "loading", options: [] });
      try {
        const list = await fetchBarangays(province, city);
        if (alive && seqRef.current === seq) {
          setBarangayState({ status: "ready", options: list });
        }
      } catch {
        if (alive && seqRef.current === seq) {
          setBarangayState({ status: "error", options: [] });
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [province, city, retryNonce]);

  const provinceLegacy = province !== "" && !provinces.includes(province);
  const cityLegacy = city !== "" && !cities.includes(city);
  const barangayNames =
    barangayState.status === "ready"
      ? barangayState.options.map((b) => b.name)
      : [];
  // Only flag once the pair's state is settled (ready/error) — while loading
  // or idle the options aren't known yet, so a valid draft value must not
  // flash the "(not in list)" note.
  const barangayLegacy =
    barangay !== "" &&
    (barangayState.status === "ready" || barangayState.status === "error") &&
    !barangayNames.includes(barangay);

  function handleProvinceChange(value: string) {
    onProvinceChange(value);
    // Cascade reset lives here too so the contract holds regardless of the
    // parent's handler (spec §5.2: switching province resets city/barangay).
    onCityChange("");
    onBarangayChange("");
  }

  function handleCityChange(value: string) {
    onCityChange(value);
    onBarangayChange("");
  }

  const barangayLoading = barangayState.status === "loading";

  return (
    <>
      <div className="flex flex-col gap-1 text-sm font-medium text-ink">
        <label htmlFor="checkout-province">Province *</label>
        <SearchableSelect
          id="checkout-province"
          testId="psgc-province"
          ariaLabel="Province"
          value={province}
          options={provinces}
          onChange={handleProvinceChange}
          onBlur={() => onBlurField?.("province")}
          placeholder="Select province"
          searchPlaceholder="Search provinces…"
          invalid={Boolean(errors?.province)}
          describedBy={errors?.province ? "checkout-province-error" : undefined}
        />
        {provinceLegacy ? (
          <LegacyNote value={province} testid="psgc-province-legacy" />
        ) : null}
        <FieldError id="checkout-province" message={errors?.province} />
      </div>

      <div className="flex flex-col gap-1 text-sm font-medium text-ink">
        <label htmlFor="checkout-city">City / Municipality *</label>
        <SearchableSelect
          id="checkout-city"
          testId="psgc-city"
          ariaLabel="City or municipality"
          value={city}
          options={cities}
          onChange={handleCityChange}
          onBlur={() => onBlurField?.("city")}
          disabled={!province}
          placeholder="Select city / municipality"
          searchPlaceholder="Search cities…"
          invalid={Boolean(errors?.city)}
          describedBy={errors?.city ? "checkout-city-error" : undefined}
        />
        {cityLegacy ? <LegacyNote value={city} testid="psgc-city-legacy" /> : null}
        <FieldError id="checkout-city" message={errors?.city} />
      </div>

      <div className="flex flex-col gap-1 text-sm font-medium text-ink">
        <label htmlFor="psgc-barangay">Barangay</label>
        {barangayState.status === "error" ? (
          <>
            <input
              type="text"
              id="psgc-barangay"
              data-testid="psgc-barangay"
              aria-label="Barangay"
              className={inputCls}
              value={barangay}
              onChange={(e) => onBarangayChange(e.target.value)}
              placeholder="Barangay"
            />
            <p className="mt-1 text-xs text-sale">
              Could not load barangays — you can type it instead.{" "}
              <button
                type="button"
                className="underline hover:no-underline"
                onClick={() => setRetryNonce((n) => n + 1)}
              >
                Retry
              </button>
            </p>
          </>
        ) : (
          <>
            <SearchableSelect
              id="psgc-barangay"
              testId="psgc-barangay"
              ariaLabel="Barangay"
              value={barangay}
              options={barangayNames}
              onChange={onBarangayChange}
              disabled={!city}
              placeholder="Select barangay"
              searchPlaceholder="Search barangays…"
              loading={barangayLoading}
            />
            {barangayLegacy ? (
              <LegacyNote value={barangay} testid="psgc-barangay-legacy" />
            ) : null}
            {/* A few (province, city) pairs resolve to no barangays in the
                2021 snapshot (0.6% of rows). Without this the select is simply
                empty with no explanation (final-review finding 4). The field is
                optional, so this informs rather than blocks. */}
            {city &&
            !barangayLoading &&
            barangayState.status === "ready" &&
            barangayState.options.length === 0 &&
            !barangayLegacy ? (
              <p className="mt-1 text-xs text-ink-muted" data-testid="psgc-barangay-empty">
                No barangays found for this city — you can skip this field.
              </p>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}