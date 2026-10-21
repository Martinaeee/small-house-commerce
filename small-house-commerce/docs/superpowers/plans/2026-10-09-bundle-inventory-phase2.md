# SKU Bundle Inventory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add SKU-level virtual Bundles whose component-derived availability, reservations, shipment movements, historical snapshots, and deletion protection remain correct under catalog edits and concurrent checkout.

**Architecture:** A Bundle is represented by an ordinary catalog Product with one or more `Sku.isBundle` virtual SKUs. `SkuBundleComponent` binds each virtual SKU to concrete ordinary component SKUs and quantities. Storefront availability and order flows expand Bundle lines into component requirements in the same transaction; the cart and customer-facing OrderItem retain the Bundle SKU while a versioned component snapshot preserves historical behavior.

**Tech Stack:** NestJS, Prisma 7, PostgreSQL, Zod, Next.js App Router, React 19, TypeScript, Vitest, React Testing Library, Playwright.

**Spec:** [2026-10-09-variant-packaging-bundle-design.md](../specs/2026-10-09-variant-packaging-bundle-design.md)

**Prerequisite plan:** [2026-10-09-variant-packaging-phase1.md](./2026-10-09-variant-packaging-phase1.md) must be complete and locally reviewed before this plan starts. Phase 2 does not modify or bypass the Phase 1 save contract.

## Global Constraints

- Components are concrete ordinary SKUs, never only Products or ProductVariants.
- Bundle SKUs are virtual and never receive ordinary Inventory rows or ordinary `setStock` writes.
- V1 rejects self-reference, nested Bundles, duplicate components, disabled components, missing components, and cross-product components.
- Availability is `min(floor(componentAvailable / requiredQuantity))` across components.
- Checkout, edit-order, cancellation, and shipment use the component expansion and one transaction; no operation reserves the virtual Bundle SKU.
- Order history uses a component snapshot and never re-reads a changed Bundle definition.
- Bundle component references participate in catalog graph `hasReferences`/delete/rebuild protection.
- Do not alter `backend/uploads/`, FAQ/PDP/media/homepage work, or unrelated uncommitted files.
- Do not change ports 3000/3001, production data, or deployment configuration.
- Do not push, merge, create a PR, or deploy; implementation stops at the local review gate.

## Review Focus

1. **Concurrent aggregate reservation:** two Bundle lines or two simultaneous checkouts that consume the same component must not oversell — test the aggregated requirement inside one transaction in Task 4.
2. **Historical definition changes:** editing component quantity after an order must not alter cancellation or shipment behavior — test the snapshot in Task 4.
3. **Virtual SKU leakage:** a Bundle SKU must not be stock-set, reserved, or consumed as an ordinary inventory row — test Tasks 1, 3, and 4.
4. **Reference/deletion protection:** a component referenced by a Bundle must not be removed or silently remapped by graph reconciliation — test Task 5.
5. **Availability edge cases:** zero/disabled/missing components and insufficient stock must fail closed and never expose a positive Bundle availability — test Task 3.

## File Map

**Persistence and Bundle contract**

- Create: `small-house-commerce/backend/prisma/migrations/20261013100000_add_sku_bundles/migration.sql` — `is_bundle`, component relation, and order-line snapshot tables/constraints.
- Modify: `small-house-commerce/backend/prisma/schema/catalog.prisma` — `Sku.isBundle`, `SkuBundleComponent`, and named SKU relations.
- Modify: `small-house-commerce/backend/prisma/schema/order.prisma` — `OrderItemBundleComponent` snapshot relation.
- Modify: `small-house-commerce/backend/src/modules/catalog/dto/catalog-graph.dto.ts` — virtual SKU and component input validation.
- Create: `small-house-commerce/backend/src/modules/catalog/dto/bundle.dto.ts` — admin component read/write DTOs.
- Create: `small-house-commerce/backend/src/modules/catalog/bundles.service.ts` — component validation, save, graph/reference helpers.
- Create: `small-house-commerce/backend/src/modules/catalog/admin/bundles.controller.ts` — authenticated admin component endpoints.
- Modify: `small-house-commerce/backend/src/modules/catalog/catalog.module.ts` — register the service/controller.
- Test: `small-house-commerce/backend/src/modules/catalog/bundles.service.spec.ts`.
- Test: `small-house-commerce/backend/src/modules/catalog/dto/bundle.dto.spec.ts`.

