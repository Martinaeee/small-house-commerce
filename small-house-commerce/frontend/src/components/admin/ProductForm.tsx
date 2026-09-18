"use client";

import type { FormEvent, ReactNode } from "react";
import { useState } from "react";
import {
  Field,
  Select,
  TextInput,
  Textarea,
} from "@/components/admin/Field";
import { Button } from "@/components/ui/Button";
import { ImageUrlInput } from "./ImageUrlInput";
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
  images: { url: string; altText: string; sortOrder: string }[];
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
const SKU_FIELD_GROUPS: {
  title: string;
  hint?: string;
  keys: (keyof SkuFormValue)[];
}[] = [
  { title: "零售价（前台展示）", keys: ["price", "compareAtPrice"] },
  { title: "内部成本（前台不显示）", keys: ["supplierCost", "landedCost"] },
  {
    title: "物流与包装",
    hint: "仅用于发货/运费核算，不在前台展示；可先留空，发货前补齐。",
    keys: [
      "productWeight",
      "packageWidth",
      "packageHeight",
      "packageDepth",
      "packageWeight",
      "volumetricWeight",
    ],
  },
];

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
    images: [],
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
    categoryId: v.categoryId,
    status: v.status,
    room: v.room || null,
    internalRole: v.internalRole || null,
    solutions: v.solutions.filter((s) =>
      (SOLUTIONS as readonly string[]).includes(s),
    ),
    ...dimensions,
    images,
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
    <section className="mt-4 rounded-xl border border-border bg-card p-5">
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

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const result = serializeFormValue(value);
    if (!result.ok) {
      setFieldErrors(result.fieldErrors);
      setFormError(result.error);
      return;
    }
    setFieldErrors({});
    setFormError(null);
    onSubmit(value);
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      {formError ? (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-sale/40 bg-sale/5 p-4 text-sm text-red-700"
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
          className="mt-4 rounded-xl border border-sale/40 bg-sale/5 p-4 text-sm text-red-700"
        >
          {error}
        </div>
      ) : null}

      {/* Operator workflow guide (internal back office; never storefront). */}
      <div className="mt-4 rounded-xl border border-primary/50 bg-primary-light/30 p-4 text-xs leading-relaxed text-ink-secondary">
        <p className="text-sm font-semibold text-ink">上架流程（新商品按此顺序操作）</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>
            在本页填写商品信息、图片、款式与价格，先以
            <span className="font-semibold"> DRAFT 草稿</span>保存。
          </li>
          <li>
            到 Products 列表确认无误后，用 Edit 把 Status 改为
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
      </div>

      {/* ---------------- Basics ---------------- */}
      <Section
        title="Basics"
        hint="商品的基本信息与运营属性。带 * 为必填。"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="Name *"
            htmlFor="pf-name"
            error={err("name")}
            hint="前台展示的英文商品名。建议：品类 + 核心特征 + 规格/层数，如 Foldable Shoe Cabinet 3-Tier with Clear Doors。"
          >
            <TextInput
              id="pf-name"
              value={value.name}
              maxLength={255}
              onChange={(e) => patch({ name: e.target.value })}
              autoComplete="off"
            />
          </Field>

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
              商品网页地址（/products/ 后面那段），只能用小写字母、数字和连字符；保存后不要随意修改，避免旧链接失效。
            </p>
          </Field>

          <div className="md:col-span-2">
            <Field
              label="Description"
              htmlFor="pf-description"
              error={err("description")}
              hint="英文详情描述（顾客可见），支持换行。材质、颜色、承重、安装方式、核心卖点都写在这里——这些规格前台没有单独的字段。最多 5,000 字符。"
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
            hint="商品的固定归属，决定它出现在哪个分类页。一个商品只能选一个分类；营销分组（新品/热销）在 Collections 页管理。"
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
            label="Status"
            htmlFor="pf-status"
            error={err("status")}
            hint="DRAFT 草稿只在后台可见；ACTIVE 后前台才能搜到和购买；DISABLED 是临时下架，数据保留。"
          >
            <Select
              id="pf-status"
              value={value.status}
              onChange={(e) =>
                patch({ status: e.target.value as ProductStatus })
              }
            >
              {PRODUCT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Room"
            htmlFor="pf-room"
            error={err("room")}
            hint="主要使用空间（单选），用于前台分类页的 Room 筛选；不确定可留空。"
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
            hint="内部运营定位，不直接展示给顾客，用于推荐排序：引流款低价拉新，利润款做高客单。"
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
              卖点标签（可多选），驱动前台分类页的 Solution 筛选；不符合的不要勾选。
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

      {/* ---------------- Dimensions ---------------- */}
      <Section
        title="Dimensions"
        hint="商品尺寸，全部以厘米 cm 填写。填写后前台商品页自动出现 Size guide；不适用的项目留空即可。可折叠商品建议同时填折叠后尺寸（也是折叠结构的勾选依据）。"
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

      {/* ---------------- Images ---------------- */}
      <Section
        title="Images"
        hint={
          <>
            可直接粘贴图片网址，或点「上传图片」从电脑选图（JPG/PNG/WebP，单张不超过
            8MB，直传 Cloudflare R2）。Sort 数字最小的是主图；建议 4–6
            张：白底主图、细节、尺寸图、生活场景图，不要带中文水印。
          </>
        }
      >
        {value.images.length === 0 ? (
          <p className="text-sm text-ink-muted">还没有图片，点下方按钮添加第一张（主图）。</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {value.images.map((img, i) => (
              <li
                key={i}
                className="grid gap-3 md:grid-cols-[1fr_220px_110px_auto] md:items-end"
              >
                <Field
                  label={i === 0 ? "URL" : ""}
                  htmlFor={`pf-images-${i}-url`}
                  error={err(`images.${i}.url`)}
                  hint={i === 0 ? "图片网址，必须是可直接打开的图片链接。" : undefined}
                >
                  <ImageUrlInput
                    id={`pf-images-${i}-url`}
                    // Row 0 has the visible Field label; later rows must
                    // still expose an accessible name (spec §12) — Field's
                    // label prop is string-only, so use aria-label (wins the
                    // accessible-name computation over the empty wrapper).
                    ariaLabel={i === 0 ? undefined : `Image ${i + 1} URL`}
                    value={img.url}
                    onChange={(url) => setImage(i, { url })}
                    disabled={pending}
                  />
                </Field>
                <Field
                  label={i === 0 ? "Alt text" : ""}
                  htmlFor={`pf-images-${i}-alt`}
                  error={err(`images.${i}.altText`)}
                  hint={i === 0 ? "图片文字描述（英文即可），SEO 用。" : undefined}
                >
                  <TextInput
                    id={`pf-images-${i}-alt`}
                    aria-label={
                      i === 0 ? undefined : `Image ${i + 1} alt text`
                    }
                    value={img.altText}
                    onChange={(e) => setImage(i, { altText: e.target.value })}
                    autoComplete="off"
                  />
                </Field>
                <Field
                  label={i === 0 ? "Sort" : ""}
                  htmlFor={`pf-images-${i}-sort`}
                  error={err(`images.${i}.sortOrder`)}
                  hint={i === 0 ? "0 为主图" : undefined}
                >
                  <TextInput
                    id={`pf-images-${i}-sort`}
                    aria-label={
                      i === 0 ? undefined : `Image ${i + 1} sort order`
                    }
                    inputMode="numeric"
                    value={img.sortOrder}
                    onChange={(e) =>
                      setImage(i, { sortOrder: e.target.value })
                    }
                    autoComplete="off"
                  />
                </Field>
                <button
                  type="button"
                  className={removeBtnCls}
                  onClick={() => removeImage(i)}
                  disabled={pending}
                >
                  Remove
                </button>
              </li>
            ))}
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

      {/* ---------------- Variants & SKUs ---------------- */}
      <Section
        title="Variants & SKUs"
        hint="款式 = 顾客可选择的颜色/规格。每个款式对应一个 SKU；一款商品至少要有 1 个勾选了 Has SKU 的款式，保存后才能到 Inventory 页入库并销售。即使只有一种颜色也建议建 1 个款式（名字可填 Default）。"
      >
        {value.variants.length === 0 ? (
          <p className="text-sm text-ink-muted">
            还没有款式。点下方 Add variant 添加；可销售商品至少需要 1 个带 SKU 的款式。
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {value.variants.map((vr, i) => (
              <li
                key={i}
                className="rounded-lg border border-border p-4"
              >
                <div className="flex items-center justify-between gap-4">
                  <h3 className="text-sm font-semibold text-ink">
                    Variant {i + 1}
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

                <div className="mt-3 grid gap-4 md:grid-cols-[1fr_140px]">
                  <Field
                    label="Variant name *"
                    htmlFor={`pf-variants-${i}-name`}
                    error={err(`variants.${i}.name`)}
                    hint="款式名 = 前台商品卡上的款式按钮文字，通常填颜色，如 White / Black；只有一款可填 Default。"
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
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      <Field
                        label="SKU code *"
                        htmlFor={`pf-variants-${i}-sku-code`}
                        error={err(`variants.${i}.sku.skuCode`)}
                        hint="内部库存编码，全店唯一。建议规则：品牌-品类-款式，如 LWG-SHOE3-WHT。"
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
                      <Field
                        label="Supplier SKU"
                        htmlFor={`pf-variants-${i}-supplier-sku`}
                        error={err(`variants.${i}.sku.supplierSku`)}
                        hint="工厂货号/型号（如 2786-3），内部使用，前台不显示。"
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
                        hint="成本货币代码，如 CNY。不影响售价——售价固定为 PHP ₱。"
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

                    {SKU_FIELD_GROUPS.map((group) => (
                      <div key={group.title} className="mt-4">
                        <p className="text-xs font-semibold text-ink-secondary">
                          {group.title}
                        </p>
                        {group.hint ? (
                          <p className="mt-0.5 text-xs text-ink-muted">
                            {group.hint}
                          </p>
                        ) : null}
                        <div className="mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                          {group.keys.map((key) => renderSkuField(i, key))}
                        </div>
                      </div>
                    ))}
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

      <div className="mt-6 flex items-center gap-3">
        <Button
          type="submit"
          variant="primary"
          size="md"
          disabled={pending}
          aria-busy={pending}
        >
          {pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
