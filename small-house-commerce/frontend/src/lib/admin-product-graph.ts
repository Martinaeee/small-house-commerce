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

import type { ProductFormValue } from "@/components/admin/ProductForm";
import type { AdminBundleEditorDraft } from "./admin-bundle";
import type {
  AdminBundleDefinition,
  AdminCatalogGraph,
  AdminGraphVariant,
  AdminOption,
  AdminOptionKind,
  AdminOptionPresentation,
  AdminProduct,
  VariantCardImage,
  VariantCardMedia,
  WireCatalogGraphPatch,
} from "./admin-api";

function toFormNumber(value: number | string | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

export function deserializeProduct(p: AdminProduct): ProductFormValue {
  const repairImageOrder = new Set(p.images.map(image => image.sortOrder)).size !== p.images.length;
  return {
    name: p.name,
    slug: p.slug,
    description: p.description ?? "",
    tagline: p.tagline ?? "",
    seoTitle: p.seoTitle ?? "",
    metaDescription: p.metaDescription ?? "",
    categoryId: p.categoryId,
    status: p.status,
    room: p.room ?? "",
    internalRole: p.internalRole ?? "",
    solutions: [...p.solutions],
    width: toFormNumber(p.width),
    height: toFormNumber(p.height),
    depth: toFormNumber(p.depth),
    foldedWidth: toFormNumber(p.foldedWidth),
    foldedHeight: toFormNumber(p.foldedHeight),
    foldedDepth: toFormNumber(p.foldedDepth),
    materials: p.materials ?? "",
    features: (p.features ?? "").split("\n").map((line) => line.trim()).filter(Boolean),
    images: p.images.map((image, index) => ({
      id: image.id,
      url: image.url,
      type: image.type ?? "IMAGE",
      altText: image.altText ?? "",
      sortOrder: String(repairImageOrder ? index : image.sortOrder),
      isScene: image.isScene ?? false,
    })),
    detailBlocks: p.detailBlocks.map((block, index) => ({
      type: block.type,
      url: block.url,
      altText: block.altText ?? "",
      sortOrder: String(index),
    })),
    faq: p.faq
      ? {
          mode: p.faq.mode,
          items: p.faq.items.map((item) => ({
            ...item,
            answer: item.answer.map((block) =>
              block.kind === "paragraph"
                ? { ...block }
                : { ...block, items: [...block.items] },
            ),
          })),
          version: p.faq.version,
        }
      : undefined,
    variants: p.variants.map((variant) => ({
      id: variant.id,
      ...(variant.cardMedia !== undefined ? { cardMedia: structuredClone(variant.cardMedia) } : {}),
      name: variant.name,
      position: String(variant.position),
      sku: variant.sku
        ? {
            skuCode: variant.sku.skuCode,
            status: variant.sku.status,
            price: toFormNumber(variant.sku.price),
            compareAtPrice: toFormNumber(variant.sku.compareAtPrice),
            supplierSku: variant.sku.supplierSku ?? "",
            supplierCost: toFormNumber(variant.sku.supplierCost),
            costCurrency: variant.sku.costCurrency ?? "",
            landedCost: toFormNumber(variant.sku.landedCost),
            productWidth: toFormNumber(variant.sku.productWidth),
            productHeight: toFormNumber(variant.sku.productHeight),
            productDepth: toFormNumber(variant.sku.productDepth),
            productWeight: toFormNumber(variant.sku.productWeight),
            packageWidth: toFormNumber(variant.sku.packageWidth),
            packageHeight: toFormNumber(variant.sku.packageHeight),
            packageDepth: toFormNumber(variant.sku.packageDepth),
            packageWeight: toFormNumber(variant.sku.packageWeight),
            volumetricWeight: toFormNumber(variant.sku.volumetricWeight),
            id: variant.sku.id,
            stock: toFormNumber(variant.sku.onHand),
            reserved: toFormNumber(variant.sku.reserved),
          }
        : null,
    })),
    graph: deserializeAdminProduct(p),
    graphTyped: p.options !== undefined || p.media !== undefined,
  };
}

export function buildSavedPreview(
  product: Pick<AdminProduct, "slug" | "status" | "variants">,
): {
  path: string;
  status: AdminProduct["status"];
  variants: { id: string; name: string; skuStatus: "ACTIVE" | "DISABLED" | null; cardMedia?: VariantCardMedia | null }[];
} {
  return {
    path: `/products/${product.slug}`,
    status: product.status,
    variants: product.variants.map((variant) => ({
      id: variant.id,
      name: variant.name,
      skuStatus: variant.sku?.status ?? null,
      ...(variant.cardMedia !== undefined ? { cardMedia: structuredClone(variant.cardMedia) } : {}),
    })),
  };
}

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
  productWidth?: number | null;
  productHeight?: number | null;
  productDepth?: number | null;
  productWeight: number | null;
  packageWidth: number | null;
  packageHeight: number | null;
  packageDepth: number | null;
  packageWeight: number | null;
  volumetricWeight: number | null;
  isBundle?: boolean;
  bundleVersion?: number;
  bundleDraft?: AdminBundleEditorDraft;
  bundleDefinition?: AdminBundleDefinition;
  /** Live on-hand stock (inventory table; written through the batch endpoint). */
  onHand: number;
  reserved?: number;
}

