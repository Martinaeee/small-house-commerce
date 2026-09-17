import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';

/**
 * Static PSGC data module — no DB, no migrations (spec §2 / ruling E-1).
 *
 * barangays.json has no province field, its `citymun` values do not match
 * municipalities.json `name` values for many cities ("Quezon" vs
 * "Quezon City", "Makati" vs "City Of Makati", Manila barangays filed under
 * 14 district names), and some citymun strings are shared ACROSS provinces
 * ("City Of San Fernando Capital" merges Pampanga and La Union rows; plain
 * "San Fernando" merges five more provinces). At load we therefore build a
 * deterministic province-scoped resolution map using only the two static
 * snapshots plus the PSGC code prefix embedded in every barangay code:
 *
 *   9-digit PSGC barangay code = region(2) + province(2) + municipality(2..3)
 *   + barangay(3). The first 4 digits identify the province (NCR splits into
 *   four statistical province-level groups 1339/1374/1375/1376).
 */

interface RawBarangay {
  // Upstream psgc@2.2.0 encodes 12,521 of 42,036 codes as JSON numbers
  // (leading-zero codes are strings). Mirrored as-is and padded for prefix
  // logic; emitted as String(code) per ruling E-1.
  code: string | number;
  name: string;
  citymun: string;
}

interface RawMunicipality {
  name: string;
  province: string;
  city: boolean;
}

interface RawProvince {
  name: string;
  region: string;
}

export interface PsgcBarangayResult {
  code: string;
  name: string;
}

/** PSGC region labels in provinces.json -> 2-digit region code prefix. */
const REGION_CODES: Record<string, string> = {
  'Region I': '01',
  'Region II': '02',
  'Region III': '03',
  'Region IV-A': '04',
  MIMAROPA: '17',
  'Region V': '05',
  'Region VI': '06',
  'Region VII': '07',
  'Region VIII': '08',
  'Region IX': '09',
  'Region X': '10',
  'Region XI': '11',
  'Region XII': '12',
  NCR: '13',
  CAR: '14',
  BARMM: '15',
  'Region XIII': '16',
};

const MANILA_PROVINCE_NORM = 'metromanila';
const MANILA_CITY_NORM = 'manila';
/** PSGC province-level code for the City of Manila; its barangays are district-filed. */
const MANILA_CODE_PREFIX = '1339';
const DISTRICT_FILED = Symbol('district-filed');

interface Resolution {
  /** Normalized province name -> its PSGC code prefixes (4-digit). */
  provincePrefixes: Map<string, Set<string>>;
  /** Normalized "province|city" -> exact citymun string, or the Manila marker. */
  citymunByKey: Map<string, string | typeof DISTRICT_FILED>;
}

let barangays: RawBarangay[] | null = null;
let resolution: Resolution | null = null;
let loadError: string | null = null;

/**
 * NFD-strip diacritics, lowercase, drop everything non-alphanumeric
 * ("Las Piñas" -> "laspinas"), then repeatedly peel a trailing "city"/"of"
 * ("Quezon City" -> "quezoncity" -> "quezon").
 */
export function normalizeName(value: string): string {
  let s = value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
  let prev: string;
  do {
    prev = s;
    s = s.replace(/(city|of)$/, '');
  } while (s !== prev);
  return s;
}

function padCode(code: string | number): string {
  return String(code).padStart(9, '0');
}

