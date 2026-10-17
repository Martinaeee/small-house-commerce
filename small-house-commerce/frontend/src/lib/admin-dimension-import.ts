import type { ProductFormValue } from "@/components/admin/ProductForm";
import { parsePackagingText, PRODUCT_SIZE_AXES, type PackagingAxisConvention } from "./parse-packaging-input";
import { PRODUCT_DIMENSION_FIELDS, applyAdminPhysicalSpecificationPatch, deriveAdminPhysicalSpecificationGroups } from "./admin-physical-specs";
import { entityRowKey } from "./admin-product-graph";

export type DimensionOrder = "" | "LWH" | "LHW" | "WLH" | "WHL" | "HLW" | "HWL";
export type DimensionUnit = "" | "cm" | "mm" | "m" | "in" | "ft";
export type DimensionColumn = "ignore" | "sku" | "variant" | "dimensions" | "length" | "width" | "height" | "unit" | `option:${string}`;
export type DimensionPatch = Partial<Record<typeof PRODUCT_DIMENSION_FIELDS[number], number | null>>;
export type DimensionValues = Record<typeof PRODUCT_DIMENSION_FIELDS[number], number | null>;
export type DimensionIssue = "dimension_issue_values" | "dimension_issue_order" | "dimension_issue_unit" | "dimension_issue_target" | "dimension_issue_match" | "dimension_issue_unavailable" | "dimension_issue_duplicate" | "dimension_issue_group" | "dimension_issue_columns" | "dimension_issue_stale" | "dimension_issue_size";
export interface DimensionConfig {
  order: DimensionOrder;
  unit: DimensionUnit;
  columns?: DimensionColumn[];
  hasHeader?: boolean;
  targetKeys?: string[];
  target?: "expanded" | "folded";
}
export interface DimensionMember { key: string; skuCode: string; name: string; values: DimensionValues }
export interface DimensionTarget {
  key: string;
  label: string;
  members: DimensionMember[];
  values: DimensionValues;
  mixed: (typeof PRODUCT_DIMENSION_FIELDS[number])[];
  editable: boolean;
  bundle: boolean;
}
export interface DimensionImportRow {
  id: string;
  line: number;
  identifier: string;
  original: string;
  raw: string;
  targetKey: string | null;
  memberKey: string | null;
  dimensions: DimensionValues | null;
  inputUnit: string;
  issue: DimensionIssue | null;
}
export interface DimensionImportPlan { fingerprint: string; rows: DimensionImportRow[] }

const NUMBER = "[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[-+]?\\d+)?|[-+]?Infinity|NaN";
const NUMBER_UNIT = `(${NUMBER})\\s*(mm|cm|m|in|ft)?`;
const AXES = { L: "packageWidth", W: "packageDepth", H: "packageHeight" } as const;
const valuesOf = (sku: DimensionPatch): DimensionValues => ({ productWidth: sku.productWidth ?? null, productDepth: sku.productDepth ?? null, productHeight: sku.productHeight ?? null });
const legacyNumber = (value: string) => value.trim() === "" ? null : Number(value);

