"use client";

import { useEffect, useRef, useState } from "react";
import {
  fetchBarangays,
  listMunicipalities,
  listProvinces,
  type PsgcBarangay,
} from "@/lib/psgc";

/**
 * PSGC province → city/municipality → barangay cascade for the checkout form
 * (spec §3.3). Native <select> plus an independent search filter (zero-dep
 * ruling); values stay plain PSGC name strings. Barangay is optional and
 * degrades to a free-text input when the backend lookup fails (spec §5.3).
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

const searchCls =
  "w-full rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-ink placeholder:text-ink-muted focus:border-cta focus:outline-none disabled:opacity-60";

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

/**
 * Case-insensitive substring filter. When the selected value is a known option
 * but the query hides it (including zero matches), keep it as the only/leading
 * option so the select always displays the form value.
 */
function visibleOptions(
  options: string[],
  query: string,
  selected: string,
  selectedKnown: boolean,
): string[] {
  const q = query.trim().toLowerCase();
  const matched = q
    ? options.filter((o) => o.toLowerCase().includes(q))
    : options;
  if (selected && selectedKnown && !matched.includes(selected)) {
    return [selected, ...matched.filter((o) => o !== selected)];
  }
  return matched;
}

function visibleBarangays(
  options: PsgcBarangay[],
  query: string,
  selected: string,
): PsgcBarangay[] {
  const q = query.trim().toLowerCase();
  const matched = q
    ? options.filter((b) => b.name.toLowerCase().includes(q))
    : options;
  if (selected && !matched.some((b) => b.name === selected)) {
    const current = options.find((b) => b.name === selected);
    if (current) {
      return [current, ...matched.filter((b) => b.code !== current.code)];
    }
  }
  return matched;
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

  const [provinceQuery, setProvinceQuery] = useState("");
  const [cityQuery, setCityQuery] = useState("");
  const [barangayQuery, setBarangayQuery] = useState("");

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
    setProvinceQuery("");
    setCityQuery("");
    setBarangayQuery("");
  }

  function handleCityChange(value: string) {
    onCityChange(value);
    onBarangayChange("");
    setCityQuery("");
    setBarangayQuery("");
  }

  function handleBarangayChange(value: string) {
    onBarangayChange(value);
    setBarangayQuery("");
  }

  const barangayLoading = barangayState.status === "loading";

  return (
    <>
      <div className="flex flex-col gap-1 text-sm font-medium text-ink">
        <label htmlFor="checkout-province">Province *</label>
        <input
          type="text"
          data-testid="psgc-province-search"
          aria-label="Search provinces"
          className={searchCls}
          value={provinceQuery}
          onChange={(e) => setProvinceQuery(e.target.value)}
          placeholder="Search provinces"
          autoComplete="off"
        />
        <select
          id="checkout-province"
          data-testid="psgc-province"
          className={`${inputCls}${errors?.province ? " border-sale" : ""}`}
          value={provinceLegacy ? "" : province}
          onChange={(e) => handleProvinceChange(e.target.value)}
          onBlur={() => onBlurField?.("province")}
          aria-invalid={Boolean(errors?.province)}
          aria-describedby={errors?.province ? "checkout-province-error" : undefined}
        >
          <option value="" disabled>
            Select province
          </option>
          {visibleOptions(provinces, provinceQuery, province, !provinceLegacy).map(
            (name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ),
          )}
        </select>
        {provinceLegacy ? (
          <LegacyNote value={province} testid="psgc-province-legacy" />
        ) : null}
        <FieldError id="checkout-province" message={errors?.province} />
      </div>

      <div className="flex flex-col gap-1 text-sm font-medium text-ink">
        <label htmlFor="checkout-city">City / Municipality *</label>
        <input
          type="text"
          data-testid="psgc-city-search"
          aria-label="Search cities"
          className={searchCls}
          value={cityQuery}
          onChange={(e) => setCityQuery(e.target.value)}
          placeholder="Search cities"
          autoComplete="off"
          disabled={!province}
        />
        <select
          id="checkout-city"
          data-testid="psgc-city"
          className={`${inputCls}${errors?.city ? " border-sale" : ""}${
            !province ? " opacity-60" : ""
          }`}
          value={cityLegacy ? "" : city}
          onChange={(e) => handleCityChange(e.target.value)}
          onBlur={() => onBlurField?.("city")}
          disabled={!province}
          aria-invalid={Boolean(errors?.city)}
          aria-describedby={errors?.city ? "checkout-city-error" : undefined}
        >
          <option value="" disabled>
            Select city / municipality
          </option>
          {visibleOptions(cities, cityQuery, city, !cityLegacy).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        {cityLegacy ? (
          <LegacyNote value={city} testid="psgc-city-legacy" />
        ) : null}
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
            <input
              type="text"
              data-testid="psgc-barangay-search"
              aria-label="Search barangays"
              className={searchCls}
              value={barangayQuery}
              onChange={(e) => setBarangayQuery(e.target.value)}
              placeholder="Search barangays"
              autoComplete="off"
              disabled={!city || barangayState.status !== "ready"}
            />
            <select
              id="psgc-barangay"
              data-testid="psgc-barangay"
              className={`${inputCls}${!city ? " opacity-60" : ""}`}
              value={barangayLegacy ? "" : barangay}
              onChange={(e) => handleBarangayChange(e.target.value)}
              disabled={!city || barangayLoading}
            >
              {barangayLoading ? (
                <option disabled>Loading…</option>
              ) : (
                <>
                  <option value="" disabled>
                    Select barangay
                  </option>
                  {visibleBarangays(
                    barangayState.status === "ready"
                      ? barangayState.options
                      : [],
                    barangayQuery,
                    barangay,
                  ).map((b) => (
                    <option key={b.code} value={b.name}>
                      {b.name}
                    </option>
                  ))}
                </>
              )}
            </select>
            {barangayLegacy ? (
              <LegacyNote value={barangay} testid="psgc-barangay-legacy" />
            ) : null}
          </>
        )}
      </div>
    </>
  );
}
