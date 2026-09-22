/**
 * Pure adapters between the server's typed catalog option graph and the admin
 * product form draft. No React, no network: the edit page deserializes on
 * load, mutates the draft in the form, and diffs on save.
 *
 * Identity rules mirror the backend (catalog-graph.ts + dto/catalog-graph.dto.ts):
 *  - persisted rows keep their UUID ids; rows created in the browser carry a
 *    request-local `clientKey` the backend resolves within the same payload;
 *  - `combinationKey` is the canonical, lexicographically sorted set of
 *    `optionId:valueId` pairs — display position never changes identity;
 *  - variant names are derived server-side and never travel in the patch;
 *  - media scope sets replace rather than merge;
 *  - at most two active option groups and 100 Cartesian candidates.
 */

import type {
  AdminCatalogGraph,
  AdminGraphVariant,
  AdminOption,
  AdminOptionKind,
  AdminOptionPresentation,
  AdminProduct,
  WireCatalogGraphPatch,
} from "./admin-api";

// --- shared reference shape ---------------------------------------------------

/** Persisted row → `{ id }`; browser-created row → `{ clientKey }`. */
export interface EntityRef {
  id?: string;
  clientKey?: string;
}

// --- draft shapes -------------------------------------------------------------

export interface AdminOptionValueDraft extends EntityRef {
  label: string;
  position: number;
  swatchHex: string | null;
  thumbnailUrl: string | null;
  thumbnailAlt: string | null;
  isActive: boolean;
}

export interface AdminOptionDraft extends EntityRef {
  kind: AdminOptionKind;
  name: string;
  position: number;
  presentation: AdminOptionPresentation;
  isMediaDriver: boolean;
  isActive: boolean;
  values: AdminOptionValueDraft[];
}

export interface AdminSkuDraft extends EntityRef {
  skuCode: string;
  status: "ACTIVE" | "DISABLED";
  supplierSku: string | null;
  supplierCost: number | null;
  costCurrency: string | null;
  landedCost: number | null;
  price: number | null;
  compareAtPrice: number | null;
  productWeight: number | null;
  packageWidth: number | null;
  packageHeight: number | null;
  packageDepth: number | null;
  packageWeight: number | null;
  volumetricWeight: number | null;
  /** Live on-hand stock (inventory table; written through the batch endpoint). */
  onHand: number;
}

export interface AdminVariantDraft extends EntityRef {
  /** Server-derived display name; never sent back in the patch. */
  name: string;
  position: number;
  combinationKey: string;
  optionValueRefs: EntityRef[];
  sku: AdminSkuDraft | null;
}

export interface AdminMediaDraft extends EntityRef {
  url: string;
  type: "IMAGE" | "VIDEO";
  altText: string | null;
  sortOrder: number;
  /** null = shared product media; a ref scopes the row to a value/variant. */
  optionValueRef: EntityRef | null;
  variantRef: EntityRef | null;
}

export interface AdminCatalogGraphDraft {
  catalogGraphVersion: number;
  /** undefined = leave unchanged; ref = set; null = clear. */
  defaultDisplayVariantRef?: EntityRef | null;
  options: AdminOptionDraft[];
  variants: AdminVariantDraft[];
  media: AdminMediaDraft[];
}

// --- patch shapes -------------------------------------------------------------

export interface CatalogOptionValueUpsert extends EntityRef {
  label: string;
  position: number;
  swatchHex?: string | null;
  thumbnailUrl?: string | null;
  thumbnailAlt?: string | null;
  isActive: boolean;
}

export interface CatalogOptionUpsert extends EntityRef {
  kind: AdminOptionKind;
  name: string;
  position: number;
  presentation: AdminOptionPresentation;
  isMediaDriver: boolean;
  isActive: boolean;
  /** Only the values this save creates or changes — unchanged rows stay out. */
  values: CatalogOptionValueUpsert[];
}

export interface CatalogVariantUpsert extends EntityRef {
  position: number;
  optionValueRefs: EntityRef[];
  /** SKU pricing/identity payload; stock deliberately excluded. */
  sku?: Omit<
    AdminSkuDraft,
    "id" | "clientKey" | "onHand"
  > | null;
}

export interface CatalogMediaUpsert extends EntityRef {
  url: string;
  type: "IMAGE" | "VIDEO";
  altText?: string | null;
  sortOrder: number;
  optionValueRef: EntityRef | null;
  variantRef: EntityRef | null;
}

export interface CatalogGraphPatch {
  optionUpserts: CatalogOptionUpsert[];
  variantUpserts: CatalogVariantUpsert[];
  mediaUpserts: CatalogMediaUpsert[];
  retirements: {
    optionIds: string[];
    optionValueIds: string[];
    variantIds: string[];
    mediaIds: string[];
  };
  defaultDisplayVariant?: EntityRef | null;
}

