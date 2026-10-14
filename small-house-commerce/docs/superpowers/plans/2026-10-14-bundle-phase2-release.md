# SKU Bundle Inventory Phase 2 Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not dispatch new Agent or Workflow runs.

**Goal:** Complete and verify sellable SKU-level Bundles whose availability, reservations, edits, cancellation, merge, shipment, snapshots, and reference protection are derived transactionally from ordinary component SKUs, then stop for an explicit production risk decision before deployment.

**Architecture:** A Bundle is an ordinary Product with a virtual `Sku.isBundle`; ordered `SkuBundleComponent` rows bind it to active ordinary component SKUs. Storefront/cart compute derived availability, while order transactions expand and aggregate component requirements and persist immutable `OrderItem.bundleSnapshot` JSON. Virtual SKUs never own physical inventory; all movements target components.

**Tech Stack:** NestJS 12, Prisma 7.10.0, PostgreSQL 18 row locking/transactions, Next.js 16.3.4, React 19.2.8, TypeScript, Zod, Vitest, Supertest/E2E, Playwright/Chromium.

**Spec:** `small-house-commerce/docs/superpowers/specs/2026-10-14-four-line-closeout-staged-release-design.md`; Phase 2 contract in `2026-10-09-variant-packaging-bundle-design.md`; detailed prior plan in `2026-10-09-bundle-inventory-phase2.md`.

## Global Constraints

- Start only after Phase 1 is deployed and verified; branch from the exact deployed `PHASE1_SHA`.
- Import no unfinished FAQ, Marketing, Homepage, Product Workbench, or non-Bundle dimension changes.
- Preserve ordinary SKU cart, checkout, risk, duplicate-order, confirmation, cancellation, merge, shipment, Back-in-stock, Newsletter, and inventory behavior.
- Bundle customer lines remain one visible order item; component identities/quantities are internal snapshots and never become separate customer charges.
- `Sku.isBundle=true` is immutable for an existing SKU; changing inventory mode requires a new SKU.
- Bundle components must be distinct active ordinary SKUs from active products; self, nested, cyclic, missing, disabled, deleted, duplicate, zero/negative, or oversized definitions fail closed.
- Virtual Bundle SKUs never receive inventory rows or direct stock writes. Physical reservations/movements target ordinary components only.
- Use one transaction, deterministic lock order, aggregated component requirements, and conditional inventory updates for checkout/edit/merge/cancel/ship.
- Historical order behavior uses immutable snapshots even after the current Bundle definition changes.
- Shared files (`catalog.prisma`, `order.prisma`, graph/catalog/inventory/cart/orders services, ProductForm, VariantMatrix, APIs, i18n) receive reviewed semantic hunks only.
- Every discovered defect follows RED → GREEN. Full regression, PostgreSQL concurrency, E2E, real browser, migration rehearsal, and exact-manifest self-review are mandatory.
- Production deployment is blocked until the user explicitly approves the completed inventory/order risk packet.

## Review Focus

1. **Two Bundle lines and one ordinary line share the same component:** Task 4 tests one aggregated reservation and exact release/ship quantities.
2. **The Bundle definition changes after checkout:** Task 4 tests edit/merge/cancel/ship use the saved snapshot, not the current catalog definition.
3. **Checkout races with definition edit or another checkout:** Tasks 3/4 test deterministic locks, no mixed definition, and no oversell.
4. **A shipment/cancellation/merge is submitted concurrently twice:** Task 4 tests exactly one transition/movement succeeds and the loser observes the locked current state.
5. **Back-in-stock or admin stock code receives a virtual SKU:** Task 5 tests hard rejection and no subscription/movement/inventory-row side effect.

---

### Task 1: Assemble the Bundle-only candidate and append-only migration

