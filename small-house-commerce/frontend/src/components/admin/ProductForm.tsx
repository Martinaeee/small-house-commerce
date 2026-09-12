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
}[] = [
  { key: "width", label: "Width" },
  { key: "height", label: "Height" },
  { key: "depth", label: "Depth" },
  { key: "foldedWidth", label: "Folded width" },
  { key: "foldedHeight", label: "Folded height" },
  { key: "foldedDepth", label: "Folded depth" },
];

const SKU_NUM_FIELDS: { key: keyof SkuFormValue; label: string }[] = [
  { key: "price", label: "Price (₱)" },
  { key: "compareAtPrice", label: "Compare-at price (₱)" },
  { key: "supplierCost", label: "Supplier cost" },
  { key: "landedCost", label: "Landed cost" },
  { key: "productWeight", label: "Product weight" },
  { key: "packageWidth", label: "Package width" },
  { key: "packageHeight", label: "Package height" },
  { key: "packageDepth", label: "Package depth" },
  { key: "packageWeight", label: "Package weight" },
  { key: "volumetricWeight", label: "Volumetric weight" },
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
  children,
}: {
  title: string;
  children: ReactNode;
}): ReactNode {
  return (
    <section className="mt-4 rounded-xl border border-border bg-card p-5">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
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

  // --- images ---------------------------------------------------------------
  const setImage = (i: number, p: Partial<ImageFormValue>): void =>
    setValue((prev) => ({
      ...prev,
      images: prev.images.map((img, j) => (j === i ? { ...img, ...p } : img)),
    }));
  const addImage = (): void =>
    setValue((prev) => ({
      ...prev,
      images: [...prev.images, { url: "", altText: "", sortOrder: "" }],
    }));
  const removeImage = (i: number): void =>
    setValue((prev) => ({
      ...prev,
      images: prev.images.filter((_, j) => j !== i),
    }));

  // --- variants -------------------------------------------------------------
  const setVariant = (i: number, p: Partial<VariantFormValue>): void =>
    setValue((prev) => ({
      ...prev,
      variants: prev.variants.map((vr, j) =>
        j === i ? { ...vr, ...p } : vr,
      ),
    }));
  const setSku = (i: number, p: Partial<SkuFormValue>): void =>
    setValue((prev) => ({
      ...prev,
      variants: prev.variants.map((vr, j) =>
        j === i && vr.sku ? { ...vr, sku: { ...vr.sku, ...p } } : vr,
      ),
    }));
  const addVariant = (): void =>
    setValue((prev) => ({
      ...prev,
      variants: [
        ...prev.variants,
        { name: "", position: "", sku: null },
      ],
    }));
  const removeVariant = (i: number): void =>
    setValue((prev) => ({
      ...prev,
      variants: prev.variants.filter((_, j) => j !== i),
    }));

  const toggleSolution = (solution: string, checked: boolean): void =>
    patch({
      solutions: checked
        ? [...value.solutions, solution]
        : value.solutions.filter((s) => s !== solution),
    });

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
      {error ? (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-sale/40 bg-sale/5 p-4 text-sm text-red-700"
        >
          {error}
        </div>
      ) : null}

      {/* ---------------- Basics ---------------- */}
      <Section title="Basics">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Name *" htmlFor="pf-name" error={err("name")}>
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
              placeholder="folding-chair"
              onChange={(e) => patch({ slug: e.target.value })}
              autoComplete="off"
            />
            <p className="mt-1 text-xs text-ink-muted">{SLUG_HINT}</p>
          </Field>

          <div className="md:col-span-2">
            <Field
              label="Description"
              htmlFor="pf-description"
              error={err("description")}
            >
              <Textarea
                id="pf-description"
                rows={4}
                value={value.description}
                onChange={(e) => patch({ description: e.target.value })}
              />
            </Field>
          </div>

          <Field
            label="Category *"
            htmlFor="pf-category"
            error={err("categoryId")}
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

          <Field label="Status" htmlFor="pf-status" error={err("status")}>
            <Select
              id="pf-status"
              value={value.status}
              onChange={(e) =>
                patch({ status: e.target.value as ProductStatus })
              }
            >
              {PRODUCT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Room" htmlFor="pf-room" error={err("room")}>
            <Select
              id="pf-room"
              value={value.room}
              onChange={(e) => patch({ room: e.target.value })}
            >
              <option value="">—</option>
              {ROOMS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Internal role"
            htmlFor="pf-internal-role"
            error={err("internalRole")}
          >
            <Select
              id="pf-internal-role"
              value={value.internalRole}
              onChange={(e) => patch({ internalRole: e.target.value })}
            >
              <option value="">—</option>
              {INTERNAL_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </Field>

          <fieldset className="md:col-span-2">
            <legend className="text-sm font-medium text-ink">Solutions</legend>
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
                    {s}
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        </div>
      </Section>

      {/* ---------------- Dimensions ---------------- */}
      <Section title="Dimensions">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {DIMENSION_FIELDS.map(({ key, label }) => (
            <Field
              key={key}
              label={label}
              htmlFor={`pf-${key}`}
              error={err(key)}
            >
              <TextInput
                id={`pf-${key}`}
                inputMode="decimal"
                placeholder="Optional"
                value={value[key]}
                onChange={(e) => patch({ [key]: e.target.value })}
                autoComplete="off"
              />
            </Field>
          ))}
        </div>
      </Section>

      {/* ---------------- Images ---------------- */}
      <Section title="Images">
        {value.images.length === 0 ? (
          <p className="text-sm text-ink-muted">No images added yet.</p>
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
                >
                  <TextInput
                    id={`pf-images-${i}-url`}
                    value={img.url}
                    placeholder="https://…"
                    onChange={(e) => setImage(i, { url: e.target.value })}
                    autoComplete="off"
                  />
                </Field>
                <Field
                  label={i === 0 ? "Alt text" : ""}
                  htmlFor={`pf-images-${i}-alt`}
                  error={err(`images.${i}.altText`)}
                >
                  <TextInput
                    id={`pf-images-${i}-alt`}
                    value={img.altText}
                    onChange={(e) => setImage(i, { altText: e.target.value })}
                    autoComplete="off"
                  />
                </Field>
                <Field
                  label={i === 0 ? "Sort" : ""}
                  htmlFor={`pf-images-${i}-sort`}
                  error={err(`images.${i}.sortOrder`)}
                >
                  <TextInput
                    id={`pf-images-${i}-sort`}
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
      <Section title="Variants & SKUs">
        {value.variants.length === 0 ? (
          <p className="text-sm text-ink-muted">
            No variants yet. A sellable product needs a variant with a SKU.
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
                  Has SKU
                </label>

                {vr.sku ? (
                  <div className="mt-4 border-t border-border pt-4">
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      <Field
                        label="SKU code *"
                        htmlFor={`pf-variants-${i}-sku-code`}
                        error={err(`variants.${i}.sku.skuCode`)}
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
                      >
                        <TextInput
                          id={`pf-variants-${i}-cost-currency`}
                          value={vr.sku.costCurrency}
                          placeholder="PHP"
                          onChange={(e) =>
                            setSku(i, { costCurrency: e.target.value })
                          }
                          autoComplete="off"
                        />
                      </Field>
                      {SKU_NUM_FIELDS.map(({ key, label }) => (
                        <Field
                          key={key}
                          label={label}
                          htmlFor={`pf-variants-${i}-sku-${key}`}
                          error={err(`variants.${i}.sku.${key}`)}
                        >
                          <TextInput
                            id={`pf-variants-${i}-sku-${key}`}
                            inputMode="decimal"
                            value={vr.sku ? vr.sku[key] : ""}
                            onChange={(e) =>
                              setSku(i, { [key]: e.target.value } as Partial<
                                SkuFormValue
                              >)
                            }
                            autoComplete="off"
                          />
                        </Field>
                      ))}
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