export function parseProductDimensionInput(raw: string, config: DimensionConfig): {
  dimensions: DimensionValues | null; issue: DimensionIssue | null; inputUnit: string;
} {
  const fail = (issue: DimensionIssue) => ({ dimensions: null, issue, inputUnit: "" });
  if (raw.length > 10_000) return fail("dimension_issue_size");
  if (/包装|包裝|package|carton/i.test(raw) ||
    (/折叠|折疊|folded/i.test(raw) && config.target !== "folded") ||
    (/展开|展開|assembled/i.test(raw) && config.target === "folded")) return fail("dimension_issue_target");
  raw = raw.replace(/(?:折叠|折疊|展开|展開|商品|产品|產品|使用)(?:尺寸)?|\b(?:assembled|folded|product)\s*(?:dimensions?|size)?\b/gi, " ");
  raw = raw.replace(new RegExp(`\\b(?:weight|wt)\\s*[:=]?\\s*(?:${NUMBER})\\s*(?:kg|g|lb|oz)\\b`, "gi"), " ");
  const tokens = [...raw.matchAll(new RegExp(NUMBER_UNIT, "gi"))];
  if (tokens.length !== 3 || /\d,\d/.test(raw)) return fail("dimension_issue_values");
  const residue = raw.replace(new RegExp(NUMBER_UNIT, "gi"), " ")
    .replace(/length|width|height|depth|长|宽|高|\b(?:l|w|h|d|by)\b/gi, "")
    .replace(/[\s×x*,:;，；=：]/gi, "");
  if (residue !== "") return fail("dimension_issue_values");
  const labelled = /(?:长|宽|高|\b(?:length|width|height|depth|l|w|h|d))\s*[:：=]?\s*[-+\d.]/i.test(raw);
  if (!labelled && !config.order) return fail("dimension_issue_order");
  const units = [...new Set(tokens.flatMap(token => token[2] ? [token[2].toLowerCase()] : []))];
  if ((!units.length || (units.length > 1 && tokens.some(token => !token[2]))) && !config.unit) return fail("dimension_issue_unit");
  const sharedUnit = units.length === 1 ? units[0] : config.unit;
  let source = raw.replace(new RegExp(NUMBER_UNIT, "gi"), (_match, number: string, unit?: string) => `${number}${unit || sharedUnit} `);
  if (!labelled && !/[×x*]|\bby\b/i.test(source)) source = source.trim().split(/\s+/).join("×");
  const convention: PackagingAxisConvention = config.order
    ? { ...PRODUCT_SIZE_AXES, triplet: [AXES[config.order[0] as keyof typeof AXES], AXES[config.order[1] as keyof typeof AXES], AXES[config.order[2] as keyof typeof AXES]] }
    : PRODUCT_SIZE_AXES;
  const result = parsePackagingText(source, "dimensions", convention);
  if (!result.complete || result.warnings.length > 0 || result.assumptions.length > 0) return fail("dimension_issue_values");
  return {
    dimensions: { productWidth: result.fields.packageWidth!, productDepth: result.fields.packageDepth!, productHeight: result.fields.packageHeight! },
    issue: null, inputUnit: units.length ? units.join(" / ") : config.unit,
  };
}

export function buildProductDimensionTargets(form: ProductFormValue): DimensionTarget[] {
  const targets: DimensionTarget[] = [];
  const represented = new Set<string>();
  if (form.graphTyped && form.graph) {
    for (const group of deriveAdminPhysicalSpecificationGroups(form.graph)) {
      const members = form.graph.variants.filter(row => group.memberVariantKeys.includes(entityRowKey(row))).map(row => ({
        key: entityRowKey(row), skuCode: row.sku!.skuCode, name: row.name, values: valuesOf(row.sku!),
      }));
      members.forEach(row => represented.add(row.key));
      targets.push({ key: group.key, label: group.label || members.map(row => row.name).join(" / "), members,
        values: valuesOf(group.uniform), mixed: PRODUCT_DIMENSION_FIELDS.filter(field => group.conflicts.includes(field)),
        editable: !group.isBundle, bundle: group.isBundle });
    }
    for (const row of form.graph.variants.filter(row => !represented.has(entityRowKey(row)))) {
      const values = valuesOf(row.sku ?? {});
      targets.push({ key: `unavailable:${entityRowKey(row)}`, label: row.name, members: [{ key: entityRowKey(row), skuCode: row.sku?.skuCode ?? "", name: row.name, values }], values, mixed: [], editable: false, bundle: row.sku?.isBundle ?? false });
    }
  } else {
    const locked = (form.graph?.catalogGraphVersion ?? 0) > 0;
    for (const [index, row] of form.variants.entries()) {
      const key = `legacy:${row.id ?? row.clientKey ?? index}`;
      const values = valuesOf(row.sku ? { productWidth: legacyNumber(row.sku.productWidth), productDepth: legacyNumber(row.sku.productDepth), productHeight: legacyNumber(row.sku.productHeight) } : {});
      targets.push({ key, label: row.name, members: [{ key, skuCode: row.sku?.skuCode ?? "", name: row.name, values }], values, mixed: [],
        editable: !locked && row.sku !== null && row.sku.status === "ACTIVE" && !row.sku.isBundle, bundle: row.sku?.isBundle ?? false });
    }
  }
  return targets;
}

