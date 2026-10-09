"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Field,
  Select,
  TextInput,
  Textarea,
} from "@/components/admin/Field";
import { Button } from "@/components/ui/Button";
import { DecimalInput } from "./DecimalInput";
import { ProductFormHeader, PRODUCT_FORM_TABS, type ProductFormTabKey } from "./product-form/ProductFormHeader";
import { ProductFormErrorRail } from "./product-form/ProductFormErrorRail";
import { ProductEditorRail } from "./product-form/ProductEditorRail";
import { ProductPreviewPanel } from "./product-form/ProductPreviewPanel";
import {
  ProductSeoLinksPanel,
  type SavedProductLinkContext,
} from "./product-form/ProductSeoLinksPanel";
import { ProductDetailBody } from "@/components/product/ProductDetailBody";
import { ProductSpecs } from "@/components/product/ProductSpecs";
import {
  formatAmount,
  type AdminCategoryNode,
  type CreateProductInput,
  type ProductStatus,
} from "@/lib/admin-api";
import {
  buildVariantCandidates,
  entityRowKey,
  type AdminCatalogGraphDraft,
} from "@/lib/admin-product-graph";
import {
  collectGraphIssues,
  serverIssuesFromError,
  type AdminProductIssue,
  type AdminProductIssueAction,
} from "@/lib/admin-product-issues";
import {
  productReadiness,
  type ReadinessCheckKey,
  type ReadinessWarningKey,
} from "@/lib/admin-product-readiness";
import { ProductOptionsEditor } from "./ProductOptionsEditor";
import { VariantMatrix } from "./VariantMatrix";
import { ProductMediaPanel } from "./product-form/ProductMediaPanel";
import { useMediaBatchUpload } from "./product-form/useMediaBatchUpload";
import { useAdminI18n, type TKey } from "@/lib/admin-i18n";
import { en } from "@/i18n/en";

/**
 * Shared product form for /admin/products/new (Task 9) and
 * /admin/products/[id]/edit (Task 10). Every numeric field is kept as a
 * STRING in state so partial edits ("1299." / "") never fight a controlled
 * numeric input; serialization + validation happens in the pure
 * serializeFormValue() below, mirroring backend product.dto.ts limits.
 */

export interface ProductFormValue {
  name: string;
  slug: string;
  description: string;
  /** First-screen one-line selling point under the H1. Empty hides the row. */
  tagline: string;
  /** Independent search metadata; never aliases description or tagline. */
  seoTitle: string;
  metaDescription: string;
  categoryId: string;
  status: ProductStatus;
  room: string;
  internalRole: string;
  solutions: string[];
  width: string;
  height: string;
  depth: string;
  foldedWidth: string;
  foldedHeight: string;
  foldedDepth: string;
  /** Structured specifications, edited outside the description. */
  materials: string;
  /** One feature per array slot (each becomes one line). */
  features: string[];
  images: { url: string; type: "IMAGE" | "VIDEO"; altText: string; sortOrder: string }[];
  /** PDP description body. Media-only: the supplier detail decks are images
   *  and videos, and `description` already carries the short text intro. */
  detailBlocks: {
    type: "IMAGE" | "VIDEO";
    url: string;
    altText: string;
    sortOrder: string;
  }[];
  variants: {
    name: string;
    position: string;
    sku: {
      skuCode: string;
      status: "ACTIVE" | "DISABLED";
      price: string;
      compareAtPrice: string;
      supplierSku: string;
      supplierCost: string;
      costCurrency: string;
      landedCost: string;
      productWeight: string;
      packageWidth: string;
      packageHeight: string;
      packageDepth: string;
      packageWeight: string;
      volumetricWeight: string;
      // Stock is not part of the product payload: `id` locates the SKU for the
      // separate stock write, `stock` is the on-hand figure this form edits and
      // `reserved` is read-only context. serializeProduct ignores all three.
      id: string;
      stock: string;
      reserved: string;
    } | null;
  }[];
  /**
   * Typed catalog option graph draft (Task 10), hydrated by the edit page's
   * deserializeProduct and diffed against server truth on save; the Task 11
   * editors below mutate it. serializeFormValue ignores it.
   */
  graph?: AdminCatalogGraphDraft;
  /**
   * True when the server payload actually CARRIED the typed graph
   * (options/media on the wire). Those products get the Task 11
   * options/matrix editors instead of the legacy free-form list. A draft
   * whose catalogGraphVersion > 0 without graphTyped is a graph product the
   * admin GET cannot yet hydrate: the legacy whole-list variants/images
   * editors are locked client-side (the backend 409s such writes) until the
   * typed payload ships — this is the 409-trap guard.
   */
  graphTyped?: boolean;
}

export type SkuFormValue = NonNullable<
  ProductFormValue["variants"][number]["sku"]
>;
export type ImageFormValue = ProductFormValue["images"][number];
export type DetailBlockFormValue = ProductFormValue["detailBlocks"][number];
export type VariantFormValue = ProductFormValue["variants"][number];

function nextImageSortOrder(images: readonly ImageFormValue[]): string {
  const maximum = images.reduce((max, image) => {
    const order = Number(image.sortOrder.trim() || "0");
    return Math.max(max, Number.isFinite(order) ? order : 0);
  }, -1);
  return String(maximum + 1);
}

/** Appends after existing orders, preserving the cover even after deletions. */
export function appendImage(
  images: ImageFormValue[],
  type: ImageFormValue["type"],
): ImageFormValue[] {
  return [
    ...images,
    { url: "", type, altText: "", sortOrder: nextImageSortOrder(images) },
  ];
}

/** Appends an image row that already carries its uploaded/pasted URL. */
export function appendImageUrl(
  images: ImageFormValue[],
  url: string,
): ImageFormValue[] {
  return [
    ...images,
    { url, type: "IMAGE", altText: "", sortOrder: nextImageSortOrder(images) },
  ];
}

/**
 * Adds a detail block, numbered by position so a later ↑/↓ reorder stays
 * consistent.
 */
export function appendDetailBlock(
  blocks: DetailBlockFormValue[],
  type: DetailBlockFormValue["type"],
): DetailBlockFormValue[] {
  return [
    ...blocks,
    { type, url: "", altText: "", sortOrder: String(blocks.length) },
  ];
}

export type SerializeFormResult =
  | { ok: true; value: CreateProductInput }
  | { ok: false; error: string; fieldErrors: Record<string, string> };

// --- backend enum mirrors (src/lib/admin-api.ts + Prisma) --------------------

const SKU_STATUSES: SkuFormValue["status"][] = ["ACTIVE", "DISABLED"];
const ROOMS = ["BEDROOM", "STORAGE", "DINING_LIVING", "HOME_OFFICE"] as const;
const INTERNAL_ROLES = [
  "HERO",
  "CORE",
  "ENTRY",
  "PRE_ORDER",
  "PREMIUM",
] as const;
const SOLUTIONS = [
  "FOLDABLE",
  "NARROW_SPACE",
  "MOBILE",
  "MULTIFUNCTIONAL",
  "HIDDEN_STORAGE",
  "RENTAL_FRIENDLY",
] as const;

const ROOM_LABEL_KEYS: Record<string, TKey> = {
  BEDROOM: "product_room_BEDROOM",
  STORAGE: "product_room_STORAGE",
  DINING_LIVING: "product_room_DINING_LIVING",
  HOME_OFFICE: "product_room_HOME_OFFICE",
};
const ROLE_LABEL_KEYS: Record<string, TKey> = {
  HERO: "product_role_HERO",
  CORE: "product_role_CORE",
  ENTRY: "product_role_ENTRY",
  PREMIUM: "product_role_PREMIUM",
  PRE_ORDER: "product_role_PRE_ORDER",
};
const SOLUTION_LABEL_KEYS: Record<string, TKey> = {
  FOLDABLE: "product_solution_FOLDABLE",
  NARROW_SPACE: "product_solution_NARROW_SPACE",
  MOBILE: "product_solution_MOBILE",
  MULTIFUNCTIONAL: "product_solution_MULTIFUNCTIONAL",
  HIDDEN_STORAGE: "product_solution_HIDDEN_STORAGE",
  RENTAL_FRIENDLY: "product_solution_RENTAL_FRIENDLY",
};

/**
 * Message translator used by the pure serializer/validation helpers. The form
 * passes the active admin dictionary so field-level errors follow the UI
 * language; the English dictionary below is the interpolation-capable fallback
 * for payload-only callers, so a raw "{label}" template can never leak.
 */
export type ProductFormTranslate = (key: TKey, vars?: Record<string, string | number>) => string;
const defaultTranslate: ProductFormTranslate = (key, vars) => {
  const template = en[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k: string) =>
    vars[k] !== undefined ? String(vars[k]) : `{${k}}`,
  );
};