// --- combination identity ------------------------------------------------------

/**
 * Mirrors the backend canonicalCombinationKey: percent-encoded pairs sorted by
 * their raw rendering (encoded as tiebreak) and joined with "|". The empty
 * set yields "" — the one candidate allowed for a graph with no active groups.
 */
export function canonicalCombinationKey(
  pairs: readonly { optionId: string; valueId: string }[],
): string {
  return pairs
    .map(({ optionId, valueId }) => ({
      raw: `${optionId}:${valueId}`,
      encoded: `${encodeURIComponent(optionId)}:${encodeURIComponent(valueId)}`,
    }))
    .sort(
      (left, right) =>
        left.raw.localeCompare(right.raw) ||
        left.encoded.localeCompare(right.encoded),
    )
    .map(({ encoded }) => encoded)
    .join("|");
}

// --- deserialization -----------------------------------------------------------

function decimal(value: string | null): number | null {
  return value === null ? null : Number(value);
}

function skuDraftFromGraph(sku: {
  id: string;
  skuCode: string;
  status: "ACTIVE" | "DISABLED";
  supplierSku: string | null;
  supplierCost: string | null;
  costCurrency: string | null;
  landedCost: string | null;
  price: string | null;
  compareAtPrice: string | null;
  productWeight: number | null;
  packageWidth: number | null;
  packageHeight: number | null;
  packageDepth: number | null;
  packageWeight: number | null;
  volumetricWeight: number | null;
  onHand: number;
}): AdminSkuDraft {
  return {
    id: sku.id,
    skuCode: sku.skuCode,
    status: sku.status,
    supplierSku: sku.supplierSku,
    supplierCost: decimal(sku.supplierCost),
    costCurrency: sku.costCurrency,
    landedCost: decimal(sku.landedCost),
    price: decimal(sku.price),
    compareAtPrice: decimal(sku.compareAtPrice),
    productWeight: sku.productWeight,
    packageWidth: sku.packageWidth,
    packageHeight: sku.packageHeight,
    packageDepth: sku.packageDepth,
    packageWeight: sku.packageWeight,
    volumetricWeight: sku.volumetricWeight,
    onHand: sku.onHand,
  };
}

const LEGACY_OPTION_KIND: AdminOptionKind = "STYLE";
const LEGACY_PRESENTATION: AdminOptionPresentation = "TEXT";

/**
 * Maps an admin product row into the editable graph draft.
 *
 * Graph-aware payloads (the server's typed snapshot) keep every persisted id
 * untouched. A legacy row (no `options`/`media` — the plain Prisma include)
 * projects to the same legacy STYLE bridge the backend presents to the
 * storefront: one synthetic option whose values are the persisted variants,
 * addressed through deterministic request-local client keys. The projection
 * is pure — the same payload deserializes to byte-identical drafts, so client
 * keys are stable across reloads and saves.
 */
