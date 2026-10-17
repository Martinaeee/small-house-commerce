import type {
  BundleComponentSpecification,
  Product,
  StorefrontOptionValue,
} from "@/lib/api";
import { isSelectableVariant } from "@/lib/product-selection";


export type PdpSpecFieldKey =
  | "productName"
  | "variant"
  | "colors"
  | "dimensions"
  | "weight"
  | "materials";

export type PdpSpecClassification = "A" | "B" | "C" | "D";
export type PdpSpecCellStatus = "complete" | "partial" | "missing";

export interface PdpSpecCellSource {
  field: string;
  raw?: number | null;
  value?: number | null;
  inherited?: boolean;
}

export interface PdpSpecChoice {
  id: string;
  label: string;
}

export interface PdpSpecWeightValue {
  kg: number;
  kind: "Net" | "Gross";
}

export interface PdpSpecComponentValue {
  name: string;
  variant: string;
  quantity: number;
  cell: PdpSpecCell;
}

interface PdpSpecCellBase {
  status: PdpSpecCellStatus;
  sources: PdpSpecCellSource[];
  signature: string;
}

export type PdpSpecCell =
  | (PdpSpecCellBase & { type: "text"; value: string | null })
  | (PdpSpecCellBase & { type: "dimensions"; value: (number | null)[] })
  | (PdpSpecCellBase & { type: "weight"; value: PdpSpecWeightValue | null })
  | (PdpSpecCellBase & { type: "material"; value: PdpSpecChoice | null })
  | (PdpSpecCellBase & { type: "choices"; value: PdpSpecChoice[] })
  | (PdpSpecCellBase & { type: "components"; value: PdpSpecComponentValue[] });

export interface PdpSpecRow {
  id: string;
  name: string;
  optionValues: Record<string, StorefrontOptionValue>;
  graphComplete: boolean;
  cells: Record<PdpSpecFieldKey, PdpSpecCell>;
}

export interface PdpSpecField {
  key: PdpSpecFieldKey;
  label: string;
  classification: PdpSpecClassification;
  complete: number;
  partial: number;
  missing: number;
  cell: PdpSpecCell;
}

export interface PdpSpecGroupRow {
  labels: string[];
  memberIds: string[];
  cells: Record<PdpSpecFieldKey, PdpSpecCell>;
}

export interface PdpSpecGroup {
  basis: string[];
  fields: PdpSpecField[];
  rows: PdpSpecGroupRow[];
}

export interface PdpSpecModel {
  rows: PdpSpecRow[];
  fields: PdpSpecField[];
  common: PdpSpecField[];
  groups: PdpSpecGroup[];
  incomplete: PdpSpecField[];
  formatCell(cell: PdpSpecCell): string;
}

export interface PdpSizeGuideRow {
  labels: string[];
  memberIds: string[];
  cell: PdpSpecCell;
}

export interface PdpFoldedEntry {
  label: string | null;
  values: (number | null)[];
}

const FIELD_ORDER: readonly PdpSpecFieldKey[] = [
  "productName",
  "variant",
  "colors",
  "dimensions",
  "weight",
  "materials",
];

export const PDP_SPEC_FIELD_LABELS: Record<PdpSpecFieldKey, string> = {
  productName: "Product name",
  variant: "Style",
  colors: "Available colors",
  dimensions: "Dimensions",
  weight: "Weight",
  materials: "Materials",
};

const OPTION_KIND_LABELS: Record<string, string> = {
  COLOR: "Color",
  SIZE: "Size",
  STYLE: "Style",
  MATERIAL: "Material",
};

const numeric = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

const absent = (value: unknown): boolean => value === null || value === undefined;

const signature = (value: unknown): string => JSON.stringify(value);

const DIMENSION_AXES = [
  { index: 0, productField: "width", skuField: "productWidth", letter: "W" },
  { index: 1, productField: "depth", skuField: "productDepth", letter: "D" },
  { index: 2, productField: "height", skuField: "productHeight", letter: "H" },
] as const;

