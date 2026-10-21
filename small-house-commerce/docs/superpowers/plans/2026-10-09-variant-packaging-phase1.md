# Variant Dimensions and Packaging Assist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist SKU-level physical-dimension overrides, expose Product-level fallback dimensions, and add a deterministic packaging paste assistant without changing ordinary SKU stock or media behavior.

**Architecture:** Product dimensions remain the shared default. Nullable `Sku.productWidth/productHeight/productDepth` overrides travel through the existing typed catalog graph and storefront response, and the PDP resolves override-then-default once. A pure parser returns normalized packaging candidates; a confirmation UI writes only the existing package fields and never derives volumetric weight.

**Tech Stack:** NestJS, Prisma 7, PostgreSQL, Zod, Next.js App Router, React 19, TypeScript, Vitest, React Testing Library, Playwright.

**Spec:** [2026-10-09-variant-packaging-bundle-design.md](../specs/2026-10-09-variant-packaging-bundle-design.md)

## Global Constraints

- Product dimensions use the existing `cm` convention; package weight uses the existing `kg` convention.
- `Product.width/height/depth` are defaults; SKU overrides are nullable and independently clearable.
- Existing graph identity, lazy variant materialization, client-key mapping, graph PATCH → stock batch order, and ordinary SKU save behavior must remain unchanged.
- Packaging parsing is deterministic and local; paste never writes without explicit confirmation.
- Parsing never computes or overwrites `volumetricWeight`.
- Do not alter `backend/uploads/`, FAQ/PDP/media/homepage work, or unrelated uncommitted files.
- Do not change ports 3000/3001, production data, or deployment configuration.
- Do not push, merge, create a PR, or deploy; implementation stops at the local review gate.

## Review Focus

1. **Inherited versus overridden dimensions:** clearing an override must restore the Product fallback in admin, API, and PDP output — test in Task 1 and Task 4.
2. **Lazy graph rows and client-key stock mapping:** bulk actions must not materialize candidates unexpectedly or break Phase B stock mapping — test in Task 2.
3. **Packaging ambiguity:** repeated labels, missing values, contradictory units, and non-positive numbers must produce warnings/rejection rather than guessed fields — test in Task 3.
4. **Package/product separation:** applying product dimensions must never mutate package dimensions, prices, stock, or option assignments — test in Task 2 and Task 3.
5. **Existing readiness contract:** parser apply must not fill or calculate volumetric weight and ordinary shipping-complete checks must remain unchanged — test in Task 4.

## File Map

**Backend contract and persistence**

- Create: `small-house-commerce/backend/prisma/migrations/20261013090000_add_sku_product_dimensions/migration.sql` — nullable SKU product-dimension columns.
- Modify: `small-house-commerce/backend/prisma/schema/catalog.prisma` — Prisma fields and indexes only if required by the final query shape.
- Modify: `small-house-commerce/backend/src/modules/catalog/dto/product.dto.ts` — legacy product/SKU DTO fields.
- Modify: `small-house-commerce/backend/src/modules/catalog/dto/catalog-graph.dto.ts` — typed graph SKU fields.
- Modify: `small-house-commerce/backend/src/modules/catalog/catalog-graph.ts` — graph wire/domain types and validation plumbing.
- Modify: `small-house-commerce/backend/src/modules/catalog/catalog-graph.service.ts` — hydrate/write SKU dimensions and preserve reference behavior.
- Modify: `small-house-commerce/backend/src/modules/catalog/products.service.ts` — product read/write and storefront effective-dimension response.
- Test: `small-house-commerce/backend/src/modules/catalog/catalog-graph.service.spec.ts`.
- Test: `small-house-commerce/backend/src/modules/catalog/products.service.spec.ts`.
- Create or modify: `small-house-commerce/backend/src/modules/catalog/dto/catalog-graph.dto.spec.ts`.

**Frontend graph and admin UI**