export function deserializeAdminProduct(
  product: AdminProduct,
): AdminCatalogGraphDraft {
  if (product.options !== undefined || product.media !== undefined) {
    const options = (product.options ?? []).map((option) => ({
      id: option.id,
      kind: option.kind,
      name: option.name,
      position: option.position,
      presentation: option.presentation,
      isMediaDriver: option.isMediaDriver,
      isActive: option.isActive,
      values: option.values.map((value) => ({ ...value })),
    }));
    const graphVariants = product.variants as AdminGraphVariant[];
    const variants = graphVariants.map((variant) => {
      const refs = (variant.optionValues ?? []).map((assignment) => ({
        id: assignment.optionValueId,
      }));
      return {
        id: variant.id,
        name: variant.name,
        position: variant.position,
        combinationKey:
          variant.combinationKey ??
          canonicalCombinationKey(
            refs.map((ref) => ({
              // Pair each value with its owning option for canonical identity.
              optionId:
                (variant.optionValues ?? []).find(
                  (a) => a.optionValueId === ref.id,
                )?.optionId ?? ref.id!,
              valueId: ref.id!,
            })),
          ),
        optionValueRefs: refs,
        sku: variant.sku ? skuDraftFromGraph(variant.sku) : null,
      };
    });
    const mediaRows = product.media ?? product.images ?? [];
    const media = mediaRows.map((row) => {
      // Graph payloads carry the scope foreign keys; legacy image rows do not.
      const optionValueId =
        "optionValueId" in row ? (row.optionValueId as string | null) : null;
      const variantId =
        "variantId" in row ? (row.variantId as string | null) : null;
      return {
        id: row.id,
        url: row.url,
        type: row.type,
        altText: row.altText,
        sortOrder: row.sortOrder,
        optionValueRef: optionValueId ? { id: optionValueId } : null,
        variantRef: variantId ? { id: variantId } : null,
      };
    });
    return {
      catalogGraphVersion: product.catalogGraphVersion,
      defaultDisplayVariantRef: product.defaultDisplayVariantId
        ? { id: product.defaultDisplayVariantId }
        : product.defaultDisplayVariantId === null
          ? null
          : undefined,
      options,
      variants,
      media,
    };
  }

  // --- legacy projection (no typed graph on the wire) -----------------------
  const optionClientKey = `legacy-option-${product.id}`;
  const values = (product.variants ?? []).map((variant) => ({
    clientKey: `legacy-value-${variant.id}`,
    label: variant.name,
    position: variant.position,
    swatchHex: null,
    thumbnailUrl: null,
    thumbnailAlt: null,
    isActive: true,
  }));
  return {
    catalogGraphVersion: product.catalogGraphVersion,
    defaultDisplayVariantRef: product.defaultDisplayVariantId
      ? { id: product.defaultDisplayVariantId }
      : null,
    options: [
      {
        clientKey: optionClientKey,
        kind: LEGACY_OPTION_KIND,
        name: "Style",
        position: 0,
        presentation: LEGACY_PRESENTATION,
        isMediaDriver: false,
        isActive: (product.variants ?? []).length > 0,
        values,
      },
    ],
    variants: (product.variants ?? []).map((variant) => {
      const valueClientKey = `legacy-value-${variant.id}`;
      return {
        id: variant.id,
        name: variant.name,
        position: variant.position,
        combinationKey: canonicalCombinationKey([
          { optionId: optionClientKey, valueId: valueClientKey },
        ]),
        optionValueRefs: [{ clientKey: valueClientKey }],
        sku: variant.sku
          ? {
              id: variant.sku.id,
              skuCode: variant.sku.skuCode,
              status: variant.sku.status,
              supplierSku: variant.sku.supplierSku,
              supplierCost: decimal(variant.sku.supplierCost),
              costCurrency: variant.sku.costCurrency,
              landedCost: decimal(variant.sku.landedCost),
              price: decimal(variant.sku.price),
              compareAtPrice: decimal(variant.sku.compareAtPrice),
              productWeight: variant.sku.productWeight,
              packageWidth: variant.sku.packageWidth,
              packageHeight: variant.sku.packageHeight,
              packageDepth: variant.sku.packageDepth,
              packageWeight: variant.sku.packageWeight,
              volumetricWeight: variant.sku.volumetricWeight,
              onHand: variant.sku.onHand,
            }
          : null,
      };
    }),
    media: (product.images ?? []).map((row) => ({
      id: row.id,
      url: row.url,
      type: row.type,
      altText: row.altText,
      sortOrder: row.sortOrder,
      optionValueRef: null,
      variantRef: null,
    })),
  };
}

/**
 * Builds the diff baseline for a legacy payload: the same projection with
 * client keys surfaced as graph ids so buildCatalogGraphPatch can compare it
 * against the draft without a second code path.
 */
export function graphFromAdminProduct(
  product: AdminProduct,
): AdminCatalogGraph {
  const draft = deserializeAdminProduct(product);
  return {
    catalogGraphVersion: draft.catalogGraphVersion,
    defaultDisplayVariantId: product.defaultDisplayVariantId,
    options: draft.options.map((option) => ({
      id: option.id ?? option.clientKey!,
      kind: option.kind,
      name: option.name,
      position: option.position,
      presentation: option.presentation,
      isMediaDriver: option.isMediaDriver,
      isActive: option.isActive,
      values: option.values.map((value) => ({
        id: value.id ?? value.clientKey!,
        label: value.label,
        position: value.position,
        swatchHex: value.swatchHex,
        thumbnailUrl: value.thumbnailUrl,
        thumbnailAlt: value.thumbnailAlt,
        isActive: value.isActive,
      })),
    })),
    variants: draft.variants.map((variant) => {
      // Resolve each value ref back to its owning option for the assignment
      // rows the graph shape carries.
      const optionKeyByValueKey = new Map<string, string>();
      for (const option of draft.options) {
        for (const value of option.values) {
          optionKeyByValueKey.set(rowKey(value), rowKey(option));
        }
      }
      const sku = variant.sku;
      return {
        id: variant.id ?? variant.clientKey!,
        name: variant.name,
        position: variant.position,
        combinationKey: variant.combinationKey,
        optionValues: variant.optionValueRefs.map((ref) => ({
          optionId: optionKeyByValueKey.get(rowKey(ref)) ?? "",
          optionValueId: ref.id ?? ref.clientKey!,
        })),
        sku: sku
          ? {
              id: sku.id ?? "",
              skuCode: sku.skuCode,
              status: sku.status,
              supplierId: null,
              supplierSku: sku.supplierSku,
              supplierCost:
                sku.supplierCost === null ? null : String(sku.supplierCost),
              costCurrency: sku.costCurrency,
              landedCost:
                sku.landedCost === null ? null : String(sku.landedCost),
              price: sku.price === null ? null : String(sku.price),
              compareAtPrice:
                sku.compareAtPrice === null ? null : String(sku.compareAtPrice),
              productWeight: sku.productWeight,
              packageWidth: sku.packageWidth,
              packageHeight: sku.packageHeight,
              packageDepth: sku.packageDepth,
              packageWeight: sku.packageWeight,
              volumetricWeight: sku.volumetricWeight,
              onHand: sku.onHand,
              reserved: 0,
              availableInventory: sku.onHand,
            }
          : null,
        hasReferences: false,
      };
    }),
    media: draft.media.map((row) => ({
      id: row.id ?? row.clientKey!,
      url: row.url,
      type: row.type,
      altText: row.altText,
      sortOrder: row.sortOrder,
      optionValueId: row.optionValueRef?.id ?? null,
      variantId: row.variantRef?.id ?? null,
    })),
  };
}