const DISPLAY_AXES = [
  { index: 0, letter: "W" },
  { index: 2, letter: "H" },
  { index: 1, letter: "D" },
] as const;

export function formatInches(cm: number): string {
  return String(Math.round((cm / 2.54) * 10) / 10);
}

export function formatLength(cm: number | null | undefined): string {
  return numeric(cm) ? `${formatInches(cm)} in` : "Not provided";
}

function buildDimensionsCell(
  raw: readonly (number | null | undefined)[],
  defaults: readonly (number | null | undefined)[],
): PdpSpecCell {
  const values: (number | null)[] = [];
  const sources: PdpSpecCellSource[] = [];
  for (const axis of DIMENSION_AXES) {
    const rawValue = raw[axis.index] ?? null;
    const inherited = absent(rawValue);
    const resolved = inherited ? defaults[axis.index] ?? null : rawValue;
    values.push(numeric(resolved) ? resolved : null);
    sources.push({
      field: inherited ? `Product.${axis.productField}` : `SKU.${axis.skuField}`,
      raw: rawValue,
      value: numeric(resolved) ? resolved : null,
      inherited,
    });
  }
  const count = values.filter(numeric).length;
  return {
    type: "dimensions",
    value: values,
    status: count === 3 ? "complete" : count > 0 ? "partial" : "missing",
    sources,
    signature: signature(["dimensions", values]),
  };
}

function buildWeightCell(
  net: number | null | undefined,
  gross: number | null | undefined,
): PdpSpecCell {
  const kind: "Net" | "Gross" | null = numeric(net)
    ? "Net"
    : absent(net) && numeric(gross)
      ? "Gross"
      : null;
  const value: PdpSpecWeightValue | null = kind
    ? { kg: kind === "Net" ? (net as number) : (gross as number), kind }
    : null;
  return {
    type: "weight",
    value,
    status: value ? "complete" : "missing",
    sources: [
      { field: kind === "Gross" ? "SKU.packageWeight" : "SKU.productWeight" },
    ],
    signature: signature(["weight", value]),
  };
}

function textCell(text: string | null, field: string): PdpSpecCell {
  const value = typeof text === "string" && text.trim() !== "" ? text : null;
  return {
    type: "text",
    value,
    status: value === null ? "missing" : "complete",
    sources: [{ field }],
    signature: signature(["text", value]),
  };
}

function materialValueCell(
  bound: StorefrontOptionValue | null,
  field: string,
): PdpSpecCell {
  const value: PdpSpecChoice | null = bound
    ? { id: bound.id, label: bound.label }
    : null;
  return {
    type: "material",
    value,
    status: value ? "complete" : "missing",
    sources: [{ field }],
    signature: signature(["material", value]),
  };
}

function choicesCell(values: PdpSpecChoice[], field: string): PdpSpecCell {
  return {
    type: "choices",
    value: values,
    status: values.length ? "complete" : "missing",
    sources: [{ field }],
    signature: signature(["choices", values.map((value) => [value.id, value.label])]),
  };
}

function componentCell(
  components: readonly BundleComponentSpecification[],
  key: "dimensions" | "weight" | "materials",
): PdpSpecCell {
  const value: PdpSpecComponentValue[] = components.map((component) => ({
    name: component.productName,
    variant: component.variantName,
    quantity: component.quantity,
    cell:
      key === "dimensions"
        ? buildDimensionsCell(
            [component.width, component.depth, component.height],
            [null, null, null],
          )
        : key === "weight"
          ? buildWeightCell(component.productWeight, null)
          : textCell(component.materials, "BundleComponent.materials"),
  }));
  const statuses = value.map((entry) => entry.cell.status);
  const status: PdpSpecCellStatus = !statuses.length
    ? "missing"
    : statuses.every((entry) => entry === "missing")
      ? "missing"
      : statuses.every((entry) => entry === "complete")
        ? "complete"
        : "partial";
  return {
    type: "components",
    value,
    status,
    sources: value.flatMap((entry) => entry.cell.sources),
    signature: signature([
      "components",
      value.map((entry) => [
        entry.name,
        entry.variant,
        entry.quantity,
        entry.cell.signature,
      ]),
    ]),
  };
}

