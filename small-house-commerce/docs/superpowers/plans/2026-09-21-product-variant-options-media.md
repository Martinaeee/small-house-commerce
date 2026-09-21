# Product Variant Options and Scoped Media Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace free-form product variants with zero-to-two typed option groups, stable SKU combinations, scoped media, explicit purchase confirmation, and structured option snapshots without breaking existing products, inventory, carts, or orders.

**Architecture:** Add a normalized catalog graph around the existing `ProductVariant` and `Sku` identities. A compatibility bridge projects legacy products into one `Style` option until a set-based backfill persists the graph; Storefront then consumes one pure selection reducer, one media resolver, and one `PdpPurchaseProvider`. Catalog graph writes are transactional and revisioned, while inventory remains a separate ledger-preserving phase.

**Tech Stack:** PostgreSQL 18, Prisma 7.10, NestJS 12, Zod, Next.js 16.3.4, React 19, TypeScript, Vitest, Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-20-variant-options-media-design.md`

## Global Constraints

- This is implementation phase 1 of 3; it must finish before `2026-09-21-pdp-inline-cod-order.md` and `2026-09-21-viewport-autoplay-media.md` execute.
- Preserve every existing `ProductVariant.id`, `Sku.id`, inventory row, reservation, movement, cart reference, and order reference.
- A product has at most two active option groups and at most 100 Cartesian candidate combinations.
- `combinationKey` is the canonical lexicographically sorted set of stable `optionId:valueId` pairs; display position must not change identity.
- Media resolution is exact variant → active media-driver option value → shared product media; scope sets replace rather than merge.
- Legacy `images` responses contain shared media only. List/Home/Search/Related responses expose `effectiveCoverMedia`, not full scoped galleries.
- New multi-SKU purchases require explicit confirmation. A valid deep link may display a combination but is not purchase confirmation.
- Add to Cart may preserve the existing out-of-stock save behavior; Order Now requires a purchasable SKU.
- `orderLines[0]` in `PdpPurchaseProvider` is the only writable top-PDP selection and quantity source.
- Catalog graph save is Phase A; inventory ledger reconciliation is Phase B. A stock failure must not replay or roll back a committed graph.
- Write a failing test and observe the expected failure before each production change.
- Before changing any Next.js route/layout/server-client boundary, read the relevant local guide under `frontend/node_modules/next/dist/docs/`; this repository uses Next.js 16 breaking APIs.
- Run `pnpm --dir backend exec prisma generate` before backend typecheck/build after schema changes.
- Expand, compatibility bridge, backfill, and constraint tightening are distinct production release gates. Do not place all pending migrations into one production deploy.
- The compatibility bridge becomes the backend rollback floor after the first scoped-media write.
- Production database migration/backfill requires a fresh `pg_dump` and explicit risk-gate confirmation before deployment.
- Storefront copy remains English; Admin operational copy may remain bilingual where the existing UI is bilingual.

## Delivered Interfaces

```ts
export type ProductOptionKind = "COLOR" | "SIZE" | "MATERIAL" | "STYLE";
export type ProductOptionPresentation = "IMAGE" | "SWATCH" | "TEXT";
export type SelectionSource = "DEFAULT" | "DEEP_LINK" | "USER" | "CONFIRM_DIALOG";
export type SelectedValueIds = Readonly<Record<string, string>>;

export interface ProductMedia {
  id: string;
  url: string;
  type: "IMAGE" | "VIDEO";
  posterUrl?: string | null;
  altText: string | null;
  sortOrder: number;
}

export interface StorefrontSku {
  id: string;
  skuCode: string;
  status: "ACTIVE" | "DISABLED";
  price: number | null;
  compareAtPrice: number | null;
  availableInventory: number;
}

export interface StorefrontOptionValue {
  id: string;
  label: string;
  position: number;
  swatchHex: string | null;
  thumbnailUrl: string | null;
  thumbnailAlt: string;
}

export interface StorefrontProductOption {
  id: string;
  kind: ProductOptionKind;
  name: string;
  position: number;
  presentation: ProductOptionPresentation;
  isMediaDriver: boolean;
  values: StorefrontOptionValue[];
}

export interface StorefrontProductVariant {
  id: string;
  name: string;
  position: number;
  combinationKey: string;
  optionValueIds: string[];
  sku: StorefrontSku | null;
}

export interface ProductSelectionState {
  selectedValueIds: SelectedValueIds;
  explicitlyTouchedOptionIds: readonly string[];
  selectionSource: SelectionSource;
  quantity: number;
  selectionRevision: number;
  confirmedCombinationKey: string | null;
  confirmedRevision: number | null;
}

export interface ProductSelectionDerived {
  resolvedVariant: StorefrontProductVariant | null;
  resolvedCombinationKey: string | null;
  displayVariant: StorefrontProductVariant | null;
  selectableVariants: StorefrontProductVariant[];
  purchasableVariant: StorefrontProductVariant | null;
  purchaseConfirmed: boolean;
  missingOptionIds: string[];
  price: number | null;
  compareAtPrice: number | null;
  availableInventory: number;
}
```

```ts
export interface PurchaseLineState extends ProductSelectionState {
  clientLineId: string;
}

export interface PdpPurchaseContextValue {
  product: Product;
  orderLines: readonly PurchaseLineState[];
  primaryLine: PurchaseLineState;
  primaryDerived: ProductSelectionDerived;
  selectOption(lineId: string, optionId: string, valueId: string): void;
  confirmLine(lineId: string): void;
  setQuantity(lineId: string, quantity: number): void;
  addLine(): string;
  removeLine(lineId: string): void;
  changeLineVariant(lineId: string): void;
}
```

```ts
export interface ProductMediaSet {
  resolvedScope: "SHARED" | "OPTION_VALUE" | "VARIANT";
  scopeId: string | null;
  media: ProductMedia[];
  catalogGraphVersion: number;
}
```

---

### Task 1: Pure Catalog Graph Identity and Validation

**Files:**
- Create: `backend/src/modules/catalog/catalog-graph.ts`
- Create: `backend/src/modules/catalog/catalog-graph.spec.ts`

**Interfaces:**
- Consumes: typed option/value drafts with stable IDs.
- Produces: `canonicalCombinationKey`, `deriveVariantName`, `countCandidateCombinations`, `validateCatalogGraph`, `planVariantReconciliation`.

- [ ] **Step 1: Write the failing graph identity tests**

```ts
import { describe, expect, it } from "vitest";
import {
  canonicalCombinationKey,
  countCandidateCombinations,
  deriveVariantName,
} from "./catalog-graph";

