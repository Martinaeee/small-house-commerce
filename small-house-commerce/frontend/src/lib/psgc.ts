/**
 * PSGC cascade helpers (spec §3.3). Province/municipality data is bundled with
 * the frontend (<130KB); barangays are served province-scoped by the backend
 * (spec §3.2, ruling E-1). Form values stay plain PSGC name strings, so the
 * order DTO / validation need no changes (spec §2).
 *
 * Client-safe: pure data functions plus a relative-URL fetch proxied by
 * next.config rewrites — no "use client" directive needed.
 */
import provincesJson from "@/data/psgc/provinces.json";
import municipalitiesJson from "@/data/psgc/municipalities.json";

export interface PsgcProvince {
  name: string;
  region: string;
}

export interface PsgcMunicipality {
  name: string;
  province: string;
  /** Absent/false for municipalities; the dataset marks cities with true. */
  city: boolean;
}

export interface PsgcBarangay {
  code: string;
  name: string;
}

// Normalise once at module load: the municipality rows omit `city` on
// municipalities, so coerce the flag explicitly.
const provinces: PsgcProvince[] = provincesJson.map((p) => ({
  name: p.name,
  region: p.region,
}));

const municipalities: PsgcMunicipality[] = municipalitiesJson.map((m) => ({
  name: m.name,
  province: m.province,
  city: m.city === true,
}));

/**
 * Distinct PSGC province names, alphabetical (includes Metro Manila).
 *
 * Provinces whose municipality list is empty are EXCLUDED: the snapshot lists
 * "Isabela City" (Region IX) as a province with zero municipalities.json rows,
 * so selecting it would dead-end the required City select with no options and
 * no free-text path (final-review finding 2). Its barangays (prefix 0997) are
 * likewise unreachable, so nothing is lost by hiding it.
 */
export function listProvinces(): string[] {
  const withCities = new Set(municipalities.map((m) => m.province));
  return Array.from(new Set(provinces.map((p) => p.name)))
    .filter((name) => withCities.has(name))
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Municipality/city names for a province (exact name match). Cities sort first,
 * municipalities after; alphabetical within each group. Both are selectable.
 */
export function listMunicipalities(province: string): string[] {
  const rows = municipalities.filter((m) => m.province === province);
  const collate = (a: string, b: string) => a.localeCompare(b);
  const cities = rows.filter((m) => m.city).map((m) => m.name).sort(collate);
  const towns = rows.filter((m) => !m.city).map((m) => m.name).sort(collate);
  return Array.from(new Set([...cities, ...towns]));
}

/** Fetch one province|city pair at most per page load (spec §3.3 Map cache). */
const barangayCache = new Map<string, PsgcBarangay[]>();

/**
 * GET /storefront/psgc/barangays?province=&city= — resolves with the list
 * (possibly []) or throws so the UI can offer the free-text fallback
 * (spec §5.3). Only successful responses are cached, so failures can retry.
 */
export async function fetchBarangays(
  province: string,
  city: string,
): Promise<PsgcBarangay[]> {
  const key = `${province}|${city}`;
  const cached = barangayCache.get(key);
  if (cached) return cached;

  const url = `/api/v1/storefront/psgc/barangays?province=${encodeURIComponent(
    province,
  )}&city=${encodeURIComponent(city)}`;
  // Bounded so a hung request cannot leave the select on "Loading…" forever
  // (final-review finding 5); the caller's error path offers free-text retry.
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error("Could not load barangays.");

  const data = (await res.json()) as { city: string; barangays: PsgcBarangay[] };
  barangayCache.set(key, data.barangays);
  return data.barangays;
}

export interface NominatimAddress {
  province?: string;
  city?: string;
  barangay?: string;
}

/**
 * Nominatim reverse geocode (client-side, no key). Confidence-fill only
 * (spec §3.4): province/city resolve from address levels Nominatim returns,
 * barangay best-effort. Throws on network/HTTP failure so the caller can
 * show the inline hint — never blocks ordering (spec §2, §5.3).
 */
export async function reverseGeocode(lat: number, lon: number): Promise<NominatimAddress> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`,
    { headers: { "Accept-Language": "en" }, signal: AbortSignal.timeout(10_000) },
  );
  if (!res.ok) throw new Error("reverse geocode failed");
  const data = (await res.json()) as {
    address?: {
      province?: string;
      state?: string;
      region?: string;
      city?: string;
      municipality?: string;
      town?: string;
      suburb?: string;
      neighbourhood?: string;
    };
  };
  const a = data.address ?? {};
  return {
    province: a.province ?? a.state ?? a.region,
    city: a.city ?? a.municipality ?? a.town,
    barangay: a.suburb ?? a.neighbourhood,
  };
}

/**
 * PSGC-name matcher: trim/lowercase/collapse-spaces, accent-stripped (NFD) so
 * Nominatim's "Las Piñas" / "Las Pinas" agree with the snapshot.
 *
 * Matching is EXACT (never substring) at three levels, in order:
 *   1. the full snapshot name,
 *   2. the snapshot name's BASE — the text before a parenthetical alias, and
 *   3. the input with a trailing "City" removed.
 *
 * Passes 2 and 3 exist because OSM reports statutory names the snapshot spells
 * differently: OSM says "Samar" where the snapshot says "Samar (Western
 * Samar)", and "Quezon City" / "Cebu City" / "Davao City" where the snapshot
 * says "Quezon" / "Cebu" / "Davao". Both passes are deterministic — verified
 * against the snapshot: exactly one province and three municipalities carry a
 * parenthetical, only one entry ends in "City", and no base/suffix-stripped
 * name collides with a sibling in the same scope.
 *
 * A substring/fuzzy pass was tried and REMOVED (final-review finding 1): it
 * mis-bound shorter inputs to the wrong sibling — "Samar" resolved to the first
 * alphabetical hit "Eastern Samar", silently writing the WRONG province into a
 * required field. When nothing matches exactly we return undefined so the
 * caller leaves the field blank and prompts, per spec §3.4 ("置信匹配").
 */
export function matchPsgcName(candidates: string[], raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const norm = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "");
  const base = (s: string) => {
    const m = s.match(/^(.*?) \(/);
    return m ? m[1] : s;
  };
  const n = norm(raw);
  if (!n) return undefined;
  const exact = candidates.find((c) => norm(c) === n);
  if (exact !== undefined) return exact;
  const baseHit = candidates.find((c) => norm(base(c)) === n);
  if (baseHit !== undefined) return baseHit;
  const withoutCity = n.replace(/ city$/, "");
  if (withoutCity === n || !withoutCity) return undefined;
  return candidates.find((c) => norm(base(c)) === withoutCity);
}