// Backend DTO bounds (product.dto.ts / category.dto.ts slugSchema).
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Structural UUID only (ids in this DB are UUIDv7; z.string().uuid() accepts
// any version nibble, so do not constrain version/variant digits).
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Standard finite decimal forms incl. scientific notation (Number()-parsable).
const NUM_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

const DIMENSION_FIELDS: {
  key:
    | "width"
    | "height"
    | "depth"
    | "foldedWidth"
    | "foldedHeight"
    | "foldedDepth";
  labelKey: TKey;
  hintKey: TKey;
}[] = [
  { key: "width", labelKey: "product_dim_width", hintKey: "product_dim_width_hint" },
  { key: "height", labelKey: "product_dim_height", hintKey: "product_dim_height_hint" },
  { key: "depth", labelKey: "product_dim_depth", hintKey: "product_dim_depth_hint" },
  { key: "foldedWidth", labelKey: "product_dim_folded_width", hintKey: "product_dim_folded_width_hint" },
  { key: "foldedHeight", labelKey: "product_dim_folded_height", hintKey: "product_dim_folded_height_hint" },
  { key: "foldedDepth", labelKey: "product_dim_folded_depth", hintKey: "product_dim_folded_depth_hint" },
];

const SKU_NUM_FIELDS: { key: keyof SkuFormValue; labelKey: TKey }[] = [
  { key: "price", labelKey: "product_sku_price" },
  { key: "compareAtPrice", labelKey: "product_sku_compare_at" },
  { key: "supplierCost", labelKey: "product_sku_supplier_cost" },
  { key: "landedCost", labelKey: "product_sku_landed_cost" },
  { key: "productWeight", labelKey: "product_sku_product_weight" },
  { key: "packageWidth", labelKey: "product_sku_package_width" },
  { key: "packageHeight", labelKey: "product_sku_package_height" },
  { key: "packageDepth", labelKey: "product_sku_package_depth" },
  { key: "packageWeight", labelKey: "product_sku_package_weight" },
  { key: "volumetricWeight", labelKey: "product_sku_volumetric_weight" },
];

const SKU_LABEL_KEYS: Partial<Record<keyof SkuFormValue, TKey>> = Object.fromEntries(
  SKU_NUM_FIELDS.map((f) => [f.key, f.labelKey]),
) as Partial<Record<keyof SkuFormValue, TKey>>;

// Per-field operator guidance inside the SKU box.
const SKU_FIELD_HINT_KEYS: Partial<Record<keyof SkuFormValue, TKey>> = {
  price: "product_sku_price_hint",
  compareAtPrice: "product_sku_compare_at_hint",
  supplierCost: "product_sku_supplier_cost_hint",
  landedCost: "product_sku_landed_cost_hint",
  productWeight: "product_sku_product_weight_hint",
  packageWidth: "product_sku_package_width_hint",
  packageHeight: "product_sku_package_height_hint",
  packageDepth: "product_sku_package_depth_hint",
  packageWeight: "product_sku_package_weight_hint",
  volumetricWeight: "product_sku_volumetric_weight_hint",
};

// How the numeric SKU fields are grouped in the form (serialization still
// iterates the flat SKU_NUM_FIELDS list).

/** Parses a form number string for the live spec preview; invalid → null. */
function previewNumber(raw: string): number | null {
  const s = raw.trim();
  if (!s || !NUM_RE.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function emptySkuFormValue(): SkuFormValue {
  return {
    skuCode: "",
    status: "ACTIVE",
    price: "",
    compareAtPrice: "",
    supplierSku: "",
    supplierCost: "",
    costCurrency: "",
    landedCost: "",
    productWeight: "",
    packageWidth: "",
    packageHeight: "",
    packageDepth: "",
    packageWeight: "",
    volumetricWeight: "",
    id: "",
    stock: "0",
    reserved: "0",
  };
}

export function emptyProductFormValue(): ProductFormValue {
  return {
    name: "",
    slug: "",
    description: "",
    tagline: "",
    seoTitle: "",
    metaDescription: "",
    categoryId: "",
    status: "DRAFT",
    room: "",
    internalRole: "",
    solutions: [],
    width: "",
    height: "",
    depth: "",
    foldedWidth: "",
    foldedHeight: "",
    foldedDepth: "",
    materials: "",
    features: [],
    images: [],
    detailBlocks: [],
    variants: [],
    graph: {
      catalogGraphVersion: 0,
      defaultDisplayVariantRef: null,
      options: [],
      variants: [],
      media: [],
    },
    graphTyped: true,
  };
}

type FieldErrors = Record<string, string>;

function addError(errors: FieldErrors, key: string, message: string): void {
  // First failure per field wins.
  if (!errors[key]) errors[key] = message;
}

/**
 * Parses an optional nonnegative number field. Empty -> null (nullable
 * dimensions); invalid/negative records a field error. Callers needing
 * `undefined` semantics (optional SKU numbers) inspect the raw string.
 */
function parseNonNegative(
  raw: string,
  key: string,
  label: string,
  errors: FieldErrors,
  translate: ProductFormTranslate,
): number | null {
  const s = raw.trim();
  if (s === "") return null;
  if (!NUM_RE.test(s)) {
    addError(errors, key, translate("product_err_not_number", { label }));
    return null;
  }
  const n = Number(s);
  if (!Number.isFinite(n)) {
    addError(errors, key, translate("product_err_not_number", { label }));
    return null;
  }
  if (n < 0) {
    addError(errors, key, translate("product_err_negative", { label }));
    return null;
  }
  return n;
}

/** Integer field defaulting to 0; non-whole or negative values error. */
function parseNonNegativeInt(
  raw: string,
  key: string,
  label: string,
  errors: FieldErrors,
  translate: ProductFormTranslate,
): number {
  const s = raw.trim();
  if (s === "") return 0;
  if (!NUM_RE.test(s)) {
    addError(errors, key, translate("product_err_not_integer", { label }));
    return 0;
  }
  const n = Number(s);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    addError(errors, key, translate("product_err_not_integer", { label }));
    return 0;
  }
  if (n < 0) {
    addError(errors, key, translate("product_err_negative", { label }));
    return 0;
  }
  return n;
}

type CreateSkuInput = NonNullable<
  CreateProductInput["variants"][number]["sku"]
>;

/**
 * Mirrors the backend siteMediaUrl() rule: an absolute http(s) URL or a
 * site-relative path starting with a single "/" — the shape the local-disk
 * upload endpoint returns (/uploads/catalog/2026/….jpg|mp4). The old
 * `new URL(url)` check rejected those relative paths and blocked every
 * locally-uploaded file from saving.
 */
function isValidMediaUrl(url: string): boolean {
  return (
    /^https?:\/\/.+/i.test(url) ||
    (url.startsWith("/") && !url.startsWith("//") && url.length > 1)
  );
}

/**
 * Pure create-semantics serializer + client validation (spec §9 parity with
 * the backend zod DTO; the server re-validates). Empty nullable strings
 * become null; optional SKU fields are omitted (undefined) when blank.
 * Task 10 will reuse this for edit (partial) serialization.
 */
/**
 * Stock is edited in this form but written through the inventory API, so it is
 * not part of the serialized payload and serializeFormValue cannot validate
 * it. Both save paths call this first; returns a message, or null when valid.
 */
export function validateStockEntry(
  value: ProductFormValue,
  translate: ProductFormTranslate = defaultTranslate,
): string | null {
  for (const [index, variant] of value.variants.entries()) {
    const raw = variant.sku?.stock.trim() ?? "";
    if (raw === "") continue;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return translate("product_err_stock_entry", { number: index + 1 });
    }
  }
  return null;
}

export function serializeFormValue(
  v: ProductFormValue,
  translate: ProductFormTranslate = defaultTranslate,
): SerializeFormResult {
  const errors: FieldErrors = {};

  // --- Basics --------------------------------------------------------------
  const name = v.name.trim();
  if (!name) addError(errors, "name", translate("product_err_name_required"));
  else if (name.length > 255)
    addError(errors, "name", translate("product_err_name_max"));

  const slug = v.slug.trim();
  if (!slug) addError(errors, "slug", translate("product_err_slug_required"));
  else if (slug.length > 120)
    addError(errors, "slug", translate("product_slug_hint"));
  else if (!SLUG_RE.test(slug))
    addError(errors, "slug", translate("product_slug_hint"));

  const description = v.description.trim();
  if (description.length > 5000)
    addError(errors, "description", translate("product_err_description_max"));

  const tagline = v.tagline.trim();
  if (tagline.length > 200)
    addError(errors, "tagline", translate("product_err_tagline_max"));

  const seoTitle = v.seoTitle.trim();
  if (seoTitle.length > 200)
    addError(errors, "seoTitle", translate("product_err_seo_title_max"));

  const metaDescription = v.metaDescription.trim();
  if (metaDescription.length > 300)
    addError(
      errors,
      "metaDescription",
      translate("product_err_meta_description_max"),
    );

  const materials = v.materials.trim();
  if (materials.length > 1000)
    addError(errors, "materials", translate("product_err_materials_max"));

  const features = v.features
    .map((line) => line.trim())
    .filter(Boolean);
  if (features.some((line) => line.length > 200))
    addError(errors, "features", translate("product_err_feature_line_max"));
  if (features.join("\n").length > 2000)
    addError(errors, "features", translate("product_err_features_max"));

  if (!v.categoryId)
    addError(errors, "categoryId", translate("product_err_category_required"));
  else if (!UUID_RE.test(v.categoryId))
    addError(errors, "categoryId", translate("product_err_category_invalid"));

  // --- Dimensions ----------------------------------------------------------
  const dimensions = {} as Pick<
    CreateProductInput,
    "width" | "height" | "depth" | "foldedWidth" | "foldedHeight" | "foldedDepth"
  >;
  for (const { key, labelKey } of DIMENSION_FIELDS) {
    dimensions[key] = parseNonNegative(
      v[key],
      key,
      translate(labelKey),
      errors,
      translate,
    );
  }

  // --- Images --------------------------------------------------------------
  const images: CreateProductInput["images"] = [];
  v.images.forEach((img, i) => {
    const url = img.url.trim();
    const altText = img.altText.trim();
    const sortRaw = img.sortOrder.trim();
    // A row with no content is dropped silently, not validated — that is what
    // lets an operator click "Add photo" and save without filling it in.
    // sortOrder is positional, not content, so it does not count as filled in.
    if (!url && !altText) return;

    if (!url) addError(errors, `images.${i}.url`, translate("product_err_image_url_required"));
    else if (url.length > 2048)
      addError(errors, `images.${i}.url`, translate("product_err_image_url_max"));
    else if (!isValidMediaUrl(url)) {
      addError(errors, `images.${i}.url`, translate("product_err_image_url_invalid"));
    }
    if (altText.length > 255)
      addError(errors, `images.${i}.altText`, translate("product_err_alt_max"));
    const sortOrder = parseNonNegativeInt(
      sortRaw,
      `images.${i}.sortOrder`,
      translate("product_label_sort_order"),
      errors,
      translate,
    );
    images.push({
      url,
      type: img.type,
      ...(altText ? { altText } : {}),
      sortOrder,
    });
  });

  // --- Detail blocks -------------------------------------------------------
  const detailBlocks: CreateProductInput["detailBlocks"] = [];
  v.detailBlocks.forEach((block, i) => {
    const url = block.url.trim();
    const altText = block.altText.trim();
    // Same rule as the gallery: sortOrder is positional, so only real content
    // keeps a row alive.
    if (!url && !altText) return;

    if (!url) addError(errors, `detailBlocks.${i}.url`, translate("product_err_detail_url_required"));
    else if (url.length > 2048)
      addError(errors, `detailBlocks.${i}.url`, translate("product_err_detail_url_max"));
    else if (!isValidMediaUrl(url)) {
      addError(errors, `detailBlocks.${i}.url`, translate("product_err_detail_url_invalid"));
    }
    if (altText.length > 255)
      addError(errors, `detailBlocks.${i}.altText`, translate("product_err_alt_max"));
    const sortOrder = parseNonNegativeInt(
      block.sortOrder,
      `detailBlocks.${i}.sortOrder`,
      translate("product_label_sort_order"),
      errors,
      translate,
    );
    detailBlocks.push({
      type: block.type,
      url,
      ...(altText ? { altText } : {}),
      sortOrder,
    });
  });

  // --- Variants + SKUs -----------------------------------------------------
  const variants: CreateProductInput["variants"] = [];
  v.variants.forEach((vr, i) => {
    const variantName = vr.name.trim();
    if (!variantName)
      addError(errors, `variants.${i}.name`, translate("product_err_variant_name_required"));
    else if (variantName.length > 120)
      addError(errors, `variants.${i}.name`, translate("product_err_variant_name_max"));
    const position = parseNonNegativeInt(
      vr.position,
      `variants.${i}.position`,
      translate("product_label_position"),
      errors,
      translate,
    );

    let sku: CreateSkuInput | undefined;
    if (vr.sku) {
      const formSku = vr.sku;
      const skuCode = formSku.skuCode.trim();
      if (!skuCode)
        addError(errors, `variants.${i}.sku.skuCode`, translate("product_err_sku_code_required"));
      else if (skuCode.length > 64)
        addError(errors, `variants.${i}.sku.skuCode`, translate("product_err_sku_code_max"));

      const supplierSku = formSku.supplierSku.trim();
      if (supplierSku.length > 120)
        addError(errors, `variants.${i}.sku.supplierSku`, translate("product_err_supplier_sku_max"));
      const costCurrency = formSku.costCurrency.trim();
      if (costCurrency.length > 8)
        addError(errors, `variants.${i}.sku.costCurrency`, translate("product_err_currency_max"));

      const skuRecord: Record<string, string | number> = {
        skuCode,
        status: SKU_STATUSES.includes(formSku.status)
          ? formSku.status
          : "ACTIVE",
      };
      if (supplierSku) skuRecord.supplierSku = supplierSku;
      if (costCurrency) skuRecord.costCurrency = costCurrency;
      for (const { key, labelKey } of SKU_NUM_FIELDS) {
        const raw = formSku[key].trim();
        const n = parseNonNegative(
          raw,
          `variants.${i}.sku.${key}`,
          translate(labelKey),
          errors,
          translate,
        );
        // Empty -> omit (optional server field); parse errors are recorded.
        if (raw !== "" && n !== null) skuRecord[key] = n;
      }
      sku = skuRecord as CreateSkuInput;
    }

    variants.push({
      name: variantName,
      position,
      ...(sku ? { sku } : {}),
    });
  });

  if (Object.keys(errors).length > 0) {
    return {
      ok: false,
      error: translate("product_err_fix_highlighted"),
      fieldErrors: errors,
    };
  }

  const value: CreateProductInput = {
    name,
    slug,
    description: description || null,
    tagline: tagline || null,
    seoTitle: seoTitle || null,
    metaDescription: metaDescription || null,
    categoryId: v.categoryId,
    status: v.status,
    room: v.room || null,
    internalRole: v.internalRole || null,
    solutions: v.solutions.filter((s) =>
      (SOLUTIONS as readonly string[]).includes(s),
    ),
    ...dimensions,
    materials: materials || null,
    features: features.join("\n") || null,
    images,
    detailBlocks,
    variants,
  };
  return { ok: true, value };
}

// --- tree flattening ---------------------------------------------------------

type FlatCategory = { id: string; name: string; depth: number };

function flattenCategories(
  nodes: AdminCategoryNode[],
  depth = 0,
  acc: FlatCategory[] = [],
): FlatCategory[] {
  for (const node of nodes) {
    acc.push({ id: node.id, name: node.name, depth });
    if (node.children.length > 0) {
      flattenCategories(node.children, depth + 1, acc);
    }
  }
  return acc;
}

// --- presentational helpers --------------------------------------------------

/**
 * Panel section header + body. Light visual hierarchy on purpose: no bordered
 * white cards — sections are separated by spacing and heading size alone, so
 * the page reads as one form, not a stack of boxes.
 */
function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
}): ReactNode {
  return (
    <section>
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {hint ? (
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">{hint}</p>
      ) : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

const removeBtnCls =
  "self-end text-sm font-semibold text-red-700 hover:underline disabled:text-ink-muted disabled:no-underline";

// --- the form ----------------------------------------------------------------

/** Editor tabs; the single form state object spans all of them. */
const TABS = PRODUCT_FORM_TABS;

/** Stand-in draft for server-error parsing when the product has no typed graph. */
const EMPTY_GRAPH_DRAFT: AdminCatalogGraphDraft = {
  catalogGraphVersion: 0,
  defaultDisplayVariantRef: null,
  options: [],
  variants: [],
  media: [],
};
type TabKey = ProductFormTabKey;

const READINESS_CHECK_TABS: Record<ReadinessCheckKey, TabKey> = {
  basic: "basic",
  priced_sku: "variants",
  shared_media: "media",
  shipping: "shipping",
  default_variant: "variants",
};

const READINESS_WARNING_TABS: Record<ReadinessWarningKey, TabKey> = {
  seo: "seo",
  option_media: "media",
};

const SHIPPING_SKU_KEYS = [
  "productWeight",
  "packageWidth",
  "packageHeight",
  "packageDepth",
  "packageWeight",
  "volumetricWeight",
] as const;

/** Maps a flat validation-error key (`variants.0.sku.price`) to its tab. */
function tabForErrorKey(key: string): TabKey {
  if (key.startsWith("variants.")) {
    return SHIPPING_SKU_KEYS.some((k) => key.includes(`.sku.${k}`))
      ? "shipping"
      : "variants";
  }
  if (key.startsWith("images.") || key.startsWith("detailBlocks.")) return "media";
  if (key === "slug" || key === "seoTitle" || key === "metaDescription")
    return "seo";
  if (
    DIMENSION_FIELDS.some((f) => f.key === key) ||
    key === "materials" ||
    key === "features"
  )
    return "specs";
  return "basic";
}

export interface ProductFormProps {
  initial: ProductFormValue;
  categories: AdminCategoryNode[];
  onSubmit: (v: ProductFormValue) => void;
  /** Kept for callers that still pass the old copy; the header derives its label from status truth. */
  submitLabel?: string;
  pending: boolean;
  error: string | null;
  savedPreview: SavedProductLinkContext | null;
  /**
   * Saved identity for the sticky header (server truth). Absent on /new.
   * The product number is display-only — it is minted once and never edited.
   */
  identity?: {
    name: string;
    productCode: string | null;
    coverImageUrl: string | null;
    updatedAt: string | null;
  } | null;
  /** Landing pages attached to this product; null while unknown. */
  landingCount?: number | null;
  /** Saved product id, for the rail's landing-page link. */
  productId?: string | null;
  /** Canonical editor section requested by an internal deep link. */
  requestedSection?: ProductFormTabKey | null;
  /** Persisted SKU code requested by an internal search result. */
  requestedSkuCode?: string | null;
}

export function ProductForm({
  initial,
  categories,
  onSubmit,
  pending,
  error,
  savedPreview,
  identity = null,
  landingCount = null,
  productId = null,
  requestedSection = null,
  requestedSkuCode = null,
}: ProductFormProps): ReactNode {
  const { t, lang } = useAdminI18n();
  const [value, setValue] = useState<ProductFormValue>(initial);
  // Re-sync when `initial` changes identity (Task 10: loaded after fetch).
  // Render-phase adjustment (same pattern as the products list URL sync);
  // an effect would cascade-render and trips react-hooks/set-state-in-effect.
  const [syncedInitial, setSyncedInitial] = useState<ProductFormValue>(initial);
  if (initial !== syncedInitial) {
    setSyncedInitial(initial);
    setValue(initial);
  }

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  // Blocking problems in rail form: graph/serializer issues raised by the last
  // submit attempt, each carrying the row it belongs to and its repairs.
  const [issues, setIssues] = useState<AdminProductIssue[]>([]);
  // Row to highlight after a jump or a one-click repair. The nonce re-arms the
  // scroll/focus effect when the same row is targeted twice.
  const [highlight, setHighlight] = useState<{
    key: string;
    nonce: number;
  } | null>(null);
  // Which editor tab is open. Panels are conditionally rendered but all state
  // lives in `value` above, so switching tabs never loses edits.
  const [activeTab, setActiveTab] = useState<TabKey>(
    requestedSection ?? "basic",
  );
  const requestIdentity = `${requestedSection ?? ""}\u0000${requestedSkuCode ?? ""}`;
  const [syncedRequestIdentity, setSyncedRequestIdentity] =
    useState(requestIdentity);
  if (requestIdentity !== syncedRequestIdentity) {
    setSyncedRequestIdentity(requestIdentity);
    if (requestedSection !== null) setActiveTab(requestedSection);
  }
  const legacySkuRefs = useRef(new Map<string, HTMLInputElement>());

  // --- Task 11: typed catalog graph mode ------------------------------------
  // Typed = the server payload carried options/media, so the options/matrix
  // editors own variant+pricing editing. Locked = catalogGraphVersion > 0 but
  // no typed payload (admin GET gap): the backend 409s legacy whole-list
  // writes for graph products, so the UI pauses those editors explicitly
  // instead of letting a doomed PATCH surface as a raw 409.
  const typed = value.graphTyped === true && value.graph !== undefined;
  const graphLocked = !typed && (value.graph?.catalogGraphVersion ?? 0) > 0;
  const graphDraft = typed && value.graph ? value.graph : null;

  useLayoutEffect(() => {
    if (
      requestedSection !== "variants" ||
      requestedSkuCode === null ||
      activeTab !== "variants" ||
      typed ||
      graphLocked
    ) {
      return;
    }
    const input = legacySkuRefs.current.get(requestedSkuCode);
    if (!input) return;
    input.focus();
    input.scrollIntoView({ block: "center" });
  }, [
    activeTab,
    graphLocked,
    requestedSection,
    requestedSkuCode,
    syncedInitial,
    typed,
  ]);

  const updateGraph = (mutate: (draft: AdminCatalogGraphDraft) => void): void => {
    setValue((prev) => {
      if (!prev.graph) return prev;
      const draft = structuredClone(prev.graph);
      mutate(draft);
      return { ...prev, graph: draft };
    });
    clearValidation();
  };

  // Candidates recompute whenever the graph changes; buildVariantCandidates
  // throws past the global constraints (0-value groups / >2 groups / >100
  // candidates) — the matrix then renders empty and the problem rail carries
  // the structure error (collectGraphIssues re-runs the same builder).
  const candidates = useMemo(() => {
    if (!graphDraft) return [];
    try {
      return buildVariantCandidates(graphDraft);
    } catch {
      return [];
    }
  }, [graphDraft]);

  // Shipping tab on typed products: numeric SKU fields commit only valid
  // values (blank → null clears); invalid keystrokes are ignored rather than
  // fighting the controlled input.
  const setDraftSkuField = (
    combinationKey: string,
    key: (typeof SHIPPING_SKU_KEYS)[number],
    value: number | null,
  ): void => {
    updateGraph((draft) => {
      const variant = draft.variants.find(
        (item) => item.combinationKey === combinationKey,
      );
      if (!variant?.sku) return;
      variant.sku = {
        ...variant.sku,
        [key]: value,
      };
    });
  };

  const flatCategories = flattenCategories(categories);
  const err = (key: string): string | undefined => fieldErrors[key];

  // --- side rail: derived, read-only ---------------------------------------
  // Dirty = the form differs from the last saved value. A JSON comparison is
  // enough for this shape (plain data, no cycles) and keeps the header honest.
  const dirty = useMemo(
    () => JSON.stringify(value) !== JSON.stringify(initial),
    [value, initial],
  );

  const savedAt = identity?.updatedAt ? new Date(identity.updatedAt) : null;
  const headerIdentity = identity
    ? {
        name: identity.name,
        productCode: identity.productCode,
        coverImageUrl: identity.coverImageUrl,
        lastSavedLabel:
          savedAt && !Number.isNaN(savedAt.getTime())
            ? t("product_form_last_saved", {
                date: savedAt.toLocaleString(lang === "zh" ? "zh-CN" : "en-PH", {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                }),
              })
            : null,
      }
    : null;

  const readiness = useMemo(
    () =>
      productReadiness({
        name: value.name,
        slug: value.slug,
        categoryId: value.categoryId,
        tagline: value.tagline,
        description: value.description,
        images: value.images,
        graph: graphDraft,
        legacyVariants: value.variants,
      }),
    [value, graphDraft],
  );

  // The rail's blocking list is the SAME issue list the save path builds, so
  // the rail can never claim "ready" while a save would fail.
  const railBlocking = useMemo(
    () => (graphDraft ? collectGraphIssues(graphDraft, t) : []),
    [graphDraft, t],
  );

  const railPriceLabel = useMemo(() => {
    const prices = new Set<number>();
    if (graphDraft) {
      for (const variant of graphDraft.variants) {
        const sku = variant.sku;
        if (!sku || sku.status !== "ACTIVE" || sku.price === null) continue;
        if (Number.isFinite(sku.price)) prices.add(sku.price);
      }
    } else {
      for (const variant of value.variants) {
        const sku = variant.sku;
        if (!sku || sku.status !== "ACTIVE" || sku.price.trim() === "") continue;
        const price = Number(sku.price);
        if (Number.isFinite(price)) prices.add(price);
      }
    }
    const sorted = [...prices].sort((left, right) => left - right);
    if (sorted.length === 0) return "—";
    const lowest = formatAmount(String(sorted[0]));
    const highest = formatAmount(String(sorted[sorted.length - 1]));
    return lowest === highest ? lowest : `${lowest} – ${highest}`;
  }, [graphDraft, value.variants]);

  const clearValidation = (): void => {
    setFieldErrors({});
    setIssues([]);
  };

  const patch = (p: Partial<ProductFormValue>): void => {
    setValue((prev) => ({ ...prev, ...p }));
    clearValidation();
  };

  // Every value mutation clears the client validation state (same clearing
  // path as patch()); the parent server error is left untouched here — it
  // stays visible until the next submit attempt (see render below).
  // --- images ---------------------------------------------------------------
  const setImage = (i: number, p: Partial<ImageFormValue>): void => {
    setValue((prev) => ({
      ...prev,
      images: prev.images.map((img, j) => (j === i ? { ...img, ...p } : img)),
    }));
    clearValidation();
  };
  const addImage = (type: "IMAGE" | "VIDEO" = "IMAGE"): void => {
    setValue((prev) => ({ ...prev, images: appendImage(prev.images, type) }));
    clearValidation();
  };
  const addImageWithUrl = (url: string): void => {
    setValue((prev) => ({
      ...prev,
      images: appendImageUrl(prev.images, url),
    }));
    clearValidation();
  };
  const batchUpload = useMediaBatchUpload({ disabled: pending || graphLocked, onAddImageUrl: addImageWithUrl });
  const removeImage = (i: number): void => {
    setValue((prev) => ({
      ...prev,
      images: prev.images.filter((_, j) => j !== i),
    }));
    clearValidation();
  };
  /**
   * Swaps two image cards and renumbers every sortOrder, so the visual order
   * and the stored order cannot drift apart (cover = lowest sortOrder).
   */
  const moveImage = (i: number, delta: -1 | 1): void => {
    setValue((prev) => {
      const j = i + delta;
      if (j < 0 || j >= prev.images.length) return prev;
      const next = [...prev.images];
      [next[i], next[j]] = [next[j], next[i]];
      return {
        ...prev,
        images: next.map((img, k) => ({ ...img, sortOrder: String(k) })),
      };
    });
    clearValidation();
  };
  /** Drag-and-drop reorder for image cards: move `from` to `to`. */
  const moveImageTo = (from: number, to: number): void => {
    setValue((prev) => {
      if (from === to || from < 0 || to < 0 || from >= prev.images.length || to >= prev.images.length)
        return prev;
      const next = [...prev.images];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return {
        ...prev,
        images: next.map((img, k) => ({ ...img, sortOrder: String(k) })),
      };
    });
    clearValidation();
  };
  /** "Set as cover" = move the card to the front (sortOrder 0). */
  const setCoverImage = (i: number): void => moveImageTo(i, 0);

  // --- features (spec bullets, one line each) -------------------------------
  const setFeatureLine = (i: number, line: string): void => {
    setValue((prev) => ({
      ...prev,
      features: prev.features.map((l, j) => (j === i ? line : l)),
    }));
    clearValidation();
  };
  const addFeatureLine = (): void => {
    setValue((prev) => ({ ...prev, features: [...prev.features, ""] }));
    clearValidation();
  };
  const removeFeatureLine = (i: number): void => {
    setValue((prev) => ({
      ...prev,
      features: prev.features.filter((_, j) => j !== i),
    }));
    clearValidation();
  };
  const moveFeatureLine = (i: number, delta: -1 | 1): void => {
    setValue((prev) => {
      const j = i + delta;
      if (j < 0 || j >= prev.features.length) return prev;
      const next = [...prev.features];
      [next[i], next[j]] = [next[j], next[i]];
      return { ...prev, features: next };
    });
    clearValidation();
  };

  // --- detail blocks --------------------------------------------------------
  const setDetailBlock = (i: number, p: Partial<DetailBlockFormValue>): void => {
    setValue((prev) => ({
      ...prev,
      detailBlocks: prev.detailBlocks.map((b, j) => (j === i ? { ...b, ...p } : b)),
    }));
    clearValidation();
  };
  const addDetailBlock = (type: DetailBlockFormValue["type"]): void => {
    setValue((prev) => ({
      ...prev,
      detailBlocks: appendDetailBlock(prev.detailBlocks, type),
    }));
    clearValidation();
  };
  const removeDetailBlock = (i: number): void => {
    setValue((prev) => ({
      ...prev,
      detailBlocks: prev.detailBlocks
        .filter((_, j) => j !== i)
        .map((b, k) => ({ ...b, sortOrder: String(k) })),
    }));
    clearValidation();
  };
  /**
   * Swaps a block with its neighbour and renumbers every sortOrder, so the
   * visual order and the stored order cannot drift apart.
   */
  const moveDetailBlock = (i: number, delta: -1 | 1): void => {
    setValue((prev) => {
      const j = i + delta;
      if (j < 0 || j >= prev.detailBlocks.length) return prev;
      const next = [...prev.detailBlocks];
      [next[i], next[j]] = [next[j], next[i]];
      return {
        ...prev,
        detailBlocks: next.map((b, k) => ({ ...b, sortOrder: String(k) })),
      };
    });
    clearValidation();
  };

  // --- variants -------------------------------------------------------------
  const setVariant = (i: number, p: Partial<VariantFormValue>): void => {
    setValue((prev) => ({
      ...prev,
      variants: prev.variants.map((vr, j) =>
        j === i ? { ...vr, ...p } : vr,
      ),
    }));
    clearValidation();
  };
  const setSku = (i: number, p: Partial<SkuFormValue>): void => {
    setValue((prev) => ({
      ...prev,
      variants: prev.variants.map((vr, j) =>
        j === i && vr.sku ? { ...vr, sku: { ...vr.sku, ...p } } : vr,
      ),
    }));
    clearValidation();
  };
  const addVariant = (): void => {
    setValue((prev) => ({
      ...prev,
      variants: [...prev.variants, { name: "", position: "", sku: null }],
    }));
    clearValidation();
  };
  const removeVariant = (i: number): void => {
    setValue((prev) => ({
      ...prev,
      variants: prev.variants.filter((_, j) => j !== i),
    }));
    clearValidation();
  };

  const toggleSolution = (solution: string, checked: boolean): void =>
    patch({
      solutions: checked
        ? [...value.solutions, solution]
        : value.solutions.filter((s) => s !== solution),
    });

  // Derive a kebab-case slug from the English product name. Product names
  // are English by convention; non-ASCII runs collapse to separators, so a
  // Chinese-only name would produce an empty slug (button then no-ops).
  const autoSlug = (): void => {
    const slug = value.name
      .trim()
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120);
    if (slug) patch({ slug });
  };

  // Renders one numeric SKU field (price group / cost group / logistics
  // group) with its localized operator hint.
  const renderSkuField = (
    variantIndex: number,
    key: keyof SkuFormValue,
  ): ReactNode => {
    const sku = value.variants[variantIndex]?.sku ?? null;
    const labelKey = SKU_LABEL_KEYS[key];
    const hintKey = SKU_FIELD_HINT_KEYS[key];
    return (
      <Field
        key={key}
        label={labelKey ? t(labelKey) : key}
        htmlFor={`pf-variants-${variantIndex}-sku-${key}`}
        error={err(`variants.${variantIndex}.sku.${key}`)}
        hint={hintKey ? t(hintKey) : undefined}
      >
        <TextInput
          id={`pf-variants-${variantIndex}-sku-${key}`}
          inputMode="decimal"
          value={sku ? sku[key] : ""}
          onChange={(e) =>
            setSku(variantIndex, {
              [key]: e.target.value,
            } as Partial<SkuFormValue>)
          }
          autoComplete="off"
        />
      </Field>
    );
  };

  /** Serializes + submits the one form value using its selected wire status. */
  const submitForm = (): void => {
    if (pending || batchUpload.uploading) return;
    const target = value;
    // Task 11: typed-graph validation runs BEFORE the legacy serializer so a
    // graph problem jumps straight to the editors even when basics are fine.
    if (typed && target.graph) {
      const graphIssues = collectGraphIssues(target.graph, t);
      if (graphIssues.length > 0) {
        setIssues(graphIssues);
        // Jump straight to the first failing section.
        setActiveTab(graphIssues[0].tab);
        return;
      }
    }
    // The active translator rides along so field-level errors match the UI
    // language (the default English fallback stays for payload-only callers).
    const result = serializeFormValue(target, t);
    if (!result.ok) {
      setFieldErrors(result.fieldErrors);
      // Say WHICH tab holds the errors — with panels hidden, a generic
      // "fix the highlighted fields" leaves the operator hunting.
      const brokenTabs = [
        ...new Set(Object.keys(result.fieldErrors).map(tabForErrorKey)),
      ].map((key) => {
        const tab = TABS.find((candidate) => candidate.key === key);
        return tab ? t(tab.labelKey) : key;
      });
      const firstKey = Object.keys(result.fieldErrors)[0];
      const firstTab = firstKey ? tabForErrorKey(firstKey) : "basic";
      if (firstKey) {
        setHighlight((previous) => ({
          key: firstKey,
          nonce: (previous?.nonce ?? 0) + 1,
        }));
      }
      setIssues([
        {
          id: "serializer",
          message: t("product_form_validation_summary", {
            tabs: brokenTabs.join(lang === "zh" ? "、" : ", "),
          }),
          tab: firstTab,
          actions: [],
        },
      ]);
      // Jump straight to the first failing tab.
      setActiveTab(firstTab);
      return;
    }
    setFieldErrors({});
    setIssues([]);
    setHighlight(null);
    onSubmit(target);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    submitForm();
  };

  // --- persistent problem rail ---------------------------------------------
  // The backend validates the PATCH as a self-contained graph, so a rejection
  // arrives as raw English. Parsing it here turns it into the same card the
  // client validation produces: what is wrong, where, and how to fix it.
  const serverIssues =
    error && issues.length === 0 && Object.keys(fieldErrors).length === 0
      ? serverIssuesFromError(error, graphDraft ?? EMPTY_GRAPH_DRAFT, t)
      : [];
  const railIssues = issues.length > 0 ? issues : serverIssues;

  const applyIssueAction = (action: AdminProductIssueAction): void => {
    if (!action.optionKey || !graphDraft) return;
    const optionKey = action.optionKey;
    const draft = structuredClone(graphDraft);
    const option = draft.options.find(
      (candidate) => entityRowKey(candidate) === optionKey,
    );
    if (!option) return;
    if (action.kind === "enable-values") {
      option.values.forEach((value) => {
        value.isActive = true;
      });
    } else if (action.kind === "disable-option") {
      option.isActive = false;
    } else {
      return;
    }
    setValue((prev) => ({ ...prev, graph: draft }));
    // Re-derive the remaining problems from the repaired draft so a fixed
    // issue disappears while the rest stay listed.
    setIssues(collectGraphIssues(draft, t));
    setHighlight((prev) => ({ key: optionKey, nonce: (prev?.nonce ?? 0) + 1 }));
    setActiveTab("variants");
  };

  const jumpToIssue = (issue: AdminProductIssue): void => {
    setActiveTab(issue.tab);
    if (issue.highlightKey) {
      const key = issue.highlightKey;
      setHighlight((prev) => ({ key, nonce: (prev?.nonce ?? 0) + 1 }));
    }
  };

  useEffect(() => {
    if (!highlight) return;
    let active = true;
    const focusHighlightedRow = () => {
      if (!active) return;
      const row = document.getElementById(`pf-row-${highlight.key}`);
      if (!row) return;
      row.scrollIntoView?.({ block: "center" });
      row
        .querySelector<HTMLElement>(
          "[data-problem-focus], select, input, button",
        )
        ?.focus();
    };
    focusHighlightedRow();
    // Native <details> applies its open state after the rail click commits.
    // Repeating in a microtask keeps focus inside the newly revealed editor.
    queueMicrotask(focusHighlightedRow);
    return () => {
      active = false;
    };
  }, [highlight, activeTab]);

  const tabIndicators = Object.fromEntries(
    TABS.map((tab) => {
      const fieldBlocking = Object.keys(fieldErrors).filter(
        (key) => tabForErrorKey(key) === tab.key,
      ).length;
      const issueIds = new Set(
        [...railBlocking, ...railIssues]
          .filter(
            (issue) => issue.tab === tab.key && issue.id !== "serializer",
          )
          .map((issue) => issue.id),
      );
      const incompleteChecks = readiness.checks.filter(
        (check) =>
          !check.ok && READINESS_CHECK_TABS[check.key] === tab.key,
      ).length;
      const advisoryWarnings = readiness.warnings.filter(
        (warning) => READINESS_WARNING_TABS[warning.key] === tab.key,
      ).length;
      return [
        tab.key,
        {
          blocking: fieldBlocking + issueIds.size,
          warning: incompleteChecks + advisoryWarnings,
        },
      ];
    }),
  ) as Record<TabKey, { blocking: number; warning: number }>;

  return (
    <form onSubmit={handleSubmit} noValidate>
      <ProductFormHeader
        currentStatus={value.status}
        savedStatus={savedPreview?.status ?? null}
        pending={pending}
        saveDisabledReason={batchUpload.uploading ? t("product_media_batch_wait") : null}
        currentTab={activeTab}
        tabIndicators={tabIndicators}
        labels={{
          back: t("product_form_back"),
          status: t("product_form_status"),
          statusOptions: {
            DRAFT: t("product_form_status_draft"),
            ACTIVE: t("product_form_status_active"),
            DISABLED: t("product_form_status_disabled"),
          },
          tabs: {
            basic: t("product_form_tab_basic"),
            media: t("product_form_tab_media"),
            variants: t("product_form_tab_variants"),
            specs: t("product_form_tab_specs"),
            shipping: t("product_form_tab_shipping"),
            seo: t("product_form_tab_seo"),
            preview: t("product_form_tab_preview"),
          },
          tabsAria: t("product_form_tabs_aria"),
          statusAria: t("product_form_status_aria"),
          tabBlockingCount: (count) =>
            t("product_form_tab_blocking_count", { count }),
          tabWarningCount: (count) =>
            t("product_form_tab_warning_count", { count }),
          saveDraft: t("product_form_save_draft"),
          savePublish: t("product_form_save_publish"),
          saveChanges: t("product_form_save_changes"),
          saveUnpublish: t("product_form_save_unpublish"),
          saving: t("product_form_saving"),
          unsavedChanges: t("product_form_unsaved"),
          previewAction: t("product_form_preview_action"),
          newProduct: t("product_form_new_title"),
        }}
        identity={headerIdentity}
        dirty={dirty}
        onStatusChange={(status) => patch({ status })}
        onTabChange={setActiveTab}
        onSubmitIntent={() => undefined}
        errorRail={
          <ProductFormErrorRail
            issues={railIssues}
            onAction={applyIssueAction}
            onJump={jumpToIssue}
          />
        }
      />

      <details className="mb-5 rounded-lg border border-border bg-card px-3 py-2 text-xs text-ink-secondary">
        <summary className="cursor-pointer list-none font-semibold text-cta">
          {t("product_form_help_summary")}
          <span aria-hidden className="ml-1 text-ink-muted">⌄</span>
        </summary>
        <p className="mt-2 leading-relaxed">
          {t("product_form_workflow_hint")}
        </p>
      </details>

      {/* Wide workspace: the form takes the room it needs. At desktop widths,
          the read-only rail stays visible below the sticky editor header. */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">
      <div
        role="tabpanel"
        id={`pf-panel-${activeTab}`}
        aria-labelledby={`pf-tab-${activeTab}`}
        className="flex min-w-0 flex-col gap-6"
      >

        {activeTab === "basic" && (
          <>
            <Section title={t("product_basic_title")} hint={t("product_basic_hint")}>
              <div className="flex flex-col gap-6">
                <section aria-labelledby="pf-basic-storefront-heading">
                  <h3
                    id="pf-basic-storefront-heading"
                    className="mb-3 text-sm font-semibold text-ink"
                  >
                    {t("product_basic_group_storefront")}
                  </h3>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field
                      label={t("product_basic_name_label")}
                      htmlFor="pf-name"
                      error={err("name")}
                      hint={<span title={t("product_basic_name_tooltip")}>{t("product_basic_name_hint")}</span>}
                    >
                      <TextInput
                        id="pf-name"
                        value={value.name}
                        maxLength={255}
                        onChange={(e) => patch({ name: e.target.value })}
                        autoComplete="off"
                      />
                    </Field>
                    <Field
                      label={t("product_basic_code_label")}
                      htmlFor="pf-product-code"
                      hint={t("product_basic_code_hint")}
                    >
                      <TextInput
                        id="pf-product-code"
                        aria-label={t("product_basic_code_label")}
                        value={identity?.productCode ?? t("product_basic_code_pending")}
                        readOnly
                        className="bg-background font-mono text-ink-secondary"
                      />
                    </Field>
                    <Field
                      label={t("product_basic_category_label")}
                      htmlFor="pf-category"
                      error={err("categoryId")}
                      hint={<span title={t("product_basic_category_tooltip")}>{t("product_basic_category_hint")}</span>}
                    >
                      <Select
                        id="pf-category"
                        value={value.categoryId}
                        onChange={(e) => patch({ categoryId: e.target.value })}
                      >
                        <option value="" disabled>
                          {t("product_basic_category_placeholder")}
                        </option>
                        {flatCategories.map((cat) => (
                          <option key={cat.id} value={cat.id}>
                            {"  ".repeat(cat.depth)}
                            {cat.depth > 0 ? "– " : ""}
                            {cat.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field
                      label={t("product_basic_tagline_label")}
                      htmlFor="pf-tagline"
                      error={err("tagline")}
                      hint={<span title={t("product_basic_tagline_tooltip")}>{t("product_basic_tagline_hint")}</span>}
                    >
                      <TextInput
                        id="pf-tagline"
                        value={value.tagline}
                        maxLength={200}
                        placeholder="Space-saving 3-tier cabinet with clear doors"
                        onChange={(e) => patch({ tagline: e.target.value })}
                        autoComplete="off"
                      />
                    </Field>
                    <div className="md:col-span-2">
                      <Field
                        label={t("product_basic_description_label")}
                        htmlFor="pf-description"
                        error={err("description")}
                        hint={<span title={t("product_basic_description_tooltip")}>{t("product_basic_description_hint")}</span>}
                      >
                        <Textarea
                          id="pf-description"
                          rows={3}
                          value={value.description}
                          onChange={(e) => patch({ description: e.target.value })}
                        />
                      </Field>
                    </div>
                  </div>
                </section>

                <section
                  aria-labelledby="pf-basic-operations-heading"
                  className="border-t border-border pt-5"
                >
                  <h3
                    id="pf-basic-operations-heading"
                    className="mb-3 text-sm font-semibold text-ink"
                  >
                    {t("product_basic_group_operations")}
                  </h3>
                  <div className="grid gap-4 md:grid-cols-2">

                <Field
                  label={t("product_basic_room_label")}
                  htmlFor="pf-room"
                  error={err("room")}
                  hint={
                    <span title={t("product_basic_room_tooltip")}>
                      {t("product_basic_room_hint")}
                    </span>
                  }
                >
                  <Select
                    id="pf-room"
                    value={value.room}
                    onChange={(e) => patch({ room: e.target.value })}
                  >
                    <option value="">—</option>
                    {ROOMS.map((r) => (
                      <option key={r} value={r}>
                        {ROOM_LABEL_KEYS[r] ? t(ROOM_LABEL_KEYS[r]) : r}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field
                  label={t("product_basic_role_label")}
                  htmlFor="pf-internal-role"
                  error={err("internalRole")}
                  hint={
                    <span title={t("product_basic_role_tooltip")}>
                      {t("product_basic_role_hint")}
                    </span>
                  }
                >
                  <Select
                    id="pf-internal-role"
                    value={value.internalRole}
                    onChange={(e) => patch({ internalRole: e.target.value })}
                  >
                    <option value="">—</option>
                    {INTERNAL_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL_KEYS[r] ? t(ROLE_LABEL_KEYS[r]) : r}
                      </option>
                    ))}
                  </Select>
                </Field>

                <fieldset className="md:col-span-2">
                  <legend className="text-sm font-medium text-ink">
                    {t("product_basic_solutions_legend")}
                  </legend>
                  <p className="mt-1 text-xs text-ink-muted">
                    {t("product_basic_solutions_hint")}
                  </p>
                  <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {SOLUTIONS.map((s) => (
                      <li key={s}>
                        <label className="flex items-center gap-2 text-sm text-ink">
                          <input
                            type="checkbox"
                            value={s}
                            checked={value.solutions.includes(s)}
                            onChange={(e) => toggleSolution(s, e.target.checked)}
                            className="h-4 w-4 rounded border-border accent-cta"
                          />
                          {SOLUTION_LABEL_KEYS[s] ? t(SOLUTION_LABEL_KEYS[s]) : s}
                        </label>
                      </li>
                    ))}
                  </ul>
                </fieldset>
                  </div>
                </section>
              </div>
            </Section>
          </>
        )}

        {activeTab === "media" && (
          <ProductMediaPanel
            graphLocked={graphLocked}
            graphVersion={value.graph?.catalogGraphVersion ?? 0}
            pending={pending}
            graphDraft={graphDraft}
            onGraphChange={typed && graphDraft ? updateGraph : null}
            highlightKey={highlight?.key ?? null}
            sharedMedia={{
              images: value.images,
              pending,
              highlightKey: highlight?.key ?? null,
              fieldErrors,
              onPatch: setImage,
              onMove: moveImage,
              onReorder: moveImageTo,
              onSetCover: setCoverImage,
              onRemove: removeImage,
              onAdd: addImage,
              onAddImageUrl: addImageWithUrl,
              batchUpload,
            }}
            detailMedia={{
              blocks: value.detailBlocks,
              pending,
              highlightKey: highlight?.key ?? null,
              fieldErrors,
              onPatch: setDetailBlock,
              onMove: moveDetailBlock,
              onRemove: removeDetailBlock,
              onAdd: addDetailBlock,
            }}
          />
        )}

          {activeTab === "specs" && (
            <>
              <Section
                title={t("product_specs_dimensions_title")}
                hint={t("product_specs_dimensions_hint")}
              >
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {DIMENSION_FIELDS.map(({ key, labelKey, hintKey }) => (
                    <Field
                      key={key}
                      label={t(labelKey)}
                      htmlFor={`pf-${key}`}
                      error={err(key)}
                      hint={t(hintKey)}
                    >
                      <TextInput
                        id={`pf-${key}`}
                        inputMode="decimal"
                        placeholder={t("product_specs_optional_placeholder")}
                        value={value[key]}
                        onChange={(e) => patch({ [key]: e.target.value })}
                        autoComplete="off"
                      />
                    </Field>
                  ))}
                </div>
              </Section>

              <Section
                title={t("product_specs_materials_title")}
                hint={t("product_specs_materials_hint")}
              >
                <Field
                  label={t("product_specs_materials_label")}
                  htmlFor="pf-materials"
                  error={err("materials")}
                >
                  <Textarea
                    id="pf-materials"
                    rows={3}
                    value={value.materials}
                    maxLength={1000}
                    onChange={(e) => patch({ materials: e.target.value })}
                  />
                </Field>
              </Section>

              <Section
                title={t("product_specs_features_title")}
                hint={t("product_specs_features_hint")}
              >
                {value.features.length === 0 ? (
                  <p className="text-sm text-ink-muted">
                    {t("product_specs_features_empty")}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {value.features.map((line, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <span aria-hidden className="w-5 shrink-0 text-center text-sm font-semibold text-cta">
                          ✓
                        </span>
                        <TextInput
                          aria-label={t("product_specs_feature_aria", { number: i + 1 })}
                          value={line}
                          maxLength={200}
                          onChange={(e) => setFeatureLine(i, e.target.value)}
                          autoComplete="off"
                        />
                        <button
                          type="button"
                          className={removeBtnCls}
                          onClick={() => moveFeatureLine(i, -1)}
                          disabled={pending || i === 0}
                          aria-label={t("product_specs_feature_move_up", { number: i + 1 })}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className={removeBtnCls}
                          onClick={() => moveFeatureLine(i, 1)}
                          disabled={pending || i === value.features.length - 1}
                          aria-label={t("product_specs_feature_move_down", { number: i + 1 })}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className={removeBtnCls}
                          onClick={() => removeFeatureLine(i)}
                          disabled={pending}
                          aria-label={t("product_specs_feature_remove", { number: i + 1 })}
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  className="mt-3"
                  onClick={addFeatureLine}
                  disabled={pending}
                >
                  {t("product_specs_add_feature")}
                </Button>
              </Section>
            </>
          )}

        {activeTab === "variants" && typed && graphDraft ? (
          /* Task 11: typed option graph products edit variants through the
             options editor + candidate matrix — the legacy free-form list is
             gone (a legacy whole-list write on a graph product would 409). */
          <Section
            title={t("product_variants_typed_title")}
            hint={t("product_variants_typed_hint")}
          >
            <ProductOptionsEditor
              draft={graphDraft}
              onChange={updateGraph}
              pending={pending}
              highlightKey={highlight?.key ?? null}
            />
            <div className="mt-8">
              <VariantMatrix
                candidates={candidates}
                draft={graphDraft}
                onChange={updateGraph}
                pending={pending}
                highlightKey={highlight?.key ?? null}
                requestedSkuCode={requestedSkuCode}
              />
            </div>
          </Section>
        ) : activeTab === "variants" && graphLocked ? (
          /* 409-trap guard: graph product without a typed payload (admin GET
             gap). The backend rejects legacy whole-list variants/images
             writes with a named 409, so editing pauses here explicitly. */
          <Section
            title={t("product_variants_locked_title")}
            hint={t("product_variants_locked_hint")}
          >
            <div
              role="alert"
              className="rounded-xl border border-sale/40 bg-sale/5 p-4 text-sm text-red-700"
            >
              {t("product_variants_locked_alert", {
                version: value.graph?.catalogGraphVersion ?? 0,
              })}
            </div>
          </Section>
        ) : activeTab === "variants" && (
          <Section
            title={t("product_variants_legacy_title")}
            hint={t("product_variants_legacy_hint")}
          >
            {value.variants.length === 0 ? (
              <p className="text-sm text-ink-muted">
                {t("product_variants_legacy_empty")}
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {value.variants.map((vr, i) => (
                  <li key={i} className="rounded-lg bg-background p-4">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <h3 className="text-sm font-semibold text-ink">
                        {vr.name.trim() || t("product_variant_name_fallback", { number: i + 1 })}
                      </h3>
                      <button
                        type="button"
                        className="text-sm font-semibold text-red-700 hover:underline disabled:text-ink-muted disabled:no-underline"
                        onClick={() => removeVariant(i)}
                        disabled={pending}
                      >
                        {t("product_variant_remove")}
                      </button>
                    </div>

                    {/* Default-visible fields: name, price, compare-at. */}
                    <div className="mt-3 grid gap-4 md:grid-cols-3">
                      <Field
                        label={t("product_variant_name_label")}
                        htmlFor={`pf-variants-${i}-name`}
                        error={err(`variants.${i}.name`)}
                        hint={t("product_variant_name_hint")}
                      >
                        <TextInput
                          id={`pf-variants-${i}-name`}
                          value={vr.name}
                          placeholder="Default"
                          onChange={(e) =>
                            setVariant(i, { name: e.target.value })
                          }
                          autoComplete="off"
                        />
                      </Field>
                      {vr.sku ? renderSkuField(i, "price") : null}
                      {vr.sku ? renderSkuField(i, "compareAtPrice") : null}
                    </div>

                    <label className="mt-4 flex items-center gap-2 text-sm font-medium text-ink">
                      <input
                        type="checkbox"
                        id={`pf-variants-${i}-has-sku`}
                        checked={vr.sku !== null}
                        onChange={(e) =>
                          setVariant(i, {
                            sku: e.target.checked ? emptySkuFormValue() : null,
                          })
                        }
                        className="h-4 w-4 rounded border-border accent-cta"
                        disabled={pending}
                      />
                      <span>
                        {t("product_variant_has_sku")}
                        <span className="font-normal text-ink-muted">
                          {" "}
                          — {t("product_variant_has_sku_hint")}
                        </span>
                      </span>
                    </label>

                    {vr.sku ? (
                      <div className="mt-4 border-t border-border pt-4">
                        {/* Default-visible: SKU code, status, stock. */}
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                          <Field
                            label={t("product_variant_sku_code_label")}
                            htmlFor={`pf-variants-${i}-sku-code`}
                            error={err(`variants.${i}.sku.skuCode`)}
                            hint={t("product_variant_sku_code_hint")}
                          >
                            <TextInput
                              inputRef={(node) => {
                                const skuCode = vr.sku?.skuCode.trim();
                                if (!skuCode) return;
                                if (node) legacySkuRefs.current.set(skuCode, node);
                                else legacySkuRefs.current.delete(skuCode);
                              }}
                              id={`pf-variants-${i}-sku-code`}
                              value={vr.sku.skuCode}
                              onChange={(e) =>
                                setSku(i, { skuCode: e.target.value })
                              }
                              autoComplete="off"
                            />
                          </Field>
                          <Field
                            label={t("product_variant_sku_status_label")}
                            htmlFor={`pf-variants-${i}-sku-status`}
                            error={err(`variants.${i}.sku.status`)}
                            hint={t("product_variant_sku_status_hint")}
                          >
                            <Select
                              id={`pf-variants-${i}-sku-status`}
                              value={vr.sku.status}
                              onChange={(e) =>
                                setSku(i, {
                                  status: e.target.value as SkuFormValue["status"],
                                })
                              }
                            >
                              {SKU_STATUSES.map((s) => (
                                <option key={s} value={s}>
                                  {s === "ACTIVE"
                                    ? t("product_sku_status_ACTIVE")
                                    : t("product_sku_status_DISABLED")}
                                </option>
                              ))}
                            </Select>
                          </Field>
                        </div>

                        {/* Stock lives in its own table, which is why the product
                            form could not see it before. The figure shown is what
                            the form last read and it is saved back as an absolute
                            value, so a stale copy cannot corrupt the count the way
                            a client-computed delta would. */}
                        <div className="mt-4">
                          <p className="text-xs font-semibold text-ink-secondary">
                            {t("product_stock_title")}
                          </p>
                          <p className="mt-0.5 text-xs text-ink-muted">
                            {t("product_stock_hint")}
                          </p>
                          <div className="mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                            <Field
                              label={t("product_stock_label")}
                              htmlFor={`pf-variants-${i}-stock`}
                              hint={
                                !vr.sku.id
                                  ? t("product_stock_hint_new_sku")
                                  : vr.sku.reserved !== "0"
                                    ? t("product_stock_hint_reserved", { reserved: vr.sku.reserved })
                                    : t("product_stock_hint_clear")
                              }
                            >
                              <TextInput
                                id={`pf-variants-${i}-stock`}
                                inputMode="numeric"
                                value={vr.sku.stock}
                                onChange={(e) => setSku(i, { stock: e.target.value })}
                                autoComplete="off"
                              />
                            </Field>
                          </div>
                        </div>

                        {/* Advanced: position, supplier refs, internal costs.
                            Logistics fields live on the Shipping tab. */}
                        <details className="mt-4">
                          <summary className="cursor-pointer text-xs font-semibold text-ink-secondary">
                            {t("product_variant_advanced")}
                          </summary>
                          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                            <Field
                              label={t("product_variant_position_label")}
                              htmlFor={`pf-variants-${i}-position`}
                              error={err(`variants.${i}.position`)}
                              hint={t("product_variant_position_hint")}
                            >
                              <TextInput
                                id={`pf-variants-${i}-position`}
                                inputMode="numeric"
                                value={vr.position}
                                placeholder="0"
                                onChange={(e) =>
                                  setVariant(i, { position: e.target.value })
                                }
                                autoComplete="off"
                              />
                            </Field>
                            <Field
                              label={t("product_variant_supplier_sku_label")}
                              htmlFor={`pf-variants-${i}-supplier-sku`}
                              error={err(`variants.${i}.sku.supplierSku`)}
                              hint={t("product_variant_supplier_sku_hint")}
                            >
                              <TextInput
                                id={`pf-variants-${i}-supplier-sku`}
                                value={vr.sku.supplierSku}
                                onChange={(e) =>
                                  setSku(i, { supplierSku: e.target.value })
                                }
                                autoComplete="off"
                              />
                            </Field>
                            <Field
                              label={t("product_variant_currency_label")}
                              htmlFor={`pf-variants-${i}-cost-currency`}
                              error={err(`variants.${i}.sku.costCurrency`)}
                              hint={t("product_variant_currency_hint")}
                            >
                              <TextInput
                                id={`pf-variants-${i}-cost-currency`}
                                value={vr.sku.costCurrency}
                                placeholder="CNY"
                                onChange={(e) =>
                                  setSku(i, { costCurrency: e.target.value })
                                }
                                autoComplete="off"
                              />
                            </Field>
                            {renderSkuField(i, "supplierCost")}
                            {renderSkuField(i, "landedCost")}
                          </div>
                        </details>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <Button
              type="button"
              variant="secondary"
              size="md"
              className="mt-4"
              onClick={addVariant}
              disabled={pending}
            >
              {t("product_variant_add")}
            </Button>
          </Section>
        )}

        {activeTab === "shipping" && typed && graphDraft ? (
          /* Task 11: on typed products the SKU rows live in the graph draft,
             so shipping fields write there (the legacy list rows would be
             dropped from the PATCH and the edits silently lost). */
          <Section
            title={t("product_shipping_title")}
            hint={t("product_shipping_typed_hint")}
          >
            {graphDraft.variants.length === 0 ? (
              <p className="text-sm text-ink-muted">
                {t("product_shipping_typed_empty")}
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {graphDraft.variants.map((variant) => (
                  <li
                    key={variant.id ?? variant.clientKey}
                    className="rounded-lg bg-background p-4"
                  >
                    <p className="text-sm font-semibold text-ink">
                      {variant.name.trim() || t("product_shipping_unnamed")}
                      {variant.sku?.skuCode.trim() ? (
                        <span className="ml-2 font-normal text-ink-muted">
                          {variant.sku.skuCode.trim()}
                        </span>
                      ) : null}
                    </p>
                    {variant.sku ? (
                      <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {SHIPPING_SKU_KEYS.map((key) => {
                          const labelKey = SKU_LABEL_KEYS[key];
                          return (
                            <Field
                              key={key}
                              label={labelKey ? t(labelKey) : String(key)}
                            >
                              <DecimalInput
                                aria-label={t("product_shipping_field_aria", {
                                  field: labelKey ? t(labelKey) : String(key),
                                  variant:
                                    variant.name.trim() || t("product_shipping_unnamed"),
                                })}
                                inputMode="decimal"
                                value={variant.sku?.[key] ?? null}
                                onValueChange={(nextValue) =>
                                  setDraftSkuField(
                                    variant.combinationKey,
                                    key,
                                    nextValue,
                                  )
                                }
                                autoComplete="off"
                              />
                            </Field>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-ink-muted">
                        {t("product_shipping_typed_no_sku")}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        ) : activeTab === "shipping" && graphLocked ? (
          <Section
            title={t("product_shipping_title")}
            hint={t("product_shipping_locked_hint")}
          >
            <div
              role="alert"
              className="rounded-xl border border-sale/40 bg-sale/5 p-4 text-sm text-red-700"
            >
              {t("product_shipping_locked_alert", {
                version: value.graph?.catalogGraphVersion ?? 0,
              })}
            </div>
            {value.variants.length > 0 ? (
              <ul className="mt-4 flex flex-col gap-1 text-xs text-ink-muted">
                {value.variants.map((vr, i) => (
                  <li key={i}>
                    {vr.name.trim() || t("product_variant_name_fallback", { number: i + 1 })}
                    {vr.sku?.skuCode.trim() ? ` — ${vr.sku.skuCode.trim()}` : ""}
                  </li>
                ))}
              </ul>
            ) : null}
          </Section>
        ) : activeTab === "shipping" && (
          <Section
            title={t("product_shipping_title")}
            hint={t("product_shipping_legacy_hint")}
          >
            {value.variants.length === 0 ? (
              <p className="text-sm text-ink-muted">
                {t("product_shipping_legacy_empty", {
                  tab: t("product_variants_legacy_title"),
                })}
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {value.variants.map((vr, i) => (
                  <li key={i} className="rounded-lg bg-background p-4">
                    <p className="text-sm font-semibold text-ink">
                      {vr.name.trim() || t("product_variant_name_fallback", { number: i + 1 })}
                      {vr.sku?.skuCode.trim() ? (
                        <span className="ml-2 font-normal text-ink-muted">
                          {vr.sku.skuCode.trim()}
                        </span>
                      ) : null}
                    </p>
                    {vr.sku ? (
                      <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {SHIPPING_SKU_KEYS.map((key) => renderSkuField(i, key))}
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-ink-muted">
                        {t("product_shipping_legacy_no_sku")}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}

        {activeTab === "seo" && (
          <Section
            title={t("product_seo_title")}
            hint={t("product_seo_hint")}
          >
            <Field label={t("product_seo_slug_label")} htmlFor="pf-slug" error={err("slug")}>
              <TextInput
                id="pf-slug"
                value={value.slug}
                maxLength={120}
                placeholder="folding-chair"
                onChange={(e) => patch({ slug: e.target.value })}
                autoComplete="off"
              />
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                <p className="text-xs text-ink-muted">{t("product_slug_hint")}</p>
                <button
                  type="button"
                  onClick={autoSlug}
                  className="text-xs font-semibold text-cta hover:underline"
                >
                  {t("product_seo_autogenerate")}
                </button>
              </div>
              <p className="text-xs text-ink-muted">
                {t("product_seo_slug_stable_hint")}
              </p>
            </Field>

            <div className="mt-6">
              <ProductSeoLinksPanel
                productName={value.name}
                slug={value.slug}
                seoTitle={value.seoTitle}
                metaDescription={value.metaDescription}
                fallbackDescription={value.description}
                savedProduct={savedPreview}
                onSeoTitleChange={(seoTitle) => patch({ seoTitle })}
                onMetaDescriptionChange={(metaDescription) =>
                  patch({ metaDescription })
                }
              />
            </div>

            {value.images.some((img) => img.altText.trim()) ? (
              <div className="mt-6">
                <p className="text-xs font-semibold text-ink-secondary">
                  {t("product_seo_alt_overview")}
                </p>
                <ul className="mt-2 flex flex-col gap-1 text-xs text-ink-muted">
                  {value.images.map((img, i) =>
                    img.altText.trim() ? (
                      <li key={i}>
                        {t("product_seo_alt_item", { number: i + 1, alt: img.altText.trim() })}
                      </li>
                    ) : null,
                  )}
                </ul>
              </div>
            ) : (
              <p className="mt-6 text-xs text-ink-muted">
                {t("product_seo_alt_empty")}
              </p>
            )}
          </Section>
        )}

        {activeTab === "preview" && (
          <Section
            title={t("product_form_tab_preview")}
            hint={t("product_form_preview_unsaved")}
          >
            <ProductPreviewPanel
              savedPreview={savedPreview}
              currentSlug={value.slug}
              currentStatus={value.status}
            >
                <ProductDetailBody
                  description={value.description}
                  blocks={value.detailBlocks.map((block) => ({
                    type: block.type,
                    url: block.url,
                    altText: block.altText,
                  }))}
                />
                <ProductSpecs
                  product={{
                    width: previewNumber(value.width),
                    height: previewNumber(value.height),
                    depth: previewNumber(value.depth),
                    foldedWidth: previewNumber(value.foldedWidth),
                    foldedHeight: previewNumber(value.foldedHeight),
                    foldedDepth: previewNumber(value.foldedDepth),
                    materials: value.materials.trim() || null,
                    features:
                      value.features.map((l) => l.trim()).filter(Boolean).join("\n") ||
                      null,
                  }}
                />
              </ProductPreviewPanel>
          </Section>
        )}
      </div>

        <aside className="min-w-0 xl:sticky xl:top-52 xl:self-start">
          <ProductEditorRail
            blocking={railBlocking}
            readiness={readiness}
            storefront={{
              savedStatus: savedPreview?.status ?? null,
              selectedStatus: value.status,
              path: savedPreview?.path ?? "",
            }}
            landing={{ count: landingCount, productId }}
            preview={{
              name: value.name,
              coverImageUrl: [...value.images]
                .sort(
                  (left, right) =>
                    Number(left.sortOrder.trim() || "0") -
                    Number(right.sortOrder.trim() || "0"),
                )
                .find((image) => image.url.trim())?.url ?? null,
              priceLabel: railPriceLabel,
            }}
            onOpenPreview={() => setActiveTab("preview")}
          />
        </aside>
      </div>
    </form>
  );
}