**Files:**
- Create: `.superpowers/release-four-lines-20261014/manifests/bundle-files.txt`
- Create: `.superpowers/release-four-lines-20261014/manifests/bundle-source-sha256.tsv`
- Create: `.superpowers/release-four-lines-20261014/manifests/bundle-shared-hunks.md`
- Create: `.superpowers/release-four-lines-20261014/manifests/bundle-migration-map.tsv`
- Exclusive source: `bundles.controller.ts`, `bundles.service.ts`, `dto/bundle.dto.ts`, `inventory/bundle-inventory.ts`, `BundleComponentsEditor.tsx`, `admin-bundle.ts`, and all Bundle tests.
- Shared hunks: Prisma catalog/order schemas; catalog graph/module/services; inventory/cart/orders services/controllers/DTOs; ProductForm/VariantMatrix/inventory page; admin APIs/types/i18n.

**Interfaces:**
- Consumes: deployed Phase 1 baseline and read-only partial Bundle implementation.
- Produces: isolated candidate with one normalized Bundle migration and a closed manifest.

- [ ] **Step 1: Create the branch from deployed Phase 1**

```bash
PHASE1_SHA=$(awk -F= '$1=="PHASE1_SHA" {print $2}' ../evidence/release-b-baseline.txt)
test -n "$PHASE1_SHA"
git checkout -b release/bundle-phase2 "$PHASE1_SHA"
mkdir -p ../manifests ../evidence/bundle
```

Expected: exact deployed Phase 1 base.

- [ ] **Step 2: Write the Bundle manifest before import**

Mark paths `EXCLUSIVE`, `SHARED_HUNK`, `MIGRATION_REPLACED`, `TEST`, or `E2E`. For each shared file, record the exact imported Bundle symbols. Explicitly deny unrelated source-tree hunks in Marketing attribution, Newsletter promotions, Back-in-stock, FAQ, Homepage, Product Card media, dimensions/parser, reviews, and Storefront Shell.

- [ ] **Step 3: Hash/copy exclusive files and surgically apply shared hunks**

Required shared-hunk inventory includes:

```text
catalog.prisma: Sku.isBundle, bundleVersion, SkuBundleComponent relations only
order.prisma: OrderItem.bundleSnapshot only
catalog graph: virtual marker immutability, component reference count, publish validation only
inventory: derived availability, virtual stock rejection, component requirement operations only
cart: derived/aggregated availability only
orders: snapshot expansion and component reservation/release/edit/merge/ship only
ProductForm/VariantMatrix: virtual marker and Bundle editor/save sequencing only
admin-api/i18n/inventory page: Bundle contracts/copy only
```

Do not copy whole shared files from the dirty tree.

- [ ] **Step 4: Normalize the unreleased Bundle migration**

Replace `20261013100000_add_sku_bundles` with a name after the Phase 1 baseline latest migration. Preserve:

```sql
ALTER TABLE skus ADD is_bundle BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE skus ADD bundle_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD bundle_snapshot JSONB;
CREATE TABLE sku_bundle_components (...);
```

Keep quantity/position/self checks, unique `(bundle_sku_id, component_sku_id)`, component index, Bundle-owner cascade, and component RESTRICT. Record old/new name and SQL SHA-256.

- [ ] **Step 5: Verify manifest closure and baseline preservation**

```bash
git diff --name-only "$PHASE1_SHA" -- | sort > ../evidence/bundle/actual-files.txt
cut -f2 ../manifests/bundle-files.txt | sort -u > ../evidence/bundle/allowed-files.txt
comm -23 ../evidence/bundle/actual-files.txt ../evidence/bundle/allowed-files.txt
```

Expected: no unexpected path. Compare all shared-file non-Bundle hunks with `PHASE1_SHA` and prove they remain unchanged.

- [ ] **Step 6: Run imported Bundle focused tests as an audit baseline**

```bash
pnpm --dir small-house-commerce/backend exec vitest run \
  src/modules/catalog/bundles.service.spec.ts \
  src/modules/catalog/dto/bundle.dto.spec.ts \
  src/modules/inventory/bundle-inventory.spec.ts \
  src/modules/catalog/admin/bundles.controller.spec.ts
pnpm --dir small-house-commerce/frontend exec vitest run \
  src/lib/admin-bundle.spec.ts \
  src/components/admin/BundleComponentsEditor.spec.tsx
```