const MISSING_CELL: PdpSpecCell = {
  type: "text",
  value: null,
  status: "missing",
  sources: [],
  signature: signature(["text", null]),
};

export function formatPdpSpecCell(cell: PdpSpecCell): string {
  if (cell.status === "missing") return "Not provided";
  switch (cell.type) {
    case "dimensions": {
      const parts: string[] = [];
      const missing: string[] = [];
      for (const axis of DISPLAY_AXES) {
        const value = cell.value[axis.index];
        if (numeric(value)) parts.push(`${formatInches(value)}${axis.letter}`);
        else missing.push(axis.letter);
      }
      if (!parts.length) return "Not provided";
      return (
        `${parts.join(" × ")} in` +
        (missing.length ? ` · ${missing.join(", ")} not provided` : "")
      );
    }
    case "weight":
      return cell.value ? `${cell.value.kg} kg · ${cell.value.kind} weight` : "Not provided";
    case "material":
      return cell.value?.label ?? "Not provided";
    case "choices":
      return cell.value.map((entry) => entry.label).join(" / ");
    case "components":
      return cell.value
        .map((entry) => {
          const inner = formatPdpSpecCell(entry.cell);
          const suffix = entry.cell.type === "weight" ? " / per item" : "";
          return `${entry.name} / ${entry.variant} × ${entry.quantity}\n${inner}${suffix}`;
        })
        .join("\n\n");
    case "text":
      return cell.value ?? "Not provided";
  }
}

function resolveRows(product: Product): PdpSpecRow[] {
  const materialOption = product.options.find((option) => option.kind === "MATERIAL");
  return product.variants.filter(isSelectableVariant).map((variant) => {
    const optionValues: Record<string, StorefrontOptionValue> = {};
    let graphComplete =
      Array.isArray(variant.optionValueIds) &&
      variant.optionValueIds.length === product.options.length &&
      new Set(variant.optionValueIds).size === variant.optionValueIds.length;
    for (const option of product.options) {
      const chosen = option.values.filter((value) =>
        variant.optionValueIds?.includes(value.id),
      );
      if (chosen.length === 1) optionValues[option.id] = chosen[0];
      else graphComplete = false;
    }
    const sku = variant.sku;
    const isBundle = sku?.specificationSource === "BUNDLE_COMPONENTS";
    const components = sku?.bundleComponents ?? [];
    const cells: Record<PdpSpecFieldKey, PdpSpecCell> = {
      productName: textCell(product.name, "Product.name"),
      variant: choicesCell([], "ProductOptionValue.nonColor"),
      colors: choicesCell([], "ProductOptionValue.COLOR"),
      dimensions: isBundle
        ? componentCell(components, "dimensions")
        : buildDimensionsCell(
            [sku?.productWidth, sku?.productDepth, sku?.productHeight],
            [product.width, product.depth, product.height],
          ),
      weight: isBundle
        ? componentCell(components, "weight")
        : buildWeightCell(sku?.productWeight, sku?.packageWeight),
      materials: isBundle
        ? componentCell(components, "materials")
        : materialOption
          ? materialValueCell(
              optionValues[materialOption.id] ?? null,
              `ProductOptionValue.${materialOption.id}`,
            )
          : textCell(product.materials?.trim() || null, "Product.materials"),
    };
    return { id: variant.id, name: variant.name, optionValues, graphComplete, cells };
  });
}

