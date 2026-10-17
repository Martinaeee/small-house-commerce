export type PackagingParseMode = "dimensions" | "weight" | "combined";

export interface PackagingParseResult {
  fields: Partial<{
    packageWidth: number;
    packageHeight: number;
    packageDepth: number;
    packageWeight: number;
  }>;
  warnings: string[];
  assumptions: string[];
  complete: boolean;
}

type PackageField = keyof PackagingParseResult["fields"];
type Candidate = { field: PackageField; raw: string; unit?: string };

export interface PackagingAxisConvention {
  triplet: readonly [PackageField, PackageField, PackageField];
  labels: Record<string, PackageField>;
  compactLabels?: boolean;
}

// Admin LWH maps to stored Width/Depth/Height without rewriting saved values.
export const PACKAGING_AXES: PackagingAxisConvention = {
  triplet: ["packageWidth", "packageDepth", "packageHeight"],
  labels: {
    length: "packageWidth", l: "packageWidth",
    width: "packageDepth", w: "packageDepth",
    depth: "packageDepth", d: "packageDepth",
    height: "packageHeight", h: "packageHeight",
  },
};

export const PRODUCT_SIZE_AXES: PackagingAxisConvention = {
  ...PACKAGING_AXES,
  compactLabels: true,
  labels: { ...PACKAGING_AXES.labels, 长: "packageWidth", 宽: "packageDepth", 高: "packageHeight" },
};

const NUMBER = "(?:[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[-+]?\\d+)?|[-+]?Infinity|NaN)";
const LABEL = "width|height|depth|length|weight|wt|w|h|d|l";
const UNIT = `(?!(?:x|by)\\b)(?!(?:${LABEL})\\b\\s*[:=]?\\s*${NUMBER})[a-z]+`;
const TOKEN = `(${NUMBER})(?![\\d.])\\s*(${UNIT})?`;
const BOUNDARY = "(?<![\\w.+-])";
const DIMENSION_FIELDS = ["packageWidth", "packageHeight", "packageDepth"] as const;
const LENGTH_FACTORS: Record<string, number> = { mm: 0.1, cm: 1, m: 100, in: 2.54, ft: 30.48 };
const WEIGHT_FACTORS: Record<string, number> = { g: 0.001, kg: 1, lb: 0.45359237, oz: 0.028349523125 };

function shareDimensionUnit(candidates: Candidate[]): void {
  const units = [...new Set(candidates.flatMap(({ unit }) => unit ? [unit] : []))];
  if (units.length === 1) {
    for (const candidate of candidates) candidate.unit ??= units[0];
  }
}