// --- candidate enumeration ------------------------------------------------------

export interface VariantCandidate {
  combinationKey: string;
  name: string;
  pairs: { optionId: string; valueId: string }[];
  /** True when a draft variant row already covers this combination. */
  exists: boolean;
  variantId: string | null;
}

export class AdminCatalogGraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminCatalogGraphError";
  }
}

const MAX_CANDIDATES = 100;

function activeValues(option: AdminOptionDraft): AdminOptionValueDraft[] {
  return option.values
    .filter((value) => value.isActive)
    .sort(
      (left, right) =>
        left.position - right.position ||
        (left.id ?? left.clientKey ?? "").localeCompare(
          right.id ?? right.clientKey ?? "",
        ),
    );
}

function activeOptionsSorted(draft: AdminCatalogGraphDraft): AdminOptionDraft[] {
  return draft.options
    .filter((option) => option.isActive)
    .sort(
      (left, right) =>
        left.position - right.position ||
        (left.id ?? left.clientKey ?? "").localeCompare(
          right.id ?? right.clientKey ?? "",
        ),
    );
}

function deriveVariantName(
  values: readonly { optionPosition: number; valueLabel: string }[],
): string {
  const name = [...values]
    .sort((left, right) => left.optionPosition - right.optionPosition)
    .map(({ valueLabel }) => valueLabel)
    .join(" / ");
  return name || "Default";
}

/**
 * Enumerates the Cartesian candidates for the active option groups in display
 * order and flags which ones already exist in the draft. Throws past the
 * plan's global constraints (two groups / 100 candidates).
 */
export function buildVariantCandidates(
  draft: AdminCatalogGraphDraft,
): VariantCandidate[] {
  const options = activeOptionsSorted(draft);
  if (options.length > 2) {
    throw new AdminCatalogGraphError(
      `A catalog graph may have at most two active option groups; received ${options.length}.`,
    );
  }

  const valueById = new Map<string, AdminOptionValueDraft>();
  for (const option of options) {
    const values = activeValues(option);
    if (values.length === 0) {
      throw new AdminCatalogGraphError(
        `Option ${option.name} must have at least one active value.`,
      );
    }
    for (const value of values) {
      valueById.set(value.id ?? value.clientKey!, value);
    }
  }

  let combinations: { optionId: string; valueId: string }[][] = [[]];
  for (const option of options) {
    const values = activeValues(option);
    combinations = combinations.flatMap((existing) =>
      values.map((value) => [
        ...existing,
        { optionId: option.id ?? option.clientKey!, valueId: value.id ?? value.clientKey! },
      ]),
    );
    if (combinations.length > MAX_CANDIDATES) {
      throw new AdminCatalogGraphError(
        `Active option groups ${options
          .map(({ name }) => name)
          .join(" and ")} produce ${combinations.length} candidates; the limit is ${MAX_CANDIDATES}.`,
      );
    }
  }

  const byKey = new Map(draft.variants.map((v) => [v.combinationKey, v]));
  return combinations.map((pairs) => {
    const combinationKey = canonicalCombinationKey(pairs);
    const existing = byKey.get(combinationKey);
    return {
      combinationKey,
      name: deriveVariantName(
        pairs.map(({ optionId, valueId }) => ({
          optionPosition:
            options.find(
              (option) => (option.id ?? option.clientKey) === optionId,
            )?.position ?? 0,
          valueLabel: valueById.get(valueId)?.label ?? "",
        })),
      ),
      pairs,
      // "Exists" = backed by a persisted server row (id), not merely drafted.
      exists: existing?.id !== undefined,
      variantId: existing?.id ?? null,
    };
  });
}

// --- validation ------------------------------------------------------------------