Expected: existing partial behavior is measured honestly. Failures are diagnosed; no completion claim follows from these focused files alone.

- [ ] **Step 7: Commit isolated assembly**

```bash
git add -- $(cut -f2 ../manifests/bundle-files.txt)
git commit -m "feat(bundle): assemble virtual SKU bundle foundation"
```

### Task 2: Complete persistence, validation, admin API, and editor

**Files:**
- Modify: Prisma schemas/migration.
- Modify: `backend/src/modules/catalog/dto/bundle.dto.ts`, `bundles.service.ts`, `admin/bundles.controller.ts`, `catalog.module.ts`.
- Modify: `frontend/src/lib/admin-bundle.ts`, `admin-api.ts`, `BundleComponentsEditor.tsx`, `ProductForm.tsx`, `VariantMatrix.tsx`, product edit page, i18n.
- Create: `frontend/src/components/admin/ProductForm.bundle.spec.tsx`
- Test: DTO/service/controller/editor/VariantMatrix specs.

**Interfaces:**
- Consumes: Phase 1 materialized SKU identities and catalog graph version.
- Produces: `GET/PUT /admin/products/:productId/bundles/:skuId`, component search, `AdminBundleEditorDraft`, and Bundle definition CAS.

- [ ] **Step 1: Add/confirm failing validation/CAS tests**

```ts
it.each([
  ["self", [{ componentSkuId: bundleSkuId, quantity: 1, position: 0 }]],
  ["nested", [{ componentSkuId: anotherBundleId, quantity: 1, position: 0 }]],
  ["duplicate", duplicateComponents],
  ["zero", [{ componentSkuId, quantity: 0, position: 0 }]],
])("rejects %s component definitions", async (_name, components) => {
  await expect(service.setComponents(productId, bundleSkuId, {
    expectedVersion: 0,
    components,
  })).rejects.toThrow();
});
```

Also test missing/disabled component, wrong owner product, stale version, 1–20 components, quantity 1–1000, ordered output, no write on failure, and search excluding Bundles/inactive SKUs.

- [ ] **Step 2: Run backend focused tests and fix only uncovered gaps**

```bash
pnpm --dir small-house-commerce/backend exec vitest run \
  src/modules/catalog/dto/bundle.dto.spec.ts \
  src/modules/catalog/bundles.service.spec.ts \
  src/modules/catalog/admin/bundles.controller.spec.ts
```

Required CAS remains `updateMany({ id, isBundle: true, bundleVersion: expectedVersion })` inside the replace transaction. Validate all component IDs before increment/delete/create.

- [ ] **Step 3: Add/confirm frontend serialization/editor tests**

Test unique exact SKU identity, integer quantity, deterministic position, derived availability, search, add/remove/reorder, stale conflict/reload, disabled save, no component internals in product payload, and virtual stock controls hidden/disabled.

- [ ] **Step 4: Run frontend focused tests and fix gaps**

```bash
pnpm --dir small-house-commerce/frontend exec vitest run \
  src/lib/admin-bundle.spec.ts \
  src/components/admin/BundleComponentsEditor.spec.tsx \
  src/components/admin/ProductForm.bundle.spec.tsx \
  src/components/admin/VariantMatrix.spec.tsx
```

Product save sequencing must persist/materialize graph identity first, then PUT components with the real persisted Bundle SKU ID/version. A failed component save must produce a visible partial-result state; it must not claim the whole form saved.

- [ ] **Step 5: Rehearse the migration fresh and Phase1→Bundle**

Verify defaults, checks, unique/index/FKs, no initial Bundle rows, no rewrites of existing SKUs/order items, and generated client fields/relations.

- [ ] **Step 6: Commit**

```bash
git add small-house-commerce/backend/prisma \
  small-house-commerce/backend/src/modules/catalog \
  small-house-commerce/frontend/src/lib/{admin-api,admin-bundle}* \
  small-house-commerce/frontend/src/components/admin/{BundleComponentsEditor,ProductForm,VariantMatrix}* \
  small-house-commerce/frontend/src/i18n/{en,zh}.ts
git commit -m "feat(bundle): add validated definitions and admin editor"
```