- Modify: `small-house-commerce/frontend/src/lib/admin-api.ts` — Admin SKU and graph wire types.
- Modify: `small-house-commerce/frontend/src/lib/admin-product-graph.ts` — draft fields, hydration, diff, and write payload.
- Modify: `small-house-commerce/frontend/src/components/admin/ProductForm.tsx` — product/SKU dimension controls and bulk actions.
- Modify: `small-house-commerce/frontend/src/components/admin/VariantMatrix.tsx` — row-level override state and bulk operations.
- Create: `small-house-commerce/frontend/src/components/admin/SkuPackagingAssist.tsx` — paste, preview, confirmation, and field application.
- Create: `small-house-commerce/frontend/src/lib/parse-packaging-input.ts` — pure parser and normalized result types.
- Modify: `small-house-commerce/frontend/src/i18n/en.ts` and `zh.ts` — concise field, warning, and confirmation copy.
- Test: `small-house-commerce/frontend/src/lib/admin-product-graph.spec.ts`.
- Test: `small-house-commerce/frontend/src/components/admin/VariantMatrix.spec.tsx`.
- Test: `small-house-commerce/frontend/src/components/admin/ProductForm.spec.tsx`.
- Create: `small-house-commerce/frontend/src/lib/parse-packaging-input.spec.ts`.
- Create: `small-house-commerce/frontend/src/components/admin/SkuPackagingAssist.spec.tsx`.

**Storefront resolution**

- Modify: `small-house-commerce/frontend/src/lib/api.ts` — storefront SKU/product dimension types.
- Modify: `small-house-commerce/frontend/src/components/product/ProductSpecs.tsx` or the current selected-variant specification presenter — one fallback resolver and rendering.
- Test: the existing ProductSpecs/PDP specification test file, or create `small-house-commerce/frontend/src/components/product/ProductSpecs.spec.tsx` if no colocated test exists.

## Interfaces

Phase 1 produces these stable interfaces for Phase 2 and later storefront work:

```ts
export interface AdminSkuDraft {
  // existing fields...
  productWidth: number | null;
  productHeight: number | null;
  productDepth: number | null;
}

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

export function parsePackagingText(
  input: string,
  mode: "dimensions" | "weight" | "combined",
): PackagingParseResult;
```

The storefront resolver must have one named implementation and one testable contract:

```ts
export function resolveProductDimensions(
  product: { width: number | null; height: number | null; depth: number | null },
  sku: {
    productWidth?: number | null;
    productHeight?: number | null;
    productDepth?: number | null;
  } | null,
): { width: number | null; height: number | null; depth: number | null };
```

### Task 1: Add the SKU dimension contract

**Files:**
- Create: `backend/prisma/migrations/20261013090000_add_sku_product_dimensions/migration.sql`
- Modify: `backend/prisma/schema/catalog.prisma`
- Modify: `backend/src/modules/catalog/dto/product.dto.ts`
- Modify: `backend/src/modules/catalog/dto/catalog-graph.dto.ts`
- Modify: `backend/src/modules/catalog/catalog-graph.ts`
- Modify: `backend/src/modules/catalog/catalog-graph.service.ts`
- Modify: `backend/src/modules/catalog/products.service.ts`
- Test: `backend/src/modules/catalog/dto/catalog-graph.dto.spec.ts`
- Test: `backend/src/modules/catalog/catalog-graph.service.spec.ts`
- Test: `backend/src/modules/catalog/products.service.spec.ts`

**Interfaces:**
- Consumes: existing `Sku` package fields, `Product.width/height/depth`, typed graph SKU payload, and the existing product/graph save path.
- Produces: nullable `productWidth/productHeight/productDepth` fields in admin and storefront SKU contracts; persistence and fallback behavior used by Tasks 2–4.

- [ ] **Step 1: Write failing DTO and service tests.** Add cases that parse a graph SKU with all three nullable product-dimension fields, reject negative values, preserve `null` as an explicit clear, and return a storefront SKU override separately from the Product default. Add a service test proving `override ?? productDefault` resolution for each axis.