export function dimensionTargetSource(target: DimensionTarget, form: ProductFormValue): "pending" | "inherited" | "independent" | "partial" {
  const defaults = { productWidth: legacyNumber(form.width), productDepth: legacyNumber(form.depth), productHeight: legacyNumber(form.height) };
  if (target.mixed.length || PRODUCT_DIMENSION_FIELDS.some(field => {
    const value = target.values[field] ?? defaults[field];
    return value === null || !Number.isFinite(value);
  })) return "pending";
  const overrides = PRODUCT_DIMENSION_FIELDS.filter(field => target.values[field] !== null).length;
  return overrides === 0 ? "inherited" : overrides === 3 ? "independent" : "partial";
}

export function dimensionDraftFingerprint(form: ProductFormValue): string {
  return JSON.stringify([form.graphTyped, form.width, form.depth, form.height, buildProductDimensionTargets(form)]);
}

export function applyProductDimensionPatch(form: ProductFormValue, keys: string[], patch: DimensionPatch): ProductFormValue {
  const targets = buildProductDimensionTargets(form);
  if (keys.length === 0 || keys.some(key => !targets.find(target => target.key === key)?.editable)) throw new Error("dimension_issue_unavailable");
  const fields = PRODUCT_DIMENSION_FIELDS.filter(field => Object.hasOwn(patch, field));
  if (fields.some(field => patch[field] !== null && (typeof patch[field] !== "number" || !Number.isFinite(patch[field]) || patch[field]! < 0))) throw new Error("dimension_issue_values");
  const safe = Object.fromEntries(fields.map(field => [field, patch[field]]));
  const next = structuredClone(form);
  if (next.graphTyped && next.graph) {
    for (const key of new Set(keys)) next.graph = applyAdminPhysicalSpecificationPatch(next.graph, key, safe);
  } else {
    next.variants.forEach((row, index) => {
      const key = `legacy:${row.id ?? row.clientKey ?? index}`;
      if (!keys.includes(key) || !row.sku) return;
      for (const field of fields) row.sku[field] = patch[field] === null ? "" : String(patch[field]);
    });
  }
  return next;
}

export function dimensionImportExceedsLimit(text: string): boolean {
  return text.length > 100_000 || text.split(/\r?\n/).some(line => line.split("\t").length > 20);
}