function applyChoiceFields(product: Product, rows: PdpSpecRow[]): void {
  const colorOption = product.options.find((option) => option.kind === "COLOR");
  const nonColor = product.options.filter((option) => option.kind !== "COLOR");
  const tuples = new Map<string, Set<string>>();
  const styleTuples = new Map<string, PdpSpecChoice>();
  const allStylesComplete = nonColor.length > 0 && rows.every((row) =>
    nonColor.every((option) => row.optionValues[option.id]),
  );
  for (const row of rows) {
    if (row.graphComplete) {
      const key = signature(nonColor.map((option) => row.optionValues[option.id].id));
      if (!tuples.has(key)) tuples.set(key, new Set());
      if (colorOption) tuples.get(key)!.add(row.optionValues[colorOption.id].id);
    }
    if (allStylesComplete) {
      const values = nonColor.map((option) => row.optionValues[option.id]);
      const id = signature(values.map((value) => value.id));
      styleTuples.set(id, { id, label: values.map((value) => value.label).join(" / ") });
    }
  }
  for (const row of rows) {
    const tuple = signature(nonColor.map((option) => row.optionValues[option.id]?.id));
    row.cells.colors = choicesCell(
      colorOption && row.graphComplete
        ? colorOption.values
            .filter((value) => tuples.get(tuple)?.has(value.id))
            .map((value) => ({ id: value.id, label: value.label }))
        : [],
      "ProductOptionValue.COLOR",
    );
    row.cells.variant = choicesCell(
      allStylesComplete
        ? [...styleTuples.values()]
        : nonColor.length > 0 && nonColor.every((option) => row.optionValues[option.id])
          ? [{ id: tuple, label: nonColor.map((option) => row.optionValues[option.id].label).join(" / ") }]
          : [],
      "ProductOptionValue.nonColor",
    );
  }
}

function classifyField(
  rows: readonly PdpSpecRow[],
  key: PdpSpecFieldKey,
): PdpSpecField {
  const cells = rows.map((row) => row.cells[key]);
  const complete = cells.filter((cell) => cell.status === "complete").length;
  const missing = cells.filter((cell) => cell.status === "missing").length;
  const partial = cells.length - complete - missing;
  const unique = new Set(
    cells.filter((cell) => cell.status === "complete").map((cell) => cell.signature),
  ).size;
  const classification: PdpSpecClassification =
    cells.length === 0 || missing === cells.length
      ? "D"
      : complete !== cells.length
        ? "C"
        : unique === 1
          ? "A"
          : "B";
  return {
    key,
    label: PDP_SPEC_FIELD_LABELS[key],
    classification,
    complete,
    partial,
    missing,
    cell: cells[0] ?? MISSING_CELL,
  };
}

function tupleKey(row: PdpSpecRow, basis: readonly string[]): string {
  return basis[0] === "$variant"
    ? row.id
    : signature(basis.map((id) => row.optionValues[id].id));
}

function tupleLabel(row: PdpSpecRow, basis: readonly string[]): string {
  return basis[0] === "$variant"
    ? row.name
    : basis.map((id) => row.optionValues[id].label).join(" / ");
}

function determines(
  rows: readonly PdpSpecRow[],
  basis: readonly string[],
  key: PdpSpecFieldKey,
): boolean {
  const values = new Map<string, string>();
  const labels = new Map<string, string>();
  for (const row of rows) {
    const tuple = tupleKey(row, basis);
    const label = tupleLabel(row, basis);
    const cell = row.cells[key].signature;
    if (values.has(tuple) && values.get(tuple) !== cell) return false;
    if (labels.has(label) && labels.get(label) !== tuple) return false;
    values.set(tuple, cell);
    labels.set(label, tuple);
  }
  return true;
}