export interface AdminVariantDraft extends EntityRef {
  /** Server-derived display name; never sent back in the patch. */
  name: string;
  position: number;
  combinationKey: string;
  optionValueRefs: EntityRef[];
  cardMedia?: VariantCardMedia | null;
  sku: AdminSkuDraft | null;
  /**
   * True when carts/orders/reservations/scoped media reference the row
   * (graph payloads carry the hint). Task 11's matrix surfaces it as the
   * protected-disable affordance; the patch never sends it.
   */
  hasReferences?: boolean;
}

export interface AdminMediaDraft extends EntityRef {
  url: string;
  type: "IMAGE" | "VIDEO";
  altText: string | null;
  sortOrder: number;
  isScene?: boolean;
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
  cardMedia?: VariantCardMedia | null;
  /** SKU pricing/identity payload; stock deliberately excluded. */
  sku?: Omit<
    AdminSkuDraft,
    "id" | "clientKey" | "onHand" | "reserved" | "bundleDraft" | "bundleDefinition" | "bundleVersion"
  > | null;
}

export interface CatalogMediaUpsert extends EntityRef {
  url: string;
  type: "IMAGE" | "VIDEO";
  altText?: string | null;
  sortOrder: number;
  isScene?: boolean;
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
  isBundle?: boolean;
  bundleVersion?: number;
  skuCode: string;
  status: "ACTIVE" | "DISABLED";
  supplierSku: string | null;
  supplierCost: string | null;
  costCurrency: string | null;
  landedCost: string | null;
  price: string | null;
  compareAtPrice: string | null;
  productWidth?: number | null;
  productHeight?: number | null;
  productDepth?: number | null;
  productWeight: number | null;
  packageWidth: number | null;
  packageHeight: number | null;
  packageDepth: number | null;
  packageWeight: number | null;
  volumetricWeight: number | null;
  onHand: number;
  reserved?: number;
}): AdminSkuDraft {
  return {
    id: sku.id,
    skuCode: sku.skuCode,
    isBundle: sku.isBundle,
    bundleVersion: sku.bundleVersion,
    status: sku.status,
    supplierSku: sku.supplierSku,
    supplierCost: decimal(sku.supplierCost),
    costCurrency: sku.costCurrency,
    landedCost: decimal(sku.landedCost),
    price: decimal(sku.price),
    compareAtPrice: decimal(sku.compareAtPrice),
    productWidth: sku.productWidth ?? null,
    productHeight: sku.productHeight ?? null,
    productDepth: sku.productDepth ?? null,
    productWeight: sku.productWeight,
    packageWidth: sku.packageWidth,
    packageHeight: sku.packageHeight,
    packageDepth: sku.packageDepth,
    packageWeight: sku.packageWeight,
    volumetricWeight: sku.volumetricWeight,
    onHand: sku.onHand,
    reserved: sku.reserved ?? 0,
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
        ...(variant.cardMedia !== undefined ? { cardMedia: structuredClone(variant.cardMedia) } : {}),
        sku: variant.sku ? skuDraftFromGraph(variant.sku) : null,
        hasReferences: variant.hasReferences ?? false,
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
        isScene: row.isScene ?? false,
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
        ...(variant.cardMedia !== undefined ? { cardMedia: structuredClone(variant.cardMedia) } : {}),
        hasReferences: false,
        sku: variant.sku
          ? {
              id: variant.sku.id,
              skuCode: variant.sku.skuCode,
              isBundle: variant.sku.isBundle,
              bundleVersion: variant.sku.bundleVersion,
              status: variant.sku.status,
              supplierSku: variant.sku.supplierSku,
              supplierCost: decimal(variant.sku.supplierCost),
              costCurrency: variant.sku.costCurrency,
              landedCost: decimal(variant.sku.landedCost),
              price: decimal(variant.sku.price),
              compareAtPrice: decimal(variant.sku.compareAtPrice),
              productWidth: variant.sku.productWidth ?? null,
              productHeight: variant.sku.productHeight ?? null,
              productDepth: variant.sku.productDepth ?? null,
              productWeight: variant.sku.productWeight,
              packageWidth: variant.sku.packageWidth,
              packageHeight: variant.sku.packageHeight,
              packageDepth: variant.sku.packageDepth,
              packageWeight: variant.sku.packageWeight,
              volumetricWeight: variant.sku.volumetricWeight,
              onHand: variant.sku.onHand,
              reserved: variant.sku.reserved,
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
      isScene: row.isScene ?? false,
      optionValueRef: null,
      variantRef: null,
    })),
  };
}