**Admin graph and editor**

- Modify: `small-house-commerce/frontend/src/lib/admin-api.ts` — Bundle SKU and component response types.
- Create: `small-house-commerce/frontend/src/lib/admin-bundle.ts` — draft normalization and component diff helpers.
- Create: `small-house-commerce/frontend/src/components/admin/BundleComponentsEditor.tsx` — component SKU picker, quantities, ordering, and availability.
- Modify: `small-house-commerce/frontend/src/components/admin/ProductForm.tsx` — virtual SKU gating and Bundle save orchestration.
- Modify: `small-house-commerce/frontend/src/app/admin/(shell)/products/[id]/edit/page.tsx` — load/save Bundle components after graph identity exists.
- Modify: `small-house-commerce/frontend/src/i18n/en.ts` and `zh.ts` — Bundle admin copy and errors.
- Test: `small-house-commerce/frontend/src/lib/admin-bundle.spec.ts`.
- Test: `small-house-commerce/frontend/src/components/admin/BundleComponentsEditor.spec.tsx`.
- Test: `small-house-commerce/frontend/src/components/admin/ProductForm.bundle.spec.tsx`.

**Availability and stock flow**

- Modify: `small-house-commerce/backend/src/modules/inventory/inventory.service.ts` — component availability and virtual SKU guards.
- Modify: `small-house-commerce/backend/src/modules/inventory/admin/inventory.controller.ts` — reject virtual Bundle stock writes.
- Modify: `small-house-commerce/backend/src/modules/catalog/products.service.ts` — public Bundle SKU availability.
- Modify: `small-house-commerce/backend/src/modules/catalog/storefront/products.controller.ts` — expose the same `availableInventory` contract.
- Modify: `small-house-commerce/backend/src/modules/cart/cart.service.ts` — validate Bundle availability without creating virtual inventory.
- Modify: `small-house-commerce/backend/src/modules/orders/orders.service.ts` — expand, reserve, release, edit, and ship component requirements.
- Modify: `small-house-commerce/backend/src/modules/orders/order-item-snapshot.ts` — snapshot component display data.
- Modify: `small-house-commerce/backend/src/modules/orders/admin/orders.controller.ts` and DTOs if admin edit/order response needs component details.
- Test: `small-house-commerce/backend/src/modules/inventory/inventory.service.spec.ts`.
- Test: `small-house-commerce/backend/src/modules/cart/cart.service.spec.ts`.
- Test: `small-house-commerce/backend/src/modules/orders/orders.service.spec.ts`.
- Test: `small-house-commerce/backend/src/modules/orders/order-item-snapshot.spec.ts`.

## Interfaces

The following names and shapes are the shared contract between tasks:

```ts
export interface BundleComponentInput {
  componentSkuId: string;
  quantity: number;
  position: number;
}

export interface BundleComponentView extends BundleComponentInput {
  id: string;
  componentSkuCode: string;
  componentProductName: string;
  componentVariantName: string;
  availableInventory: number;
}

export interface InventoryRequirement {
  skuId: string;
  quantity: number;
}

export interface BundleExpansion {
  bundleSkuId: string;
  bundleQuantity: number;
  requirements: InventoryRequirement[];
  components: Array<{
    componentSkuId: string;
    quantityPerBundle: number;
    totalQuantity: number;
    position: number;
  }>;
}

export async function expandBundleRequirements(
  skuId: string,
  quantity: number,
  tx: Prisma.TransactionClient,
): Promise<BundleExpansion>;

export async function getAvailableInventoryForSku(
  skuId: string,
  tx?: Prisma.TransactionClient,
): Promise<number>;
```

### Task 1: Add Bundle persistence and validated admin contract