describe("catalog graph identity", () => {
  it("keeps identity when option display order changes", () => {
    const pairs = [
      { optionId: "size", valueId: "large" },
      { optionId: "color", valueId: "red" },
    ];
    expect(canonicalCombinationKey(pairs)).toBe("color:red|size:large");
    expect(canonicalCombinationKey([...pairs].reverse())).toBe(
      "color:red|size:large",
    );
  });

  it("uses display position only for the generated name", () => {
    expect(
      deriveVariantName([
        { optionPosition: 1, valueLabel: "Large" },
        { optionPosition: 0, valueLabel: "Red" },
      ]),
    ).toBe("Red / Large");
  });

  it("rejects a graph above one hundred candidates", () => {
    expect(() => countCandidateCombinations([
      { name: "Color", activeValueCount: 11 },
      { name: "Size", activeValueCount: 10 },
    ])).toThrow(/Color|Size/);
  });
});
```

Also cover zero/one/two active groups, a third group, case-insensitive duplicate labels, one value per option, retain/create/disable/delete reconciliation, and the one empty-key variant allowed for zero groups.

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm --dir backend exec vitest run src/modules/catalog/catalog-graph.spec.ts`

Expected: FAIL because `./catalog-graph` and its exports do not exist.

- [ ] **Step 3: Implement the pure graph functions**

```ts
export function canonicalCombinationKey(
  pairs: readonly { optionId: string; valueId: string }[],
): string {
  return pairs
    .map(({ optionId, valueId }) => `${optionId}:${valueId}`)
    .sort((left, right) => left.localeCompare(right))
    .join("|");
}

export function deriveVariantName(
  values: readonly { optionPosition: number; valueLabel: string }[],
): string {
  return [...values]
    .sort((left, right) => left.optionPosition - right.optionPosition)
    .map(({ valueLabel }) => valueLabel)
    .join(" / ");
}
```

Keep this module free of Prisma and Nest dependencies. Add the candidate-count, graph-validation, and reconciliation functions required by the tests.

- [ ] **Step 4: Run focused tests and typecheck**

Run:

```bash
pnpm --dir backend exec vitest run src/modules/catalog/catalog-graph.spec.ts
pnpm --dir backend exec tsc --noEmit
```

Expected: PASS with zero failures.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/catalog/catalog-graph.ts backend/src/modules/catalog/catalog-graph.spec.ts
git commit -m "feat(catalog): define stable product option graph"
```

---

### Task 2: Additive Catalog Graph Expand Migration

**Files:**
- Modify: `backend/prisma/schema/catalog.prisma`
- Modify: `backend/prisma/schema/order.prisma`
- Create: `backend/prisma/migrations/20260921090000_expand_variant_options_media/migration.sql`
- Create: `backend/test/sql/catalog-graph-constraints.sql`

**Interfaces:**
- Consumes: Task 1 identity rules.
- Produces: nullable expand schema for compatibility reads and later backfill.

- [ ] **Step 1: Write the failing SQL contract**

```sql
\set ON_ERROR_STOP on
SELECT to_regclass('public.product_options') IS NOT NULL AS options_exist;
SELECT to_regclass('public.product_option_values') IS NOT NULL AS values_exist;
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'product_variants'
  AND column_name = 'combination_key';
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'order_items'
  AND column_name = 'option_snapshot';
```

Extend the script with savepoint-based negative cases for two active case-insensitive option names, two active media drivers, dual media scope, cross-product media scope, and a cross-product default variant.

- [ ] **Step 2: Run the SQL contract and verify RED**

Run against a disposable database:

```bash
docker compose up -d postgres
docker compose exec -T postgres createdb -U smallhouse small_house_variant_test
DATABASE_URL="postgresql://smallhouse:smallhouse@localhost:5432/small_house_variant_test?schema=public" pnpm --dir backend exec prisma migrate deploy
docker compose exec -T postgres psql -U smallhouse -d small_house_variant_test -v ON_ERROR_STOP=1 -f /workspace/backend/test/sql/catalog-graph-constraints.sql
```

Expected: FAIL because `product_options` does not exist.

- [ ] **Step 3: Add the expand schema and migration**

Add `ProductOption`, `ProductOptionValue`, and `ProductVariantOptionValue`; add `Product.catalogGraphVersion`, `Product.defaultDisplayVariantId`, nullable `ProductVariant.combinationKey`, nullable `ProductImage.optionValueId/variantId`, and nullable `OrderItem.optionSnapshot`.

The SQL must include partial unique indexes rather than ordinary boolean-bearing uniques:

```sql
CREATE UNIQUE INDEX product_options_active_name_key
ON product_options (product_id, lower(name))
WHERE is_active = true;

CREATE UNIQUE INDEX product_options_active_position_key
ON product_options (product_id, position)
WHERE is_active = true;

CREATE UNIQUE INDEX product_options_active_media_driver_key
ON product_options (product_id)
WHERE is_active = true AND is_media_driver = true;
```

Add denormalized product IDs and composite foreign keys so the database enforces same-product assignments/media. Add the media exclusive-scope CHECK as `NOT VALID`; do not update existing variants, SKUs, inventory, media, or orders.

- [ ] **Step 4: Validate, generate, migrate, and rerun SQL**

```bash
pnpm --dir backend exec prisma validate
pnpm --dir backend exec prisma generate
DATABASE_URL="postgresql://smallhouse:smallhouse@localhost:5432/small_house_variant_test?schema=public" pnpm --dir backend exec prisma migrate deploy
docker compose exec -T postgres psql -U smallhouse -d small_house_variant_test -v ON_ERROR_STOP=1 -f /workspace/backend/test/sql/catalog-graph-constraints.sql
```

Expected: PASS; existing row counts remain unchanged.

- [ ] **Step 5: Commit the Release A migration**

```bash
git add backend/prisma/schema/catalog.prisma backend/prisma/schema/order.prisma backend/prisma/migrations/20260921090000_expand_variant_options_media/migration.sql backend/test/sql/catalog-graph-constraints.sql
git commit -m "feat(db): expand catalog options and scoped media schema"
```

---

### Task 3: Rollback-Safe Legacy Compatibility Projection

**Files:**
- Create: `backend/src/modules/catalog/catalog-compat.ts`
- Create: `backend/src/modules/catalog/catalog-compat.spec.ts`
- Modify: `backend/src/modules/catalog/products.service.ts`
- Modify: `backend/src/modules/catalog/products.service.spec.ts`

**Interfaces:**
- Consumes: nullable expand schema.
- Produces: legacy flat product → synthetic one-group `Style` graph and shared-only legacy images.

- [ ] **Step 1: Write failing compatibility tests**

```ts
it("projects a version-zero product as one Style option", () => {
  const graph = projectLegacyCatalogGraph(legacyProductFixture);
  expect(graph.options).toHaveLength(1);
  expect(graph.options[0]).toMatchObject({ kind: "STYLE", position: 0 });
  expect(graph.variants.map((variant) => variant.id)).toEqual(
    legacyProductFixture.variants.map((variant) => variant.id),
  );
});

