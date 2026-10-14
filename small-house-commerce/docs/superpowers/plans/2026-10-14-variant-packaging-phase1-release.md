# Variant Dimensions and Packaging Phase 1 Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not dispatch new Agent or Workflow runs.

**Goal:** Complete and release per-SKU product-dimension overrides plus deterministic packaging assistance, preserving the approved 长 × 宽 × 高 admin convention and existing storefront Width × Depth × Height semantics.

**Architecture:** Nullable `Sku.productWidth/productHeight/productDepth` columns override product dimensions; null means inheritance. Pure parsing converts supplier text into a preview with assumptions/warnings, and UI confirmation writes only selected existing dimension/package fields. The ProductForm graph path remains the only save path, and storefront selected-variant rendering resolves override then product fallback.

**Tech Stack:** NestJS 12, Prisma 7.10.0, PostgreSQL 18, Next.js 16.3.4, React 19.2.8, TypeScript, Zod, Vitest, Testing Library, Playwright/Chromium.

**Spec:** `small-house-commerce/docs/superpowers/specs/2026-10-14-four-line-closeout-staged-release-design.md`; Phase 1 contract in `2026-10-09-variant-packaging-bundle-design.md`; detailed prior plan in `2026-10-09-variant-packaging-phase1.md`.

## Global Constraints

- Start from the exact Marketing SHA deployed by Wave 2; never start from the dirty source branch.
- Phase 1 is a separate release boundary and hard prerequisite for Bundle. Do not import `Sku.isBundle`, Bundle tables/services/UI, Bundle order/inventory logic, or Bundle tests.
- Admin unlabeled triplets are 长 × 宽 × 高 and map to Width × Depth × Height. Never swap or migrate historical values.
- Product dimensions and package dimensions remain separate. Parser/assist never writes volumetric weight, prices, inventory, SKU codes, option assignments, or new SKU rows.
- Bulk dimension actions affect only materialized sellable SKU drafts and preserve client keys.
- Null SKU overrides inherit product values; clearing an override stores null, not the current parent value.
- Parser is deterministic, local, and pure; no dependency, network request, LLM, or silent apply.
- Shared files (`catalog.prisma`, graph service/DTO, ProductForm, VariantMatrix, API types, ProductSpecs, i18n) receive semantic hunks only.
- Read installed Next.js docs before route/cache changes; no route/cache change is expected in this wave.
- Every defect/change follows RED → GREEN; use isolated schema/runtime and do not disturb FAQ/Marketing or other sessions.

## Review Focus

1. **`120 × 60 × 75` is parsed with no labels:** Tasks 4/5 test admin storage Width=120, Depth=60, Height=75 and storefront labels in that exact mapping.
2. **A parent product dimension changes after a SKU override is cleared:** Tasks 2/3 test null inheritance reads the new parent value without copying it into the SKU.
3. **Apply-all sees unmaterialized option combinations:** Task 3 tests they remain unmaterialized and receive no stock-bearing row.
4. **Input mixes net weight, gross weight, duplicate axes, unsupported units, or four dimensions:** Task 4 tests warnings and zero writes.
5. **A save fails after assist confirmation:** Task 5 tests only the form draft changed; normal ProductForm validation/transaction remains authoritative and retry-safe.

---

### Task 1: Assemble a Phase-1-only candidate and migration

**Files:**
- Create: `.superpowers/release-four-lines-20261014/manifests/variant-packaging-files.txt`
- Create: `.superpowers/release-four-lines-20261014/manifests/variant-packaging-source-sha256.tsv`
- Create: `.superpowers/release-four-lines-20261014/manifests/variant-packaging-shared-hunks.md`
- Create: `.superpowers/release-four-lines-20261014/manifests/variant-packaging-migration-map.tsv`
- Exclusive source: `frontend/src/lib/parse-packaging-input.ts`, `ProductDimensionsAssist.tsx`, `SkuPackagingAssist.tsx`, and tests.
- Shared hunks: `backend/prisma/schema/catalog.prisma`, product/graph DTO/service files, `admin-product-graph.ts`, `ProductForm.tsx`, `VariantMatrix.tsx`, `api.ts`, `ProductSpecs.tsx`, i18n.

**Interfaces:**
- Consumes: deployed Marketing baseline and read-only Phase 1 source work.
- Produces: isolated Phase 1 candidate with one append-only migration and no Bundle symbols.

- [ ] **Step 1: Create the wave branch**

```bash
MARKETING_SHA=$(awk -F= '$1=="MARKETING_SHA" {print $2}' ../evidence/release-b-baseline.txt)
test -n "$MARKETING_SHA"
git checkout -b release/variant-packaging-phase1 "$MARKETING_SHA"
mkdir -p ../manifests ../evidence/variant-packaging
```