**Files:**
- Create: `backend/prisma/migrations/20261013100000_add_sku_bundles/migration.sql`
- Modify: `backend/prisma/schema/catalog.prisma`
- Modify: `backend/prisma/schema/order.prisma`
- Modify: `backend/src/modules/catalog/dto/catalog-graph.dto.ts`
- Create: `backend/src/modules/catalog/dto/bundle.dto.ts`
- Create: `backend/src/modules/catalog/bundles.service.ts`
- Create: `backend/src/modules/catalog/admin/bundles.controller.ts`
- Modify: `backend/src/modules/catalog/catalog.module.ts`
- Test: `backend/src/modules/catalog/dto/bundle.dto.spec.ts`
- Test: `backend/src/modules/catalog/bundles.service.spec.ts`

**Interfaces:**
- Consumes: Phase 1 SKU graph fields, existing SKU identity/reference checks, and Prisma catalog/order models.
- Produces: `BundleComponentInput`, `BundleComponentView`, `Sku.isBundle`, validated component persistence, and admin GET/PUT endpoints used by Tasks 2–5.

- [ ] **Step 1: Write failing DTO/service tests.** Cover positive integer quantities, duplicate component rejection, self-reference, nested Bundle rejection, disabled/missing component rejection, cross-product rejection, and virtual SKU stock-write rejection.

```ts
expect(() => bundleComponentsSchema.parse([
  { componentSkuId: skuId, quantity: 1, position: 0 },
])).not.toThrow();
expect(() => bundleComponentsSchema.parse([
  { componentSkuId: skuId, quantity: 0, position: 0 },
])).toThrow();
```

- [ ] **Step 2: Run focused backend tests to verify RED.**

Run:

```bash
pnpm --dir small-house-commerce/backend test -- bundle.dto.spec.ts bundles.service.spec.ts
```

Expected: missing-module/schema failures or unmet contract assertions, not a database connection failure.

- [ ] **Step 3: Add Prisma models and migration.** Add `Sku.isBundle` defaulting false, named `SkuBundleComponent` relations from bundle SKU to component SKU, unique `(bundleSkuId, componentSkuId)`, indexes in both directions, positive-quantity SQL check, and the order-line snapshot table. Use restrictive deletes for component references. Do not create Inventory rows for Bundle SKUs.

- [ ] **Step 4: Implement DTO and service validation.** Create `bundleComponentsSchema` with a bounded component list, positive integer quantity, stable position, and UUID component IDs. In the service, load all referenced SKUs in one query, enforce same product scope where the catalog contract requires it, reject disabled/nested/self references, and replace the component set transactionally.

- [ ] **Step 5: Add authenticated admin endpoints.** Implement `GET /admin/products/:productId/skus/:skuId/bundle-components` and `PUT` with the existing admin auth/RBAC guard. Return component labels and computed availability placeholders from the service; reject the endpoint for non-Bundle SKUs. Do not add a second product save contract.

- [ ] **Step 6: Run focused tests to verify GREEN.** Run the command from Step 2 and the catalog module tests. Expected: validation, persistence, authorization, and no-ordinary-inventory behavior pass.

- [ ] **Step 7: Generate Prisma client and typecheck.**

Run:

```bash
pnpm --dir small-house-commerce/backend exec prisma generate
pnpm --dir small-house-commerce/backend exec tsc --noEmit
```

Expected: the new relations and DTOs compile without changing generated files outside the normal Prisma output.

### Task 2: Add the admin Bundle component editor

**Files:**
- Modify: `frontend/src/lib/admin-api.ts`
- Create: `frontend/src/lib/admin-bundle.ts`
- Create: `frontend/src/components/admin/BundleComponentsEditor.tsx`
- Modify: `frontend/src/components/admin/ProductForm.tsx`
- Modify: `frontend/src/app/admin/(shell)/products/[id]/edit/page.tsx`
- Modify: `frontend/src/i18n/en.ts` and `zh.ts`
- Test: `frontend/src/lib/admin-bundle.spec.ts`
- Test: `frontend/src/components/admin/BundleComponentsEditor.spec.tsx`
- Test: `frontend/src/components/admin/ProductForm.bundle.spec.tsx`