it("keeps scoped rows out of legacy images", () => {
  expect(projectLegacyImages(productWithScopedMedia).every((image) =>
    image.optionValueId === null && image.variantId === null,
  )).toBe(true);
});
```

Also verify deterministic synthetic IDs match the backfill formula, default display uses the first positioned ACTIVE/priced SKU, disabled SKU status is explicit, and list responses do not leak scoped galleries.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm --dir backend exec vitest run src/modules/catalog/catalog-compat.spec.ts src/modules/catalog/products.service.spec.ts`

Expected: FAIL because compatibility helpers and new response fields are absent.

- [ ] **Step 3: Implement compatibility presentation**

```ts
export function presentCatalogGraph(product: CatalogProductRow): PresentedCatalogGraph {
  return product.catalogGraphVersion === 0
    ? projectLegacyCatalogGraph(product)
    : presentPersistedCatalogGraph(product);
}
```

Update all legacy `images` selects to require both scope columns to be null. Add explicit SKU status, options, option assignments, default display ID, effective cover, and graph version to storefront serialization.

- [ ] **Step 4: Verify catalog suite and types**

```bash
pnpm --dir backend exec vitest run src/modules/catalog
pnpm --dir backend exec tsc --noEmit
pnpm --dir backend lint
```

Expected: PASS.

- [ ] **Step 5: Commit the compatibility bridge**

```bash
git add backend/src/modules/catalog/catalog-compat.ts backend/src/modules/catalog/catalog-compat.spec.ts backend/src/modules/catalog/products.service.ts backend/src/modules/catalog/products.service.spec.ts
git commit -m "feat(api): add rollback-safe catalog graph compatibility"
```

Release note: deploy Tasks 2–3 together before any scoped media exists; record that backend image as the rollback floor.

---

### Task 4: Catalog Graph Write DTO and Mutation Planner

**Files:**
- Create: `backend/src/modules/catalog/dto/catalog-graph.dto.ts`
- Create: `backend/src/modules/catalog/dto/catalog-graph.dto.spec.ts`
- Modify: `backend/src/modules/catalog/dto/product.dto.ts`

**Interfaces:**
- Produces: `CatalogGraphPatch`, `EntityRef`, retirements, and named revision errors.

- [ ] **Step 1: Write failing DTO tests**

```ts
it("requires exactly one stable reference form", () => {
  expect(entityRefSchema.safeParse({ id: "a", clientKey: "b" }).success).toBe(false);
  expect(entityRefSchema.safeParse({}).success).toBe(false);
});

it("rejects media with two scopes", () => {
  expect(mediaWriteSchema.safeParse({
    clientKey: "m1",
    url: "/uploads/a.webp",
    optionValueId: "value",
    variantId: "variant",
  }).success).toBe(false);
});
```

Cover duplicate refs/client keys/positions/labels/SKU codes, over-two options, over-100 candidates, omitted/set/clear default display, and `siteMediaUrl()` validation.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm --dir backend exec vitest run src/modules/catalog/dto/catalog-graph.dto.spec.ts`

Expected: FAIL because the schemas do not exist.

- [ ] **Step 3: Implement discriminated changed-row schemas**

```ts
export const entityRefSchema = z.union([
  z.object({ id: z.string().uuid(), clientKey: z.never().optional() }),
  z.object({ clientKey: z.string().min(1), id: z.never().optional() }),
]);
```

Validate shape in Zod; leave ownership, history, derived keys/names, and publish rules to the service.

- [ ] **Step 4: Verify DTO and product update tests**

```bash
pnpm --dir backend exec vitest run src/modules/catalog/dto/catalog-graph.dto.spec.ts src/modules/catalog/products.service.update.spec.ts
pnpm --dir backend exec tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/catalog/dto/catalog-graph.dto.ts backend/src/modules/catalog/dto/catalog-graph.dto.spec.ts backend/src/modules/catalog/dto/product.dto.ts
git commit -m "feat(api): define changed-row catalog graph writes"
```

---

### Task 5: Transactional Graph Persistence and Optimistic Revision

**Files:**
- Create: `backend/src/modules/catalog/catalog-graph.service.ts`
- Create: `backend/src/modules/catalog/catalog-graph.service.spec.ts`
- Modify: `backend/src/modules/catalog/products.service.ts`
- Modify: `backend/src/modules/catalog/admin/products.controller.ts`
- Modify: `backend/src/modules/catalog/catalog.module.ts`

**Interfaces:**
- Consumes: `CatalogGraphPatch` and expected `catalogGraphVersion`.
- Produces: persisted graph with stable IDs and incremented version.

- [ ] **Step 1: Write failing persistence tests**

```ts
it("retains variant and SKU identity for the same combination key", async () => {
  const result = await service.applyPatch(productId, version, renamePatch);
  expect(result.variants[0].id).toBe(existingVariantId);
  expect(result.variants[0].sku?.id).toBe(existingSkuId);
});

it("rejects stale catalog versions", async () => {
  await expect(service.applyPatch(productId, 4, patch)).rejects.toMatchObject({
    code: "CATALOG_GRAPH_VERSION_MISMATCH",
    actualVersion: 5,
  });
});
```

Cover option reorder identity, value rename/display names, swap-safe temporary names, new combinations, history-protected disable, history-free delete, rollback on media/default failure, missing revision, and revalidation only after commit.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm --dir backend exec vitest run src/modules/catalog/catalog-graph.service.spec.ts src/modules/catalog/products.service.update.spec.ts`

Expected: FAIL because the service is absent.

- [ ] **Step 3: Implement the mutation service**

```ts
async applyPatch(
  productId: string,
  expectedVersion: number,
  patch: CatalogGraphPatch,
): Promise<AdminProduct> {
  const plan = await this.planOutsideTransaction(productId, patch);
  const saved = await this.prisma.$transaction((tx) =>
    this.persistPlan(tx, productId, expectedVersion, plan),
  );
  await this.revalidation.product(saved.slug);
  return saved;
}
```