function nullableFormNumber(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function cardGraphFromLegacyForm(value: ProductFormValue): AdminCatalogGraphDraft {
  const draft = structuredClone(value.graph ?? {
    catalogGraphVersion: 0, defaultDisplayVariantRef: null, options: [], variants: [], media: [],
  });
  const previousRows = new Map(draft.variants.map(row => [rowKey(row), row]));
  const option: AdminOptionDraft = draft.options[0] ?? {
    clientKey: freshClientKey("legacy-option", draft), kind: "STYLE", name: "Style", position: 0,
    presentation: "TEXT", isMediaDriver: false, isActive: true, values: [],
  };
  const oldValues = new Map(option.values.map(row => [rowKey(row), row]));
  const values: AdminOptionValueDraft[] = [];
  draft.variants = value.variants.map((row, index) => {
    const ref = row.id !== undefined ? { id: row.id } : { clientKey: row.clientKey! };
    const key = rowKey(ref);
    const previous = previousRows.get(key);
    const valueRef = previous?.optionValueRefs[0] ?? { clientKey: `legacy-value-${key}` };
    values.push({
      ...oldValues.get(rowKey(valueRef)), ...valueRef, label: row.name,
      position: index, swatchHex: null,
      thumbnailUrl: null, thumbnailAlt: null, isActive: true,
    });
    const sku = row.sku;
    return {
      ...previous, ...ref, name: row.name, position: nullableFormNumber(row.position) ?? 0,
      combinationKey: canonicalCombinationKey([{ optionId: rowKey(option), valueId: rowKey(valueRef) }]),
      optionValueRefs: [valueRef],
      ...(row.cardMedia !== undefined ? { cardMedia: structuredClone(row.cardMedia) } : {}),
      sku: sku ? {
        ...previous?.sku, ...(sku.id ? { id: sku.id } : {}), skuCode: sku.skuCode, status: sku.status,
        supplierSku: sku.supplierSku || null, supplierCost: nullableFormNumber(sku.supplierCost),
        costCurrency: sku.costCurrency || null, landedCost: nullableFormNumber(sku.landedCost),
        price: nullableFormNumber(sku.price), compareAtPrice: nullableFormNumber(sku.compareAtPrice),
        productWidth: nullableFormNumber(sku.productWidth), productHeight: nullableFormNumber(sku.productHeight),
        productDepth: nullableFormNumber(sku.productDepth), productWeight: nullableFormNumber(sku.productWeight),
        packageWidth: nullableFormNumber(sku.packageWidth), packageHeight: nullableFormNumber(sku.packageHeight),
        packageDepth: nullableFormNumber(sku.packageDepth), packageWeight: nullableFormNumber(sku.packageWeight),
        volumetricWeight: nullableFormNumber(sku.volumetricWeight),
        onHand: nullableFormNumber(sku.stock) ?? 0, reserved: nullableFormNumber(sku.reserved) ?? 0,
      } : null,
    };
  });
  draft.options = [{ ...option, kind: "STYLE", values, isActive: values.length > 0 }];
  syncSharedMediaDraft(draft, value.images);
  return draft;
}

export function setVariantCardImage(
  draft: AdminCatalogGraphDraft,
  variantRef: EntityRef,
  slot: "cover" | "hover",
  image: VariantCardImage | null,
): void {
  const variant = draft.variants.find(row => rowKey(row) === rowKey(variantRef));
  if (!variant) return;
  variant.cardMedia = {
    cover: variant.cardMedia?.cover ?? null,
    hover: variant.cardMedia?.hover ?? null,
    [slot]: image === null ? null : structuredClone(image),
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
        ...(variant.cardMedia !== undefined ? { cardMedia: structuredClone(variant.cardMedia) } : {}),
        optionValues: variant.optionValueRefs.map((ref) => ({
          optionId: optionKeyByValueKey.get(rowKey(ref)) ?? "",
          optionValueId: ref.id ?? ref.clientKey!,
        })),
        sku: sku
          ? {
              id: sku.id ?? "",
              skuCode: sku.skuCode,
              isBundle: sku.isBundle,
              bundleVersion: sku.bundleVersion,
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
              productWidth: sku.productWidth ?? null,
              productHeight: sku.productHeight ?? null,
              productDepth: sku.productDepth ?? null,
              productWeight: sku.productWeight,
              packageWidth: sku.packageWidth,
              packageHeight: sku.packageHeight,
              packageDepth: sku.packageDepth,
              packageWeight: sku.packageWeight,
              volumetricWeight: sku.volumetricWeight,
              onHand: sku.onHand,
              reserved: sku.reserved ?? 0,
              availableInventory: Math.max(0, sku.onHand - (sku.reserved ?? 0)),
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
      isScene: row.isScene ?? false,
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

export function findSupersededDefaultVariant(
  draft: AdminCatalogGraphDraft,
): AdminVariantDraft | undefined {
  const options = activeOptionsSorted(draft);
  if (options.length === 0 || options.some(option => activeValues(option).length === 0)) return;

  return draft.variants.find(variant =>
    variant.clientKey === "variant-" &&
    variant.id === undefined &&
    variant.combinationKey === "" &&
    variant.optionValueRefs.length === 0 &&
    !variant.hasReferences &&
    !variant.sku?.id,
  );
}

/** The label the operator sees for a row: its values, else its stored name. */
export function variantDisplayName(
  draft: AdminCatalogGraphDraft,
  variant: AdminVariantDraft,
): string {
  const labels = new Map(
    draft.options.flatMap(option =>
      option.values.map(value => [entityRowKey(value), value.label] as const),
    ),
  );
  const composed = variant.optionValueRefs
    .map(ref => labels.get(entityRowKey(ref)))
    .filter(Boolean)
    .join(" / ");
  return composed || variant.name;
}

/**
 * Draft rows that no active option combination produces any more: what is left
 * of an earlier option setup (the no-options Default, or the colour-only rows
 * from before a second group was added). Persisted rows are excluded — retiring
 * a saved variant is the server's reconcile decision, not the editor's.
 */
export function findSupersededVariantRows(
  draft: AdminCatalogGraphDraft,
): AdminVariantDraft[] {
  const options = draft.options.filter(option => option.isActive);
  if (options.length === 0) return [];
  let candidateKeys: Set<string>;
  try {
    candidateKeys = new Set(buildVariantCandidates(draft).map(candidate => candidate.combinationKey));
  } catch {
    return [];
  }
  const values = new Map(options.flatMap(option => option.values
    .filter(value => value.isActive)
    .map(value => [entityRowKey(value), entityRowKey(option)] as const)));
  return draft.variants.filter(variant => {
    if (variant.id !== undefined || variant.hasReferences || variant.sku?.id) return false;
    const pairs = variant.optionValueRefs.map(ref => {
      const valueId = entityRowKey(ref);
      return { optionId: values.get(valueId) ?? "", valueId };
    });
    return !candidateKeys.has(canonicalCombinationKey(pairs));
  });
}

export function removeSupersededDefaultVariant(draft: AdminCatalogGraphDraft): void {
  const variant = findSupersededDefaultVariant(draft);
  if (!variant || variant.sku?.skuCode.trim()) return;
  if (variant.sku && (
    variant.sku.status !== "ACTIVE" ||
    variant.sku.onHand !== 0 ||
    (variant.sku.reserved ?? 0) !== 0 ||
    !Object.entries(variant.sku).every(([key, value]) =>
      ["skuCode", "status", "price", "compareAtPrice", "onHand", "reserved"].includes(key) ||
      value === null || value === undefined,
    )
  )) return;
  if (variant.cardMedia?.cover || variant.cardMedia?.hover) return;
  if (draft.media.some(row => row.variantRef?.clientKey === "variant-")) return;

  // The no-options candidate is hidden once real option combinations exist.
  draft.variants.splice(draft.variants.indexOf(variant), 1);
  if (draft.defaultDisplayVariantRef?.clientKey === "variant-") {
    draft.defaultDisplayVariantRef = null;
  }
}

// --- validation ------------------------------------------------------------------

export type AdminCatalogGraphIssueCode =
  | "active_option_limit"
  | "active_value_required"
  | "duplicate_value_label"
  | "duplicate_value_position"
  | "value_label_required"
  | "media_driver_limit"
  | "candidate_limit";

export interface AdminCatalogGraphIssue {
  code: AdminCatalogGraphIssueCode;
  /** Draft option key (id ?? clientKey) this issue belongs to, when known. */
  optionKey?: string;
  /** Draft option-value key this issue belongs to, when known. */
  valueKey?: string;
}

export type AdminCatalogGraphValidationMessageKey =
  | "product_graph_active_option_limit"
  | "product_graph_active_value_required"
  | "product_graph_duplicate_value_label"
  | "product_graph_duplicate_value_position"
  | "product_graph_value_label_required"
  | "product_graph_media_driver_limit"
  | "product_graph_candidate_limit";

type AdminCatalogGraphTranslate = (
  key: AdminCatalogGraphValidationMessageKey,
  vars?: Record<string, string | number>,
) => string;

export interface AdminCatalogGraphValidation {
  ok: boolean;
  errors: string[];
  issues: AdminCatalogGraphIssue[];
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
  translate?: AdminCatalogGraphTranslate,
): AdminCatalogGraphValidation {
  const errors: string[] = [];
  const issues: AdminCatalogGraphIssue[] = [];
  const addError = (
    code: AdminCatalogGraphIssueCode,
    key: AdminCatalogGraphValidationMessageKey,
    vars: Record<string, string | number>,
    fallback: string,
    locate: { optionKey?: string; valueKey?: string } = {},
  ): void => {
    issues.push({ code, ...locate });
    errors.push(translate ? translate(key, vars) : fallback);
  };
  const options = activeOptionsSorted(draft);
  const activeOptionCount = options.length;

  if (activeOptionCount > 2) {
    addError(
      "active_option_limit",
      "product_graph_active_option_limit",
      { count: activeOptionCount },
      `A catalog graph may have at most two active option groups; received ${activeOptionCount}.`,
    );
  }

  let mediaDriverCount = 0;
  let candidateCount = 1;
  for (const option of options) {
    if (option.isMediaDriver) mediaDriverCount += 1;
    const values = activeValues(option);
    if (values.length === 0) {
      addError(
        "active_value_required",
        "product_graph_active_value_required",
        { option: option.name },
        `Active option ${option.name} must have at least one active value.`,
        { optionKey: rowKey(option) },
      );
      continue;
    }
    const seenLabels = new Set<string>();
    const seenPositions = new Set<number>();
    for (const value of values) {
      const label = value.label.trim().toLowerCase();
      if (seenLabels.has(label)) {
        addError(
          "duplicate_value_label",
          "product_graph_duplicate_value_label",
          { label: value.label, option: option.name },
          `Duplicate active value label ${value.label} in option ${option.name}.`,
          { optionKey: rowKey(option), valueKey: rowKey(value) },
        );
      }
      seenLabels.add(label);
      if (seenPositions.has(value.position)) {
        addError(
          "duplicate_value_position",
          "product_graph_duplicate_value_position",
          { position: value.position, option: option.name },
          `Duplicate active value position ${value.position} in option ${option.name}.`,
          { optionKey: rowKey(option), valueKey: rowKey(value) },
        );
      }
      seenPositions.add(value.position);
      if (!value.label.trim()) {
        addError(
          "value_label_required",
          "product_graph_value_label_required",
          { option: option.name },
          `Value label in option ${option.name} must not be empty.`,
          { optionKey: rowKey(option), valueKey: rowKey(value) },
        );
      }
    }
    candidateCount *= values.length;
  }

  if (mediaDriverCount > 1) {
    addError(
      "media_driver_limit",
      "product_graph_media_driver_limit",
      {},
      "A catalog graph may have at most one active media-driver option group.",
    );
  }

  if (candidateCount > MAX_CANDIDATES) {
    addError(
      "candidate_limit",
      "product_graph_candidate_limit",
      { count: candidateCount, limit: MAX_CANDIDATES },
      `Active option groups produce ${candidateCount} candidates; the limit is ${MAX_CANDIDATES}.`,
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    issues,
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

/**
 * Shared row-identity key for UI code: rows are addressed by `id ?? clientKey`,
 * so client code must key maps/lookups across BOTH spaces. Exported so the
 * admin editors cannot drift from the adapter's addressing.
 */
export function entityRowKey(ref: EntityRef): string {
  return rowKey(ref);
}

export interface ProductDimensionValues {
  width: number | null;
  height: number | null;
  depth: number | null;
}

export type ProductDimensionApplyMode = "all-materialized" | "empty-only";

export interface ProductDimensionApplyResult {
  changedCount: number;
  skippedCount: number;
}

export function applyProductDimensionsToVariants(
  draft: AdminCatalogGraphDraft,
  dimensions: ProductDimensionValues,
  mode: ProductDimensionApplyMode,
): ProductDimensionApplyResult {
  let changedCount = 0;
  let skippedCount = 0;

  for (const variant of draft.variants) {
    if (!variant.sku || variant.sku.status !== "ACTIVE") {
      skippedCount += 1;
      continue;
    }

    const next = { ...variant.sku };
    if (mode === "all-materialized" || next.productWidth == null) {
      next.productWidth = dimensions.width;
    }
    if (mode === "all-materialized" || next.productHeight == null) {
      next.productHeight = dimensions.height;
    }
    if (mode === "all-materialized" || next.productDepth == null) {
      next.productDepth = dimensions.depth;
    }

    if (
      next.productWidth !== variant.sku.productWidth ||
      next.productHeight !== variant.sku.productHeight ||
      next.productDepth !== variant.sku.productDepth
    ) {
      variant.sku = next;
      changedCount += 1;
    }
  }

  return { changedCount, skippedCount };
}

/**
 * Mints a request-local unique client key for a browser-created row. Uniqueness
 * spans the id space TOO (rows are addressed by `id ?? clientKey`), so a fresh
 * key must dodge every id as well — not just the other client keys.
 */
export function freshClientKey(
  prefix: string,
  draft: AdminCatalogGraphDraft,
): string {
  const used = new Set<string>();
  for (const option of draft.options) {
    if (option.id) used.add(option.id);
    if (option.clientKey) used.add(option.clientKey);
    for (const value of option.values) {
      if (value.id) used.add(value.id);
      if (value.clientKey) used.add(value.clientKey);
    }
  }
  for (const variant of draft.variants) {
    if (variant.id) used.add(variant.id);
    if (variant.clientKey) used.add(variant.clientKey);
  }
  for (const media of draft.media) {
    if (media.id) used.add(media.id);
    if (media.clientKey) used.add(media.clientKey);
  }
  let index = used.size + 1;
  while (used.has(`${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
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
  draft: number | null | undefined,
): boolean {
  if (wire === undefined) return draft === undefined || draft === null;
  if (wire === null) return draft === null;
  if (draft === null || draft === undefined) return false;
  return Number(wire) === draft;
}

function cardMediaChanged(
  original: VariantCardMedia | null | undefined,
  draft: VariantCardMedia | null | undefined,
): boolean {
  if (draft === undefined) return false;
  if (original == null || draft === null) return (original ?? null) !== draft;
  return (["cover", "hover"] as const).some(slot => {
    const before = original[slot];
    const after = draft[slot];
    return before?.type !== after?.type || before?.url !== after?.url || before?.altText !== after?.altText;
  });
}

function skuChanged(
  original: NonNullable<AdminCatalogGraph["variants"][number]["sku"]> | null,
  draft: AdminSkuDraft | null,
): boolean {
  if (!original && !draft) return false;
  if (!original || !draft) return true;
  return (
    original.skuCode !== draft.skuCode ||
    Boolean(original.isBundle) !== Boolean(draft.isBundle) ||
    original.status !== draft.status ||
    original.supplierSku !== draft.supplierSku ||
    !numberEquals(original.supplierCost, draft.supplierCost) ||
    original.costCurrency !== draft.costCurrency ||
    !numberEquals(original.landedCost, draft.landedCost) ||
    !numberEquals(original.price, draft.price) ||
    !numberEquals(original.compareAtPrice, draft.compareAtPrice) ||
    !numberEquals(original.productWidth, draft.productWidth) ||
    !numberEquals(original.productHeight, draft.productHeight) ||
    !numberEquals(original.productDepth, draft.productDepth) ||
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
    ...(draft.isBundle !== undefined ? { isBundle: draft.isBundle } : {}),
    status: draft.status,
    supplierSku: draft.supplierSku,
    supplierCost: draft.supplierCost,
    costCurrency: draft.costCurrency,
    landedCost: draft.landedCost,
    price: draft.price,
    compareAtPrice: draft.compareAtPrice,
    ...(draft.productWidth !== undefined
      ? { productWidth: draft.productWidth }
      : {}),
    ...(draft.productHeight !== undefined
      ? { productHeight: draft.productHeight }
      : {}),
    ...(draft.productDepth !== undefined
      ? { productDepth: draft.productDepth }
      : {}),
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
    (original.isScene ?? false) !== (draft.isScene ?? false) ||
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

  const valueUpsert = (
    draftValue: AdminOptionValueDraft,
  ): CatalogOptionValueUpsert => ({
    ...(draftValue.id !== undefined
      ? { id: draftValue.id }
      : { clientKey: draftValue.clientKey! }),
    label: draftValue.label,
    position: draftValue.position,
    swatchHex: draftValue.swatchHex,
    thumbnailUrl: draftValue.thumbnailUrl,
    thumbnailAlt: draftValue.thumbnailAlt,
    isActive: draftValue.isActive,
  });

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
        valueRows.push(valueUpsert(draftValue));
      }
    }
    // Values that existed on the server but are gone from the draft retire
    // through the retirements block below (draftValueKeys diff).
    if (source && !optionScalarChanged(source, draftOption) && valueRows.length === 0) {
      continue;
    }
    // The backend validates every option upsert as a self-contained option
    // (`validateOptionGraph` in catalog-graph.dto.ts runs on the patch alone),
    // so an active option must carry an active value even when this delta only
    // moved its scalars — otherwise a rename, a reorder, or a gallery-driver
    // switch would be rejected with "Active option X must have at least one
    // active value."
    if (draftOption.isActive && !valueRows.some((row) => row.isActive)) {
      for (const draftValue of draftOption.values) {
        if (!draftValue.isActive) continue;
        if (draftValue.id === undefined && draftValue.clientKey === undefined) {
          continue;
        }
        valueRows.push(valueUpsert(draftValue));
      }
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
        ...(draftVariant.cardMedia !== undefined ? { cardMedia: draftVariant.cardMedia } : {}),
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
    const skuHasChanged = skuChanged(source.sku, draftVariant.sku);
    const cardHasChanged = cardMediaChanged(source.cardMedia, draftVariant.cardMedia);
    if (
      draftVariant.position === source.position &&
      !refsChanged && !skuHasChanged && !cardHasChanged
    ) {
      continue;
    }
    variantUpserts.push({
      id: source.id,
      position: draftVariant.position,
      optionValueRefs: draftVariant.optionValueRefs,
      ...(cardHasChanged ? { cardMedia: draftVariant.cardMedia } : {}),
      ...(skuHasChanged ? { sku: draftVariant.sku ? skuWritePayload(draftVariant.sku) : null } : {}),
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
      isScene: draftMedia.isScene ?? false,
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
    if (!sku || sku.isBundle) continue;

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
  id?: string;
  clientKey?: string;
  url: string;
  type?: "IMAGE" | "VIDEO";
  altText?: string | null;
  sortOrder?: string | number;
  isScene?: boolean;
}

export function syncSharedMediaDraft(
  draft: AdminCatalogGraphDraft,
  images: readonly SharedMediaInput[],
): void {
  const shared = draft.media.filter(row => row.optionValueRef === null && row.variantRef === null);
  const scoped = draft.media.filter(row => row.optionValueRef !== null || row.variantRef !== null);
  const byIdentity = new Map(shared.map(row => [rowKey(row), row]));
  const byMedia = new Map<string, AdminMediaDraft[]>();
  const incomingCounts = new Map<string, number>();
  const mediaKey = (row: SharedMediaInput) => JSON.stringify([row.url, row.type ?? "IMAGE"]);
  for (const row of shared) {
    const key = mediaKey(row);
    const matches = byMedia.get(key) ?? [];
    matches.push(row);
    byMedia.set(key, matches);
  }
  for (const image of images) {
    const key = mediaKey(image);
    incomingCounts.set(key, (incomingCounts.get(key) ?? 0) + 1);
  }
  const nextShared: AdminMediaDraft[] = [];
  for (const [index, image] of images.entries()) {
    const identity = image.id ?? image.clientKey;
    let previous = identity === undefined ? undefined : byIdentity.get(identity);
    if (identity === undefined) {
      const matches = byMedia.get(mediaKey(image)) ?? [];
      const unique = matches.length === 1 && incomingCounts.get(mediaKey(image)) === 1;
      if (!unique && image.isScene === undefined && matches.some(row => row.isScene)) {
        throw new Error("Cannot uniquely preserve scene metadata for ambiguous duplicate media URLs; provide stable media identities.");
      }
      if (unique) previous = matches[0];
    }
    const ref: EntityRef = previous
      ? previous.id !== undefined ? { id: previous.id } : { clientKey: previous.clientKey! }
      : image.id !== undefined ? { id: image.id }
        : { clientKey: image.clientKey ?? freshClientKey("media", { ...draft, media: [...draft.media, ...nextShared] }) };
    const type = image.type ?? "IMAGE";
    const order = Number(image.sortOrder ?? index);
    nextShared.push({
      ...ref, url: image.url, type, altText: image.altText || null,
      sortOrder: Number.isInteger(order) && order >= 0 ? order : index,
      isScene: type === "IMAGE" && (image.isScene ?? previous?.isScene ?? false),
      optionValueRef: null, variantRef: null,
    });
  }
  if (shared.length === nextShared.length && shared.every((row, index) => {
    const next = nextShared[index]!;
    return rowKey(row) === rowKey(next) && row.url === next.url && row.type === next.type &&
      (row.altText ?? "") === (next.altText ?? "") && row.sortOrder === next.sortOrder &&
      (row.isScene ?? false) === next.isScene;
  })) return;
  draft.media = [...nextShared, ...scoped];
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
      ...(variant.cardMedia !== undefined ? { cardMedia: variant.cardMedia } : {}),
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
        isScene: media.isScene ?? false,
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

// --- Phase B helpers (Task 11 two-phase save) -----------------------------------

export interface ResolvedStockWrite {
  skuId: string;
  onHand: number;
  /** Row label for the failure/retry UI. */
  label: string;
}

export interface UnresolvedStockWrite {
  onHand: number;
  label: string;
  error: string;
}

/**
 * Maps Phase B stock writes onto real SKU ids. Persisted rows already carry
 * `skuId`; browser-created rows only have a client key, and the batch endpoint
 * predates client keys — so the client key is resolved through the draft row's
 * SKU code against the graph PATCH response, which contains every variant of
 * the new snapshot WITH its SKU id. Unresolvable rows are reported instead of
 * guessed (the retry UI keeps them visible).
 */
export function resolveStockBatchWrites(
  writes: readonly StockBatchWrite[],
  draft: AdminCatalogGraphDraft,
  saved: AdminProduct,
): { ready: ResolvedStockWrite[]; unresolved: UnresolvedStockWrite[] } {
  // Labels are keyed by BOTH the variant row key and the SKU id: persisted
  // stock writes arrive addressed by skuId, client-key writes by variant key.
  const labelOf = new Map<string, string>();
  for (const variant of draft.variants) {
    const label = variant.name || variant.combinationKey;
    if (variant.id !== undefined) labelOf.set(variant.id, label);
    if (variant.sku?.id) labelOf.set(variant.sku.id, label);
    if (variant.clientKey !== undefined) labelOf.set(variant.clientKey, label);
  }
  const savedSkuIdByCode = new Map<string, string>();
  for (const variant of saved.variants) {
    const code = variant.sku?.skuCode.trim().toLowerCase();
    if (code && variant.sku && !savedSkuIdByCode.has(code)) {
      savedSkuIdByCode.set(code, variant.sku.id);
    }
  }

  const ready: ResolvedStockWrite[] = [];
  const unresolved: UnresolvedStockWrite[] = [];
  for (const write of writes) {
    if (write.skuId !== undefined) {
      ready.push({
        skuId: write.skuId,
        onHand: write.onHand,
        label: labelOf.get(write.skuId) ?? write.skuId,
      });
      continue;
    }
    const variant = draft.variants.find(
      (candidate) => candidate.clientKey === write.skuClientKey,
    );
    const code = variant?.sku?.skuCode.trim().toLowerCase() ?? "";
    const skuId = code ? savedSkuIdByCode.get(code) : undefined;
    const label =
      (variant && labelOf.get(rowKey(variant))) || write.skuClientKey || "";
    if (!variant) {
      unresolved.push({
        onHand: write.onHand,
        label,
        error: "The variant row is no longer in the draft.",
      });
    } else if (!skuId) {
      unresolved.push({
        onHand: write.onHand,
        label,
        error:
          "Could not resolve the new SKU id from the save response (check the SKU code).",
      });
    } else {
      ready.push({ skuId, onHand: write.onHand, label });
    }
  }
  return { ready, unresolved };
}

/**
 * Drops media rows a graph save cannot express: blanks (the editor keeps an
 * in-progress row until it has a URL — persisted blanks become retirements)
 * and rows scoped to a client key that no longer matches any draft row (the
 * backend rejects unknown client keys rather than ignoring them).
 */
export function stripUnsavableMedia(draft: AdminCatalogGraphDraft): void {
  const optionValueKeys = new Set(
    draft.options.flatMap((option) => option.values.map(rowKey)),
  );
  const variantKeys = new Set(draft.variants.map(rowKey));
  draft.media = draft.media.filter((row) => {
    if (!row.url.trim()) return false;
    if (
      row.optionValueRef &&
      row.optionValueRef.id === undefined &&
      !optionValueKeys.has(row.optionValueRef.clientKey ?? "")
    ) {
      return false;
    }
    if (
      row.variantRef &&
      row.variantRef.id === undefined &&
      !variantKeys.has(row.variantRef.clientKey ?? "")
    ) {
      return false;
    }
    return true;
  });
}