**Interfaces:**
- Consumes: Task 1 Bundle endpoints/types and existing materialized SKU identity mapping.
- Produces: draft component list with quantity/order editing, virtual SKU stock gating, and save sequencing after graph identity is known.

- [ ] **Step 1: Write failing admin tests.** Cover loading components, adding an exact SKU, quantity validation, ordering, duplicate prevention, removing a component, disabled/Bundle component display, and refusal to render ordinary stock editing for a virtual SKU.

```ts
expect(screen.getByText("Black / Medium")).toBeVisible();
await user.clear(screen.getByLabelText("Quantity for Black / Medium"));
await user.type(screen.getByLabelText("Quantity for Black / Medium"), "0");
expect(screen.getByText("Quantity must be a positive whole number")).toBeVisible();
```

- [ ] **Step 2: Run focused frontend tests to verify RED.**

Run:

```bash
pnpm --dir small-house-commerce/frontend test -- admin-bundle.spec.ts BundleComponentsEditor.spec.tsx ProductForm.bundle.spec.tsx
```

Expected: missing helper/component or unmet virtual SKU assertions.

- [ ] **Step 3: Implement draft normalization and component editor.** Keep exact `componentSkuId`, quantity, and position in draft state. Show product name, variant name, SKU code, and computed availability. Prevent duplicate component selection and make removal explicit. Do not expose component internals in customer-facing UI.

- [ ] **Step 4: Integrate save sequencing.** Keep existing Product/graph Phase A and stock Phase B unchanged. After persisted SKU IDs are available, save Bundle components through the dedicated endpoint. For a newly created Bundle, surface a clear component-save error and leave the base product/graph result intact rather than issuing a destructive rollback. Disable virtual SKU stock inputs and show derived availability instead.

- [ ] **Step 5: Run focused tests to verify GREEN.** Run the command from Step 2. Expected: component editor, save sequencing, and ordinary SKU regression tests pass.

- [ ] **Step 6: Verify reload identity.** Add a test that saves reordered components, reloads the product, and confirms the same IDs, quantities, positions, and virtual SKU flag return without duplicate rows.

### Task 3: Implement component-derived availability and cart validation

**Files:**
- Modify: `backend/src/modules/inventory/inventory.service.ts`
- Modify: `backend/src/modules/catalog/products.service.ts`
- Modify: `backend/src/modules/catalog/storefront/products.controller.ts`
- Modify: `backend/src/modules/cart/cart.service.ts`
- Test: `backend/src/modules/inventory/inventory.service.spec.ts`
- Test: `backend/src/modules/cart/cart.service.spec.ts`
- Test: `backend/src/modules/catalog/products.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 persisted `SkuBundleComponent` rows and existing `available = onHand - reserved` calculation.
- Produces: `getAvailableInventoryForSku` and fail-closed cart/storefront behavior used by Task 4.

- [ ] **Step 1: Write failing availability tests.** Cover one component, multiple components, floor division, zero stock, disabled/missing component, no components, ordinary SKU passthrough, and virtual SKU rejection in absolute stock setting.

```ts
expect(await getAvailableInventoryForSku(bundleSkuId)).toBe(
  Math.min(Math.floor(7 / 2), Math.floor(3 / 1)),
);
expect(await getAvailableInventoryForSku(emptyBundleSkuId)).toBe(0);
```

- [ ] **Step 2: Run focused backend tests to verify RED.**

Run:

```bash
pnpm --dir small-house-commerce/backend test -- inventory.service.spec.ts cart.service.spec.ts products.service.spec.ts
```

Expected: missing Bundle availability behavior or incorrect ordinary stock assumptions.

- [ ] **Step 3: Implement transactional availability.** Add `getAvailableInventoryForSku`; ordinary SKUs use existing inventory logic, while Bundle SKUs load all components and compute the minimum floor ratio. Return zero if any component is missing, disabled, invalid, or the relation set is empty. Accept an optional transaction client so checkout can use a consistent snapshot.

- [ ] **Step 4: Wire storefront and cart validation.** Public SKU responses keep the existing `availableInventory` field but use the derived result for Bundles. Cart add/update validates against derived availability and never creates or mutates a virtual Inventory row.

- [ ] **Step 5: Run focused tests to verify GREEN.** Run the command from Step 2 and existing catalog/cart suites. Expected: ordinary SKU behavior remains unchanged and all Bundle edge cases pass.

### Task 4: Expand checkout, cancellation, edit, shipment, and order snapshots

**Files:**
- Modify: `backend/src/modules/orders/orders.service.ts`
- Modify: `backend/src/modules/orders/order-item-snapshot.ts`
- Modify: `backend/src/modules/orders/admin/orders.controller.ts` and DTOs where component details are returned.
- Test: `backend/src/modules/orders/orders.service.spec.ts`
- Test: `backend/src/modules/orders/order-item-snapshot.spec.ts`
- Test: `backend/src/modules/inventory/inventory.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 `BundleExpansion`, Task 3 `getAvailableInventoryForSku`, and existing reserve/release/ship transaction helpers.
- Produces: one aggregated component requirement set per checkout transaction and immutable `OrderItemBundleComponent` snapshots.