export function parsePackagingText(
  input: string,
  mode: PackagingParseMode,
  axes: PackagingAxisConvention = PACKAGING_AXES,
): PackagingParseResult {
  const fields: PackagingParseResult["fields"] = {};
  const warnings: string[] = [];
  const assumptions = new Set<string>();
  const candidates: Candidate[] = [];
  if (input.length > 10_000) {
    return { fields, warnings: ["Paste at most 10,000 characters."], assumptions: [], complete: false };
  }
  const source = input.trim();

  if (/\d,\d/.test(source)) {
    return { fields, warnings: ["Comma-formatted numbers are ambiguous; use digits and a decimal point."], assumptions: [], complete: false };
  }
  const hasNetWeight = /\bnet\b|\bnw\b|净重|淨重/i.test(source);
  const hasVolumetricWeight = /\b(?:volumetric|dimensional)\s*(?:weight|wt)\b|体积重|體積重/i.test(source);
  if (mode !== "dimensions" && hasNetWeight) warnings.push("Net weight is not packaging gross weight; enter gross weight separately.");
  if (mode !== "dimensions" && hasVolumetricWeight) warnings.push("Volumetric weight is not physical package weight; enter gross weight separately.");

  if (mode !== "weight") {
    const labelled: Candidate[] = [];
    const axisWords = Object.keys(axes.labels).sort((a, b) => b.length - a.length).join("|");
    const labelExpression = axes.compactLabels
      ? new RegExp(`(?<![\\p{L}_])(${axisWords})(?![\\p{L}_])\\s*[:：=]?\\s*(${NUMBER})(?![\\d.])\\s*((?!(?:${axisWords})\\s*[:：=]?\\s*${NUMBER})[a-z]+)?`, "giu")
      : new RegExp(`\\b(${axisWords})\\b\\s*[:=]?\\s*${TOKEN}`, "gi");
    for (const match of source.matchAll(labelExpression)) {
      labelled.push({ field: axes.labels[match[1].toLowerCase()], raw: match[2], unit: match[3]?.toLowerCase() });
    }
    shareDimensionUnit(labelled);
    candidates.push(...labelled);

    const tripletExpression = new RegExp(`${BOUNDARY}${TOKEN}\\s*(?:x|×|\\*|by)\\s*${TOKEN}\\s*(?:x|×|\\*|by)\\s*${TOKEN}`, "gi");
    for (const match of source.matchAll(tripletExpression)) {
      const tail = source.slice((match.index ?? 0) + match[0].length);
      if (/^\s*(?:x|×|\*|by)\s*[-+\d.]/i.test(tail)) {
        warnings.push("A dimension triplet must contain exactly three values.");
        continue;
      }
      const triplet = axes.triplet.map((field, i) => ({ field, raw: match[1 + i * 2], unit: match[2 + i * 2]?.toLowerCase() }));
      shareDimensionUnit(triplet);
      if (triplet.some(({ unit }) => unit && LENGTH_FACTORS[unit] === undefined)) {
        warnings.push("The dimension triplet contains an unsupported unit.");
        continue;
      }
      candidates.push(...triplet);
    }
  }

  if (mode !== "dimensions" && !hasNetWeight && !hasVolumetricWeight) {
    const labelledExpression = new RegExp(`\\b(?:weight|wt)\\b\\s*[:=]?\\s*${TOKEN}`, "gi");
    const unlabelledSource = source.replace(labelledExpression, (_text, raw: string, unit?: string) => {
      candidates.push({ field: "packageWeight", raw, unit: unit?.toLowerCase() });
      return " ";
    });
    const weightExpression = new RegExp(`${BOUNDARY}(${NUMBER})(?![\\d.])\\s*(kg|g|lb|oz)\\b`, "gi");
    for (const match of unlabelledSource.matchAll(weightExpression)) {
      candidates.push({ field: "packageWeight", raw: match[1], unit: match[2].toLowerCase() });
    }
    if (mode === "weight" && candidates.length === 0) {
      const bare = new RegExp(`^${TOKEN}$`, "i").exec(source);
      if (bare) candidates.push({ field: "packageWeight", raw: bare[1], unit: bare[2]?.toLowerCase() });
    }
  }

  const grouped = new Map<PackageField, Candidate[]>();
  for (const candidate of candidates) {
    const group = grouped.get(candidate.field) ?? [];
    group.push(candidate);
    grouped.set(candidate.field, group);
  }
  for (const [field, group] of grouped) {
    if (group.length !== 1) {
      warnings.push(`${field} appears more than once; enter one unambiguous value.`);
      continue;
    }
    const { raw, unit } = group[0];
    const isWeight = field === "packageWeight";
    const defaultUnit = isWeight ? "kg" : "cm";
    const factor = (isWeight ? WEIGHT_FACTORS : LENGTH_FACTORS)[unit ?? defaultUnit];
    const normalized = Number(raw) * factor;
    if (factor === undefined || !Number.isFinite(normalized) || normalized <= 0) {
      warnings.push(`${field} needs a positive finite value and a supported unit.`);
      continue;
    }
    fields[field] = normalized;
    if (!unit) assumptions.add(`Assumed ${defaultUnit} for a value without a unit.`);
  }

  const hasDimensions = DIMENSION_FIELDS.every((field) => fields[field] !== undefined);
  const hasWeight = fields.packageWeight !== undefined;
  const complete = mode === "dimensions" ? hasDimensions : mode === "weight" ? hasWeight : hasDimensions && hasWeight;
  return { fields, warnings, assumptions: [...assumptions], complete };
}
