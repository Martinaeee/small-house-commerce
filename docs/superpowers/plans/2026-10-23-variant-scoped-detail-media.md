# Variant-Scoped Detail Media Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let PDP detail blocks (long images / videos) be scoped to an option value or an exact variant, resolved exactly like the gallery, and remove the duplicate "add detail image / video" entry points.

**Architecture:** Add nullable `option_value_id` / `variant_id` columns to `product_detail_blocks` (mirroring `product_images`), pass them through the existing Prisma passthrough create/update path, expose them in the storefront select, let the admin set them per row through a new "适用范围" select inside `MediaGallery`'s editor, and resolve them on the PDP with one pure function that `PdpDetails` feeds from `PdpPurchaseProvider`.

**Tech Stack:** Next.js 16 / React 19 / TypeScript / Tailwind 4 / Vitest + Testing Library (frontend); NestJS + Zod + Prisma + PostgreSQL / Vitest (backend).

**Spec:** `docs/superpowers/specs/2026-10-23-variant-scoped-detail-media-design.md`

## Global Constraints

- Scope columns are nullable; rows with both NULL are shared and must behave exactly as before.
- Columns are mutually exclusive: `option_value_id IS NULL OR variant_id IS NULL` (mirrors `product_images_exclusive_scope_check`).
- Option-value scopes are only offered for options with `isMediaDriver = true`; variants are always offered.
- Resolution order on the PDP: exact variant → media-driver option value → shared.
- No changes to gallery (`product_images`) behavior or its admin editor.
- All UI copy lives in `frontend/src/i18n/zh.ts` (default) and `en.ts`.

## Review Focus

- A product with scoped detail blocks but an unmatched selection must still show its shared blocks, never an empty detail section that hides legitimate content.
- Switching variants must not leave a stale scoped set on screen (the filtered list has to be recomputed on every selection change).
- Historical rows (both scope columns NULL) must render exactly as today, including the "See more" count and the featured-first ordering.
- Deleting an option value or variant must remove only its detail blocks, never the product's shared blocks (composite FK cascade).
- Admin rows whose scope select is switched back to "共享" must clear both ids in the submitted payload, not keep a hidden stale id.

---

### Task 1: Schema and migration for detail-block scope

**Files:**
- Modify: `small-house-commerce/backend/prisma/schema/catalog.prisma` (ProductDetailBlock ~206-219; ProductOptionValue ~300; ProductVariant ~341)
- Create: `small-house-commerce/backend/prisma/migrations/20261023110000_add_detail_block_scope/migration.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `ProductDetailBlock.optionValueId: string | null`, `ProductDetailBlock.variantId: string | null` (Prisma client types), used by every later task.

- [ ] **Step 1: Add the columns and relations to the Prisma model**

In `model ProductDetailBlock`, after `createdAt` add:

```prisma
  optionValueId String? @map("option_value_id") @db.Uuid
  variantId     String? @map("variant_id") @db.Uuid

  optionValue ProductOptionValue? @relation(fields: [optionValueId, productId], references: [id, productId], onDelete: Cascade)
  variant     ProductVariant?     @relation(fields: [variantId, productId], references: [id, productId], onDelete: Cascade)

  @@index([optionValueId, productId])
  @@index([variantId, productId])
```

Add the back-relations:

```prisma
// inside model ProductOptionValue, next to `images ProductImage[]`
  detailBlocks ProductDetailBlock[]

// inside model ProductVariant, next to `images ProductImage[]`
  detailBlocks ProductDetailBlock[]
```

- [ ] **Step 2: Write the migration SQL**

Create `prisma/migrations/20261023110000_add_detail_block_scope/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "product_detail_blocks"
ADD COLUMN "option_value_id" UUID,
ADD COLUMN "variant_id" UUID;

-- CreateIndex
CREATE INDEX "product_detail_blocks_option_value_id_product_id_idx" ON "product_detail_blocks"("option_value_id", "product_id");
CREATE INDEX "product_detail_blocks_variant_id_product_id_idx" ON "product_detail_blocks"("variant_id", "product_id");