```ts
expect(
  skuWriteSchema.parse({
    skuCode: "CHAIR-BLACK",
    productWidth: 48,
    productHeight: null,
    productDepth: 52,
  }).productWidth,
).toBe(48);
expect(() => skuWriteSchema.parse({ skuCode: "X", productWidth: -1 })).toThrow();
```

- [ ] **Step 2: Run the focused tests to verify RED.**

Run:

```bash
pnpm --dir small-house-commerce/backend test -- catalog-graph.dto.spec.ts catalog-graph.service.spec.ts products.service.spec.ts
```

Expected: failures show the missing SKU fields and missing fallback response, not setup or database import errors.

- [ ] **Step 3: Add the migration and Prisma fields.** Add nullable `Float` columns mapped to `product_width`, `product_height`, and `product_depth`; do not add a unit column. Write the migration with nullable columns and no destructive backfill because existing Product dimensions remain the fallback.

- [ ] **Step 4: Extend all backend schemas and graph mapping.** Add the fields to both legacy `skuSchema` and typed `skuWriteSchema`, graph read/write types, service hydration, changed-row detection, and SKU upsert payload. Keep package fields and `volumetricWeight` independent. Keep explicit `null` distinguishable from omitted fields so clearing an override is persisted.

- [ ] **Step 5: Add storefront fallback resolution.** Return raw SKU overrides and Product defaults through the existing product response, then apply the fallback in one named resolver used by the selected-variant ProductSpecs path. A missing SKU or null override must not hide a non-null Product default.

- [ ] **Step 6: Run the focused tests to verify GREEN.**

Run the command from Step 2. Expected: all new and existing tests in those files pass.

- [ ] **Step 7: Run Prisma/type checks for the contract.**

Run:

```bash
pnpm --dir small-house-commerce/backend exec prisma generate
pnpm --dir small-house-commerce/backend exec tsc --noEmit
```

Expected: generated client and backend typecheck pass without modifying unrelated schema or migration files.

### Task 2: Add variant matrix and ProductForm dimension editing

**Files:**
- Modify: `frontend/src/lib/admin-api.ts`
- Modify: `frontend/src/lib/admin-product-graph.ts`
- Modify: `frontend/src/components/admin/ProductForm.tsx`
- Modify: `frontend/src/components/admin/VariantMatrix.tsx`
- Modify: `frontend/src/i18n/en.ts` and `frontend/src/i18n/zh.ts`
- Test: `frontend/src/lib/admin-product-graph.spec.ts`
- Test: `frontend/src/components/admin/VariantMatrix.spec.tsx`
- Test: `frontend/src/components/admin/ProductForm.spec.tsx`

**Interfaces:**
- Consumes: Task 1 `AdminSkuDraft` fields and existing lazy candidate materialization/client-key mapping.
- Produces: tested `applyProductDimensionsToVariants(mode)` behavior that mutates only materialized sellable SKU rows and leaves all other graph fields unchanged.

- [ ] **Step 1: Write failing graph and UI tests.** Add tests for inheritance, per-SKU override, clear-to-inherit, apply-all, fill-empty, count messaging, and package/stock isolation. Include a lazy candidate that must remain unmaterialized.

```ts
const before = structuredClone(draft);
applyProductDimensionsToVariants(draft, { width: 48, height: 72, depth: 50 }, "empty-only");
expect(draft.variants.find((row) => row.sku?.skuCode === "BLACK")?.sku).toMatchObject({
  productWidth: 48,
});
expect(draft.variants).toHaveLength(before.variants.length);
expect(draft.variants[0]?.sku?.packageWidth).toBe(before.variants[0]?.sku?.packageWidth);
```

- [ ] **Step 2: Run the focused frontend tests to verify RED.**

Run:

```bash
pnpm --dir small-house-commerce/frontend test -- admin-product-graph.spec.ts VariantMatrix.spec.tsx ProductForm.spec.tsx
```

Expected: failures identify missing draft fields/actions or missing controls.

