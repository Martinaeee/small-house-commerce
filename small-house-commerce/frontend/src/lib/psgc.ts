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

/** Distinct PSGC province names, alphabetical (85 entries incl. Metro Manila). */
export function listProvinces(): string[] {
  return Array.from(new Set(provinces.map((p) => p.name))).sort((a, b) =>
    a.localeCompare(b),
  );
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
  const res = await fetch(url);
  if (!res.ok) throw new Error("Could not load barangays.");

  const data = (await res.json()) as { city: string; barangays: PsgcBarangay[] };
  barangayCache.set(key, data.barangays);
  return data.barangays;
}