export function planProductDimensionImport(form: ProductFormValue, text: string, config: DimensionConfig): DimensionImportPlan {
  const targets = buildProductDimensionTargets(form);
  const rows: DimensionImportRow[] = [];
  const add = (line: number, original: string, raw: string, identifier: string, matches: { target: DimensionTarget; member: DimensionMember }[], columnIssue = false, unit = config.unit) => {
    const parsed = parseProductDimensionInput(raw, { ...config, unit, target: "expanded" });
    const match = matches.length === 1 ? matches[0] : null;
    const issue = columnIssue ? "dimension_issue_columns" : !match ? "dimension_issue_match" : !match.target.editable ? "dimension_issue_unavailable" : parsed.issue;
    rows.push({ id: `line-${line}`, line, original, raw, identifier, targetKey: match?.target.key ?? null, memberKey: match?.member.key ?? null, ...parsed, issue });
  };
  const lines = text.split(/\r?\n/);
  if (dimensionImportExceedsLimit(text) || lines.filter(line => line.trim() !== "").length - (config.hasHeader ? 1 : 0) > 100) {
    rows.push({ id: "oversize", line: 1, original: "", raw: "", identifier: "", targetKey: null, memberKey: null, dimensions: null, inputUnit: "", issue: "dimension_issue_size" });
  } else if (config.targetKeys) {
    config.targetKeys.forEach((key, index) => {
      const target = targets.find(row => row.key === key);
      add(index + 1, text, text, target?.label ?? key, target ? [{ target, member: target.members[0] }] : []);
    });
  } else {
    const columns = config.columns ?? ["sku", "dimensions"];
    const options = form.graphTyped && form.graph ? form.graph.options.filter(option => option.isActive) : [];
    const optionColumns = columns.filter(role => role.startsWith("option:"));
    const directIdentity = columns.filter(c => c === "sku" || c === "variant").length === 1 && optionColumns.length === 0;
    const optionIdentity = !columns.includes("sku") && !columns.includes("variant") && options.length > 0 && optionColumns.length === options.length &&
      options.every(option => optionColumns.filter(role => role === `option:${entityRowKey(option)}`).length === 1);
    const mappingValid = (directIdentity || optionIdentity) &&
      ((columns.filter(c => c === "dimensions").length === 1 && !columns.some(c => ["length", "width", "height"].includes(c))) ||
        (!columns.includes("dimensions") && ["length", "width", "height"].every(c => columns.filter(x => x === c).length === 1))) &&
      columns.filter(c => c === "unit").length <= 1;
    lines.forEach((original, index) => {
      if ((config.hasHeader && index === 0) || original.trim() === "") return;
      const cells = original.includes("\t") ? original.split("\t") : columns.length === 2 ? original.trim().split(/\s+(.+)/).filter(Boolean) : [original];
      const get = (role: DimensionColumn) => cells[columns.indexOf(role)]?.trim() ?? "";
      const identifier = columns.includes("sku") ? get("sku") : columns.includes("variant") ? get("variant") : optionColumns.map(role => get(role)).join(" / ");
      const matches = targets.flatMap(target => target.members.filter(member => {
        if (columns.includes("sku")) return member.skuCode === identifier;
        if (columns.includes("variant")) return member.name === identifier;
        const variant = form.graph?.variants.find(row => entityRowKey(row) === member.key);
        return optionIdentity && variant !== undefined && options.every(option => {
          const label = get(`option:${entityRowKey(option)}`);
          const matching = option.values.filter(value => value.isActive && value.label === label);
          return matching.length === 1 && variant.optionValueRefs.some(ref => entityRowKey(ref) === entityRowKey(matching[0]));
        });
      }).map(member => ({ target, member })));
      let unitConflict = false;
      const withHeaderUnit = (role: DimensionColumn) => {
        const cell = get(role);
        const header = config.hasHeader ? lines[0].split("\t")[columns.indexOf(role)] ?? "" : "";
        const headerUnit = /[(（]\s*([^）)]+?)\s*[)）]/.exec(header)?.[1].toLowerCase();
        if (!headerUnit) return cell;
        if (!/^(?:cm|mm|m|in|ft)$/.test(headerUnit)) { unitConflict = true; return cell; }
        const explicitUnits = [...cell.matchAll(/(?:\d|\.)\s*(mm|cm|m|in|ft)\b/gi)].map(match => match[1].toLowerCase());
        if (explicitUnits.some(unit => unit !== headerUnit)) unitConflict = true;
        return explicitUnits.length ? cell : `${cell}${headerUnit}`;
      };
      const raw = columns.includes("dimensions") ? withHeaderUnit("dimensions") : `长:${withHeaderUnit("length")} 宽:${withHeaderUnit("width")} 高:${withHeaderUnit("height")}`;
      const unit = get("unit");
      if (unit && [...raw.matchAll(/(?:\d|\.)\s*(mm|cm|m|in|ft)\b/gi)].some(match => match[1].toLowerCase() !== unit.toLowerCase())) unitConflict = true;
      add(index + 1, original, raw, identifier, matches, !mappingValid || cells.length !== columns.length || unitConflict || (columns.includes("unit") && !/^(?:cm|mm|m|in|ft)?$/i.test(unit)), (unit.toLowerCase() || config.unit) as DimensionUnit);
    });
  }
  for (const row of rows) {
    if (row.memberKey && rows.filter(other => other.memberKey === row.memberKey).length > 1) row.issue = "dimension_issue_duplicate";
  }
  for (const target of targets) {
    const peers = rows.filter(row => row.targetKey === target.key && row.dimensions !== null && row.issue === null);
    if (new Set(peers.map(row => JSON.stringify(row.dimensions))).size > 1) peers.forEach(row => { row.issue = "dimension_issue_group"; });
  }
  return { fingerprint: dimensionDraftFingerprint(form), rows };
}

export function applyProductDimensionImport(form: ProductFormValue, plan: DimensionImportPlan, ids: string[]): ProductFormValue {
  if (dimensionDraftFingerprint(form) !== plan.fingerprint) throw new Error("dimension_issue_stale");
  if (ids.length === 0 || ids.some(id => !plan.rows.find(row => row.id === id))) throw new Error("dimension_issue_values");
  const selected = plan.rows.filter(row => ids.includes(row.id));
  if (selected.some(row => row.issue || !row.targetKey || !row.dimensions)) throw new Error(selected.find(row => row.issue)?.issue ?? "dimension_issue_values");
  let next = form;
  for (const row of selected) next = applyProductDimensionPatch(next, [row.targetKey!], row.dimensions!);
  return next;
}