### Task 3: Complete derived availability and cart validation

**Files:**
- Modify: `backend/src/modules/inventory/bundle-inventory.ts`, `inventory.service.ts`.
- Modify: `backend/src/modules/catalog/products.service.ts` and storefront product projection.
- Modify: `backend/src/modules/cart/cart.service.ts`.
- Test: bundle-inventory, inventory, products, cart specs.

**Interfaces:**
- Consumes: persisted component rows and ordinary `available = onHand - reserved` facts.
- Produces: `getBundleAvailabilityForSkus`, `computeBundleAvailability`, `aggregateRequirements`, and fail-closed public/cart availability.

- [ ] **Step 1: Add/confirm limiting-component and fail-closed tests**

```ts
expect(computeBundleAvailability([
  activeComponent({ availableInventory: 10, quantity: 2 }),
  activeComponent({ availableInventory: 5, quantity: 1 }),
])).toBe(5);

expect(computeBundleAvailability([
  activeComponent({ availableInventory: 10, quantity: 2, isBundle: true }),
])).toBe(0);
```

Cover empty, disabled SKU/product, nonpositive quantity, negative available, nested Bundle, multiple warehouses, and floor behavior.

- [ ] **Step 2: Add aggregated cart-demand tests**

```ts
it("flags shared demand across two Bundles and one ordinary line", async () => {
  const cart = await service.getCart(cartId);
  expect(cart.invalidSkuIds).toContain(sharedComponentSkuId);
  expect(cart.items.filter((item) => item.available === false)).toHaveLength(3);
});
```

Test Bundle line remains one row, derived available quantity is exposed, component internals are not public, and empty/invalid definition is unavailable.

- [ ] **Step 3: Run focused tests**

```bash
pnpm --dir small-house-commerce/backend exec vitest run \
  src/modules/inventory/bundle-inventory.spec.ts \
  src/modules/inventory/inventory.service.spec.ts \
  src/modules/catalog/products.service.spec.ts \
  src/modules/cart/cart.service.spec.ts
```

- [ ] **Step 4: Fix only proven availability/cart gaps**

Use one component query for requested Bundle IDs; compute ordinary facts from inventory aggregates; aggregate cart requirements across every line before declaring validity. Never create virtual inventory rows.

- [ ] **Step 5: Re-run focused tests to GREEN and commit**

```bash
pnpm --dir small-house-commerce/backend exec vitest run \
  src/modules/inventory/bundle-inventory.spec.ts \
  src/modules/inventory/inventory.service.spec.ts \
  src/modules/catalog/products.service.spec.ts \
  src/modules/cart/cart.service.spec.ts
git add small-house-commerce/backend/src/modules/{inventory,catalog,cart}
git commit -m "feat(bundle): derive availability from components"
```

### Task 4: Complete transactional checkout, edit, merge, cancellation, and shipment

**Files:**
- Modify: `backend/src/modules/inventory/bundle-inventory.ts`, `inventory.service.ts`.
- Modify: `backend/src/modules/orders/orders.service.ts`, `order-item-snapshot.ts`, DTO/controller projections as required.
- Test: order/inventory specs and `backend/test/bundle.e2e-spec.ts`.

**Interfaces:**
- Consumes: `expandBundleRequirements`, `aggregateRequirements`, `requirementsFromBundleSnapshot`, inventory reserve/release/ship helpers, and order row locks.
- Produces: atomic component movements and immutable version-1 Bundle snapshots.

- [ ] **Step 1: Add/confirm snapshot and aggregate requirement tests**

```ts
const requirements = aggregateRequirements([
  { skuId: "chair", quantity: 2 },
  { skuId: "chair", quantity: 3 },
  { skuId: "table", quantity: 1 },
]);
expect(requirements).toEqual([
  { skuId: "chair", quantity: 5 },
  { skuId: "table", quantity: 1 },
]);
```