-- AddCheck
ALTER TABLE "product_detail_blocks"
ADD CONSTRAINT "product_detail_blocks_exclusive_scope_check"
CHECK ("option_value_id" IS NULL OR "variant_id" IS NULL)
NOT VALID;

-- AddForeignKey
ALTER TABLE "product_detail_blocks" ADD CONSTRAINT "product_detail_blocks_option_value_id_product_id_fkey" FOREIGN KEY ("option_value_id", "product_id") REFERENCES "product_option_values"("id", "product_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_detail_blocks" ADD CONSTRAINT "product_detail_blocks_variant_id_product_id_fkey" FOREIGN KEY ("variant_id", "product_id") REFERENCES "product_variants"("id", "product_id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 3: Validate and regenerate the client**

Run from `small-house-commerce/backend`:

```bash
pnpm exec prisma validate
pnpm exec prisma generate
```

Expected: `The schema at prisma/schema/catalog.prisma is valid` and a generated client without errors.

- [ ] **Step 4: Commit**

```bash
git add small-house-commerce/backend/prisma/schema/catalog.prisma \
  small-house-commerce/backend/prisma/migrations/20261023110000_add_detail_block_scope/migration.sql
git commit -m "feat(catalog): scope detail blocks by option value and variant"
```

(`backend/src/generated/prisma` is git-ignored — never stage it.)

---

### Task 2: Backend DTO, storefront select and landing snapshot

**Files:**
- Modify: `small-house-commerce/backend/src/modules/catalog/dto/product.dto.ts:65-70`
- Modify: `small-house-commerce/backend/src/modules/catalog/products.service.ts:264-267`
- Modify: `small-house-commerce/backend/src/modules/catalog/landing/landing-snapshot.service.ts:76`
- Test: `small-house-commerce/backend/src/modules/catalog/dto/product.dto.spec.ts` (create)

**Interfaces:**
- Consumes: Prisma fields from Task 1.
- Produces: `createProductSchema` accepts `detailBlocks[].optionValueId` / `.variantId` (UUID or null); storefront product `detailBlocks[]` entries include `optionValueId` and `variantId`.

- [ ] **Step 1: Write the failing DTO test**

Create `backend/src/modules/catalog/dto/product.dto.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createProductSchema } from "./product.dto";

const base = {
  name: "Chair",
  slug: "chair",
  categoryId: "018f0000-0000-7000-8000-000000000001",
};

describe("detail block scope", () => {
  it("accepts an option-value scope and leaves the variant scope empty", () => {
    const parsed = createProductSchema.parse({
      ...base,
      detailBlocks: [
        {
          type: "IMAGE",
          url: "https://cdn.test/detail.jpg",
          sortOrder: 0,
          optionValueId: "018f0000-0000-7000-8000-000000000002",
        },
      ],
    });
    expect(parsed.detailBlocks[0].optionValueId).toBe(
      "018f0000-0000-7000-8000-000000000002",
    );
    expect(parsed.detailBlocks[0].variantId).toBeUndefined();
  });

  it("rejects a non-uuid scope id", () => {
    expect(() =>
      createProductSchema.parse({
        ...base,
        detailBlocks: [
          { type: "IMAGE", url: "https://cdn.test/detail.jpg", variantId: "abc" },
        ],
      }),
    ).toThrow();
  });

  it("keeps a shared block shared", () => {
    const parsed = createProductSchema.parse({
      ...base,
      detailBlocks: [{ type: "IMAGE", url: "https://cdn.test/detail.jpg" }],
    });
    expect(parsed.detailBlocks[0]).toMatchObject({ type: "IMAGE" });
    expect(parsed.detailBlocks[0].optionValueId ?? null).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd small-house-commerce/backend && pnpm exec vitest run src/modules/catalog/dto/product.dto.spec.ts
```

Expected: FAIL — `optionValueId` is stripped by the zod schema.

- [ ] **Step 3: Extend the zod schema**

In `product.dto.ts`, replace the body of `detailBlockSchema`:

```ts
const detailBlockSchema = z.object({
  type: z.nativeEnum(DetailBlockType),
  url: siteMediaUrl(),
  altText: z.string().max(255).optional(),
  sortOrder: z.number().int().default(0),
  optionValueId: z.string().uuid().nullable().optional(),
  variantId: z.string().uuid().nullable().optional(),
});
```

- [ ] **Step 4: Expose the scope on the storefront select**

In `products.service.ts`, inside `STOREFRONT_SELECT.detailBlocks.select`, add:

```ts
    select: {
      id: true,
      type: true,
      url: true,
      altText: true,
      sortOrder: true,
      optionValueId: true,
      variantId: true,
    },
```

- [ ] **Step 5: Pass the scope through the landing snapshot**

In `landing-snapshot.service.ts` line 76, replace the hard-coded nulls:

```ts
    if (product.detailBlocks.length)
      blocks.push({ id: 'detail', type: 'detail', sourceKey: from('detail'), props: { media: product.detailBlocks.map((item) => ({ url: item.url, type: item.type, altText: item.altText, optionValueId: item.optionValueId, variantId: item.variantId })) } });
```

- [ ] **Step 6: Run the tests and typecheck**

```bash
cd small-house-commerce/backend
pnpm exec vitest run src/modules/catalog/dto/product.dto.spec.ts
pnpm exec tsc --noEmit
```

Expected: 3 passing; tsc clean.

- [ ] **Step 7: Commit**

```bash
git add small-house-commerce/backend/src/modules/catalog
git commit -m "feat(catalog): persist and expose detail block scope"
```

---

### Task 3: Frontend types and form-value mapping

**Files:**
- Modify: `small-house-commerce/frontend/src/lib/api.ts:165-171`
- Modify: `small-house-commerce/frontend/src/lib/admin-api.ts:702-708`, `:1367-1372`
- Modify: `small-house-commerce/frontend/src/lib/admin-product-graph.ts:65-70`
- Modify: `small-house-commerce/frontend/src/components/admin/ProductForm.tsx:109-114`, `:633-660`
- Test: `small-house-commerce/frontend/src/lib/admin-product-graph.spec.ts`

**Interfaces:**
- Consumes: API fields from Task 2.
- Produces:
  - `ProductDetailBlock` and `AdminDetailBlock` gain `optionValueId: string | null; variantId: string | null;`
  - `ProductFormValue["detailBlocks"][number]` gains optional `optionValueId?: string; variantId?: string;`
  - `CreateProductInput["detailBlocks"][number]` gains optional `optionValueId?: string; variantId?: string;`
  - Form mapping turns null into `""`; payload turns `""` into `undefined`.

- [ ] **Step 1: Write the failing mapping test**

In `frontend/src/lib/admin-product-graph.spec.ts`, add:

```ts
it("carries detail block scope into the form value", () => {
  const draft = deserializeProduct({
    ...productFixture,
    detailBlocks: [
      { id: "d1", type: "IMAGE", url: "/a.jpg", altText: null, sortOrder: 0, optionValueId: "018f0000-0000-7000-8000-000000000011", variantId: null },
      { id: "d2", type: "VIDEO", url: "/b.mp4", altText: null, sortOrder: 1, optionValueId: null, variantId: "018f0000-0000-7000-8000-000000000012" },
    ],
  } as never);
  expect(draft.detailBlocks[0]).toMatchObject({ optionValueId: "018f0000-0000-7000-8000-000000000011" });
  expect(draft.detailBlocks[0].variantId).toBeUndefined();
  expect(draft.detailBlocks[1]).toMatchObject({ variantId: "018f0000-0000-7000-8000-000000000012" });
  expect(draft.detailBlocks[1].optionValueId).toBeUndefined();
});
```

`deserializeProduct` is already imported in that spec; reuse the file's existing product fixture (or a local `{} as never`-cast object) for the remaining `AdminProduct` fields.

- [ ] **Step 2: Run it and watch it fail**

```bash
cd small-house-commerce/frontend && pnpm exec vitest run src/lib/admin-product-graph.spec.ts
```

Expected: FAIL — the mapped row has no `optionValueId`.

- [ ] **Step 3: Extend the shared types**

`lib/api.ts`:

```ts
export interface ProductDetailBlock {
  id: string;
  type: "IMAGE" | "VIDEO";
  url: string;
  altText: string | null;
  sortOrder: number;
  optionValueId: string | null;
  variantId: string | null;
}
```

`lib/admin-api.ts` `AdminDetailBlock` gains the same two fields, and the create payload type becomes:

```ts
  detailBlocks: {
    type: "IMAGE" | "VIDEO";
    url: string;
    altText?: string;
    sortOrder?: number;
    optionValueId?: string;
    variantId?: string;
  }[];
```

- [ ] **Step 4: Map the scope into and out of the form value**

`lib/admin-product-graph.ts`:

```ts
    detailBlocks: p.detailBlocks.map((block, index) => ({
      type: block.type,
      url: block.url,
      altText: block.altText ?? "",
      sortOrder: String(index),
      ...(block.optionValueId ? { optionValueId: block.optionValueId } : {}),
      ...(block.variantId ? { variantId: block.variantId } : {}),
    })),
```

`ProductForm.tsx` form value type:

```ts
  detailBlocks: {
    type: "IMAGE" | "VIDEO";
    url: string;
    altText: string;
    sortOrder: string;
    optionValueId?: string;
    variantId?: string;
  }[];
```

`ProductForm.tsx` payload build (inside the existing `detailBlocks.push({...})`):

```ts
    detailBlocks.push({
      type: block.type,
      url,
      ...(altText ? { altText } : {}),
      sortOrder,
      ...(block.optionValueId ? { optionValueId: block.optionValueId } : {}),
      ...(block.variantId ? { variantId: block.variantId } : {}),
    });
```

- [ ] **Step 5: Run the mapping test plus the form payload specs**

```bash
cd small-house-commerce/frontend
pnpm exec vitest run src/lib/admin-product-graph.spec.ts src/components/admin/ProductForm.spec.tsx src/components/admin/ProductForm.media-bulk.spec.tsx
```

Expected: PASS (existing exact-equality assertions still hold because shared rows add no new keys).

- [ ] **Step 6: Commit**

```bash
git add small-house-commerce/frontend/src/lib small-house-commerce/frontend/src/components/admin/ProductForm.tsx
git commit -m "feat(product-form): carry detail block scope through the form value"
```

---

### Task 4: Per-row scope select and duplicate-entry removal in the admin editor

**Files:**
- Modify: `small-house-commerce/frontend/src/components/admin/product-form/MediaGallery.tsx`
- Modify: `small-house-commerce/frontend/src/components/admin/product-form/DetailMediaWorkspace.tsx`
- Modify: `small-house-commerce/frontend/src/components/admin/ProductForm.tsx:1823-1834` (pass scope options)
- Modify: `small-house-commerce/frontend/src/i18n/zh.ts`, `en.ts`
- Test: `small-house-commerce/frontend/src/components/admin/product-form/DetailMediaWorkspace.spec.tsx`

**Interfaces:**
- Consumes: form-value fields from Task 3.
- Produces:
  - `MediaGalleryProps`: `scopeValue?: string`, `scopeOptions?: readonly { value: string; label: string }[]`, `scopeLabel?: string`, `onScopeChange?: (key: string, value: string) => void`.
  - `DetailMediaWorkspaceProps.scopeOptions: readonly { value: string; label: string }[]`.
  - `onAdd` is removed from `DetailMediaWorkspaceProps`.

- [ ] **Step 1: Write the failing workspace tests**

Add to `DetailMediaWorkspace.spec.tsx`:

```tsx
it("sets a scope on a single detail block", async () => {
  const onPatch = vi.fn();
  renderWorkspace({
    onPatch,
    scopeOptions: [
      { value: "", label: "Shared" },
      { value: "option:orange", label: "Orange" },
      { value: "variant:tall", label: "Tall" },
    ],
  });
  await userEvent.click(
    screen.getByRole("button", { name: "Edit Detail content (images / videos) media 1" }),
  );
  fireEvent.change(screen.getByLabelText("Detail block 1 applies to"), {
    target: { value: "option:orange" },
  });
  expect(onPatch).toHaveBeenCalledWith(0, { optionValueId: "orange", variantId: "" });
});

it("no longer offers the duplicate manual add entry", () => {
  renderWorkspace();
  expect(screen.queryByText("Manually add an empty row")).not.toBeInTheDocument();
  expect(screen.queryByText("Add detail image")).not.toBeInTheDocument();
  expect(screen.queryByText("Add detail video")).not.toBeInTheDocument();
});
```

Update the shared `renderWorkspace` props to include `scopeOptions: []` and delete `onAdd: vi.fn()`.

- [ ] **Step 2: Run and watch them fail**

```bash
cd small-house-commerce/frontend && pnpm exec vitest run src/components/admin/product-form/DetailMediaWorkspace.spec.tsx
```

Expected: FAIL — no "applies to" control; the old buttons still render.

- [ ] **Step 3: Add the scope control to `MediaGallery`**

Extend the props interface:

```tsx
  scopeValue?: string;
  scopeOptions?: readonly { value: string; label: string }[];
  scopeLabel?: string;
  onScopeChange?: (key: string, value: string) => void;
```

Render it inside the editor grid, as the first full-width field (before the type field):

```tsx
            {scopeOptions && onScopeChange ? (
              <div className="sm:col-span-2">
                <Field label={scopeLabel ?? t("product_media_scope_label")} htmlFor={`${editorId}-scope`}>
                  <Select id={`${editorId}-scope`} aria-label={labels.scope?.(number) ?? scopeLabel} value={scopeValue ?? ""} disabled={pending} onChange={(event) => onScopeChange(active.key, event.target.value)}>
                    {scopeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </Select>
                </Field>
              </div>
            ) : null}
```

Add `scope?: (number: number) => string;` to `MediaGalleryLabels` (optional).

- [ ] **Step 4: Wire `DetailMediaWorkspace` and delete the duplicate block**

- Replace the `onAdd` prop with:

```tsx
  scopeOptions: readonly { value: string; label: string }[];
```

- Compute the current value per block (shared → `""`):

```tsx
  const scopeValueFor = (block: DetailBlockFormValue): string =>
    block.variantId ? `variant:${block.variantId}` : block.optionValueId ? `option:${block.optionValueId}` : "";
  const setScope = (index: number, value: string): void => {
    if (value.startsWith("variant:")) onPatch(index, { variantId: value.slice(8), optionValueId: "" });
    else if (value.startsWith("option:")) onPatch(index, { optionValueId: value.slice(7), variantId: "" });
    else onPatch(index, { optionValueId: "", variantId: "" });
  };
```

- Add `scope: (number: number) => string;` to `MediaGalleryLabels`, and pass it from `DetailMediaWorkspace` so the test's accessible name resolves:

```tsx
            remove: t("product_detail_remove"),
            scope: (number) => t("product_detail_scope_aria", { number }),
```

- Pass to `MediaGallery` (the per-row value rides on each item, so the editor shows the active row's scope):

```tsx
          items={blocks.map((block, index) => ({
            ...block,
            key: `detailBlocks.${index}`,
            domId: `product-detail-block-${index}`,
            scopeValue: scopeValueFor(block),
          }))}
          scopeOptions={scopeOptions}
          scopeLabel={t("product_detail_scope_label")}
          onScopeChange={(key, value) => setScope(Number(key.split(".")[1]), value)}
```

`MediaGalleryItem` gains `scopeValue?: string`, and inside `MediaGallery` the select uses `active.scopeValue ?? ""` as its value.

- Delete the entire `<details>` block (lines 73-79) that rendered `product_detail_add_image` / `product_detail_add_video`, remove `onAdd` from the destructured props and from the interface, and remove the now-unused `Button` import.

- [ ] **Step 5: Build the scope options in `ProductForm`**

Pass into `detailMedia`:

```tsx
              scopeOptions={detailBlockScopeOptions(value)}
```

Add a helper in `ProductForm.tsx` (module scope). Only persisted variants (with a real `id`) and media-driver option values are offered — an unsaved variant has no id to scope to yet:

```tsx
function detailBlockScopeOptions(value: ProductFormValue): { value: string; label: string }[] {
  const options = [{ value: "", label: "共享" }];
  for (const option of value.graph?.options ?? []) {
    if (!option.isMediaDriver) continue;
    for (const optionValue of option.values) {
      options.push({ value: `option:${optionValue.id}`, label: `${option.name} = ${optionValue.label}` });
    }
  }
  for (const variant of value.graph?.variants ?? []) {
    if (!variant.id) continue;
    options.push({ value: `variant:${variant.id}`, label: variant.name });
  }
  return options;
}
```

Also remove the now-unused `onAdd: addDetailBlock` entry from the `detailMedia` props and delete the `addDetailBlock` function from `ProductForm.tsx` (the scope select replaces manual row creation; `MediaAddRow` still adds rows for uploads and URLs).

- [ ] **Step 6: Update i18n**

Add to both `zh.ts` and `en.ts`:

```ts
  product_detail_scope_label: "适用范围",          // en: "Applies to"
  product_media_scope_label: "适用范围",           // en: "Applies to"
  product_detail_scope_aria: (number: number) => `详情块 ${number} 适用范围`, // en: `Detail block ${number} applies to`
```

Remove `product_media_manual_add`, `product_detail_add_image`, `product_detail_add_video` from both files.

- [ ] **Step 7: Run the workspace tests and typecheck**

```bash
cd small-house-commerce/frontend
pnpm exec vitest run src/components/admin/product-form/DetailMediaWorkspace.spec.tsx src/components/admin/product-form/SharedMediaWorkspace.spec.tsx src/components/admin/ProductForm.spec.tsx
pnpm exec tsc --noEmit
```

Expected: PASS, tsc clean.

- [ ] **Step 8: Commit**

```bash
git add small-house-commerce/frontend/src/components/admin small-house-commerce/frontend/src/i18n
git commit -m "feat(product-form): scope detail blocks per row and drop duplicate adders"
```

---

### Task 5: PDP detail resolution

**Files:**
- Modify: `small-house-commerce/frontend/src/components/product/pdp-detail-blocks.ts`
- Test: `small-house-commerce/frontend/src/components/product/pdp-detail-blocks.spec.ts`

**Interfaces:**
- Consumes: `ProductDetailBlock.optionValueId` / `.variantId` (Task 3).
- Produces: `resolveDetailBlocksForSelection<T extends DetailBlockLike>(blocks, options, selectedValueIds, resolvedVariantId): T[]`.

- [ ] **Step 1: Write the failing resolver tests**

Append to `pdp-detail-blocks.spec.ts`:

```ts
const options = [
  { id: "color", position: 0, isMediaDriver: true },
  { id: "size", position: 1, isMediaDriver: false },
];
const blocks = [
  { type: "IMAGE" as const, url: "/shared.jpg", optionValueId: null, variantId: null },
  { type: "IMAGE" as const, url: "/orange.jpg", optionValueId: "orange", variantId: null },
  { type: "IMAGE" as const, url: "/tall.jpg", optionValueId: null, variantId: "tall" },
];

it("shows shared blocks when nothing scoped matches", () => {
  expect(resolveDetailBlocksForSelection(blocks, options, {}, null).map((b) => b.url)).toEqual(["/shared.jpg"]);
});

it("replaces shared blocks with the selected option value's blocks", () => {
  expect(resolveDetailBlocksForSelection(blocks, options, { color: "orange" }, null).map((b) => b.url)).toEqual(["/orange.jpg"]);
});

it("prefers an exact variant over an option value", () => {
  expect(resolveDetailBlocksForSelection(blocks, options, { color: "orange" }, "tall").map((b) => b.url)).toEqual(["/tall.jpg"]);
});

it("ignores option values of non media-driver options", () => {
  const sized = [{ type: "IMAGE" as const, url: "/queen.jpg", optionValueId: "queen", variantId: null }];
  expect(resolveDetailBlocksForSelection(sized, options, { size: "queen" }, null).map((b) => b.url)).toEqual([]);
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
cd small-house-commerce/frontend && pnpm exec vitest run src/components/product/pdp-detail-blocks.spec.ts
```

Expected: FAIL — `resolveDetailBlocksForSelection is not exported`.

- [ ] **Step 3: Implement the resolver**

In `pdp-detail-blocks.ts`:

```ts
export interface DetailBlockLike {
  type: "IMAGE" | "VIDEO";
  url: string;
  altText?: string | null;
  optionValueId?: string | null;
  variantId?: string | null;
}

export interface DetailScopeOption {
  id: string;
  position: number;
  isMediaDriver: boolean;
}

export function resolveDetailBlocksForSelection<T extends DetailBlockLike>(
  blocks: readonly T[],
  options: readonly DetailScopeOption[],
  selectedValueIds: Readonly<Record<string, string>>,
  resolvedVariantId: string | null,
): T[] {
  const variantScopes = new Set(blocks.map((block) => block.variantId).filter(Boolean));
  const valueScopes = new Set(blocks.map((block) => block.optionValueId).filter(Boolean));

  if (resolvedVariantId && variantScopes.has(resolvedVariantId)) {
    return blocks.filter((block) => block.variantId === resolvedVariantId);
  }
  for (const option of [...options].sort((left, right) => left.position - right.position)) {
    if (!option.isMediaDriver) continue;
    const valueId = selectedValueIds[option.id];
    if (valueId && valueScopes.has(valueId)) {
      return blocks.filter((block) => block.optionValueId === valueId);
    }
  }
  return blocks.filter((block) => !block.optionValueId && !block.variantId);
}
```

- [ ] **Step 4: Run the tests**

```bash
cd small-house-commerce/frontend && pnpm exec vitest run src/components/product/pdp-detail-blocks.spec.ts
```

Expected: 4 new tests plus the existing ones pass.

- [ ] **Step 5: Commit**

```bash
git add small-house-commerce/frontend/src/components/product/pdp-detail-blocks.ts small-house-commerce/frontend/src/components/product/pdp-detail-blocks.spec.ts
git commit -m "feat(pdp): resolve detail blocks against the selected scope"
```

---

### Task 6: Wire the resolver into PdpDetails

**Files:**
- Modify: `small-house-commerce/frontend/src/components/product/PdpDetails.tsx:56-75`
- Test: `small-house-commerce/frontend/src/components/product/PdpDetails.spec.tsx`

**Interfaces:**
- Consumes: `resolveDetailBlocksForSelection` (Task 5), `usePdpPurchase()` (`product.options`, `primaryLine.selectedValueIds`, `primaryDerived.resolvedVariant`).
- Produces: nothing new for later tasks.

- [ ] **Step 1: Write the failing component test**

Append to `PdpDetails.spec.tsx` (the file already imports `PdpPurchaseProvider`; extend that import to also bring in `usePdpPurchase`):

```tsx
function ScopeHarness(): React.ReactNode {
  const { selectOption } = usePdpPurchase();
  return (
    <button type="button" onClick={() => selectOption("primary", "finish", "white")}>
      pick white
    </button>
  );
}

it("swaps detail media when the selected option value changes", async () => {
  const scoped: Product = {
    ...product,
    options: product.options.map((option) => ({ ...option, isMediaDriver: true })),
    detailBlocks: [
      { id: "d-shared", type: "IMAGE", url: "/shared.jpg", altText: null, sortOrder: 0, optionValueId: null, variantId: null },
      { id: "d-black", type: "IMAGE", url: "/black.jpg", altText: null, sortOrder: 1, optionValueId: "black", variantId: null },
      { id: "d-white", type: "IMAGE", url: "/white.jpg", altText: null, sortOrder: 2, optionValueId: "white", variantId: null },
    ],
  };
  render(
    <PdpPurchaseProvider product={scoped}>
      <ScopeHarness />
      <PdpDetails product={scoped} />
    </PdpPurchaseProvider>,
  );
  expect(document.querySelector('img[src="/black.jpg"]')).not.toBeNull();
  expect(document.querySelector('img[src="/shared.jpg"]')).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "pick white" }));
  expect(document.querySelector('img[src="/white.jpg"]')).not.toBeNull();
  expect(document.querySelector('img[src="/black.jpg"]')).toBeNull();
});
```

The fixture's default display variant is black, so the first render already resolves the black option value.

- [ ] **Step 2: Run and watch it fail**

```bash
cd small-house-commerce/frontend && pnpm exec vitest run src/components/product/PdpDetails.spec.tsx
```

Expected: FAIL — both scoped images render.

- [ ] **Step 3: Filter the blocks in `PdpDetails`**

```tsx
import { usePdpPurchase } from "./PdpPurchaseProvider";
import { partitionDetailBlocks, resolveDetailBlocksForSelection, type DetailBlockLike } from "./pdp-detail-blocks";

export function PdpDetails({ product }: { product: Product }): ReactNode {
  const { product: purchaseProduct, primaryLine, primaryDerived } = usePdpPurchase();
  const scopedBlocks = resolveDetailBlocksForSelection(
    product.detailBlocks ?? [],
    purchaseProduct.options,
    primaryLine.selectedValueIds,
    primaryDerived.resolvedVariant?.id ?? null,
  );
  const { featured, remaining } = partitionDetailBlocks(scopedBlocks);
  return (
    <div className="flex flex-col gap-8">
      <ProductDetailBody description={product.description} features={product.features} />
      <FoldableDetailMedia featured={featured} blocks={remaining} />
      <ProductInformation product={product} />
    </div>
  );
}
```

- [ ] **Step 4: Run the component tests**

```bash
cd small-house-commerce/frontend
pnpm exec vitest run src/components/product/PdpDetails.spec.tsx src/components/product/pdp-detail-blocks.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add small-house-commerce/frontend/src/components/product/PdpDetails.tsx small-house-commerce/frontend/src/components/product/PdpDetails.spec.tsx
git commit -m "feat(pdp): render variant-scoped detail media"
```

---

### Task 7: Full verification and release preparation

**Files:** none (verification only).

- [ ] **Step 1: Backend suite and build**

```bash
cd small-house-commerce/backend
pnpm exec vitest run
pnpm exec tsc --noEmit
pnpm exec prisma generate
pnpm build
```

Expected: all green.

- [ ] **Step 2: Frontend suite and build**

```bash
cd small-house-commerce/frontend
pnpm exec tsc --noEmit
pnpm exec vitest run --maxWorkers=2
pnpm build
```

Expected: all green (a local `TypeError: fetch failed` during static generation is expected when no backend is running; the build must still exit 0).

- [ ] **Step 3: Manual check on a local/staging stack**

1. Admin → product → media tab: add two detail images, set one to `Color = X`, leave one shared.
2. Save, reopen, confirm the select shows the saved scope.
3. PDP: select another color, confirm the detail section falls back to the shared block; select the scoped color, confirm the scoped block replaces it.
4. Confirm the detail section no longer shows the "add detail image/video" buttons.

- [ ] **Step 4: Commit any verification fixes**

```bash
git status --porcelain
# commit only files touched by this feature
```