function loadJson<T>(relativePath: string): T {
  const url = new URL(relativePath, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as T;
}

/**
 * Province -> PSGC province-prefix(es). Every prefix is scored against every
 * province IN THE PROVINCE'S REGION (region comes from provinces.json) by how
 * many of the province's municipality names match citymun values in that
 * prefix group; a prefix is linked when it is the province's strongest match
 * or at least 30% of it with >=2 municipalities. Region scoping is what keeps
 * nationally shared names ("Santa Cruz", "San Fernando") from leaking foreign
 * prefixes. Metro Manila legitimately owns four prefixes; Manila's 1339
 * contains zero matching citymun names and is injected explicitly.
 */
function linkProvincePrefixes(
  municipalities: RawMunicipality[],
  provinces: RawProvince[],
  prefixCitymunRows: Map<string, Map<string, number>>,
  citymunNorm: Map<string, string>,
): Map<string, Set<string>> {
  const regionByRawName = new Map(provinces.map((p) => [p.name, REGION_CODES[p.region]]));
  const municipalityNormsByProvince = new Map<string, string[]>();
  for (const m of municipalities) {
    const list = municipalityNormsByProvince.get(m.province) ?? [];
    list.push(normalizeName(m.name));
    municipalityNormsByProvince.set(m.province, list);
  }

  const result = new Map<string, Set<string>>();
  for (const [rawProvince, cityNorms] of municipalityNormsByProvince) {
    const np = normalizeName(rawProvince);
    const region = regionByRawName.get(rawProvince);
    const linked = new Set<string>();
    if (region) {
      const scored: { prefix: string; rows: number; hits: number }[] = [];
      for (const [prefix, citymunRows] of prefixCitymunRows) {
        if (!prefix.startsWith(region)) continue;
        let rows = 0;
        const hits = new Set<string>();
        for (const nc of cityNorms) {
          for (const [citymun, count] of citymunRows) {
            const n = citymunNorm.get(citymun) ?? normalizeName(citymun);
            if (n === nc || n.includes(nc)) {
              rows += count;
              hits.add(nc);
            }
          }
        }
        if (rows > 0) scored.push({ prefix, rows, hits: hits.size });
      }
      scored.sort((a, b) => b.rows - a.rows);
      if (scored.length > 0) {
        const top = scored[0].rows;
        for (const s of scored) {
          if (s.rows >= top * 0.3 && s.hits >= 2) linked.add(s.prefix);
        }
      }
    }
    if (np === MANILA_PROVINCE_NORM) linked.add(MANILA_CODE_PREFIX);
    result.set(np, linked);
  }
  return result;
}

/**
 * Resolve each municipality to its barangays-side citymun string. Candidates
 * must contain barangays under one of the province's own code prefixes and are
 * ranked: normalized equality > startsWith > endsWith > contains, shortest raw
 * citymun as tie-break. The boundary ordering prevents "Bogo" (City Of Bogo)
 * from resolving to "Tabogon" (which merely contains "bogo") and "Roxas"
 * (Roxas City) from resolving to "President Roxas".
 */
function buildResolution(
  barangaysRaw: RawBarangay[],
  municipalities: RawMunicipality[],
  provinces: RawProvince[],
): Resolution {
  const distinctCitymuns = [...new Set(barangaysRaw.map((b) => b.citymun))];
  const citymunNorm = new Map(distinctCitymuns.map((c) => [c, normalizeName(c)]));

  const prefixCitymunRows = new Map<string, Map<string, number>>();
  const citymunPrefixes = new Map<string, Set<string>>();
  for (const b of barangaysRaw) {
    const prefix = padCode(b.code).slice(0, 4);
    let byCitymun = prefixCitymunRows.get(prefix);
    if (!byCitymun) prefixCitymunRows.set(prefix, (byCitymun = new Map()));
    byCitymun.set(b.citymun, (byCitymun.get(b.citymun) ?? 0) + 1);
    let prefixes = citymunPrefixes.get(b.citymun);
    if (!prefixes) citymunPrefixes.set(b.citymun, (prefixes = new Set()));
    prefixes.add(prefix);
  }

  const provincePrefixes = linkProvincePrefixes(
    municipalities,
    provinces,
    prefixCitymunRows,
    citymunNorm,
  );

  const citymunByKey = new Map<string, string | typeof DISTRICT_FILED>();
  for (const m of municipalities) {
    const np = normalizeName(m.province);
    const nc = normalizeName(m.name);
    const key = `${np}|${nc}`;
    if (np === MANILA_PROVINCE_NORM && nc === MANILA_CITY_NORM) {
      citymunByKey.set(key, DISTRICT_FILED);
      continue;
    }
    const ownedPrefixes = provincePrefixes.get(np);
    if (!ownedPrefixes || ownedPrefixes.size === 0) continue;
    const rank = (n: string): number => {
      if (n === nc) return 0;
      if (n.startsWith(nc)) return 1;
      if (n.endsWith(nc)) return 2;
      if (n.includes(nc)) return 3;
      return 4;
    };
    let best: string | null = null;
    let bestRank = 4;
    for (const c of distinctCitymuns) {
      const prefixes = citymunPrefixes.get(c);
      if (!prefixes || [...prefixes].every((p) => !ownedPrefixes.has(p))) continue;
      const r = rank(citymunNorm.get(c) ?? normalizeName(c));
      if (r < bestRank || (r === bestRank && best !== null && c.length < best.length)) {
        best = c;
        bestRank = r;
      }
    }
    if (best) citymunByKey.set(key, best);
  }

  return { provincePrefixes, citymunByKey };
}

try {
  barangays = loadJson<RawBarangay[]>('../../assets/psgc-barangays.json');
  const municipalities = loadJson<RawMunicipality[]>('../../assets/psgc-municipalities.json');
  const provinces = loadJson<RawProvince[]>('../../assets/psgc-provinces.json');
  resolution = buildResolution(barangays, municipalities, provinces);
} catch (error) {
  loadError = error instanceof Error ? error.message : String(error);
  new Logger('PsgcService').error(
    `Failed to load PSGC assets (src/assets/*.json must be copied into dist/assets by nest build): ${loadError}`,
  );
}

@Injectable()
export class PsgcService {
  private readonly logger = new Logger(PsgcService.name);

  /**
   * Province-scoped barangay lookup (ruling E-1). Trim + normalized exact
   * match against municipalities.json; the load-time map resolves the
   * barangays-side citymun; Manila is served from its PSGC-1339 district
   * rows. Unknown province/city -> 200 with [] (never 404).
   */
  findBarangays(
    province: string,
    city: string,
  ): { city: string; barangays: PsgcBarangayResult[] } {
    if (!barangays || !resolution) {
      this.logger.error(
        `PSGC barangay request failed because the dataset did not load: ${loadError ?? 'unknown error'}`,
      );
      throw new InternalServerErrorException('Barangay data is temporarily unavailable.');
    }

    const trimmedCity = city.trim();
    const np = normalizeName(province.trim());
    const nc = normalizeName(trimmedCity);
    const resolved = resolution.citymunByKey.get(`${np}|${nc}`);

    if (resolved === undefined) {
      return { city: trimmedCity, barangays: [] };
    }

    const ownedPrefixes = resolution.provincePrefixes.get(np) ?? new Set<string>();
    let rows: RawBarangay[];
    if (resolved === DISTRICT_FILED) {
      rows = barangays.filter((b) => padCode(b.code).startsWith(MANILA_CODE_PREFIX));
    } else {
      rows = barangays.filter(
        (b) => b.citymun === resolved && ownedPrefixes.has(padCode(b.code).slice(0, 4)),
      );
    }

    return {
      city: trimmedCity,
      barangays: rows.map((b) => ({ code: String(b.code), name: b.name })),
    };
  }
}