function basisFor(
  product: Product,
  rows: readonly PdpSpecRow[],
  key: PdpSpecFieldKey,
): string[] {
  if (!rows.length || !rows.every((row) => row.graphComplete) || !product.options.length) {
    return ["$variant"];
  }
  const ids = product.options.map((option) => option.id);
  const candidates: string[][] = [];
  for (let mask = 1; mask < 1 << ids.length; mask += 1) {
    const subset = ids.filter((_, index) => mask & (1 << index));
    if (determines(rows, subset, key)) candidates.push(subset);
  }
  if (!candidates.length) return ["$variant"];
  const min = Math.min(...candidates.map((candidate) => candidate.length));
  const smallest = candidates.filter((candidate) => candidate.length === min);
  if (smallest.length === 1) return smallest[0];
  return determines(rows, ids, key) ? ids : ["$variant"];
}

function groupRows(
  rows: readonly PdpSpecRow[],
  basis: readonly string[],
  fields: readonly PdpSpecField[],
): PdpSpecGroupRow[] {
  const output = new Map<string, PdpSpecGroupRow>();
  for (const row of rows) {
    const key =
      basis[0] === "$variant"
        ? row.id
        : signature(fields.map((field) => row.cells[field.key].signature));
    if (!output.has(key)) {
      output.set(key, {
        labels: [],
        memberIds: [],
        cells: Object.fromEntries(
          fields.map((field) => [field.key, row.cells[field.key]]),
        ) as Record<PdpSpecFieldKey, PdpSpecCell>,
      });
    }
    const group = output.get(key)!;
    const label = tupleLabel(row, basis);
    if (!group.labels.includes(label)) group.labels.push(label);
    group.memberIds.push(row.id);
  }
  return [...output.values()];
}

export function analyzePdpSpecifications(product: Product): PdpSpecModel {
  const rows = resolveRows(product);
  applyChoiceFields(product, rows);
  const fields = FIELD_ORDER.map((key) => classifyField(rows, key));
  const grouped = new Map<string, { basis: string[]; fields: PdpSpecField[] }>();
  for (const field of fields) {
    if (field.classification !== "B" && field.classification !== "C") continue;
    const basis = basisFor(product, rows, field.key);
    const key = signature(basis);
    if (!grouped.has(key)) grouped.set(key, { basis, fields: [] });
    grouped.get(key)!.fields.push(field);
  }
  return {
    rows,
    fields,
    common: fields.filter((field) => field.classification === "A"),
    groups: [...grouped.values()].map((group) => ({
      ...group,
      rows: groupRows(rows, group.basis, group.fields),
    })),
    incomplete: fields.filter(
      (field) => field.classification === "C" || field.classification === "D",
    ),
    formatCell: formatPdpSpecCell,
  };
}

export function pdpInformationVisible(product: Product): boolean {
  const model = analyzePdpSpecifications(product);
  return model.fields.some(
    (field) =>
      field.key !== "productName" &&
      field.key !== "variant" &&
      field.classification !== "D",
  );
}

export function rowMatchesSelection(
  row: PdpSpecRow,
  selectedValueIds: Readonly<Record<string, string>>,
): boolean {
  return Object.entries(selectedValueIds).every(
    ([optionId, valueId]) => row.optionValues[optionId]?.id === valueId,
  );
}

export function pdpBasisLabel(product: Product, basis: readonly string[]): string {
  if (basis[0] === "$variant") return "Variant";
  return basis
    .map((id) => {
      const option = product.options.find((candidate) => candidate.id === id);
      return OPTION_KIND_LABELS[option?.kind ?? ""] ?? "Variant";
    })
    .join(" / ");
}

export function pdpFieldGroup(model: PdpSpecModel, key: PdpSpecFieldKey): PdpSpecGroup | undefined {
  const group = model.groups.find((candidate) => candidate.fields.some((field) => field.key === key));
  if (!group) return undefined;
  const fields = group.fields.filter((field) => field.key === key);
  return { basis: group.basis, fields, rows: groupRows(model.rows, group.basis, fields) };
}