- [ ] **Step 3: Extend frontend types and hydration.** Add nullable product-dimension fields to Admin API wire types, `AdminSkuDraft`, empty SKU defaults, server-to-draft hydration, `numberEquals`, `skuChanged`, and `skuWritePayload`. Preserve `undefined` as omitted and `null` as clear according to existing PATCH semantics.

- [ ] **Step 4: Implement the bulk dimension operations.** Add a pure helper used by ProductForm/VariantMatrix with two modes: `all-materialized` and `empty-only`. It must iterate only rows with a non-null SKU, never create candidates, never touch stock/package/pricing/options, and return `{ changedCount, skippedCount }` for copy.

- [ ] **Step 5: Add compact editor controls.** Show Product dimensions as the common source, show each materialized SKU's inherited/overridden state, provide `Apply to all variants`, `Fill empty variant dimensions`, and clear override. Keep existing matrix pagination and pending/save locks. Use current English/Chinese admin i18n conventions; do not introduce Chinese into storefront copy.

- [ ] **Step 6: Run focused tests to verify GREEN.** Run the command from Step 2. Expected: new bulk-action and isolation tests pass, and all existing matrix/ProductForm tests remain green.

- [ ] **Step 7: Verify the actual graph save payload.** Add an assertion through the existing ProductForm save test that changed SKU product dimensions appear in `catalogGraph.variants[].sku`, while Phase B stock payload is unchanged. Run the same focused suite and inspect the serialized request body.

### Task 3: Implement the deterministic packaging parser

**Files:**
- Create: `frontend/src/lib/parse-packaging-input.ts`
- Create: `frontend/src/lib/parse-packaging-input.spec.ts`
- Modify: `frontend/src/i18n/en.ts` and `frontend/src/i18n/zh.ts`

**Interfaces:**
- Consumes: raw paste text and an explicit parse mode.
- Produces: `PackagingParseResult` from the Interfaces block; no network calls, no React state, and no writes.

- [ ] **Step 1: Write parser tests first.** Cover triplets with `x`, `×`, `*`, labelled W/H/L and width/height/depth, weight labels, supported units, omitted-unit assumptions, duplicate labels, missing values, contradictory units, non-positive values, and unrelated text.

```ts
expect(parsePackagingText("30 x 20 x 10 cm; 2 kg", "combined")).toMatchObject({
  fields: {
    packageWidth: 30,
    packageHeight: 20,
    packageDepth: 10,
    packageWeight: 2,
  },
  warnings: [],
});
expect(parsePackagingText("width: 0 cm", "dimensions").fields).toEqual({});
```

- [ ] **Step 2: Run parser tests to verify RED.**

Run:

```bash
pnpm --dir small-house-commerce/frontend test -- parse-packaging-input.spec.ts
```

Expected: import/function failures or unmet expectations because the parser does not exist.

- [ ] **Step 3: Implement unit normalization and labelled/triplet parsing.** Keep regex/token handling local and bounded. Convert mm/m/in/ft to centimeters and g/kg/lb/oz to kilograms. Use width × height × depth order for triplets, map `length` to depth, and return warnings for assumptions. Reject duplicate labels, contradictory values, non-positive numbers, NaN, and Infinity.

- [ ] **Step 4: Run parser tests to verify GREEN.** Run the command from Step 2. Expected: all parser cases pass without console output or external requests.

- [ ] **Step 5: Add parser regression tests for overwrite safety.** Assert that parser output contains only package fields and has no `volumetricWeight` key. Run the parser suite again.

### Task 4: Integrate packaging assist and storefront specifications