Assert snapshot includes component ID, quantity per Bundle, total ordered quantity, position, SKU code, product name, variant name, and schema version; no live price/inventory fields.

- [ ] **Step 2: Add/confirm checkout concurrency tests on real PostgreSQL**

Use two simultaneous transactions for the final component stock. Assert exactly one order succeeds, one fails safely, component `reserved` equals the winner's aggregate requirement, virtual SKU has no inventory/reservation/movement, and no partial order remains.

- [ ] **Step 3: Add/confirm lifecycle tests using saved definitions**

Cover:

```text
quantity increase/decrease
line removal/addition
multiple historical lines with same Bundle SKU
merge with ordinary and Bundle lines
cancel once and concurrent cancel
ship partial/full and concurrent duplicate shipment
confirmation versus cancellation race
definition edit after checkout
ordinary component plus Bundle overlap
transaction rollback after one component reserve fails
```

For every case assert order lines, reservations, movements, inventory, status history, totals, and snapshots.

- [ ] **Step 4: Run order/inventory/E2E tests to expose gaps**

```bash
pnpm --dir small-house-commerce/backend exec vitest run \
  src/modules/orders/orders.service.spec.ts \
  src/modules/inventory/inventory.service.spec.ts \
  test/bundle.e2e-spec.ts
```

Expected: failures identify missing lifecycle integration, not fixture/schema errors.

- [ ] **Step 5: Implement minimal transactional fixes**

Required ordering:

```text
lock order/current definition rows deterministically
expand every line
aggregate by component SKU
conditionally reserve/release/ship ordinary component rows
write customer-visible order items plus immutable snapshots
write status/movement history
commit once
```

Edits of existing Bundle lines use their saved snapshot; new Bundle lines use the current locked definition. Merge must not collapse lines with different snapshots.

- [ ] **Step 6: Re-run focused and E2E tests to GREEN**

```bash
pnpm --dir small-house-commerce/backend exec vitest run \
  src/modules/orders \
  src/modules/inventory \
  test/bundle.e2e-spec.ts
```

- [ ] **Step 7: Commit**

```bash
git add small-house-commerce/backend/src/modules/{orders,inventory} \
  small-house-commerce/backend/test/bundle.e2e-spec.ts
git commit -m "feat(bundle): transact component inventory through order lifecycle"
```

### Task 5: Complete graph references, virtual-stock guards, and side-effect isolation

**Files:**
- Modify: `backend/src/modules/catalog/catalog-graph.service.ts` and snapshot/reference logic.
- Modify: inventory admin controller/page and product readiness/attention code only where Bundle state is displayed.
- Test: graph/inventory attention specs, Back-in-stock inventory specs.

**Interfaces:**
- Consumes: `componentOfBundles`, order snapshots/history, `Sku.isBundle`, ordinary stock adjustment and Back-in-stock hooks.
- Produces: deletion/reference protection and zero virtual-stock side effects.

- [ ] **Step 1: Write/confirm graph reference tests**

Assert a component SKU referenced by `SkuBundleComponent` is reported by `hasReferences` and cannot be retired/deleted; a Bundle-owner deletion cascades only its definition rows; an order snapshot remains independent of later catalog deletion attempts.

- [ ] **Step 2: Write virtual stock/Back-in-stock tests**

```ts
it("rejects a virtual Bundle stock adjustment before inventory or notification side effects", async () => {
  await expect(service.setOnHand(bundleSkuId, 10, undefined, actorId))
    .rejects.toThrow(/Virtual Bundle stock/i);
  expect(rows.size).toBe(0);
  expect(backInStock.snapshotForChangedSkusWithin).not.toHaveBeenCalled();
  expect(backInStock.claimTransitionsWithin).not.toHaveBeenCalled();
});
```

Also test bulk stock, inventory page controls, manual movement, and notification snapshots exclude virtual rows.

- [ ] **Step 3: Run focused protection tests**