Resolve refs and history before the transaction, preallocate UUIDs, perform a conditional version increment, batch writes, compute server-side keys/names, and keep flat `reconcileVariants` only for graph-version-0 compatibility.

- [ ] **Step 4: Verify the catalog backend**

```bash
pnpm --dir backend exec vitest run src/modules/catalog
pnpm --dir backend exec tsc --noEmit
pnpm --dir backend lint
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/catalog/catalog-graph.service.ts backend/src/modules/catalog/catalog-graph.service.spec.ts backend/src/modules/catalog/products.service.ts backend/src/modules/catalog/admin/products.controller.ts backend/src/modules/catalog/catalog.module.ts
git commit -m "feat(catalog): persist option graphs without replacing SKUs"
```

---

### Task 6: Scoped Media Resolver and Storefront Media API

**Files:**
- Create: `backend/src/modules/catalog/product-media.resolver.ts`
- Create: `backend/src/modules/catalog/product-media.resolver.spec.ts`
- Modify: `backend/src/modules/catalog/products.service.ts`
- Modify: `backend/src/modules/catalog/storefront/products.controller.ts`
- Modify: `backend/src/modules/catalog/landing/landing-pages.service.ts`
- Modify: `backend/src/modules/catalog/landing/storefront/landing-pages.controller.ts`

**Interfaces:**
- Produces: `resolveProductMedia`, `GET /storefront/products/:slug/media`, `initialMediaSet`, and `effectiveCoverMedia`.

- [ ] **Step 1: Write failing resolver tests**

```ts
it("prefers exact variant media without merging scopes", () => {
  expect(resolveProductMedia(graph, { variantId: "variant-red-large" })).toEqual({
    resolvedScope: "VARIANT",
    scopeId: "variant-red-large",
    media: exactVariantMedia,
    catalogGraphVersion: 3,
  });
});
```

Cover option-value fallback, shared fallback, type/sort preservation, thumbnail fallback order, foreign-product/non-driver rejection, initial PDP scope only, no scoped list galleries, and cache invalidation by graph version.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm --dir backend exec vitest run src/modules/catalog/product-media.resolver.spec.ts src/modules/catalog/products.service.spec.ts src/modules/catalog/landing/landing-pages.service.spec.ts`

- [ ] **Step 3: Implement resolver, endpoint, and bounded cache**

```ts
export interface MediaScopeRequest {
  variantId?: string;
  optionValueId?: string;
}

export async function resolveProductMedia(
  productId: string,
  graphVersion: number,
  request: MediaScopeRequest,
): Promise<ProductMediaSet>;
```

Allow exactly one query scope. Cache by product ID + graph version + scope. LP overrides apply only when there is no deep link/user selection; selected product scope replaces the override.

- [ ] **Step 4: Verify catalog and landing services**

```bash
pnpm --dir backend exec vitest run src/modules/catalog
pnpm --dir backend exec tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/catalog/product-media.resolver.ts backend/src/modules/catalog/product-media.resolver.spec.ts backend/src/modules/catalog/products.service.ts backend/src/modules/catalog/storefront/products.controller.ts backend/src/modules/catalog/landing
git commit -m "feat(storefront): resolve scoped product media"
```

---

### Task 7: Set-Based Legacy Backfill and Audit

**Files:**
- Create: `backend/prisma/migrations/20260921100000_backfill_variant_options/migration.sql`
- Create: `backend/scripts/catalog-graph-audit.ts`
- Create: `backend/scripts/catalog-graph-audit.spec.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Produces: persisted one-group Style graph for every legacy variant product without changing IDs.

- [ ] **Step 1: Write failing audit tests**

```ts
it("detects changed SKU and variant identities", () => {
  expect(compareCatalogSnapshots(before, changedIds)).toContainEqual({
    code: "SKU_ID_SET_CHANGED",
  });
});

it("accepts an idempotent deterministic backfill", () => {
  expect(compareCatalogSnapshots(before, afterSecondRun)).toEqual([]);
});
```

Cover inventory values, reservations, movements, order references, media IDs/order, missing assignments, and repeated inserts.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm --dir backend exec vitest run scripts/catalog-graph-audit.spec.ts`

- [ ] **Step 3: Implement audit commands and set-based migration**

Use deterministic UUIDs, `INSERT ... SELECT`, `UPDATE ... FROM`, and `ON CONFLICT`. Insert one Style option/value per existing variant, assignments, one-pair keys, default variant, and graph version 1. Leave image scopes and historical snapshots unchanged.

Add scripts:

```json
{
  "catalog:audit:snapshot": "tsx scripts/catalog-graph-audit.ts snapshot",
  "catalog:audit:verify": "tsx scripts/catalog-graph-audit.ts verify"
}
```

- [ ] **Step 4: Run snapshot, migration, and verification on the disposable DB**

```bash
DATABASE_URL="postgresql://smallhouse:smallhouse@localhost:5432/small_house_variant_test?schema=public" pnpm --dir backend run catalog:audit:snapshot -- --out /tmp/catalog-before.json
DATABASE_URL="postgresql://smallhouse:smallhouse@localhost:5432/small_house_variant_test?schema=public" pnpm --dir backend exec prisma migrate deploy
DATABASE_URL="postgresql://smallhouse:smallhouse@localhost:5432/small_house_variant_test?schema=public" pnpm --dir backend run catalog:audit:verify -- --snapshot /tmp/catalog-before.json
```

Expected: PASS with unchanged ID/reference/media/inventory sets.

- [ ] **Step 5: Commit the Release B migration**

```bash
git add backend/prisma/migrations/20260921100000_backfill_variant_options/migration.sql backend/scripts/catalog-graph-audit.ts backend/scripts/catalog-graph-audit.spec.ts backend/package.json
git commit -m "feat(db): backfill legacy variants into typed options"
```

---

### Task 8: Validate and Tighten Catalog Constraints

**Files:**
- Modify: `backend/prisma/schema/catalog.prisma`
- Create: `backend/prisma/migrations/20260921110000_validate_variant_options/migration.sql`
- Modify: `backend/test/sql/catalog-graph-constraints.sql`

**Interfaces:**
- Produces: non-null unique combination identity and validated graph ownership constraints.

- [ ] **Step 1: Extend SQL tests for the tightened state**

Add assertions for non-null `combination_key`, unique `(product_id, combination_key)`, one value per option per variant, cross-product assignment rejection, validated media/default FKs, and `pg_constraint.convalidated = true`.

- [ ] **Step 2: Run before migration and verify RED**

Run the SQL contract against the backfilled DB. Expected: FAIL on nullable/unvalidated constraints.

- [ ] **Step 3: Add the validation migration**

```sql
ALTER TABLE product_images VALIDATE CONSTRAINT product_images_scope_check;
ALTER TABLE product_variants ALTER COLUMN combination_key SET NOT NULL;
CREATE UNIQUE INDEX product_variants_product_combination_key
ON product_variants(product_id, combination_key);
```

Validate all previously unvalidated composite FKs/CHECKs. Do not drop `ProductVariant.name`, shared `images`, or nullable historical snapshots.

- [ ] **Step 4: Rerun Prisma and SQL verification**

```bash
pnpm --dir backend exec prisma validate
pnpm --dir backend exec prisma generate
DATABASE_URL="postgresql://smallhouse:smallhouse@localhost:5432/small_house_variant_test?schema=public" pnpm --dir backend exec prisma migrate deploy
docker compose exec -T postgres psql -U smallhouse -d small_house_variant_test -v ON_ERROR_STOP=1 -f /workspace/backend/test/sql/catalog-graph-constraints.sql
```

- [ ] **Step 5: Commit the Release C migration**

```bash
git add backend/prisma/schema/catalog.prisma backend/prisma/migrations/20260921110000_validate_variant_options/migration.sql backend/test/sql/catalog-graph-constraints.sql
git commit -m "feat(db): enforce catalog graph integrity"
```

---

### Task 9: Bounded Inventory Batch Endpoint

**Files:**
- Modify: `backend/src/modules/inventory/dto/inventory.dto.ts`
- Modify: `backend/src/modules/inventory/inventory.service.ts`
- Create: `backend/src/modules/inventory/inventory.service.spec.ts`
- Modify: `backend/src/modules/inventory/admin/inventory.controller.ts`

**Interfaces:**
- Produces: `PUT /api/v1/admin/inventory/stock/batch` with per-SKU settled results.

- [ ] **Step 1: Write failing batch tests**

```ts
it("keeps successful ledger writes when another SKU fails", async () => {
  const result = await service.setOnHandBatch([
    { skuId: "ok", onHand: 10 },
    { skuId: "reserved", onHand: 1 },
  ]);
  expect(result).toEqual([
    expect.objectContaining({ skuId: "ok", ok: true }),
    expect.objectContaining({ skuId: "reserved", ok: false }),
  ]);
});
```

Cover 1/100/101 entries, duplicate IDs, movement creation, and retrying failed rows only.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm --dir backend exec vitest run src/modules/inventory/inventory.service.spec.ts`