export interface AdminCatalogGraphValidation {
  ok: boolean;
  errors: string[];
  activeOptionCount: number;
  candidateCount: number;
}

/**
 * Collects every violated plan constraint (never throws) so the UI can render
 * all problems at once. candidateCount is reported even when it exceeds the
 * cap so the editor can show the actual number.
 */
export function validateAdminCatalogGraph(
  draft: AdminCatalogGraphDraft,
): AdminCatalogGraphValidation {
  const errors: string[] = [];
  const options = activeOptionsSorted(draft);
  const activeOptionCount = options.length;

  if (activeOptionCount > 2) {
    errors.push(
      `A catalog graph may have at most two active option groups; received ${activeOptionCount}.`,
    );
  }

  let mediaDriverCount = 0;
  let candidateCount = 1;
  for (const option of options) {
    if (option.isMediaDriver) mediaDriverCount += 1;
    const values = activeValues(option);
    if (values.length === 0) {
      errors.push(
        `Active option ${option.name} must have at least one active value.`,
      );
      continue;
    }
    const seenLabels = new Set<string>();
    const seenPositions = new Set<number>();
    for (const value of values) {
      const label = value.label.trim().toLowerCase();
      if (seenLabels.has(label)) {
        errors.push(
          `Duplicate active value label ${value.label} in option ${option.name}.`,
        );
      }
      seenLabels.add(label);
      if (seenPositions.has(value.position)) {
        errors.push(
          `Duplicate active value position ${value.position} in option ${option.name}.`,
        );
      }
      seenPositions.add(value.position);
      if (!value.label.trim()) {
        errors.push(`Value label in option ${option.name} must not be empty.`);
      }
    }
    candidateCount *= values.length;
  }

  if (mediaDriverCount > 1) {
    errors.push(
      "A catalog graph may have at most one active media-driver option group.",
    );
  }

  if (candidateCount > MAX_CANDIDATES) {
    errors.push(
      `Active option groups produce ${candidateCount} candidates; the limit is ${MAX_CANDIDATES}.`,
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    activeOptionCount,
    candidateCount,
  };
}

// --- changed-row diff -----------------------------------------------------------

function rowKey(ref: EntityRef): string {
  // Original graph rows are addressed by id; a legacy-projected original uses
  // the client key as its id, so one lookup table serves both shapes.
  return ref.id ?? ref.clientKey ?? "";
}

function optionScalarChanged(
  original: AdminOption,
  draft: AdminOptionDraft,
): boolean {
  return (
    original.kind !== draft.kind ||
    original.name !== draft.name ||
    original.position !== draft.position ||
    original.presentation !== draft.presentation ||
    original.isMediaDriver !== draft.isMediaDriver ||
    original.isActive !== draft.isActive
  );
}

function valueChanged(
  original: AdminOption["values"][number] | undefined,
  draft: AdminOptionValueDraft,
): boolean {
  if (!original) return true;
  return (
    original.label !== draft.label ||
    original.position !== draft.position ||
    original.swatchHex !== draft.swatchHex ||
    original.thumbnailUrl !== draft.thumbnailUrl ||
    original.thumbnailAlt !== draft.thumbnailAlt ||
    original.isActive !== draft.isActive
  );
}

function numberEquals(
  wire: string | number | null | undefined,
  draft: number | null,
): boolean {
  if (wire === null || wire === undefined) return draft === null;
  if (draft === null) return false;
  return Number(wire) === draft;
}

function skuChanged(
  original: NonNullable<AdminCatalogGraph["variants"][number]["sku"]> | null,
  draft: AdminSkuDraft | null,
): boolean {
  if (!original && !draft) return false;
  if (!original || !draft) return true;
  return (
    original.skuCode !== draft.skuCode ||
    original.status !== draft.status ||
    original.supplierSku !== draft.supplierSku ||
    !numberEquals(original.supplierCost, draft.supplierCost) ||
    original.costCurrency !== draft.costCurrency ||
    !numberEquals(original.landedCost, draft.landedCost) ||
    !numberEquals(original.price, draft.price) ||
    !numberEquals(original.compareAtPrice, draft.compareAtPrice) ||
    original.productWeight !== draft.productWeight ||
    original.packageWidth !== draft.packageWidth ||
    original.packageHeight !== draft.packageHeight ||
    original.packageDepth !== draft.packageDepth ||
    original.packageWeight !== draft.packageWeight ||
    original.volumetricWeight !== draft.volumetricWeight
  );
}

function skuWritePayload(
  draft: NonNullable<AdminVariantDraft["sku"]>,
): CatalogVariantUpsert["sku"] {
  // The wire SKU payload carries identity/pricing only: the row reference
  // travels on the variant, and stock is a separate inventory write.
  return {
    skuCode: draft.skuCode,
    status: draft.status,
    supplierSku: draft.supplierSku,
    supplierCost: draft.supplierCost,
    costCurrency: draft.costCurrency,
    landedCost: draft.landedCost,
    price: draft.price,
    compareAtPrice: draft.compareAtPrice,
    productWeight: draft.productWeight,
    packageWidth: draft.packageWidth,
    packageHeight: draft.packageHeight,
    packageDepth: draft.packageDepth,
    packageWeight: draft.packageWeight,
    volumetricWeight: draft.volumetricWeight,
  };
}

function mediaChanged(
  original: AdminCatalogGraph["media"][number] | undefined,
  draft: AdminMediaDraft,
): boolean {
  if (!original) return true;
  return (
    original.url !== draft.url ||
    original.type !== draft.type ||
    original.altText !== draft.altText ||
    original.sortOrder !== draft.sortOrder ||
    (original.optionValueId ?? null) !==
      (draft.optionValueRef ? rowKey(draft.optionValueRef) : null) ||
    (original.variantId ?? null) !==
      (draft.variantRef ? rowKey(draft.variantRef) : null)
  );
}

/**
 * Diffs the server graph against the edited draft and emits the minimal
 * changed-row patch: only rows the operator actually touched, never
 * backend-derived variant names, and request-local client keys preserved for
 * rows this save creates (so stock writes can be mapped back afterwards).
 *
 * Variant retirement is never emitted by the client: the backend reconciles
 * candidates and disables/deletes unreferenced rows itself.
 */
export function buildCatalogGraphPatch(
  original: AdminCatalogGraph,
  draft: AdminCatalogGraphDraft,
): CatalogGraphPatch {
  const originalOptionById = new Map(original.options.map((o) => [o.id, o]));
  const originalVariantById = new Map(
    original.variants.map((v) => [v.id, v]),
  );
  const originalMediaById = new Map(original.media.map((m) => [m.id, m]));

  const optionUpserts: CatalogOptionUpsert[] = [];
  for (const draftOption of draft.options) {
    const key = rowKey(draftOption);
    const source = originalOptionById.get(key);
    // Unaddressable new option row (no id, no clientKey): skipping keeps the
    // payload valid; the server never sees a half-keyed row.
    if (!source && draftOption.id === undefined && draftOption.clientKey === undefined) {
      continue;
    }
    const valueRows: CatalogOptionValueUpsert[] = [];

    for (const draftValue of draftOption.values) {
      const valueKey = rowKey(draftValue);
      if (draftValue.id === undefined && draftValue.clientKey === undefined) {
        continue; // unaddressable new row (see variant guard below)
      }
      if (valueChanged(source?.values.find((v) => v.id === valueKey), draftValue)) {
        valueRows.push({
          ...(draftValue.id !== undefined ? { id: draftValue.id } : { clientKey: draftValue.clientKey! }),
          label: draftValue.label,
          position: draftValue.position,
          swatchHex: draftValue.swatchHex,
          thumbnailUrl: draftValue.thumbnailUrl,
          thumbnailAlt: draftValue.thumbnailAlt,
          isActive: draftValue.isActive,
        });
      }
    }
    // Values that existed on the server but are gone from the draft retire
    // through the retirements block below (draftValueKeys diff).
    if (source && !optionScalarChanged(source, draftOption) && valueRows.length === 0) {
      continue;
    }

    optionUpserts.push({
      ...(draftOption.id !== undefined ? { id: draftOption.id } : { clientKey: draftOption.clientKey! }),
      kind: draftOption.kind,
      name: draftOption.name,
      position: draftOption.position,
      presentation: draftOption.presentation,
      isMediaDriver: draftOption.isMediaDriver,
      isActive: draftOption.isActive,
      values: valueRows,
    });
  }

  const variantUpserts: CatalogVariantUpsert[] = [];
  for (const draftVariant of draft.variants) {
    const key = rowKey(draftVariant);
    const source = originalVariantById.get(key);

    if (!source) {
      // A row the server cannot address (no id, no clientKey — e.g. the
      // legacy "add variant" button on a typed product) is skipped: sending
      // an empty client key would fail the backend contract.
      if (draftVariant.id === undefined && draftVariant.clientKey === undefined) {
        continue;
      }
      // New candidate row: client key preserved for the stock mapping step.
      variantUpserts.push({
        ...(draftVariant.id !== undefined
          ? { id: draftVariant.id }
          : { clientKey: draftVariant.clientKey! }),
        position: draftVariant.position,
        optionValueRefs: draftVariant.optionValueRefs,
        ...(draftVariant.sku ? { sku: skuWritePayload(draftVariant.sku) } : {}),
      });
      continue;
    }

    const refsChanged =
      draftVariant.optionValueRefs.length !== source.optionValues.length ||
      draftVariant.optionValueRefs.some(
        (ref, index) =>
          rowKey(ref) !== source.optionValues[index]?.optionValueId,
      );
    if (
      draftVariant.position === source.position &&
      !refsChanged &&
      !skuChanged(source.sku, draftVariant.sku)
    ) {
      continue;
    }
    variantUpserts.push({
      id: source.id,
      position: draftVariant.position,
      optionValueRefs: draftVariant.optionValueRefs,
      // sku omitted entirely when neither side has one; `null` only as an
      // explicit disable of a SKU the server still holds.
      ...(draftVariant.sku
        ? { sku: skuWritePayload(draftVariant.sku) }
        : source.sku
          ? { sku: null }
          : {}),
    });
  }

  const mediaUpserts: CatalogMediaUpsert[] = [];
  for (const draftMedia of draft.media) {
    const key = rowKey(draftMedia);
    const source = originalMediaById.get(key);
    if (!source && draftMedia.id === undefined && draftMedia.clientKey === undefined) {
      continue; // unaddressable new row
    }
    if (!mediaChanged(source, draftMedia)) continue;
    mediaUpserts.push({
      ...(draftMedia.id !== undefined ? { id: draftMedia.id } : { clientKey: draftMedia.clientKey! }),
      url: draftMedia.url,
      type: draftMedia.type,
      altText: draftMedia.altText,
      sortOrder: draftMedia.sortOrder,
      optionValueRef: draftMedia.optionValueRef,
      variantRef: draftMedia.variantRef,
    });
  }

  const draftOptionKeys = new Set(draft.options.map(rowKey));
  const draftValueKeys = new Set(
    draft.options.flatMap((option) => option.values.map(rowKey)),
  );
  const draftMediaKeys = new Set(draft.media.map(rowKey));

  return {
    optionUpserts,
    variantUpserts,
    mediaUpserts,
    retirements: {
      optionIds: original.options
        .filter((option) => !draftOptionKeys.has(option.id))
        .map((option) => option.id),
      optionValueIds: original.options
        .flatMap((option) => option.values)
        .filter((value) => !draftValueKeys.has(value.id))
        .map((value) => value.id),
      // The server reconciles variants from the desired candidates; the client
      // never retires variant rows directly.
      variantIds: [],
      mediaIds: original.media
        .filter((media) => !draftMediaKeys.has(media.id))
        .map((media) => media.id),
    },
    defaultDisplayVariant: resolveDefaultDisplayPatch(
      original.defaultDisplayVariantId,
      draft.defaultDisplayVariantRef,
    ),
  };
}

function resolveDefaultDisplayPatch(
  originalId: string | null,
  draftRef: EntityRef | null | undefined,
): EntityRef | null | undefined {
  if (draftRef === undefined) return undefined;
  if (draftRef === null) return originalId === null ? undefined : null;
  return rowKey(draftRef) === originalId ? undefined : draftRef;
}

// --- stock batch ------------------------------------------------------------------

export interface StockBatchWrite {
  /** Persisted SKU: absolute set addressed by id. */
  skuId?: string;
  /** Browser-created SKU: addressed by its variant's client key. */
  skuClientKey?: string;
  onHand: number;
}

/**
 * Absolute stock sets for PUT /admin/inventory/stock/batch (Phase B). Rows
 * whose on-hand figure the operator left untouched are excluded; rows the
 * operator added are addressed through the variant client key, which the
 * catalog graph patch also carries, so the response can map real SKU ids back.
 */
export function collectStockBatch(
  draft: AdminCatalogGraphDraft,
  baseline: AdminCatalogGraphDraft,
): StockBatchWrite[] {
  const baselineSkuByVariantKey = new Map(
    baseline.variants.map((variant) => [rowKey(variant), variant.sku]),
  );

  const writes: StockBatchWrite[] = [];
  for (const variant of draft.variants) {
    const sku = variant.sku;
    if (!sku) continue;

    if (sku.id) {
      const before = baseline.variants
        .map((v) => v.sku)
        .find((s) => s?.id === sku.id);
      if (before && before.onHand === sku.onHand) continue;
      writes.push({ skuId: sku.id, onHand: sku.onHand });
      continue;
    }

    if (variant.clientKey === undefined) continue;
    const before = baselineSkuByVariantKey.get(rowKey(variant));
    if (before?.id) continue; // persisted elsewhere; not a new row
    writes.push({ skuClientKey: variant.clientKey, onHand: sku.onHand });
  }
  return writes;
}

// --- shared gallery sync -----------------------------------------------------------

interface SharedMediaInput {
  url: string;
  type: "IMAGE" | "VIDEO";
  altText: string;
  sortOrder: string;
}

/**
 * Overlays the legacy gallery tab (an ordered list of shared media rows) onto
 * the draft's shared media set, reusing persisted row ids positionally and
 * minting client keys for net-new rows. Removed rows simply vanish from the
 * draft — buildCatalogGraphPatch then retires their server ids. Scoped rows
 * (option-value/variant) are never touched: the legacy tab cannot see them.
 */
export function syncSharedMediaDraft(
  draft: AdminCatalogGraphDraft,
  images: readonly SharedMediaInput[],
): void {
  const sharedIndexes: number[] = [];
  draft.media.forEach((row, index) => {
    if (row.optionValueRef === null && row.variantRef === null) {
      sharedIndexes.push(index);
    }
  });

  // Already in sync (same rows, same order, same content): leave the draft
  // untouched so an unedited gallery produces no spurious upserts.
  if (
    sharedIndexes.length === images.length &&
    sharedIndexes.every((mediaIndex, i) => {
      const row = draft.media[mediaIndex]!;
      const image = images[i]!;
      return (
        row.url === image.url &&
        row.type === image.type &&
        (row.altText ?? "") === image.altText
      );
    })
  ) {
    return;
  }

  const kept = Math.min(sharedIndexes.length, images.length);
  for (let i = 0; i < kept; i += 1) {
    const row = draft.media[sharedIndexes[i]]!;
    const image = images[i]!;
    row.url = image.url;
    row.type = image.type;
    row.altText = image.altText || null;
    row.sortOrder = i;
  }

  // Drop shared rows beyond the submitted list (retired on diff).
  for (let i = sharedIndexes.length - 1; i >= kept; i -= 1) {
    draft.media.splice(sharedIndexes[i]!, 1);
  }

  images.slice(kept).forEach((image, offset) => {
    draft.media.push({
      clientKey: `media-new-${draft.media.length}-${offset}`,
      url: image.url,
      type: image.type,
      altText: image.altText || null,
      sortOrder: kept + offset,
      optionValueRef: null,
      variantRef: null,
    });
  });
}

// --- wire conversion -----------------------------------------------------------------

function wireRef(ref: EntityRef): { id?: string; clientKey?: string } {
  return ref.id !== undefined ? { id: ref.id } : { clientKey: ref.clientKey! };
}

/**
 * Converts the adapter patch into the exact JSON the backend
 * catalogGraphPatchSchema accepts (scope refs flattened onto
 * optionValueId/optionValueClientKey fields) and pairs it with the optimistic
 * revision the write requires.
 */
export function toWireCatalogGraphPatch(
  patch: CatalogGraphPatch,
  catalogGraphVersion: number,
): { catalogGraph: WireCatalogGraphPatch; catalogGraphVersion: number } {
  const catalogGraph: WireCatalogGraphPatch = {
    options: patch.optionUpserts.map((option) => ({
      ...wireRef(option),
      kind: option.kind,
      name: option.name,
      position: option.position,
      presentation: option.presentation,
      isMediaDriver: option.isMediaDriver,
      isActive: option.isActive,
      values: option.values.map((value) => ({
        ...wireRef(value),
        label: value.label,
        position: value.position,
        swatchHex: value.swatchHex,
        thumbnailUrl: value.thumbnailUrl,
        thumbnailAlt: value.thumbnailAlt,
        isActive: value.isActive,
      })),
    })),
    variants: patch.variantUpserts.map((variant) => ({
      ...wireRef(variant),
      position: variant.position,
      optionValueRefs: variant.optionValueRefs.map(wireRef),
      // Emit the sku key only when the patch carries SKU information
      // (payload or explicit null-disable); absent = leave untouched.
      ...(variant.sku !== undefined ? { sku: variant.sku ?? null } : {}),
    })),
    media: patch.mediaUpserts.map((media) => {
      const wire: WireCatalogGraphPatch["media"][number] = {
        ...wireRef(media),
        url: media.url,
        type: media.type,
        sortOrder: media.sortOrder,
      };
      if (media.altText !== null) wire.altText = media.altText;
      if (media.optionValueRef) {
        if (media.optionValueRef.id !== undefined) {
          wire.optionValueId = media.optionValueRef.id;
        } else {
          wire.optionValueClientKey = media.optionValueRef.clientKey;
        }
      }
      if (media.variantRef) {
        if (media.variantRef.id !== undefined) {
          wire.variantId = media.variantRef.id;
        } else {
          wire.variantClientKey = media.variantRef.clientKey;
        }
      }
      return wire;
    }),
    retirements: patch.retirements,
  };
  if (patch.defaultDisplayVariant !== undefined) {
    catalogGraph.defaultDisplayVariant =
      patch.defaultDisplayVariant === null
        ? null
        : wireRef(patch.defaultDisplayVariant);
  }
  return { catalogGraph, catalogGraphVersion };
}