```bash
pnpm --dir small-house-commerce/backend exec vitest run \
  src/modules/catalog/catalog-graph.service.spec.ts \
  src/modules/inventory/inventory.service.spec.ts \
  src/modules/newsletter/back-in-stock.inventory.spec.ts \
  src/modules/orders/orders.service.back-in-stock.spec.ts
pnpm --dir small-house-commerce/frontend exec vitest run \
  'src/app/admin/(shell)/inventory/page.spec.tsx' \
  src/components/admin/VariantMatrix.spec.tsx
```

- [ ] **Step 4: Implement minimal guards and readable admin state**

Reject virtual writes before any transaction side effect. Include component references in the existing reference count/issue rail. UI labels stock as component-derived and removes editable physical-stock controls.

- [ ] **Step 5: Re-run tests to GREEN and commit**

```bash
pnpm --dir small-house-commerce/backend exec vitest run \
  src/modules/catalog/catalog-graph.service.spec.ts \
  src/modules/inventory/inventory.service.spec.ts \
  src/modules/newsletter/back-in-stock.inventory.spec.ts \
  src/modules/orders/orders.service.back-in-stock.spec.ts
pnpm --dir small-house-commerce/frontend exec vitest run \
  'src/app/admin/(shell)/inventory/page.spec.tsx' \
  src/components/admin/VariantMatrix.spec.tsx
git add small-house-commerce/backend/src/modules/{catalog,inventory,newsletter,orders} \
  'small-house-commerce/frontend/src/app/admin/(shell)/inventory' \
  small-house-commerce/frontend/src/components/admin/VariantMatrix*
git commit -m "fix(bundle): protect component references and virtual stock"
```

### Task 6: Run full Bundle release, browser, migration, and self-review gates

**Files:**
- Create: `frontend/e2e/bundle.spec.ts`
- Create: `.superpowers/sdd/2026-10-14-bundle-phase2-release/progress.md`
- Create: `.superpowers/sdd/2026-10-14-bundle-phase2-release/review-package.md`

**Interfaces:**
- Consumes: complete Bundle candidate.
- Produces: green `BUNDLE_RELEASE_SHA`; no production deployment.

- [ ] **Step 1: Add real-browser Bundle flow**

The E2E must use isolated tagged fixtures and cover:

1. create/edit a virtual Bundle SKU and search exact component SKUs;
2. quantity/order/CAS conflict/reload and derived availability;
3. admin inventory shows component-derived stock and no editable stock;
4. public PDP exposes Bundle price/availability but not component internals;
5. cart keeps one Bundle row and blocks aggregate shared-component shortfall;
6. checkout creates one visible line and component reservations;
7. admin cancel/reload returns exact component reservations;
8. mobile 390px and desktop layout, keyboard editor controls, no page errors;
9. cleanup only tagged unshipped fixtures after assertions.

- [ ] **Step 2: Run focused PostgreSQL/E2E/browser gates**

```bash
pnpm --dir small-house-commerce/backend exec vitest run test/bundle.e2e-spec.ts
pnpm --dir small-house-commerce/frontend exec playwright test e2e/bundle.spec.ts --project=chromium
```

Expected: all Bundle and ordinary-control scenarios pass.

- [ ] **Step 3: Run full suites**

```bash
pnpm --dir small-house-commerce/backend test
pnpm --dir small-house-commerce/frontend test
```

- [ ] **Step 4: Run type, lint, Prisma, build, and diff gates**

```bash
pnpm --dir small-house-commerce/backend exec tsc --noEmit
pnpm --dir small-house-commerce/frontend exec tsc --noEmit
pnpm --dir small-house-commerce/backend lint
pnpm --dir small-house-commerce/frontend lint
pnpm --dir small-house-commerce/backend exec prisma validate
pnpm --dir small-house-commerce/backend exec prisma generate
pnpm --dir small-house-commerce/backend build
pnpm --dir small-house-commerce/frontend build
git diff --check "$PHASE1_SHA"..HEAD
```

Expected: exit 0; every warning classified.

- [ ] **Step 5: Rehearse fresh and Phase1→Bundle migrations**