- [ ] **Step 1: Write failing transaction tests.** Add cases for one Bundle line, multiple Bundle lines sharing a component, insufficient aggregate stock, cancellation release, shipment consumption, edit-order quantity changes, and definition changes after order creation.

```ts
const result = await checkout({
  lines: [{ skuId: bundleSkuId, quantity: 2 }],
});
expect(await inventoryFor(componentSkuId)).toMatchObject({ reserved: 2 * componentQuantity });
expect(result.items[0].skuId).toBe(bundleSkuId);
expect(result.items[0].bundleComponents).toHaveLength(1);
```

- [ ] **Step 2: Run focused order/inventory tests to verify RED.**

Run:

```bash
pnpm --dir small-house-commerce/backend test -- orders.service.spec.ts order-item-snapshot.spec.ts inventory.service.spec.ts
```

Expected: Bundle lines either incorrectly reserve the virtual SKU or lack snapshot/expansion behavior.

- [ ] **Step 3: Implement a single expansion path.** Add `expandBundleRequirements(skuId, quantity, tx)` and use it for checkout, edit-order, cancellation, and shipment. Aggregate requirements by component SKU before any reserve call; reject quantity overflow and insufficient availability before writing reservations.

- [ ] **Step 4: Reserve and release only concrete components.** Preserve the customer-facing OrderItem SKU as the Bundle SKU, but pass aggregated component requirements to existing inventory reservation/release/consume methods. Use one transaction and existing idempotency/reference conventions.

- [ ] **Step 5: Write order component snapshots.** At order creation, store component SKU ID/code, display product/variant labels, quantity per Bundle, total quantity, and position. Cancellation and shipment read these snapshots rather than current Bundle relations. Existing ordinary OrderItems continue to work with no snapshot rows.

- [ ] **Step 6: Run focused tests to verify GREEN.** Run the command from Step 2. Expected: aggregate reservation, release, shipment, edit-order, and historical snapshot tests pass.

- [ ] **Step 7: Add a concurrency regression test.** Use two checkout attempts against the same limited component and assert that at most the available component quantity is reserved. The test must exercise the database transaction/locking path, not only a mocked helper.

### Task 5: Add graph reference protection and virtual-SKU stock guards

**Files:**
- Modify: `backend/src/modules/catalog/catalog-graph.service.ts`
- Modify: `backend/src/modules/catalog/catalog-graph.ts`
- Modify: `backend/src/modules/inventory/admin/inventory.controller.ts`
- Modify: `backend/src/modules/catalog/admin-product-readiness.ts`
- Modify: `backend/src/modules/catalog/admin-product-issues.ts` if the new error needs the existing issue rail.
- Test: `backend/src/modules/catalog/catalog-graph.service.spec.ts`
- Test: `backend/src/modules/inventory/inventory.service.spec.ts`
- Test: `backend/src/modules/catalog/admin-product-attention.spec.ts`