- [ ] **Step 2: Write the allowlist and explicit Bundle denylist**

The manifest marks each path `EXCLUSIVE`, `SHARED_HUNK`, `MIGRATION_REPLACED`, or `TEST`. A deny check must reject candidate content introducing any of:

```text
Sku.isBundle
bundleVersion
SkuBundleComponent
bundleSnapshot
BundleComponentsEditor
bundle-inventory
```

Existing occurrences from already-deployed dependencies are not expected on this baseline; any match must be explained before proceeding.

- [ ] **Step 3: Hash/copy exclusive files and apply shared hunks only**

Record every imported symbol in `variant-packaging-shared-hunks.md`, including:

```text
Sku.productWidth/productHeight/productDepth
skuWriteSchema nullable fields
resolveProductDimensions
AdminSkuDraft fields and serializer/deserializer
applyProductDimensionsToVariants
ProductDimensionsAssist/SkuPackagingAssist wiring
selected-variant ProductSpecs fallback
phase1 i18n keys
```

Do not replace whole ProductForm, VariantMatrix, APIs, ProductSpecs, or i18n files.

- [ ] **Step 4: Normalize the unreleased migration**

Replace local `20261013090000_add_sku_product_dimensions` with one migration name after the Marketing baseline latest migration. Preserve only the three nullable double-precision SKU columns; record old/new name and SQL hash.

- [ ] **Step 5: Verify manifest closure and Bundle absence**

```bash
git diff --name-only "$MARKETING_SHA" -- | sort > ../evidence/variant-packaging/actual-files.txt
cut -f2 ../manifests/variant-packaging-files.txt | sort -u > ../evidence/variant-packaging/allowed-files.txt
comm -23 ../evidence/variant-packaging/actual-files.txt ../evidence/variant-packaging/allowed-files.txt
if git grep -n -E 'SkuBundleComponent|bundleSnapshot|BundleComponentsEditor|bundle-inventory' -- \
  small-house-commerce/backend small-house-commerce/frontend; then
  printf '%s\n' 'Phase 2 symbols found in the Phase 1 candidate' >&2
  exit 1
fi
```

Expected: manifest closure and no Phase 2 symbols.

- [ ] **Step 6: Commit isolated assembly**

```bash
git add -- $(cut -f2 ../manifests/variant-packaging-files.txt)
git commit -m "feat(catalog): assemble variant dimensions and packaging assist"
```

### Task 2: Verify backend persistence, validation, and fallback

**Files:**
- Modify: `backend/prisma/schema/catalog.prisma`
- Modify: `backend/src/modules/catalog/dto/product.dto.ts`, `catalog-graph.dto.ts`
- Modify: `backend/src/modules/catalog/catalog-graph.ts`, `catalog-graph.service.ts`, `products.service.ts`
- Test: corresponding DTO/service/product specs.

**Interfaces:**
- Consumes: product `width/height/depth`, SKU graph save, and nullable override columns.
- Produces: nullable `productWidth/productHeight/productDepth` contracts plus `resolveProductDimensions(product, sku)`.

- [ ] **Step 1: Add/confirm failing DTO and graph tests before fixing any gap**

```ts
it("round-trips nullable SKU product dimension overrides without touching package fields", async () => {
  const patch = skuWriteSchema.parse({
    ...validSku,
    productWidth: 120,
    productDepth: 60,
    productHeight: 75,
    packageWidth: 130,
  });
  expect(patch).toMatchObject({
    productWidth: 120,
    productDepth: 60,
    productHeight: 75,
    packageWidth: 130,
  });
});
```

Add cases for null clearing, negative/NaN/Infinity rejection, omitted-field preservation, graph save/reload, and transaction rollback.

- [ ] **Step 2: Run focused backend tests**

```bash
pnpm --dir small-house-commerce/backend exec vitest run \
  src/modules/catalog/dto/catalog-graph.dto.spec.ts \
  src/modules/catalog/catalog-graph.service.spec.ts \
  src/modules/catalog/products.service.spec.ts
```

Expected: imported behavior either passes or exposes a specific gap. Do not change production code for an already-green case.

- [ ] **Step 3: Fix only failing contracts using nullable fields**

Required write shape:

```ts
productWidth: z.number().finite().nonnegative().nullable().optional(),
productDepth: z.number().finite().nonnegative().nullable().optional(),
productHeight: z.number().finite().nonnegative().nullable().optional(),
```

Required resolver:

