"use client";

import type { FormEvent, ReactNode } from "react";
import { useRef, useState } from "react";
import Link from "next/link";
import {
  Field,
  Select,
  TextInput,
  Textarea,
} from "@/components/admin/Field";
import { Button } from "@/components/ui/Button";
import { ImageUrlInput } from "./ImageUrlInput";
import { LivePreview, StorefrontPreview } from "./PreviewPane";
import { ProductDetailBody } from "@/components/product/ProductDetailBody";
import { ProductSpecs } from "@/components/product/ProductSpecs";
import type {
  AdminCategoryNode,
  CreateProductInput,
  ProductStatus,
} from "@/lib/admin-api";

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
  images: { url: string; altText: string; sortOrder: string }[];
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
}

export type SkuFormValue = NonNullable<
  ProductFormValue["variants"][number]["sku"]
>;
export type ImageFormValue = ProductFormValue["images"][number];
export type DetailBlockFormValue = ProductFormValue["detailBlocks"][number];
export type VariantFormValue = ProductFormValue["variants"][number];

export type SerializeFormResult =
  | { ok: true; value: CreateProductInput }
  | { ok: false; error: string; fieldErrors: Record<string, string> };

// --- backend enum mirrors (src/lib/admin-api.ts + Prisma) --------------------

const PRODUCT_STATUSES: ProductStatus[] = ["DRAFT", "ACTIVE", "DISABLED"];
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

// Chinese operator labels for the enum-backed controls. The submitted value
// stays the English enum code the API expects; only the back-office UI shows
// the Chinese gloss. The storefront never renders these.
const STATUS_LABELS: Record<ProductStatus, string> = {
  DRAFT: "DRAFT — 草稿：前台完全看不到，先保存检查用",
  ACTIVE: "ACTIVE — 上架：前台可搜索、可下单",
  DISABLED: "DISABLED — 下架：前台隐藏，数据保留，可随时重新上架",
};
const ROOM_LABELS: Record<string, string> = {
  BEDROOM: "BEDROOM — 卧室",
  STORAGE: "STORAGE — 收纳/储物空间",
  DINING_LIVING: "DINING_LIVING — 餐厅/客厅",
  HOME_OFFICE: "HOME_OFFICE — 书房/居家办公",
};
const ROLE_LABELS: Record<string, string> = {
  HERO: "HERO — 主推款",
  CORE: "CORE — 常规款",
  ENTRY: "ENTRY — 引流款（低价）",
  PREMIUM: "PREMIUM — 利润款（高客单）",
  PRE_ORDER: "PRE_ORDER — 预售款",
};
const SOLUTION_LABELS: Record<string, string> = {
  FOLDABLE: "FOLDABLE — 可折叠",
  NARROW_SPACE: "NARROW_SPACE — 窄缝/小空间适用",
  MOBILE: "MOBILE — 带轮可移动",
  MULTIFUNCTIONAL: "MULTIFUNCTIONAL — 多功能/可组合",
  HIDDEN_STORAGE: "HIDDEN_STORAGE — 封闭/隐藏收纳",
  RENTAL_FRIENDLY: "RENTAL_FRIENDLY — 租房友好、搬家可带走",
};

// Backend DTO bounds (product.dto.ts / category.dto.ts slugSchema).
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Structural UUID only (ids in this DB are UUIDv7; z.string().uuid() accepts
// any version nibble, so do not constrain version/variant digits).
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_HINT =
  "slug must be lowercase kebab-case (e.g. folding-chair)";
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
  label: string;
  hint: string;
}[] = [
  { key: "width", label: "Width", hint: "展开宽度，单位 cm" },
  { key: "height", label: "Height", hint: "展开总高，单位 cm" },
  { key: "depth", label: "Depth", hint: "展开深度，单位 cm" },
  { key: "foldedWidth", label: "Folded width", hint: "折叠后宽度 cm，不可折叠留空" },
  { key: "foldedHeight", label: "Folded height", hint: "折叠后高度/厚度 cm，不可折叠留空" },
  { key: "foldedDepth", label: "Folded depth", hint: "折叠后深度 cm，不可折叠留空" },
];

const SKU_NUM_FIELDS: { key: keyof SkuFormValue; label: string }[] = [
  { key: "price", label: "Price 售价 (₱)" },
  { key: "compareAtPrice", label: "Compare-at price 划线原价 (₱)" },
  { key: "supplierCost", label: "Supplier cost" },
  { key: "landedCost", label: "Landed cost" },
  { key: "productWeight", label: "Product weight" },
  { key: "packageWidth", label: "Package width" },
  { key: "packageHeight", label: "Package height" },
  { key: "packageDepth", label: "Package depth" },
  { key: "packageWeight", label: "Package weight" },
  { key: "volumetricWeight", label: "Volumetric weight" },
];

const SKU_LABELS: Partial<Record<keyof SkuFormValue, string>> = Object.fromEntries(
  SKU_NUM_FIELDS.map((f) => [f.key, f.label]),
);