- [ ] **Step 3: Implement bounded settled processing**

Reuse `setOnHand()` in chunks of ten; do not add a second ledger path or one all-SKU transaction.

- [ ] **Step 4: Verify inventory suite**

```bash
pnpm --dir backend exec vitest run src/modules/inventory
pnpm --dir backend exec tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/inventory
git commit -m "feat(inventory): batch absolute stock updates safely"
```

---

### Task 10: Pure Admin Graph Adapters and Changed-Row Diff

**Files:**
- Create: `frontend/src/lib/admin-product-graph.ts`
- Create: `frontend/src/lib/admin-product-graph.spec.ts`
- Modify: `frontend/src/lib/admin-api.ts`
- Modify: `frontend/src/components/admin/ProductForm.tsx`

**Interfaces:**
- Produces: `deserializeAdminProduct`, `buildVariantCandidates`, `validateAdminCatalogGraph`, `buildCatalogGraphPatch`, `collectStockBatch`.

- [ ] **Step 1: Write failing adapter tests**

```ts
it("does not emit variant upserts when only option display order changes", () => {
  const patch = buildCatalogGraphPatch(serverGraph, reorderedDraft);
  expect(patch.variantUpserts).toEqual([]);
});
```

Cover stable IDs/client keys, 100/101 candidates, value rename, new candidate, retirements, changed media only, graph version/default round-trip, and client-key-to-stock mapping.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm --dir frontend exec vitest run src/lib/admin-product-graph.spec.ts`

- [ ] **Step 3: Implement pure adapters outside ProductForm**

```ts
export function buildCatalogGraphPatch(
  original: AdminCatalogGraph,
  draft: AdminCatalogGraphDraft,
): CatalogGraphPatch;
```

Keep backend-derived variant names out of the patch and preserve client keys for newly created SKUs.

- [ ] **Step 4: Verify adapters and edit-page regression**

```bash
pnpm --dir frontend exec vitest run src/lib/admin-product-graph.spec.ts 'src/app/admin/(shell)/products/[id]/edit/page.spec.ts'
pnpm --dir frontend exec tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/admin-product-graph.ts frontend/src/lib/admin-product-graph.spec.ts frontend/src/lib/admin-api.ts frontend/src/components/admin/ProductForm.tsx
git commit -m "feat(admin): adapt typed option graphs to product form state"
```

---

### Task 11: Admin Options, Matrix, and Scoped Media UI

**Files:**
- Modify: `frontend/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `frontend/vitest.config.ts`
- Create: `frontend/src/test/setup.ts`
- Create: `frontend/src/components/admin/ProductOptionsEditor.tsx`
- Create: `frontend/src/components/admin/ProductOptionsEditor.spec.tsx`
- Create: `frontend/src/components/admin/VariantMatrix.tsx`
- Create: `frontend/src/components/admin/VariantMatrix.spec.tsx`
- Create: `frontend/src/components/admin/ProductMediaScopesEditor.tsx`
- Create: `frontend/src/components/admin/ProductMediaScopesEditor.spec.tsx`
- Modify: `frontend/src/components/admin/ProductForm.tsx`
- Modify: `frontend/src/app/admin/(shell)/products/new/page.tsx`
- Modify: `frontend/src/app/admin/(shell)/products/[id]/edit/page.tsx`

**Interfaces:**
- Consumes: Task 10 adapters and existing `ImageUrlInput`.
- Produces: typed options editor, 30-row pages, scoped media editor, and two-phase save UX.

- [ ] **Step 1: Install the component-test harness and write failing UI tests**

```bash
pnpm --dir frontend add -D @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom
```

```tsx
it("renders only the current thirty-row matrix page", () => {
  render(<VariantMatrix candidates={makeCandidates(31)} />);
  expect(screen.getAllByRole("row")).toHaveLength(31);
  expect(screen.getByRole("button", { name: "Next page" })).toBeEnabled();
});
```