```ts
export function resolveProductDimensions(product: ProductDimensions, sku?: SkuDimensions | null) {
  return {
    width: sku?.productWidth ?? product.width,
    depth: sku?.productDepth ?? product.depth,
    height: sku?.productHeight ?? product.height,
  };
}
```

Never use truthiness; zero must follow the explicit validation policy, and null means inherit.

- [ ] **Step 4: Re-run focused tests to GREEN**

```bash
pnpm --dir small-house-commerce/backend exec vitest run \
  src/modules/catalog/dto/catalog-graph.dto.spec.ts \
  src/modules/catalog/catalog-graph.service.spec.ts \
  src/modules/catalog/products.service.spec.ts
```

- [ ] **Step 5: Rehearse migration fresh and Marketing→Phase1 upgrade**

Verify three nullable columns, no data rewrite, and identical pre/post values for product dimensions, package fields, SKU price/status, inventory, and orders.

- [ ] **Step 6: Commit verified backend contract**

```bash
git add small-house-commerce/backend/prisma \
  small-house-commerce/backend/src/modules/catalog
git commit -m "feat(catalog): add inheritable SKU product dimensions"
```

### Task 3: Verify ProductForm and VariantMatrix dimension editing

**Files:**
- Modify: `frontend/src/lib/admin-product-graph.ts`
- Modify: `frontend/src/components/admin/ProductForm.tsx`, `VariantMatrix.tsx`
- Modify: `frontend/src/i18n/en.ts`, `zh.ts`
- Test: `admin-product-graph.spec.ts`, `ProductForm.spec.tsx`, `VariantMatrix.spec.tsx`.

**Interfaces:**
- Consumes: backend nullable fields and materialized SKU drafts.
- Produces: `applyProductDimensionsToVariants(draft, dimensions, mode): ProductDimensionApplyResult` and per-SKU clear/inherit editing.

- [ ] **Step 1: Add/confirm failing pure bulk-action tests**

```ts
it("fills only empty overrides on materialized sellable SKU rows", () => {
  const draft = graphDraftWithVariants([
    materializedEmpty,
    materializedOverride,
    unmaterialized,
  ]);
  const result = applyProductDimensionsToVariants(
    draft,
    { width: 120, depth: 60, height: 75 },
    "empty-only",
  );
  expect(draft.variants[0].sku).toMatchObject({
    productWidth: 120,
    productDepth: 60,
    productHeight: 75,
  });
  expect(draft.variants[1]).toEqual(materializedOverride);
  expect(draft.variants[2]).toEqual(unmaterialized);
  expect(result).toEqual({ changedCount: 1, skippedCount: 1 });
});
```

Add all-materialized, clear-to-null, stable client key, and no package/price/stock changes.

- [ ] **Step 2: Run graph helper tests**

```bash
pnpm --dir small-house-commerce/frontend exec vitest run src/lib/admin-product-graph.spec.ts
```

Expected: gaps fail semantically; existing correct behavior stays green.

- [ ] **Step 3: Fix only the helper/serialization gaps**

Keep `AdminSkuDraft.productWidth/productDepth/productHeight` nullable and use field-by-field immutable updates. Do not call the existing materialization helper from bulk dimensions.

- [ ] **Step 4: Add/confirm VariantMatrix UI tests**

Test inherited labels, override inputs ordered 长/宽/高, clear action, apply-all/fill-empty counts, package fields remaining separate, narrow-screen local scroll, and disabled save-state integration.

- [ ] **Step 5: Run UI tests and fix only proven gaps**

```bash
pnpm --dir small-house-commerce/frontend exec vitest run \
  src/components/admin/VariantMatrix.spec.tsx \
  src/components/admin/ProductForm.spec.tsx
```

- [ ] **Step 6: Commit**

```bash
git add small-house-commerce/frontend/src/lib/admin-product-graph* \
  small-house-commerce/frontend/src/components/admin/{ProductForm,VariantMatrix}* \
  small-house-commerce/frontend/src/i18n/{en,zh}.ts
git commit -m "feat(admin): edit inherited variant dimensions"
```

### Task 4: Verify deterministic packaging and product-dimension parsing

**Files:**
- Modify: `frontend/src/lib/parse-packaging-input.ts`
- Modify: `frontend/src/lib/parse-packaging-input.spec.ts`
- Create: `frontend/src/components/admin/ProductDimensionsAssist.spec.tsx`
- Modify: `frontend/src/components/admin/ProductDimensionsAssist.tsx`, `SkuPackagingAssist.tsx`
- Modify: `frontend/src/components/admin/SkuPackagingAssist.spec.tsx`