Verify schema checks/FKs/indexes/defaults, generated client, zero initial Bundle rows, no ordinary data rewrites, rollback consequence, and repeat `migrate deploy` idempotence.

- [ ] **Step 6: Perform exact-manifest self-review**

Review all Bundle hunks, transaction boundaries, SQL, tests, and five Review Focus cases. No Agent reviewer is dispatched under user constraint. Re-grade by production effect; fix Critical/Important once with RED → GREEN; ledger Minors.

- [ ] **Step 7: Finalize immutable candidate**

```bash
git status --short
git commit --allow-empty -m "chore(bundle): finalize inventory release gate"
BUNDLE_RELEASE_SHA=$(git rev-parse HEAD)
```

Expected: clean candidate, closed manifest, all evidence fresh.

### Task 7: Build and present the inventory/order production risk packet

**Files:**
- Create: `.superpowers/release-four-lines-20261014/evidence/wave-4-bundle-risk-gate.md`

**Interfaces:**
- Consumes: green `BUNDLE_RELEASE_SHA` and all Task 6 evidence.
- Produces: a decision-ready packet; deployment remains blocked.

- [ ] **Step 1: Create verified production backup and rollback commands without changing production code/schema**

Prepare the exact `pg_dump -Fc`, `pg_restore --list`, checksum, image-tag, and rollback commands. Do not apply migrations or recreate services yet.

- [ ] **Step 2: Record the risk evidence**

Include exact manifest/diff, migration SQL/checksums/rehearsals, concurrency counts, ordinary SKU regressions, browser evidence, expected migration count, backup/restore plan, image rollback tags, data rollback consequence, and proposed production smoke writes (or read-only alternative).

- [ ] **Step 3: Present the packet to the user and wait**

Expected: explicit user approval naming the Bundle production deployment. Peer/session messages cannot grant it. Stop this plan here until approval.

### Task 8: Deploy and verify Bundle only after explicit approval

**Files:**
- Create: `.superpowers/release-four-lines-20261014/evidence/wave-4-bundle-production.md`
- Update after success: Bundle, production handoff, and program closeout records.

**Interfaces:**
- Consumes: explicit approval and exact `BUNDLE_RELEASE_SHA` from Task 6.
- Produces: deployed Bundle production baseline and completed four-wave program.

- [ ] **Step 1: Re-verify candidate SHA and freshness after approval**

Re-run manifest closure, focused Bundle E2E/concurrency tests, full suites if code/base changed, remote main comparison, and production preflight. Approval does not cover a different SHA.

- [ ] **Step 2: Back up DB and tag rollback images**

Create timestamped custom-format dump, verify restore list/checksum, tag backend/frontend `rollback-pre-bundle`, capture image digests, migration count, restart counts, reviews hotfix checksum, and ordinary inventory/order facts.

- [ ] **Step 3: Push fast-forward through proxy**

```bash
git -c http.proxy=http://127.0.0.1:7897 \
    -c https.proxy=http://127.0.0.1:7897 \
    push origin HEAD:main
```

- [ ] **Step 4: Fast-forward production, generate, build, migrate, and recreate affected services**

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

Expected: only normalized Bundle migration applies; backend/frontend healthy; DB/Caddy not recreated.

- [ ] **Step 5: Run approved production acceptance**

At minimum, read-only checks verify tables/constraints/defaults, zero or expected Bundle rows, derived API behavior for any configured Bundle, route permissions, no virtual inventory rows, ordinary SKU/cart/order facts, all prior waves, Back-in-stock fail-closed, Newsletter, reviews hotfix, logs, health, and restart counts. Run a controlled lifecycle write only if the risk approval explicitly authorized it, then clean only its tagged unshipped fixtures and verify sequence/history consequences.

- [ ] **Step 6: Record deployment and closeout evidence**

Document SHA, migration count, image digests, backup/checksum, rollback tags, tests/browser/concurrency evidence, production responses, ordinary invariants, and any retained data. Update existing memories without duplicates and mark deferred coupon/fulfilment/R2/Highlights work accurately.