export function pdpSizeGuideRows(product: Product): PdpSizeGuideRow[] {
  const model = analyzePdpSpecifications(product);
  const nonColor = product.options.filter((option) => option.kind !== "COLOR");
  const common = model.common.find((field) => field.key === "dimensions");
  if (common) {
    const allComplete = model.rows.length > 0 && model.rows.every((row) => row.graphComplete);
    const labels = model.rows.map((row) => {
      if (!allComplete || !product.options.length) return row.name;
      const used = nonColor.length ? nonColor : product.options;
      return used.map((option) => row.optionValues[option.id].label).join(" / ");
    });
    const separator =
      allComplete && (nonColor.length || product.options.length) === 1 ? " / " : " · ";
    return [
      {
        labels: [[...new Set(labels)].join(separator)],
        memberIds: model.rows.map((row) => row.id),
        cell: common.cell,
      },
    ];
  }
  const group = pdpFieldGroup(model, "dimensions");
  if (!group) return [];
  return group.rows.map((row) => ({
    labels: row.labels,
    memberIds: row.memberIds,
    cell: row.cells.dimensions,
  }));
}

export function pdpFoldedEntries(
  product: Product,
  sku?: { specificationSource?: "SKU" | "BUNDLE_COMPONENTS"; bundleComponents?: BundleComponentSpecification[] } | null,
): PdpFoldedEntry[] {
  if (sku?.specificationSource === "BUNDLE_COMPONENTS") {
    return (sku.bundleComponents ?? [])
      .map((component) => ({
        label: `${component.productName} / ${component.variantName} × ${component.quantity}`,
        values: [component.foldedWidth, component.foldedDepth, component.foldedHeight] as (number | null)[],
      }))
      .filter((entry) => entry.values.some(numeric));
  }
  const values: (number | null)[] = [
    product.foldedWidth,
    product.foldedDepth,
    product.foldedHeight,
  ];
  return values.some(numeric) ? [{ label: null, values }] : [];
}

export function pdpFoldedGuideEntries(product: Product): PdpFoldedEntry[] {
  const groups = new Map<string, { names: string[]; entries: PdpFoldedEntry[] }>();
  for (const variant of product.variants.filter(isSelectableVariant)) {
    const entries = pdpFoldedEntries(product, variant.sku);
    const key = signature(entries);
    if (!groups.has(key)) groups.set(key, { names: [], entries });
    groups.get(key)!.names.push(variant.name);
  }
  if (![...groups.values()].some((group) => group.entries.length > 0)) return [];
  if (groups.size === 1) return [...groups.values()][0].entries;
  return [...groups.values()].flatMap((group) => {
    const owner = [...new Set(group.names)].join(" · ");
    if (!group.entries.length) return [{ label: owner, values: [null, null, null] }];
    return group.entries.map((entry) => ({
      label: entry.label ? `${owner} — ${entry.label}` : owner,
      values: entry.values,
    }));
  });
}

export function formatFoldedLine(entry: PdpFoldedEntry): string | null {
  const parts: string[] = [];
  for (const axis of DISPLAY_AXES) {
    const value = entry.values[axis.index];
    if (numeric(value)) parts.push(`${formatInches(value)}${axis.letter}`);
  }
  return parts.length ? `${parts.join(" × ")} in` : null;
}

export function formatSkuDimensions(
  product: Pick<Product, "width" | "depth" | "height">,
  sku?: {
    productWidth?: number | null;
    productDepth?: number | null;
    productHeight?: number | null;
  } | null,
): string | null {
  const cell = buildDimensionsCell(
    [sku?.productWidth, sku?.productDepth, sku?.productHeight],
    [product.width, product.depth, product.height],
  );
  return cell.status === "missing" ? null : formatPdpSpecCell(cell);
}

export function formatBundleComponentDimensions(
  component: BundleComponentSpecification,
): string | null {
  const cell = buildDimensionsCell(
    [component.width, component.depth, component.height],
    [null, null, null],
  );
  return cell.status === "missing" ? null : formatPdpSpecCell(cell);
}