**Interfaces:**
- Consumes: Task 1 component relations and Task 4 order snapshots.
- Produces: `hasReferences` that includes Bundle component references and a hard rejection for ordinary stock writes against virtual Bundle SKUs.

- [ ] **Step 1: Write failing protection tests.** Assert that a component SKU referenced by a Bundle cannot be deleted/replaced by graph reconciliation, that the Bundle SKU itself cannot be passed to `setStock`, and that readiness/issues explain the virtual/derived-inventory state.

```ts
expect(await catalogGraphService.hasReferences(componentSkuId)).toBe(true);
await expect(inventoryService.setStock(bundleSkuId, 4)).rejects.toThrow("Bundle inventory is derived");
```

- [ ] **Step 2: Run focused tests to verify RED.**

Run:

```bash
pnpm --dir small-house-commerce/backend test -- catalog-graph.service.spec.ts inventory.service.spec.ts admin-product-attention.spec.ts
```

Expected: current `_count` misses Bundle component references or stock setters accept virtual SKUs.

- [ ] **Step 3: Extend reference counting and reconciliation guards.** Include Bundle component counts in the existing SKU reference query and `variantHasReferences`/`skuHasReferences` decision. Keep restrictive database FKs as a second layer. Do not weaken current cart/inventory/reservation/movement/order protections.

- [ ] **Step 4: Reject virtual stock writes and expose derived readiness.** Guard absolute stock writes and any admin stock batch endpoint. Make the issue/readiness surfaces distinguish “derived from components” from missing ordinary inventory, without marking a valid Bundle as ordinary stock-incomplete.

- [ ] **Step 5: Run focused tests to verify GREEN.** Run the command from Step 2 plus the full catalog/inventory module tests. Expected: component deletion protection and ordinary SKU deletion/stock behavior remain green.

### Task 6: Full verification and local review gate

**Files:**
- Modify only files already listed in Tasks 1–5.
- Test: all backend/frontend Bundle, catalog, inventory, cart, and order suites.
- Browser: existing admin product editor and storefront/cart checkout E2E files.

**Interfaces:**
- Consumes: the complete Phase 2 implementation.
- Produces: evidence for the local review gate; no deployment artifact.

- [ ] **Step 1: Run backend verification.**

```bash
pnpm --dir small-house-commerce/backend exec prisma generate
pnpm --dir small-house-commerce/backend test
pnpm --dir small-house-commerce/backend lint
pnpm --dir small-house-commerce/backend build
```

Expected: all commands exit 0; existing warnings are reported separately from errors.

- [ ] **Step 2: Run frontend verification.**

```bash
pnpm --dir small-house-commerce/frontend test
pnpm --dir small-house-commerce/frontend exec tsc --noEmit
pnpm --dir small-house-commerce/frontend lint
pnpm --dir small-house-commerce/frontend build
```

Expected: all commands exit 0 and no unrelated FAQ/media/homepage tests are weakened.

- [ ] **Step 3: Run browser/E2E verification in rehearsal only.** Use backend `127.0.0.1:3002` and frontend `localhost:3005`; never restart ports 3000/3001. Verify ordinary SKU checkout alongside Bundle checkout, component-derived availability, insufficient stock, cancellation, and admin component editing. Check page/console/network errors and confirm no production or `backend/uploads/` writes.

- [ ] **Step 4: Run final static checks.**

```bash
git diff --check
git status --short
```

Expected: only intended Bundle files plus any explicitly tracked Phase 1 outputs are changed; FAQ, media, homepage, `backend/uploads/`, and unrelated reviews work remain untouched.

- [ ] **Step 5: Perform the review gate.** Request a fresh whole-branch review focused on transactional expansion, virtual SKU leakage, historical snapshots, reference protection, and ordinary SKU regressions. Fix Critical/Important findings with a failing regression test before any commit. Stop locally; push, merge, PR, and deploy require separate explicit authorization.

## Phase 2 completion contract

Phase 2 is complete only when schema constraints, admin editing, derived availability, aggregated transactional reservations, cancellation/shipment/edit flows, order snapshots, catalog reference protection, full regression suites, and browser verification all pass. A green component editor alone does not establish inventory correctness.