Cover third-option blocking, IMAGE/SWATCH/TEXT controls, thumbnail warnings, candidate cap, bulk edits, protected disable, shared/value/advanced scopes, existing uploader reuse, stock partial failure, and failed-row-only retry.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
pnpm --dir frontend exec vitest run src/components/admin/ProductOptionsEditor.spec.tsx src/components/admin/VariantMatrix.spec.tsx src/components/admin/ProductMediaScopesEditor.spec.tsx
```

Expected: FAIL because components do not exist.

- [ ] **Step 3: Implement focused components and two-phase save**

Use client-side pagination with page size 30. Save graph Phase A, adopt returned graph/version, then call stock batch Phase B. On partial stock failure, refetch server state and retain only failed retry rows.

- [ ] **Step 4: Verify frontend suite, typecheck, and lint**

```bash
pnpm --dir frontend test
pnpm --dir frontend exec tsc --noEmit
pnpm --dir frontend lint
```

- [ ] **Step 5: Commit**

```bash
git add frontend/package.json pnpm-lock.yaml frontend/vitest.config.ts frontend/src/test frontend/src/components/admin frontend/src/app/admin/'(shell)'/products
git commit -m "feat(admin): edit option matrices and scoped media"
```

---

### Task 12: Pure Storefront Selection Reducer and Purchase Provider

**Files:**
- Create: `frontend/src/lib/product-selection.ts`
- Create: `frontend/src/lib/product-selection.spec.ts`
- Create: `frontend/src/components/product/PdpPurchaseProvider.tsx`
- Create: `frontend/src/components/product/PdpPurchaseProvider.spec.tsx`
- Modify: `frontend/src/lib/api.ts`

**Interfaces:**
- Produces: the exact `ProductSelectionState`, selectors, and `PdpPurchaseContextValue` defined above.

- [ ] **Step 1: Write failing reducer/provider tests**

```ts
it("prefills a deep link without confirming purchase", () => {
  const state = createInitialSelection(product, deepLinkedVariant.id);
  const derived = resolveSelection(product, state);
  expect(state.selectionSource).toBe("DEEP_LINK");
  expect(state.explicitlyTouchedOptionIds).toEqual([]);
  expect(derived.resolvedVariant?.id).toBe(deepLinkedVariant.id);
  expect(derived.purchaseConfirmed).toBe(false);
});
```

Cover ordinary multi-SKU, invalid deep link removal result, single SKU, 0/1/2 groups, touch-all confirmation, confirm-dialog, revision invalidation, incompatible clear, OOS selectable/non-purchasable, disabled/unpriced exclusion, display-only default, quantity 1–99, and first-line persistence.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm --dir frontend exec vitest run src/lib/product-selection.spec.ts src/components/product/PdpPurchaseProvider.spec.tsx`

- [ ] **Step 3: Implement pure state and thin provider**

```ts
export function combinationKeyForSelection(
  options: readonly StorefrontProductOption[],
  selectedValueIds: SelectedValueIds,
): string | null;

export function reduceProductSelection(
  product: Product,
  state: ProductSelectionState,
  action: ProductSelectionAction,
): ProductSelectionState;
```

The provider dispatches line actions and computes selectors; it must not store derived variant/SKU/price/media state.

- [ ] **Step 4: Verify tests and types**

```bash
pnpm --dir frontend exec vitest run src/lib/product-selection.spec.ts src/components/product/PdpPurchaseProvider.spec.tsx
pnpm --dir frontend exec tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/product-selection.ts frontend/src/lib/product-selection.spec.ts frontend/src/components/product/PdpPurchaseProvider.tsx frontend/src/components/product/PdpPurchaseProvider.spec.tsx frontend/src/lib/api.ts
git commit -m "feat(storefront): centralize product option selection state"
```

---

### Task 13: PDP Deep Links, Scoped Gallery, and Explicit Confirmation

**Files:**
- Create: `frontend/src/components/product/ProductOptionSelector.tsx`
- Create: `frontend/src/components/product/ProductOptionSelector.spec.tsx`
- Create: `frontend/src/components/product/VariantPickerDialog.tsx`
- Create: `frontend/src/lib/product-media.ts`
- Create: `frontend/src/lib/product-media.spec.ts`
- Modify: `frontend/src/components/product/PdpClient.tsx`
- Modify: `frontend/src/components/product/PdpView.tsx`
- Modify: `frontend/src/components/product/ProductGallery.tsx`
- Modify: `frontend/src/components/product/MobileStickyCta.tsx`
- Modify: `frontend/src/app/(storefront)/products/[slug]/page.tsx`
- Modify: `frontend/src/app/(storefront)/lp/[slug]/page.tsx`

**Interfaces:**
- Consumes: Task 12 provider and backend media endpoint.
- Produces: one typed picker across desktop/mobile and scoped gallery cache.

- [ ] **Step 1: Write failing PDP and media tests**

```tsx
it("requires confirmation before adding a deep-linked variant", async () => {
  render(<PdpFixture variantId={deepLinkedVariant.id} />);
  await user.click(screen.getByRole("button", { name: "ADD TO CART" }));
  expect(screen.getByRole("dialog", { name: "Confirm your options" })).toBeVisible();
  expect(addToCart).not.toHaveBeenCalled();
});
```

Cover ordinary CHOOSE OPTIONS, display-only default, exact media/price deep link, no premature event/API call, confirm-once, touched groups, confirmation invalidation, OOS save vs blocked Order Now, single SKU, invalid query removal, gallery reset/lightbox close, same-scope image fallback, and shared desktop/mobile state.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --dir frontend exec vitest run src/components/product/ProductOptionSelector.spec.tsx src/lib/product-media.spec.ts
```

- [ ] **Step 3: Implement option selector and scoped media cache**

Use graph-version/scope cache keys. A scope change replaces gallery media, resets active index, and closes an open Lightbox. Phase 1 confirmed Order Now may still route to traditional checkout; Phase 2 replaces only its handler with `#quick-order` focus.

- [ ] **Step 4: Verify reducer, media, component, typecheck, and lint**

```bash
pnpm --dir frontend exec vitest run src/lib/product-selection.spec.ts src/lib/product-media.spec.ts src/components/product/ProductOptionSelector.spec.tsx
pnpm --dir frontend exec tsc --noEmit
pnpm --dir frontend lint
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/product frontend/src/lib/product-media.ts frontend/src/lib/product-media.spec.ts frontend/src/app/'(storefront)'/products frontend/src/app/'(storefront)'/lp
git commit -m "feat(pdp): require confirmed options and resolve scoped media"
```

---

### Task 14: Product Cards and Quick Add Without Positional Heuristics