**Interfaces:**
- Consumes: raw text, `PackagingParseMode`, and `PackagingAxisConvention`.
- Produces: `PackagingParseResult { fields, warnings, assumptions, complete }` and confirmation-only patches.

- [ ] **Step 1: Add/confirm parser review-focus tests**

```ts
expect(parsePackagingText("120 x 60 x 75", "dimensions")).toMatchObject({
  fields: { packageWidth: 120, packageDepth: 60, packageHeight: 75 },
  assumptions: ["Assumed cm for a value without a unit."],
});
expect(parsePackagingText("net 4kg gross 5kg", "combined").fields.packageWeight).toBeUndefined();
expect(parsePackagingText("120x60x75x10 cm", "dimensions").fields).toEqual({});
```

Also cover labelled/triplet unit conversion, duplicate axes, unsupported units, nonpositive/NaN/Infinity, comma ambiguity, >10,000 characters, weight-only, and never volumetric weight.

- [ ] **Step 2: Run parser tests and repair only proven gaps**

```bash
pnpm --dir small-house-commerce/frontend exec vitest run src/lib/parse-packaging-input.spec.ts
```

Expected: all required cases pass after minimal fixes. A test that already passes records characterization, not a new change.

- [ ] **Step 3: Add/confirm confirmation-only component tests**

Assert typing/pasting never calls `onApply`; changing input invalidates preview; cancel writes nothing; fill-empty and replace pass exact patches; apply closes preview; unique labels/IDs support multiple SKU rows; disabled form blocks parse/apply.

- [ ] **Step 4: Run component tests and fix only proven gaps**

```bash
pnpm --dir small-house-commerce/frontend exec vitest run \
  src/components/admin/ProductDimensionsAssist.spec.tsx \
  src/components/admin/SkuPackagingAssist.spec.tsx
```

- [ ] **Step 5: Commit**

```bash
git add small-house-commerce/frontend/src/lib/parse-packaging-input* \
  small-house-commerce/frontend/src/components/admin/{ProductDimensionsAssist,SkuPackagingAssist}* \
  small-house-commerce/frontend/src/i18n/{en,zh}.ts
git commit -m "feat(admin): parse and confirm supplier dimensions"
```

### Task 5: Verify selected-variant storefront dimensions and complete browser acceptance

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/components/product/ProductSpecs.tsx`
- Modify: PDP selected-variant presenter only where required.
- Test: `ProductSpecs.spec.tsx`, PDP specs.
- Create: `frontend/e2e/variant-packaging.spec.ts`.

**Interfaces:**
- Consumes: storefront SKU override fields and selected variant.
- Produces: Width/Depth/Height display resolved from selected SKU override then product fallback.

- [ ] **Step 1: Write failing storefront fallback/axis tests**

```tsx
it("renders selected SKU overrides as Width, Depth, Height", () => {
  render(<ProductSpecs product={product} variantDimensions={{
    productWidth: 120,
    productDepth: 60,
    productHeight: 75,
  }} />);
  expect(screen.getByText("Width").nextSibling).toHaveTextContent("120 cm");
  expect(screen.getByText("Depth").nextSibling).toHaveTextContent("60 cm");
  expect(screen.getByText("Height").nextSibling).toHaveTextContent("75 cm");
});
```

Add partial-null fallback and selected-variant switch tests.

- [ ] **Step 2: Run tests to observe RED for any missing integration**

```bash
pnpm --dir small-house-commerce/frontend exec vitest run \
  src/components/product/ProductSpecs.spec.tsx \
  src/components/product/PdpDetails.spec.tsx
```

- [ ] **Step 3: Implement the minimal selected-variant projection**

Use the same null-coalescing order as backend. Do not change storefront label order or historical product fields.

- [ ] **Step 4: Run focused tests to GREEN**

```bash
pnpm --dir small-house-commerce/frontend exec vitest run \
  src/components/product/ProductSpecs.spec.tsx \
  src/components/product/PdpDetails.spec.tsx
```

- [ ] **Step 5: Add real-browser save/reload/PDP coverage**

The E2E must:

1. log in normally;
2. edit one materialized SKU to 120/60/75 through 长/宽/高 controls;
3. parse ambiguous and valid package text, prove no write before confirmation, then confirm;
4. save, reload admin, and verify persisted override/package separation;
5. switch PDP variants and verify Width 120 / Depth 60 / Height 75;
6. clear override, save, change/read parent fallback, and prove inheritance;
7. verify no package, price, stock, option, or SKU count drift.

- [ ] **Step 6: Run browser E2E on owned runtime/schema**

```bash
pnpm --dir small-house-commerce/frontend exec playwright test e2e/variant-packaging.spec.ts --project=chromium
```

Expected: desktop and 390px checks pass; no page errors or root overflow.

- [ ] **Step 7: Commit**

```bash
git add small-house-commerce/frontend/src/lib/api.ts \
  small-house-commerce/frontend/src/components/product \
  small-house-commerce/frontend/e2e/variant-packaging.spec.ts