// Chinese per-field guidance inside the SKU box.
const SKU_FIELD_HINTS: Partial<Record<keyof SkuFormValue, ReactNode>> = {
  price: "前台售价，单位比索 ₱。不填价格，该款式在前台无法购买。",
  compareAtPrice:
    "划线原价（可选）。高于售价时前台显示折扣；不打折请留空，不要填等于售价的数。",
  supplierCost: "出厂价，内部成本字段，前台不会显示。",
  landedCost: "到菲落地成本，内部核算字段，前台不显示。",
  productWeight: "产品净重，单位 kg。",
  packageWidth: "外包装宽，单位 cm。",
  packageHeight: "外包装高，单位 cm。",
  packageDepth: "外包装深，单位 cm。",
  packageWeight: "带包装毛重，单位 kg。",
  volumetricWeight: "体积重，单位 kg，物流计费用；可先留空。",
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
): number | null {
  const s = raw.trim();
  if (s === "") return null;
  if (!NUM_RE.test(s)) {
    addError(errors, key, `${label} must be a number.`);
    return null;
  }
  const n = Number(s);
  if (!Number.isFinite(n)) {
    addError(errors, key, `${label} must be a number.`);
    return null;
  }
  if (n < 0) {
    addError(errors, key, `${label} must be 0 or greater.`);
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
): number {
  const s = raw.trim();
  if (s === "") return 0;
  if (!NUM_RE.test(s)) {
    addError(errors, key, `${label} must be a whole number.`);
    return 0;
  }
  const n = Number(s);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    addError(errors, key, `${label} must be a whole number.`);
    return 0;
  }
  if (n < 0) {
    addError(errors, key, `${label} must be 0 or greater.`);
    return 0;
  }
  return n;
}

type CreateSkuInput = NonNullable<
  CreateProductInput["variants"][number]["sku"]
>;

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
export function validateStockEntry(value: ProductFormValue): string | null {
  for (const [index, variant] of value.variants.entries()) {
    const raw = variant.sku?.stock.trim() ?? "";
    if (raw === "") continue;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return `Stock must be a whole number of 0 or more (variant ${index + 1}).`;
    }
  }
  return null;
}

