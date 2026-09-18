#!/usr/bin/env node
/**
 * Generates `src/data/psgc/postal-codes.json` — Philippine ZIP codes keyed by
 * the exact PSGC province/city names the checkout selects.
 *
 * Upstream: use-postal-ph — https://github.com/blckclov3r/use-postal-ph
 *           MIT License, Copyright (c) 2024 blckclov3r (see LICENSE-postal-codes)
 *           2049 rows shaped { location, municipality, post_code, region }.
 *
 * Reality of PH ZIP codes this script encodes:
 *  - Outside Metro Manila a municipality/city has exactly ONE ZIP.
 *  - Inside Metro Manila the ZIP varies by area/barangay (the upstream
 *    `municipality` field holds the area there), so those cities keep a list.
 *
 * Rows that cannot be matched to a PSGC name are SKIPPED — a missing ZIP just
 * means "no auto-fill", which is safe, whereas a guessed ZIP delays deliveries.
 *
 * Usage (GitHub raw needs the local proxy on this machine):
 *   node scripts/build-postal-codes.mjs [path-or-url-to-placeDataArray.ts]
 * Default input: /tmp/use-postal-ph/src/logic/placeDataArray.ts
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FE_ROOT = resolve(HERE, "..");
const OUT = resolve(FE_ROOT, "src/data/psgc/postal-codes.json");
const PSGC_DIR = resolve(FE_ROOT, "src/data/psgc");
const DEFAULT_SRC = "/tmp/use-postal-ph/src/logic/placeDataArray.ts";

/** Must stay byte-identical to the copy in src/lib/postalCodes.ts. */
export function normKey(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\(.*?\)/g, " ")
    .replace(/\bsta\.?\b/g, "santa")
    .replace(/\bsto\.?\b/g, "santo")
    .replace(/\bgen\.?\b/g, "general")
    .replace(/\binc\.?\b/g, " ")
    .replace(
      /\b(city|province|municipality|capital|village|subd|subdivision|proper|the|of)\b/g,
      " ",
    )
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

/** PSGC province name -> upstream `location` when they differ beyond normalization. */
const PROVINCE_ALIASES = {
  cotabato: "north cotabato",
  "davao de oro": "davao de oro",
  "maguindanao del norte": null, // upstream predates the 2022 split — skip
  "maguindanao del sur": null,
};

function readArray(file) {
  const text = readFileSync(file, "utf8");
  const start = text.indexOf("= [") + 2;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) {
        return JSON.parse(text.slice(start, i + 1).replace(/,(\s*[\]}])/g, "$1"));
      }
    }
  }
  throw new Error("could not locate the data array");
}

const srcPath = process.argv[2] ?? DEFAULT_SRC;
const rows = readArray(srcPath).filter((r) => r.location !== "Companies/Institutions");
const munis = JSON.parse(readFileSync(resolve(PSGC_DIR, "municipalities.json"), "utf8"));

// index upstream. NCR and provincial rows MUST stay in separate indexes:
// upstream names the NCR city in `location` and the province there otherwise,
// so "Quezon City" and "Quezon Province" both normalize to "quezon" and would
// otherwise merge QC with the province's municipalities.
const byProvCity = new Map(); // "<provNorm>|<cityNorm>" -> zip            (non-NCR)
const byArea = new Map(); // "<cityNorm>" -> [{ label, key, zip }]         (NCR only)
for (const r of rows) {
  const zip = String(r.post_code);
  if (String(r.region ?? "").toUpperCase() === "NCR") {
    const cityNorm = normKey(r.location);
    if (!byArea.has(cityNorm)) byArea.set(cityNorm, []);
    byArea.get(cityNorm).push({ label: r.municipality, key: normKey(r.municipality), zip });
  } else {
    const k = `${normKey(r.location)}|${normKey(r.municipality)}`;
    if (!byProvCity.has(k)) byProvCity.set(k, zip);
  }
}

const cities = {};
let matched = 0;
const missed = [];

for (const m of munis) {
  const prov = m.province;
  const provNorm = normKey(prov);
  const cityNorm = normKey(m.name);

  if (prov === "Metro Manila") {
    // Upstream keys NCR by the city itself in `location`.
    const areas = byArea.get(cityNorm) ?? [];
    if (areas.length === 0) {
      missed.push(`${prov}/${m.name}`);
      continue;
    }
    const seen = new Set();
    const list = [];
    for (const a of areas) {
      const dedup = `${a.key}|${a.zip}`;
      if (seen.has(dedup)) continue;
      seen.add(dedup);
      list.push([a.label, a.key, a.zip]);
    }
    cities[`${prov}|${m.name}`] = list;
    matched++;
    continue;
  }

  const aliasTarget = PROVINCE_ALIASES[prov.toLowerCase()];
  if (aliasTarget === null) {
    missed.push(`${prov}/${m.name} (skipped by alias)`);
    continue;
  }
  const provVariants = new Set([provNorm]);
  if (aliasTarget) provVariants.add(normKey(aliasTarget));

  let zip = null;
  for (const pv of provVariants) {
    const hit = byProvCity.get(`${pv}|${cityNorm}`);
    if (hit) {
      zip = hit;
      break;
    }
  }
  if (!zip) {
    missed.push(`${prov}/${m.name}`);
    continue;
  }
  cities[`${prov}|${m.name}`] = [["", "", zip]];
  matched++;
}

const out = {
  source:
    "use-postal-ph (https://github.com/blckclov3r/use-postal-ph) — MIT, Copyright (c) 2024 blckclov3r",
  note: "Keys are '<PSGC province>|<PSGC city/municipality>'. Value is [label, normalizedKey, zip] triples: Metro Manila cities carry one entry per area/barangay; everywhere else there is exactly one entry with an empty label.",
  cities,
};
writeFileSync(OUT, `${JSON.stringify(out)}\n`);

const pct = ((matched / munis.length) * 100).toFixed(1);
console.log(`PSGC cities: ${munis.length} | matched: ${matched} (${pct}%) | skipped: ${missed.length}`);
console.log(`wrote ${OUT}`);
const bytes = readFileSync(OUT).length;
console.log(`output size: ${(bytes / 1024).toFixed(1)} KB`);
console.log("first skipped:", missed.slice(0, 30).join(" ; "));