**Files:**
- Create: `frontend/src/components/admin/SkuPackagingAssist.tsx`
- Create: `frontend/src/components/admin/SkuPackagingAssist.spec.tsx`
- Modify: `frontend/src/components/admin/VariantMatrix.tsx`
- Modify: `frontend/src/components/admin/ProductForm.tsx`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/components/product/ProductSpecs.tsx` or the current selected-variant presenter
- Modify: existing ProductSpecs/PDP tests
- Modify: `frontend/src/i18n/en.ts` and `frontend/src/i18n/zh.ts`

**Interfaces:**
- Consumes: `parsePackagingText`, `AdminSkuDraft`, existing ProductForm draft mutation callback, and `resolveProductDimensions`.
- Produces: confirmation-only packaging edits and selected-variant dimension display.

- [ ] **Step 1: Write failing component and storefront tests.** Cover paste → preview, warning display, default fill-empty mode, explicit replace mode, cancel leaving the draft untouched, and a selected SKU rendering override/fallback. Assert no `volumetricWeight` mutation.

```ts
await user.paste(input, "30 x 20 x 10 cm; 2 kg");
expect(screen.getByText("Review parsed values")).toBeVisible();
expect(onChange).not.toHaveBeenCalled();
await user.click(screen.getByRole("button", { name: "Apply parsed values" }));
expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ packageWidth: 30 }));
```

- [ ] **Step 2: Run component/PDP tests to verify RED.**

Run:

```bash
pnpm --dir small-house-commerce/frontend test -- SkuPackagingAssist.spec.tsx ProductSpecs.spec.tsx ProductForm.spec.tsx
```

Expected: failures identify the missing assistant, controls, or fallback rendering.

- [ ] **Step 3: Implement the confirmation UI.** Build a controlled component that accepts the selected SKU draft, `onApply(patch, mode)`, and `onCancel`. Render normalized values, assumptions, and warnings. Default to filling empty fields; require an explicit selection to replace parsed fields. Disable apply when no valid fields exist. The component must not call an API.

- [ ] **Step 4: Mount the assistant in the SKU editor.** Wire `onApply` through the existing draft mutation path, preserving pending/save locks and client keys. Keep the package fields and product dimension fields visually separate. Ensure switching matrix pages or variants cannot apply a parse result to a different SKU.

- [ ] **Step 5: Implement one storefront dimension resolver.** Add `resolveProductDimensions` and use it in ProductSpecs for the selected variant. Omit empty axes rather than rendering zeros or placeholder units. Keep package dimensions in the existing shipping/packaging context, not the customer-facing product specification.

- [ ] **Step 6: Run focused tests to verify GREEN.** Run the command from Step 2. Expected: assistant, fallback, ProductForm, and existing PDP tests pass.

- [ ] **Step 7: Run Phase 1 verification.** Execute all of the following from the worktree:

```bash
pnpm --dir small-house-commerce/backend test
pnpm --dir small-house-commerce/backend lint
pnpm --dir small-house-commerce/backend build
pnpm --dir small-house-commerce/frontend test
pnpm --dir small-house-commerce/frontend exec tsc --noEmit
pnpm --dir small-house-commerce/frontend lint
pnpm --dir small-house-commerce/frontend build
pnpm --dir small-house-commerce/frontend exec playwright test e2e/admin-product-editor.spec.ts --project=chromium

git diff --check
```

Expected: all commands exit 0; any existing warning is reported separately from errors. Do not start or restart ports 3000/3001. If browser verification uses the existing rehearsal services, use backend `127.0.0.1:3002` and frontend `localhost:3005` only.

- [ ] **Step 8: Perform browser acceptance.** In the isolated rehearsal app, verify: inherited dimensions, per-SKU override, clear-to-inherit, apply-all, fill-empty, packaging paste preview, warning/cancel path, confirmed apply, save/reload, and no console errors or unexpected upload requests.

- [ ] **Step 9: Stop at the Phase 1 local review gate.** Record the exact verification outputs and changed-file list. Do not start Phase 2, commit, push, merge, create a PR, or deploy until the Phase 1 diff is reviewed and separately authorized.

## Phase 1 completion contract

Phase 1 is complete only when the migration, backend contract, graph editor, parser, confirmation UI, storefront fallback, full suites, type checks, build, and browser acceptance all pass. A parser unit test alone is insufficient because the graph save path and SKU client-key mapping are part of the feature.