**Files:**
- Modify: `frontend/src/components/product/ProductCard.tsx`
- Modify: `frontend/src/components/product/PlpProductCard.tsx`
- Modify: `frontend/src/components/cart/QuickAddView.tsx`
- Modify: `frontend/src/components/cart/CartContext.tsx`
- Delete: `frontend/src/lib/variantImages.ts`
- Create: `frontend/src/components/product/PlpProductCard.spec.tsx`
- Create: `frontend/src/components/cart/QuickAddView.spec.tsx`

**Interfaces:**
- Consumes: `effectiveCoverMedia`, shared selector, and provider-compatible picker.
- Produces: heuristic-free cards and Quick Add.

- [ ] **Step 1: Write failing card and Quick Add tests**

Verify effective cover instead of `images[0]`, price range/default display, direct single SKU including OOS save, unselected multi-SKU picker, IMAGE/SWATCH/TEXT controls, exactly one successful AddToCart event, and no events on cancel/media browse.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --dir frontend exec vitest run src/components/product/PlpProductCard.spec.tsx src/components/cart/QuickAddView.spec.tsx
```

- [ ] **Step 3: Replace positional mapping with shared contracts**

```ts
const cover = product.effectiveCoverMedia;
const selection = createInitialSelection(product, null);
```

Remove every import of `variantImages.ts`, then delete the file.

- [ ] **Step 4: Verify frontend tests and types**

```bash
pnpm --dir frontend test
pnpm --dir frontend exec tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/product frontend/src/components/cart frontend/src/lib/variantImages.ts
git commit -m "feat(storefront): replace quick-add image and SKU heuristics"
```

---

### Task 15: Atomic Cart SKU Replacement and Enriched Summary

**Files:**
- Modify: `backend/src/modules/cart/dto/cart.dto.ts`
- Modify: `backend/src/modules/cart/cart.service.ts`
- Create: `backend/src/modules/cart/cart.service.spec.ts`
- Modify: `backend/src/modules/cart/storefront/cart.controller.ts`

**Interfaces:**
- Produces: `PATCH /storefront/cart/:cartId/items/:itemId` and cart `optionValues`/effective thumbnail.

- [ ] **Step 1: Write failing cart tests**

```ts
it("atomically merges when the target SKU already exists", async () => {
  const cart = await service.replaceItemSku(cartId, sourceItemId, {
    skuId: targetSkuId,
    quantity: 2,
  });
  expect(cart.items).toContainEqual(expect.objectContaining({ skuId: targetSkuId, quantity: 3 }));
  expect(cart.items.some((item) => item.id === sourceItemId)).toBe(false);
});
```

Cover structured summary, new target update, 99/stock checks, invalid/disabled/unpriced/foreign targets, unchanged original rows on failure, cross-cart 404, existing quantity and OOS-save regressions.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm --dir backend exec vitest run src/modules/cart/cart.service.spec.ts`

- [ ] **Step 3: Implement transactional replace/merge**

Validate ownership and target before mutation. If a target row exists, merge and delete inside one transaction; otherwise update the row. Checkout remains authoritative for reservation.

- [ ] **Step 4: Verify cart suite and typecheck**

```bash
pnpm --dir backend exec vitest run src/modules/cart/cart.service.spec.ts
pnpm --dir backend exec tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/cart
git commit -m "feat(cart): replace and merge selected SKUs atomically"
```

---

### Task 16: Cart Change Options Frontend

**Files:**
- Create: `frontend/src/components/cart/CartOptionPicker.tsx`
- Create: `frontend/src/components/cart/CartOptionPicker.spec.tsx`
- Modify: `frontend/src/components/cart/CartContext.tsx`
- Modify: `frontend/src/components/cart/CartDrawer.tsx`
- Modify: `frontend/src/components/cart/CartView.tsx`
- Modify: `frontend/src/lib/api.ts`

**Interfaces:**
- Consumes: cart replacement endpoint and shared option selector.
- Produces: accessible Change Options flow.

- [ ] **Step 1: Write failing frontend cart tests**

Verify structured Color/Size/SKU/thumbnail, prefilled picker without confirmation, cancel no-op, one PATCH on confirm, merged response adoption, server-error preservation/announcement, and focus restoration.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --dir frontend exec vitest run src/components/cart/CartOptionPicker.spec.tsx src/components/cart/CartView.spec.tsx
```

- [ ] **Step 3: Implement the picker and context mutation**

Use the shared reducer/selector. Do not call product-by-slug only to recover cart images after enriched summaries are available.

- [ ] **Step 4: Verify frontend suite**

```bash
pnpm --dir frontend test
pnpm --dir frontend exec tsc --noEmit
pnpm --dir frontend lint
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/cart frontend/src/lib/api.ts
git commit -m "feat(cart): change product options from cart lines"
```

---

### Task 17: Authoritative Structured Order Snapshots

**Files:**
- Create: `backend/src/modules/orders/order-item-snapshot.ts`
- Create: `backend/src/modules/orders/order-item-snapshot.spec.ts`
- Modify: `backend/src/modules/orders/orders.service.ts`
- Modify: `backend/src/modules/orders/orders.service.spec.ts`
- Modify: `backend/src/modules/customers/storefront-customer-auth.service.ts`

**Interfaces:**
- Produces: `OrderOptionSnapshotV1` and `buildOrderItemSnapshot` for all new order lines.

- [ ] **Step 1: Write failing snapshot tests**

```ts
it("sorts options by option position and preserves stable IDs", () => {
  expect(buildOrderItemSnapshot(skuFixture).optionSnapshot).toEqual({
    version: 1,
    options: [colorSnapshot, sizeSnapshot],
  });
});
```

Cover storefront/admin order creation, rename immutability, legacy variant text, historical null, and SKU-only checkout input.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --dir backend exec vitest run src/modules/orders/order-item-snapshot.spec.ts src/modules/orders/orders.service.spec.ts
```

- [ ] **Step 3: Implement one snapshot builder and use it everywhere**

```ts
export function buildOrderItemSnapshot(
  sku: SkuWithVariantProductAndOptionAssignments,
): OrderItemSnapshotWrite;
```

Populate both structured JSON and legacy `variantSnapshot`; never rebuild historical snapshots at read time.

- [ ] **Step 4: Verify orders and types**

```bash
pnpm --dir backend exec vitest run src/modules/orders
pnpm --dir backend exec tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/orders backend/src/modules/customers/storefront-customer-auth.service.ts
git commit -m "feat(orders): snapshot structured product options"
```

---

### Task 18: Checkout, Tracking, Account, and Admin Option Displays