git commit -m "feat(storefront): resolve selected variant dimensions"
```

### Task 6: Run the Phase 1 full release and self-review gate

**Files:**
- Create: `.superpowers/sdd/2026-10-14-variant-packaging-phase1-release/progress.md`
- Create: `.superpowers/sdd/2026-10-14-variant-packaging-phase1-release/review-package.md`

**Interfaces:**
- Consumes: complete Phase 1 candidate.
- Produces: green `PHASE1_RELEASE_SHA` and proof Bundle may begin only after deployment.

- [ ] **Step 1: Run full suites**

```bash
pnpm --dir small-house-commerce/backend test
pnpm --dir small-house-commerce/frontend test
```

- [ ] **Step 2: Run types, lint, Prisma, builds, and diff checks**

```bash
pnpm --dir small-house-commerce/backend exec tsc --noEmit
pnpm --dir small-house-commerce/frontend exec tsc --noEmit
pnpm --dir small-house-commerce/backend lint
pnpm --dir small-house-commerce/frontend lint
pnpm --dir small-house-commerce/backend exec prisma validate
pnpm --dir small-house-commerce/backend exec prisma generate
pnpm --dir small-house-commerce/backend build
pnpm --dir small-house-commerce/frontend build
git diff --check "$MARKETING_SHA"..HEAD
```

Expected: exit 0 and all warnings classified.

- [ ] **Step 3: Rehearse fresh and Marketing→Phase1 upgrades**

Verify exactly three nullable SKU columns, no data rewrite, no Bundle columns/table, and all pre/post commerce hashes except schema metadata identical.

- [ ] **Step 4: Perform exact-manifest self-review**

Review the full candidate against Phase 1 spec and five Review Focus cases. Record no Agent reviewer due user constraint. Fix Critical/Important once via RED → GREEN; ledger Minors.

- [ ] **Step 5: Finalize release SHA**

```bash
git status --short
git commit --allow-empty -m "chore(catalog): finalize dimensions release gate"
PHASE1_RELEASE_SHA=$(git rev-parse HEAD)
```

### Task 7: Push, deploy, and verify Phase 1 production

**Files:**
- Create: `.superpowers/release-four-lines-20261014/evidence/wave-3-variant-packaging-production.md`
- Update after success: dimension preference/project and production handoff memories.

**Interfaces:**
- Consumes: green `PHASE1_RELEASE_SHA`.
- Produces: deployed Phase 1 baseline consumed by Bundle.

- [ ] **Step 1: Back up DB, verify restore list/checksum, tag rollback images, and capture invariants**

Capture existing SKU/package/dimension/inventory/order facts for representative products, hotfix checksum, fail-closed email state, image digests, and restart counts.

- [ ] **Step 2: Push fast-forward through proxy**

```bash
git -c http.proxy=http://127.0.0.1:7897 \
    -c https.proxy=http://127.0.0.1:7897 \
    push origin HEAD:main
```

- [ ] **Step 3: Fast-forward production, generate, build, migrate, and recreate backend/frontend only**

```bash
ssh smallhouse-prod 'set -eu
  cd /opt/small-house-commerce/small-house-commerce
  git -c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897 fetch origin main
  git merge --ff-only FETCH_HEAD
  docker compose --env-file .env.deploy -f docker-compose.prod.yml build backend frontend
  docker run --rm --entrypoint sh small-house-prod-backend -lc '\''test -f /app/src/generated/prisma/client.ts'\''
  docker compose --env-file .env.deploy -f docker-compose.prod.yml up -d backend frontend
'
```

- [ ] **Step 4: Run production acceptance**

Verify columns/migration, unchanged existing data, admin route contracts, representative fallback/override reads without destructive writes, public PDP response, all prior FAQ/Marketing/Homepage/Shell behavior, ordinary checkout/inventory, Back-in-stock fail-closed, Newsletter, reviews hotfix, logs, health, and restart counts. Confirm Bundle schema/API remains absent.

- [ ] **Step 5: Record the deployment and update the master baseline**

Document SHA, migrations, images, backup/checksum, rollback tags, test/browser evidence, production smokes, and unchanged invariants. Mark Phase 1 deployed before allowing the Bundle plan to start.