export function serializeFormValue(
  v: ProductFormValue,
): SerializeFormResult {
  const errors: FieldErrors = {};

  // --- Basics --------------------------------------------------------------
  const name = v.name.trim();
  if (!name) addError(errors, "name", "Name is required.");
  else if (name.length > 255)
    addError(errors, "name", "Name must be 255 characters or fewer.");

  const slug = v.slug.trim();
  if (!slug) addError(errors, "slug", "Slug is required.");
  else if (slug.length > 120) addError(errors, "slug", SLUG_HINT);
  else if (!SLUG_RE.test(slug)) addError(errors, "slug", SLUG_HINT);

  const description = v.description.trim();
  if (description.length > 5000)
    addError(
      errors,
      "description",
      "Description must be 5,000 characters or fewer.",
    );

  const tagline = v.tagline.trim();
  if (tagline.length > 200)
    addError(errors, "tagline", "Tagline must be 200 characters or fewer.");

  const materials = v.materials.trim();
  if (materials.length > 1000)
    addError(errors, "materials", "Materials must be 1,000 characters or fewer.");

  const features = v.features
    .map((line) => line.trim())
    .filter(Boolean);
  if (features.some((line) => line.length > 200))
    addError(errors, "features", "Each feature must be 200 characters or fewer.");
  if (features.join("\n").length > 2000)
    addError(errors, "features", "Features must be 2,000 characters or fewer.");

  if (!v.categoryId) addError(errors, "categoryId", "Category is required.");
  else if (!UUID_RE.test(v.categoryId))
    addError(errors, "categoryId", "Choose a valid category.");

  // --- Dimensions ----------------------------------------------------------
  const dimensions = {} as Pick<
    CreateProductInput,
    "width" | "height" | "depth" | "foldedWidth" | "foldedHeight" | "foldedDepth"
  >;
  for (const { key, label } of DIMENSION_FIELDS) {
    dimensions[key] = parseNonNegative(v[key], key, label, errors);
  }

  // --- Images --------------------------------------------------------------
  const images: CreateProductInput["images"] = [];
  v.images.forEach((img, i) => {
    const url = img.url.trim();
    const altText = img.altText.trim();
    const sortRaw = img.sortOrder.trim();
    // A fully blank row is dropped silently, not validated.
    if (!url && !altText && !sortRaw) return;

    if (!url) addError(errors, `images.${i}.url`, "Image URL is required.");
    else if (url.length > 2048)
      addError(
        errors,
        `images.${i}.url`,
        "Image URL must be 2,048 characters or fewer.",
      );
    else {
      try {
        // Mirror z.string().url() (WHATWG URL parse).
        new URL(url);
      } catch {
        addError(errors, `images.${i}.url`, "Image URL must be a valid URL.");
      }
    }
    if (altText.length > 255)
      addError(
        errors,
        `images.${i}.altText`,
        "Alt text must be 255 characters or fewer.",
      );
    const sortOrder = parseNonNegativeInt(
      sortRaw,
      `images.${i}.sortOrder`,
      "Sort order",
      errors,
    );
    images.push({
      url,
      ...(altText ? { altText } : {}),
      sortOrder,
    });
  });

  // --- Detail blocks -------------------------------------------------------
  const detailBlocks: CreateProductInput["detailBlocks"] = [];
  v.detailBlocks.forEach((block, i) => {
    const url = block.url.trim();
    const altText = block.altText.trim();
    const sortRaw = block.sortOrder.trim();
    // A fully blank row is dropped silently, not validated.
    if (!url && !altText && !sortRaw) return;

    if (!url) addError(errors, `detailBlocks.${i}.url`, "Media URL is required.");
    else if (url.length > 2048)
      addError(
        errors,
        `detailBlocks.${i}.url`,
        "Media URL must be 2,048 characters or fewer.",
      );
    else {
      try {
        new URL(url);
      } catch {
        addError(errors, `detailBlocks.${i}.url`, "Media URL must be a valid URL.");
      }
    }
    if (altText.length > 255)
      addError(
        errors,
        `detailBlocks.${i}.altText`,
        "Alt text must be 255 characters or fewer.",
      );
    const sortOrder = parseNonNegativeInt(
      sortRaw,
      `detailBlocks.${i}.sortOrder`,
      "Sort order",
      errors,
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
      addError(errors, `variants.${i}.name`, "Variant name is required.");
    else if (variantName.length > 120)
      addError(
        errors,
        `variants.${i}.name`,
        "Variant name must be 120 characters or fewer.",
      );
    const position = parseNonNegativeInt(
      vr.position,
      `variants.${i}.position`,
      "Position",
      errors,
    );

    let sku: CreateSkuInput | undefined;
    if (vr.sku) {
      const formSku = vr.sku;
      const skuCode = formSku.skuCode.trim();
      if (!skuCode)
        addError(
          errors,
          `variants.${i}.sku.skuCode`,
          "SKU code is required when a SKU is enabled.",
        );
      else if (skuCode.length > 64)
        addError(
          errors,
          `variants.${i}.sku.skuCode`,
          "SKU code must be 64 characters or fewer.",
        );

      const supplierSku = formSku.supplierSku.trim();
      if (supplierSku.length > 120)
        addError(
          errors,
          `variants.${i}.sku.supplierSku`,
          "Supplier SKU must be 120 characters or fewer.",
        );
      const costCurrency = formSku.costCurrency.trim();
      if (costCurrency.length > 8)
        addError(
          errors,
          `variants.${i}.sku.costCurrency`,
          "Currency code must be 8 characters or fewer.",
        );

      const skuRecord: Record<string, string | number> = {
        skuCode,
        status: SKU_STATUSES.includes(formSku.status)
          ? formSku.status
          : "ACTIVE",
      };
      if (supplierSku) skuRecord.supplierSku = supplierSku;
      if (costCurrency) skuRecord.costCurrency = costCurrency;
      for (const { key, label } of SKU_NUM_FIELDS) {
        const raw = formSku[key].trim();
        const n = parseNonNegative(
          raw,
          `variants.${i}.sku.${key}`,
          label,
          errors,
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
      error: "Please fix the highlighted fields and try again.",
      fieldErrors: errors,
    };
  }

  const value: CreateProductInput = {
    name,
    slug,
    description: description || null,
    tagline: tagline || null,
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
const TABS = [
  { key: "basic", label: "Basic Info" },
  { key: "media", label: "Media" },
  { key: "variants", label: "Variants & Pricing" },
  { key: "specs", label: "Specifications" },
  { key: "shipping", label: "Shipping" },
  { key: "seo", label: "SEO" },
  { key: "preview", label: "Preview" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

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
  if (key === "slug") return "seo";
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
  submitLabel: string;
  pending: boolean;
  error: string | null;
}

export function ProductForm({
  initial,
  categories,
  onSubmit,
  submitLabel,
  pending,
  error,
}: ProductFormProps): ReactNode {
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
  const [formError, setFormError] = useState<string | null>(null);
  // Which editor tab is open. Panels are conditionally rendered but all state
  // lives in `value` above, so switching tabs never loses edits.
  const [activeTab, setActiveTab] = useState<TabKey>("basic");
  // Index of the image card currently being HTML5-dragged.
  const dragFrom = useRef<number | null>(null);

  const flatCategories = flattenCategories(categories);
  const err = (key: string): string | undefined => fieldErrors[key];

  const clearValidation = (): void => {
    setFieldErrors({});
    setFormError(null);
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
  const addImage = (): void => {
    setValue((prev) => ({
      ...prev,
      images: [...prev.images, { url: "", altText: "", sortOrder: "" }],
    }));
    clearValidation();
  };
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
      detailBlocks: [
        ...prev.detailBlocks,
        // New blocks land last: sortOrder mirrors the list position.
        { type, url: "", altText: "", sortOrder: String(prev.detailBlocks.length) },
      ],
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
  // group) with its Chinese operator hint.
  const renderSkuField = (
    variantIndex: number,
    key: keyof SkuFormValue,
  ): ReactNode => {
    const sku = value.variants[variantIndex]?.sku ?? null;
    return (
      <Field
        key={key}
        label={SKU_LABELS[key] ?? key}
        htmlFor={`pf-variants-${variantIndex}-sku-${key}`}
        error={err(`variants.${variantIndex}.sku.${key}`)}
        hint={SKU_FIELD_HINTS[key]}
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

  /**
   * Serializes + submits the single form value. `statusOverride` lets the
   * action bar's "Save Draft" store the current edits as a DRAFT in one click
   * without mutating the visible status select first.
   */
  const submitForm = (statusOverride?: ProductStatus): void => {
    const target = statusOverride ? { ...value, status: statusOverride } : value;
    const result = serializeFormValue(target);
    if (!result.ok) {
      setFieldErrors(result.fieldErrors);
      setFormError(result.error);
      // Surface the failing tab — with panels hidden, an inline error alone
      // would be invisible.
      const firstKey = Object.keys(result.fieldErrors)[0];
      if (firstKey) setActiveTab(tabForErrorKey(firstKey));
      return;
    }
    setFieldErrors({});
    setFormError(null);
    onSubmit(target);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    submitForm();
  };

  const tabHasError = (tab: TabKey): boolean =>
    Object.keys(fieldErrors).some((k) => tabForErrorKey(k) === tab);
  const coverSortOrder =
    value.images.length > 0
      ? Math.min(...value.images.map((img) => Number(img.sortOrder.trim() || "0") || 0))
      : 0;

  return (
    <form onSubmit={handleSubmit} noValidate>
      {/* Sticky action bar. top-14 clears the shell's h-14 top bar; z-10 sits
          under its z-20 (and the sidebar's z-30). Kept inside the single
          <form> so both save buttons submit it — no nested forms. */}
      <div className="sticky top-14 z-10 -mx-4 mb-6 border-b border-border bg-background/95 px-4 py-3 backdrop-blur md:-mx-8 md:px-8">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link
            href="/admin/products"
            className="text-sm font-semibold text-cta hover:underline"
          >
            ← Back to Products
          </Link>
          <div className="flex items-center gap-2">
            <label htmlFor="pf-status" className="text-xs font-semibold text-ink-secondary">
              Status
            </label>
            <select
              id="pf-status"
              value={value.status}
              onChange={(e) => patch({ status: e.target.value as ProductStatus })}
              className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm font-semibold text-ink focus:border-cta focus:outline-none"
            >
              {PRODUCT_STATUSES.map((s) => (
                <option key={s} value={s} title={STATUS_LABELS[s]}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => submitForm("DRAFT")}
              disabled={pending}
              className="h-9 rounded-lg border border-border bg-card px-4 text-sm font-semibold text-ink hover:border-primary disabled:text-ink-muted"
            >
              Save Draft
            </button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              className="h-9 min-w-0 px-5 text-sm"
              disabled={pending}
              aria-busy={pending}
            >
              {pending ? "Saving…" : submitLabel}
            </Button>
            {value.slug.trim() ? (
              <Link
                href={`/products/${value.slug.trim()}`}
                target="_blank"
                className="h-9 rounded-lg border border-border bg-card px-4 text-sm font-semibold leading-9 text-cta hover:border-primary"
              >
                Preview Product
              </Link>
            ) : (
              <span className="text-xs text-ink-muted">填好 Slug 并保存后可预览</span>
            )}
          </div>
        </div>
      </div>

      {formError ? (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-sale/40 bg-sale/5 p-4 text-sm text-red-700"
        >
          {formError}
        </div>
      ) : null}
      {/* Parent (server) error from the last submit attempt. A newer failed
          CLIENT-side submit supersedes it: hide it while local validation
          state exists (formError or any field error) so two alerts never
          show together. Mere edits do not dismiss it — only a submit does. */}
      {error && !formError && Object.keys(fieldErrors).length === 0 ? (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-sale/40 bg-sale/5 p-4 text-sm text-red-700"
        >
          {error}
        </div>
      ) : null}

      {/* Operator workflow guide (internal back office; never storefront). */}
      <details className="group mb-6 rounded-lg bg-primary-light/30 px-4 py-3 text-xs leading-relaxed text-ink-secondary">
        <summary className="cursor-pointer list-none text-sm font-semibold text-ink">
          上架流程（新商品按此顺序操作）
          <span className="ml-2 font-normal text-ink-muted group-open:hidden">展开</span>
        </summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>
            在本页填写商品信息、图片、款式与价格，先以
            <span className="font-semibold"> DRAFT 草稿</span>保存。
          </li>
          <li>
            确认无误后把右上 Status 改为
            <span className="font-semibold"> ACTIVE 上架</span>（DRAFT 在前台完全不可见）。
          </li>
          <li>
            到左侧 <span className="font-semibold">Inventory</span> 页给每个 SKU
            入库：搜到商品 → Adjust → 填正数数量（如 50）和原因。库存为 0
            时前台显示 Out of Stock，不能下单。
          </li>
          <li>
            到左侧 <span className="font-semibold">Collections</span> 页把商品加入
            New Arrivals（前台显示 New 角标）。Bestseller 角标只挂真实热销款，新品不要挂。
          </li>
        </ol>
        <p className="mt-2">
          出厂价、物流尺寸等成本字段仅后台可见；前台只显示售价和商品描述。
        </p>
      </details>

      {/* Editor tabs. Panels are conditionally rendered; all form state lives
          in the single `value` object, so switching tabs never loses edits. */}
      <div
        role="tablist"
        aria-label="Product form sections"
        className="mb-8 flex flex-wrap gap-2 border-b border-border pb-3"
      >
        {TABS.map((tab) => {
          const selected = activeTab === tab.key;
          const hasError = tabHasError(tab.key);
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              id={`pf-tab-${tab.key}`}
              aria-selected={selected}
              aria-controls={`pf-panel-${tab.key}`}
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                selected
                  ? "bg-cta text-white"
                  : "border border-border bg-card text-ink-secondary hover:text-cta"
              }`}
            >
              {tab.label}
              {hasError ? (
                <span
                  aria-label="(有错误)"
                  className="ml-1.5 inline-block h-2 w-2 rounded-full bg-sale align-middle"
                />
              ) : null}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`pf-panel-${activeTab}`}
        aria-labelledby={`pf-tab-${activeTab}`}
        className="flex flex-col gap-8"
      >

        {activeTab === "basic" && (
          <>
            <Section
              title="Basic Info"
              hint="带 * 为必填。前台首屏依次展示：商品名 → Tagline → 评分 → 价格。"
            >
              <div className="grid gap-4 md:grid-cols-2">
                <Field
                  label="Name *"
                  htmlFor="pf-name"
                  error={err("name")}
                  hint={
                    <span title="前台展示的英文商品名，也是唯一 H1。建议：品类 + 核心特征 + 规格/层数，如 Foldable Shoe Cabinet 3-Tier with Clear Doors。">
                      英文商品名（前台唯一 H1）
                    </span>
                  }
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
                  label="Tagline / Subtitle"
                  htmlFor="pf-tagline"
                  error={err("tagline")}
                  hint={
                    <span title="一句话卖点，显示在商品名下方。留空则前台不显示这一行。最多 200 字符。">
                      商品名下的一句话卖点，留空则不显示
                    </span>
                  }
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
                    label="Description"
                    htmlFor="pf-description"
                    error={err("description")}
                    hint={
                      <span title="英文详情描述（顾客可见），支持换行，最多 5,000 字符。只显示在下方 Product Details 区——材质、功能等规格请填到 Specifications 页，不要写在这里。">
                        详情区开头的短文字；规格请用 Specifications 页
                      </span>
                    }
                  >
                    <Textarea
                      id="pf-description"
                      rows={6}
                      value={value.description}
                      onChange={(e) => patch({ description: e.target.value })}
                    />
                  </Field>
                </div>

                <Field
                  label="Category *"
                  htmlFor="pf-category"
                  error={err("categoryId")}
                  hint={
                    <span title="商品的固定归属，决定它出现在哪个分类页与面包屑。一个商品只能选一个分类；营销分组（新品/热销）在 Collections 页管理。">
                      归属分类，决定分类页与面包屑
                    </span>
                  }
                >
                  <Select
                    id="pf-category"
                    value={value.categoryId}
                    onChange={(e) => patch({ categoryId: e.target.value })}
                  >
                    <option value="" disabled>
                      Select a category…
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
                  label="Room"
                  htmlFor="pf-room"
                  error={err("room")}
                  hint={
                    <span title="主要使用空间（单选），用于前台分类页的 Room 筛选；不确定可留空。">
                      前台 Room 筛选用
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
                        {ROOM_LABELS[r] ?? r}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field
                  label="Internal role"
                  htmlFor="pf-internal-role"
                  error={err("internalRole")}
                  hint={
                    <span title="内部运营定位，不展示给顾客，用于推荐排序：引流款低价拉新，利润款做高客单。">
                      内部运营定位，前台不显示
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
                        {ROLE_LABELS[r] ?? r}
                      </option>
                    ))}
                  </Select>
                </Field>

                <fieldset className="md:col-span-2">
                  <legend className="text-sm font-medium text-ink">Solutions</legend>
                  <p className="mt-1 text-xs text-ink-muted">
                    卖点标签（可多选），驱动前台 Solution 筛选；不符合的不要勾选。
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
                          {SOLUTION_LABELS[s] ?? s}
                        </label>
                      </li>
                    ))}
                  </ul>
                </fieldset>
              </div>
            </Section>
          </>
        )}

        {activeTab === "media" && (
          <>
            <Section
              title="Product images"
              hint={
                <>
                  卡片可拖动排序（也可用 ↑ ↓）。「设为封面」把图移到第一位 = 前台主图。
                  建议每商品 4–6 张：白底主图、细节、尺寸图、生活场景图。URL
                  与排序数字收在「Advanced」里。
                </>
              }
            >
              {value.images.length === 0 ? (
                <p className="text-sm text-ink-muted">
                  还没有图片，点下方按钮添加第一张（主图）。
                </p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {value.images.map((img, i) => {
                    const sortNum = Number(img.sortOrder.trim() || "0") || 0;
                    const isCover = value.images.length > 0 && sortNum === coverSortOrder;
                    return (
                      <li
                        key={i}
                        draggable
                        onDragStart={(e) => {
                          dragFrom.current = i;
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (dragFrom.current !== null) moveImageTo(dragFrom.current, i);
                          dragFrom.current = null;
                        }}
                        className={`rounded-lg bg-background p-3 ${
                          isCover ? "ring-1 ring-cta" : ""
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          {/* Thumbnail; empty until a URL is set. */}
                          <div className="h-20 w-20 shrink-0 overflow-hidden rounded-md border border-border bg-card">
                            {img.url.trim() ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={img.url}
                                alt=""
                                className="h-full w-full object-cover"
                                draggable={false}
                              />
                            ) : (
                              <div className="flex h-full items-center justify-center text-xs text-ink-muted">
                                无图
                              </div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              {isCover ? (
                                <span className="rounded-full bg-cta px-2 py-0.5 text-xs font-semibold text-white">
                                  封面
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setCoverImage(i)}
                                  disabled={pending}
                                  className="text-xs font-semibold text-cta hover:underline disabled:text-ink-muted disabled:no-underline"
                                >
                                  设为封面
                                </button>
                              )}
                              <span className="text-xs text-ink-muted">
                                拖动卡片或用 ↑ ↓ 排序
                              </span>
                            </div>
                            <div className="mt-2">
                              <Field
                                label={i === 0 ? "Alt text" : ""}
                                htmlFor={`pf-images-${i}-alt`}
                                error={err(`images.${i}.altText`)}
                                hint={
                                  i === 0
                                    ? "图片文字描述（英文即可），SEO 用。"
                                    : undefined
                                }
                              >
                                <TextInput
                                  id={`pf-images-${i}-alt`}
                                  aria-label={
                                    i === 0 ? undefined : `Image ${i + 1} alt text`
                                  }
                                  value={img.altText}
                                  onChange={(e) =>
                                    setImage(i, { altText: e.target.value })
                                  }
                                  autoComplete="off"
                                />
                              </Field>
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-3">
                              <button
                                type="button"
                                className={removeBtnCls}
                                onClick={() => moveImage(i, -1)}
                                disabled={pending || i === 0}
                                aria-label={`Move image ${i + 1} up`}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                className={removeBtnCls}
                                onClick={() => moveImage(i, 1)}
                                disabled={pending || i === value.images.length - 1}
                                aria-label={`Move image ${i + 1} down`}
                              >
                                ↓
                              </button>
                              <button
                                type="button"
                                className={removeBtnCls}
                                onClick={() => removeImage(i)}
                                disabled={pending}
                              >
                                Remove
                              </button>
                            </div>
                            {/* URL + numeric sort live here, not in the
                                main card — the card UI is the primary
                                editing surface. */}
                            <details className="mt-2">
                              <summary className="cursor-pointer text-xs font-semibold text-ink-secondary">
                                Advanced（图片网址 / 排序数字）
                              </summary>
                              <div className="mt-2 grid gap-3 md:grid-cols-[1fr_110px] md:items-end">
                                <Field
                                  label="URL"
                                  htmlFor={`pf-images-${i}-url`}
                                  error={err(`images.${i}.url`)}
                                >
                                  <ImageUrlInput
                                    id={`pf-images-${i}-url`}
                                    ariaLabel={`Image ${i + 1} URL`}
                                    value={img.url}
                                    onChange={(url) => setImage(i, { url })}
                                    disabled={pending}
                                  />
                                </Field>
                                <Field
                                  label="Sort"
                                  htmlFor={`pf-images-${i}-sort`}
                                  error={err(`images.${i}.sortOrder`)}
                                >
                                  <TextInput
                                    id={`pf-images-${i}-sort`}
                                    aria-label={`Image ${i + 1} sort order`}
                                    inputMode="numeric"
                                    value={img.sortOrder}
                                    onChange={(e) =>
                                      setImage(i, { sortOrder: e.target.value })
                                    }
                                    autoComplete="off"
                                  />
                                </Field>
                              </div>
                            </details>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              <Button
                type="button"
                variant="secondary"
                size="md"
                className="mt-4"
                onClick={addImage}
                disabled={pending}
              >
                Add image
              </Button>
            </Section>

      {/* ---------------- Detail blocks (description body) ---------------- */}
      <Section
        title="详情内容（图片 / 视频）"
        hint={
          <>
            显示在商品页图集下方的详情区。顾客主要靠这里的图/视频做判断，所以详情以
            图片视频为主：1688 详情长图、实物拍摄、安装视频都可以放。IMAGE
            可粘贴网址或点「上传图片」；VIDEO 粘贴 MP4 直链。顺序即前台展示顺序，用 ↑ ↓
            调整；上方「Description」的短文字会显示在详情区开头。
          </>
        }
      >
        {value.detailBlocks.length === 0 ? (
          <p className="text-sm text-ink-muted">
            还没有详情内容，点下方「Add image / Add video」添加第一块。
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {value.detailBlocks.map((block, i) => (
              <li
                key={i}
                className="grid gap-3 md:grid-cols-[120px_1fr_200px_auto] md:items-end"
              >
                <Field
                  label={i === 0 ? "类型" : ""}
                  htmlFor={`pf-detail-${i}-type`}
                  hint={i === 0 ? "图片或视频" : undefined}
                >
                  <Select
                    id={`pf-detail-${i}-type`}
                    aria-label={i === 0 ? undefined : `Detail block ${i + 1} type`}
                    value={block.type}
                    onChange={(e) =>
                      setDetailBlock(i, {
                        type: e.target.value as DetailBlockFormValue["type"],
                      })
                    }
                    disabled={pending}
                  >
                    <option value="IMAGE">图片</option>
                    <option value="VIDEO">视频</option>
                  </Select>
                </Field>
                <Field
                  label={i === 0 ? "URL" : ""}
                  htmlFor={`pf-detail-${i}-url`}
                  error={err(`detailBlocks.${i}.url`)}
                  hint={
                    i === 0
                      ? block.type === "VIDEO"
                        ? "MP4 直链；手机上不自动播放，给顾客点播按钮。"
                        : "图片网址，必须是可直接打开的图片链接。"
                      : undefined
                  }
                >
                  {block.type === "IMAGE" ? (
                    <ImageUrlInput
                      id={`pf-detail-${i}-url`}
                      ariaLabel={i === 0 ? undefined : `Detail block ${i + 1} URL`}
                      value={block.url}
                      onChange={(url) => setDetailBlock(i, { url })}
                      disabled={pending}
                    />
                  ) : (
                    <TextInput
                      id={`pf-detail-${i}-url`}
                      aria-label={i === 0 ? undefined : `Detail block ${i + 1} URL`}
                      value={block.url}
                      placeholder="https://…/product-demo.mp4"
                      onChange={(e) => setDetailBlock(i, { url: e.target.value })}
                      autoComplete="off"
                    />
                  )}
                </Field>
                <Field
                  label={i === 0 ? "Alt text" : ""}
                  htmlFor={`pf-detail-${i}-alt`}
                  error={err(`detailBlocks.${i}.altText`)}
                  hint={i === 0 ? "英文描述，SEO 与无障碍用。" : undefined}
                >
                  <TextInput
                    id={`pf-detail-${i}-alt`}
                    aria-label={i === 0 ? undefined : `Detail block ${i + 1} alt text`}
                    value={block.altText}
                    onChange={(e) => setDetailBlock(i, { altText: e.target.value })}
                    autoComplete="off"
                  />
                </Field>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className={removeBtnCls}
                    onClick={() => moveDetailBlock(i, -1)}
                    disabled={pending || i === 0}
                    aria-label={`Move block ${i + 1} up`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className={removeBtnCls}
                    onClick={() => moveDetailBlock(i, 1)}
                    disabled={pending || i === value.detailBlocks.length - 1}
                    aria-label={`Move block ${i + 1} down`}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className={removeBtnCls}
                    onClick={() => removeDetailBlock(i)}
                    disabled={pending}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex flex-wrap gap-3">
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => addDetailBlock("IMAGE")}
            disabled={pending}
          >
            Add image
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => addDetailBlock("VIDEO")}
            disabled={pending}
          >
            Add video
          </Button>
        </div>

          </Section>
            </>
          )}

          {activeTab === "specs" && (
            <>
              <Section
                title="Dimensions"
                hint="全部以厘米 cm 填写。填写后前台 Specifications 自动展示尺寸；可折叠商品建议同时填折叠后尺寸。"
              >
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {DIMENSION_FIELDS.map(({ key, label, hint }) => (
                    <Field
                      key={key}
                      label={label}
                      htmlFor={`pf-${key}`}
                      error={err(key)}
                      hint={hint}
                    >
                      <TextInput
                        id={`pf-${key}`}
                        inputMode="decimal"
                        placeholder="选填"
                        value={value[key]}
                        onChange={(e) => patch({ [key]: e.target.value })}
                        autoComplete="off"
                      />
                    </Field>
                  ))}
                </div>
              </Section>

              <Section
                title="Materials"
                hint="材质说明（如 Solid wood frame, MDF panels）。前台 Specifications 自动读取，不要写进 Description。留空则不显示。"
              >
                <Field label="Materials" htmlFor="pf-materials" error={err("materials")}>
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
                title="Features"
                hint="功能点列表，一行一条（前台显示为 ✓ 短句）。用 ↑ ↓ 调整顺序；留空则整块不显示。"
              >
                {value.features.length === 0 ? (
                  <p className="text-sm text-ink-muted">
                    还没有功能点，点下方按钮添加第一条。
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {value.features.map((line, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <span aria-hidden className="w-5 shrink-0 text-center text-sm font-semibold text-cta">
                          ✓
                        </span>
                        <TextInput
                          aria-label={`Feature ${i + 1}`}
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
                          aria-label={`Move feature ${i + 1} up`}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className={removeBtnCls}
                          onClick={() => moveFeatureLine(i, 1)}
                          disabled={pending || i === value.features.length - 1}
                          aria-label={`Move feature ${i + 1} down`}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className={removeBtnCls}
                          onClick={() => removeFeatureLine(i)}
                          disabled={pending}
                          aria-label={`Remove feature ${i + 1}`}
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
                  Add feature
                </Button>
              </Section>
            </>
          )}

        {activeTab === "variants" && (
          <Section
            title="Variants & Pricing"
            hint="款式 = 顾客可选择的颜色/规格。每个款式对应一个 SKU；至少 1 个勾选 Has SKU 的款式才能销售。包装/重量等物流字段在 Shipping 页统一填写。"
          >
            {value.variants.length === 0 ? (
              <p className="text-sm text-ink-muted">
                还没有款式。点下方 Add variant 添加；可销售商品至少需要 1 个带 SKU 的款式。
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {value.variants.map((vr, i) => (
                  <li key={i} className="rounded-lg bg-background p-4">
                    <div className="flex items-center justify-between gap-4">
                      <h3 className="text-sm font-semibold text-ink">
                        {vr.name.trim() || `Variant ${i + 1}`}
                      </h3>
                      <button
                        type="button"
                        className="text-sm font-semibold text-red-700 hover:underline disabled:text-ink-muted disabled:no-underline"
                        onClick={() => removeVariant(i)}
                        disabled={pending}
                      >
                        Remove
                      </button>
                    </div>

                    {/* Default-visible fields: name, price, compare-at. */}
                    <div className="mt-3 grid gap-4 md:grid-cols-3">
                      <Field
                        label="Variant name *"
                        htmlFor={`pf-variants-${i}-name`}
                        error={err(`variants.${i}.name`)}
                        hint="前台款式按钮文字，通常填颜色；只有一款可填 Default。"
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
                        Has SKU
                        <span className="font-normal text-ink-muted">
                          {" "}
                          — 勾选后才能填价格、入库销售；不勾选时该款式在前台只显示 View Details
                        </span>
                      </span>
                    </label>

                    {vr.sku ? (
                      <div className="mt-4 border-t border-border pt-4">
                        {/* Default-visible: SKU code, status, stock. */}
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                          <Field
                            label="SKU code *"
                            htmlFor={`pf-variants-${i}-sku-code`}
                            error={err(`variants.${i}.sku.skuCode`)}
                            hint="内部库存编码，全店唯一。"
                          >
                            <TextInput
                              id={`pf-variants-${i}-sku-code`}
                              value={vr.sku.skuCode}
                              onChange={(e) =>
                                setSku(i, { skuCode: e.target.value })
                              }
                              autoComplete="off"
                            />
                          </Field>
                          <Field
                            label="SKU status"
                            htmlFor={`pf-variants-${i}-sku-status`}
                            error={err(`variants.${i}.sku.status`)}
                            hint="ACTIVE 可售；DISABLED 停售（数据保留）。"
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
                                  {s}
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
                        Stock 库存
                      </p>
                      <p className="mt-0.5 text-xs text-ink-muted">
                        可售数量，前台据此显示库存状态并在售罄时拦住下单。保存商品时一并写入，后台保留库存流水。
                      </p>
                      <div className="mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <Field
                          label="Stock 库存"
                          htmlFor={`pf-variants-${i}-stock`}
                          hint={
                            !vr.sku.id
                              ? "SKU 尚未创建：保存后会按这里的数量写入库存。"
                              : vr.sku.reserved !== "0"
                                ? `已有 ${vr.sku.reserved} 件被未完成订单占用，库存不能低于该数。`
                                : "当前无订单占用。"
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
                            Advanced inventory &amp; logistics
                          </summary>
                          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                            <Field
                              label="Position"
                              htmlFor={`pf-variants-${i}-position`}
                              error={err(`variants.${i}.position`)}
                              hint="显示顺序，0 起"
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
                              label="Supplier SKU"
                              htmlFor={`pf-variants-${i}-supplier-sku`}
                              error={err(`variants.${i}.sku.supplierSku`)}
                              hint="工厂货号/型号，内部使用，前台不显示。"
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
                              label="Cost currency"
                              htmlFor={`pf-variants-${i}-cost-currency`}
                              error={err(`variants.${i}.sku.costCurrency`)}
                              hint="成本货币代码，如 CNY。售价固定为 PHP ₱。"
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

                        {/* Stock lives in its own table, which is why the product
                            form could not see it before. The figure shown is what
                            the form last read and it is saved back as an absolute
                            value, so a stale copy cannot corrupt the count the way
                            a client-computed delta would. */}
                        <div className="mt-4">
                          <p className="text-xs font-semibold text-ink-secondary">
                            Stock 库存
                          </p>
                          <p className="mt-0.5 text-xs text-ink-muted">
                            可售数量，保存商品时一并写入，后台保留库存流水。
                          </p>
                          <div className="mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                            <Field
                              label="Stock 库存"
                              htmlFor={`pf-variants-${i}-stock`}
                              hint={
                                !vr.sku.id
                                  ? "SKU 尚未创建：保存后会按这里的数量写入库存。"
                                  : vr.sku.reserved !== "0"
                                    ? `已有 ${vr.sku.reserved} 件被未完成订单占用，库存不能低于该数。`
                                    : "当前无订单占用。"
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
              Add variant
            </Button>
          </Section>
        )}

        {activeTab === "shipping" && (
          <Section
            title="Shipping — 包装与重量"
            hint="按 SKU 填写，仅用于发货/运费核算，前台不显示；可先留空，发货前补齐。与 Variants 页的 Advanced 存的是同一份数据。"
          >
            {value.variants.length === 0 ? (
              <p className="text-sm text-ink-muted">
                还没有款式——先到 Variants &amp; Pricing 页添加。
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {value.variants.map((vr, i) => (
                  <li key={i} className="rounded-lg bg-background p-4">
                    <p className="text-sm font-semibold text-ink">
                      {vr.name.trim() || `Variant ${i + 1}`}
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
                        该款式未启用 SKU，无物流字段。
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
            title="SEO"
            hint="商品网页地址与搜索结果预览。图片 Alt text 在 Media 页每张图上填写。"
          >
            <Field label="Slug *" htmlFor="pf-slug" error={err("slug")}>
              <TextInput
                id="pf-slug"
                value={value.slug}
                maxLength={120}
                placeholder="folding-chair"
                onChange={(e) => patch({ slug: e.target.value })}
                autoComplete="off"
              />
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                <p className="text-xs text-ink-muted">{SLUG_HINT}</p>
                <button
                  type="button"
                  onClick={autoSlug}
                  className="text-xs font-semibold text-cta hover:underline"
                >
                  根据名称自动生成
                </button>
              </div>
              <p className="text-xs text-ink-muted">
                保存后不要随意修改，避免旧链接失效。
              </p>
            </Field>

            <div className="mt-6">
              <p className="text-xs font-semibold text-ink-secondary">
                搜索结果预览（示意）
              </p>
              <div className="mt-2 max-w-xl rounded-lg bg-background p-4">
                <p className="truncate text-sm font-semibold text-[#1a0dab]">
                  {value.name.trim() || "Product name"} | LUWAG Living
                </p>
                <p className="truncate text-xs text-[#006621]">
                  luwag.ph/products/{value.slug.trim() || "your-slug"}
                </p>
                <p className="mt-1 line-clamp-2 text-xs text-ink-secondary">
                  {(value.tagline.trim() || value.description.trim() || "暂无描述——填好 Tagline 或 Description 后这里显示摘要。").slice(0, 160)}
                </p>
              </div>
            </div>

            {value.images.some((img) => img.altText.trim()) ? (
              <div className="mt-6">
                <p className="text-xs font-semibold text-ink-secondary">
                  图片 Alt text 概览
                </p>
                <ul className="mt-2 flex flex-col gap-1 text-xs text-ink-muted">
                  {value.images.map((img, i) =>
                    img.altText.trim() ? (
                      <li key={i}>
                        Image {i + 1}: {img.altText.trim()}
                      </li>
                    ) : null,
                  )}
                </ul>
              </div>
            ) : (
              <p className="mt-6 text-xs text-ink-muted">
                还没有填任何图片 Alt text——到 Media 页补齐，利于 SEO 与无障碍。
              </p>
            )}
          </Section>
        )}

        {activeTab === "preview" && (
          <Section
            title="Preview"
            hint="左边是本表单当前内容的实时预览；整页预览显示已保存版本，需先保存。"
          >
            <div className="flex flex-col gap-5">
              <LivePreview>
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
              </LivePreview>
              {value.slug.trim() ? (
                <div className="border-t border-border pt-4">
                  <h4 className="text-xs font-semibold text-ink-secondary">
                    整页预览（已保存版本，商品详情页）
                  </h4>
                  <div className="mt-3">
                    <StorefrontPreview path={`/products/${value.slug.trim()}`} />
                  </div>
                </div>
              ) : (
                <p className="text-xs text-ink-muted">
                  整页预览需要先保存：填好 Slug 并保存后，这里会显示商品详情页的真实效果。
                </p>
              )}
            </div>
          </Section>
        )}
      </div>
    </form>
  );
}