**Files:**
- Create: `frontend/src/lib/order-options.ts`
- Create: `frontend/src/lib/order-options.spec.ts`
- Modify: `frontend/src/components/checkout/checkoutItems.ts`
- Modify: `frontend/src/components/checkout/useCheckoutLines.ts`
- Modify: `frontend/src/components/checkout/OrderPreview.tsx`
- Modify: `frontend/src/components/checkout/CheckoutForm.tsx`
- Modify: `frontend/src/components/checkout/CheckoutConfirmView.tsx`
- Modify: `frontend/src/components/track-order/TrackOrderForm.tsx`
- Modify: `frontend/src/app/admin/(shell)/orders/[id]/page.tsx`
- Modify: `frontend/src/app/(storefront)/account/page.tsx`

**Interfaces:**
- Produces: structured option formatter with historical fallback.

- [ ] **Step 1: Write failing display tests**

Verify checkout/cart options and thumbnails, Buy Now selected options, request remains `{skuId, quantity}`, Admin/guest/account structured display, null snapshot fallback, and unresolved selections blocked from confirmation.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --dir frontend exec vitest run src/lib/order-options.spec.ts src/components/checkout/checkoutItems.spec.ts
```

- [ ] **Step 3: Implement formatter and migrate all snapshot consumers**

```ts
export function formatOrderOptions(
  optionSnapshot: OrderOptionSnapshotV1 | null,
  variantSnapshot: string | null,
): readonly { label: string; value: string }[];
```

- [ ] **Step 4: Verify frontend full suite**

```bash
pnpm --dir frontend test
pnpm --dir frontend exec tsc --noEmit
pnpm --dir frontend lint
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/order-options.ts frontend/src/lib/order-options.spec.ts frontend/src/components/checkout frontend/src/components/track-order frontend/src/app/admin/'(shell)'/orders frontend/src/app/'(storefront)'/account
git commit -m "feat(checkout): display authoritative option snapshots"
```

---

### Task 19: SKU-Consistent Analytics and Per-SKU SEO Offers

**Files:**
- Create: `frontend/src/lib/commerce-events.ts`
- Create: `frontend/src/lib/commerce-events.spec.ts`
- Create: `frontend/src/lib/product-jsonld.spec.ts`
- Modify: `frontend/src/lib/product-jsonld.ts`
- Modify: `frontend/src/components/tracking/PurchaseTracking.tsx`
- Modify event emitters in PDP, Quick Add, cart, and checkout.

**Interfaces:**
- Produces: one event adapter keyed by final SKU IDs and per-SKU JSON-LD offers.

- [ ] **Step 1: Write failing event and SEO tests**

Verify ViewContent once on displayed SKU, option_select/variant_confirm/unavailable events, exactly one AddToCart after success, final SKU InitiateCheckout/Purchase, no unconfirmed events, one Offer per ACTIVE/priced SKU, precise variant URLs/availability/descriptions, and queryless canonical.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --dir frontend exec vitest run src/lib/commerce-events.spec.ts src/lib/product-jsonld.spec.ts
```

- [ ] **Step 3: Implement shared event builders and SKU offers**

Store the successful purchase event payload tab-scoped before navigation; `PurchaseTracking` consumes it once. Keep price/availability server-derived.

- [ ] **Step 4: Verify frontend**

```bash
pnpm --dir frontend test
pnpm --dir frontend exec tsc --noEmit
pnpm --dir frontend lint
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/commerce-events.ts frontend/src/lib/commerce-events.spec.ts frontend/src/lib/product-jsonld.ts frontend/src/lib/product-jsonld.spec.ts frontend/src/components/tracking frontend/src/components/product frontend/src/components/cart frontend/src/components/checkout
git commit -m "feat(tracking): unify commerce events on final SKU IDs"
```

---

### Task 20: Full Compatibility and Browser Acceptance Gate

**Files:**
- Modify: `frontend/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `frontend/playwright.config.ts`
- Create: `frontend/e2e/variant-options-media.spec.ts`
- Create: `backend/prisma/seed-e2e.ts`
- Modify: `docs/DEPLOYMENT.md`

**Interfaces:**
- Consumes: all phase-1 behavior.
- Produces: repeatable browser/regression gate and staged rollout runbook.

- [ ] **Step 1: Install Playwright and write failing E2E scenarios**

```bash
pnpm --dir frontend add -D @playwright/test
pnpm --dir frontend exec playwright install chromium
```

Cover legacy Style, Color-only, Size-only, Color×Size, exact override, valid/invalid deep links, OOS save vs Order Now, PDP/LP/Quick Add/cart/checkout/order/account/Admin, 375/768/1280, keyboard/focus, request audit for non-current media, and zero console/hydration errors.

- [ ] **Step 2: Run browser tests and verify RED**

Run: `pnpm --dir frontend exec playwright test e2e/variant-options-media.spec.ts`

Expected: FAIL until deterministic typed fixtures and every integrated surface exist.

- [ ] **Step 3: Add deterministic seed and staged deployment checks**

The seed must refuse non-test database names and create one product for each scenario. Document Release A bridge, Release B backfill audit, Release C constraints, Release D Admin/Storefront, `prisma generate`, backup path, and rollback floor.

- [ ] **Step 4: Run the complete phase gate**

```bash
pnpm --dir backend exec prisma validate
pnpm --dir backend exec prisma generate
pnpm --dir backend test
pnpm --dir backend test:e2e
pnpm --dir backend lint
pnpm --dir backend exec tsc --noEmit
pnpm --dir backend build
pnpm --dir frontend test
pnpm --dir frontend lint
pnpm --dir frontend exec tsc --noEmit
pnpm --dir frontend build
pnpm --dir frontend exec playwright test e2e/variant-options-media.spec.ts
```

Expected: all commands exit 0; no non-current scoped media requests; migration audit reports no identity/reference drift.

- [ ] **Step 5: Commit the acceptance gate**

```bash
git add frontend/package.json pnpm-lock.yaml frontend/playwright.config.ts frontend/e2e/variant-options-media.spec.ts backend/prisma/seed-e2e.ts docs/DEPLOYMENT.md
git commit -m "test(e2e): gate typed variants and scoped media rollout"
```

## Phase 1 Completion Gate

Before starting Inline COD:

- All Task 20 commands pass from a clean test database.
- Existing production-like products backfill without variant/SKU/reference drift.
- Catalog compatibility backend is identified as the rollback floor.
- `PdpPurchaseProvider`, `ProductSelectionState`, shared Variant Picker, media resolver, enriched cart summary, and `buildOrderItemSnapshot` are exported and documented.
- Production migrations/backfill are not executed until the user approves the database risk gate.
