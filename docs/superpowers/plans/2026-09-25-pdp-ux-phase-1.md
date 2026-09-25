# PDP UX Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recompose both storefront PDP routes around a conversion-focused hero, conserved mixed details, truthful related/recent rails, and one shared-state sticky buy surface.

**Architecture:** Keep `PdpPurchaseProvider` as the only purchase state and extend its existing boundary to the client detail/spec presentation that needs the current display SKU. Pure helpers own detail partitioning and product-list selection; `PdpClient` continues to own purchase actions and passes those exact actions to a presentational sticky bar. Backend changes are limited to deterministic detail-block read ordering.

**Tech Stack:** Next.js 16.3.4 App Router, React 19, TypeScript, Tailwind CSS 4, Vitest/React Testing Library, NestJS 12, Prisma 7, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-25-pdp-ux-phase-1-design.md`

## Global Constraints

- PURE UI + REUSE EXISTING; no new purchase, variant, price, quantity, cart, or checkout state.
- `PdpPurchaseProvider`, current variant resolver, `requestIntent`, cart, Order Now, checkout, and tracking remain authoritative.
- Detail blocks use exactly `valid → featured → remaining`; preserve every valid URL/type/alt exactly once in API order.
- Backend ordering changes are read-only `sortOrder ASC, id ASC`; no schema, migration, dependency, ProductForm, Catalog Graph, or Media Resolver change.
- Related products are same-category, non-current, genuinely in-stock, maximum four; Recently Viewed reuses localStorage/batch API, excludes current, maximum four.
- Do not implement Inline COD, video autoplay, new recommendations, FAQ/spec schema, push, merge, PR, or deployment.
- Read `frontend/node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md` and `04-linking-and-navigating.md` before changing App Router composition.
- Do not touch `small-house-commerce/backend/uploads/`.

## HARD STOP（用户原文）

出现以下任一情况立即停止，不得自行跨越：

- “需要 Prisma schema 修改”
- “需要 migration”
- “需要 destructive SQL”
- “需要 production DB 操作”
- “需要新的 npm dependency”
- “需要改变现有业务写入 contract”
- “需要改变 ProductForm / Catalog Graph / Media Resolver”
- “现有测试无法保持通过”
- “审计结果与实际代码严重不一致”

普通 UI / API 只读能力 / 派生逻辑不再次询问。本 Phase 必须完成 Implementation → Tests → Browser/E2E Verification → Screenshots → Review → Independent Commit 后，自动进入 Notifications V1。

## Review Focus

1. A detail-block list with blank URLs before/between valid entries must neither shift, duplicate, nor lose a valid block; Task 2 adds a conservation matrix.
2. Variant changes after first render must update displayed product weight and sticky price without firing another `ViewContent`; Tasks 2 and 5 pin both behaviors.
3. A related product with positive stock only on a disabled/unpriced SKU must not be shown as buyable; Task 4 tests selectable inventory rather than a raw row sum.
4. The sticky bar must survive missing `IntersectionObserver`, reduced-motion/mobile safe areas, and option-confirmation flows without a duplicate purchase event; Task 5 tests observer fallback and single invocation.
5. LP overrides must not change which product is excluded from related/recent rails or break purchase/provider identity; Task 6 runs the same assertions on `/products` and `/lp`.

---

### Task 1: Conversion-focused product hero

**Files:**
- Create: `small-house-commerce/frontend/src/components/product/pdp-facts.ts`
- Create: `small-house-commerce/frontend/src/components/product/pdp-facts.spec.ts`
- Modify: `small-house-commerce/frontend/src/components/product/PdpClient.tsx`
- Modify: `small-house-commerce/frontend/src/components/product/ProductOptionSelector.spec.tsx`

**Interfaces:**
- Produces:
  ```ts
  export interface PdpDimensionSummary {
    assembled: string | null;
    folded: string | null;
  }
  export function pdpDimensionSummary(product: Pick<Product,
    "width" | "height" | "depth" |
    "foldedWidth" | "foldedHeight" | "foldedDepth"
  >): PdpDimensionSummary;
  ```
- Consumes existing `delivery: DeliveryWindows`, `primaryLine`, `primaryDerived`, `setQuantity`, and local `requestIntent(intent, trigger)` without changing signatures.

- [ ] **Step 1: Read current framework and policy sources**

Read the two installed Next 16 guides named in Global Constraints plus `PdpInfoSections.tsx` and the current return section of `PdpClient.tsx`. Record in the ledger that server/client boundaries and navigation remain compatible; do not add code in this step.

- [ ] **Step 2: Write failing hero-fact tests**

Add `pdp-facts.spec.ts` cases that expect assembled and folded summaries only from product dimensions, preserve partial values, and prove package fields cannot be passed through the narrow type. Add RTL assertions in `ProductOptionSelector.spec.tsx` that the hero renders in this DOM order: title/tagline/reviews, price, options, Dimensions & Fit, estimated delivery, quantity, ORDER NOW, ADD TO CART, trust strip. Assert copy says “Estimated delivery” and contains only current COD/nationwide/secure/returns policy terms.

```ts
expect(pdpDimensionSummary({
  width: 120, height: 74, depth: 60,
  foldedWidth: 120, foldedHeight: 8, foldedDepth: 60,
})).toEqual({
  assembled: "120 × 74 × 60 cm",
  folded: "120 × 8 × 60 cm",
});
```

- [ ] **Step 3: Run RED**

Run:

```bash
pnpm --dir small-house-commerce/frontend vitest run \
  src/components/product/pdp-facts.spec.ts \
  src/components/product/ProductOptionSelector.spec.tsx
```

Expected: new helper import fails or new Hero assertions fail while existing purchase behavior stays green.

- [ ] **Step 4: Implement the minimal hero composition**

Implement the pure dimension formatter using the existing storefront number/units convention. Reorder existing JSX; do not rewrite `requestIntent`, `executeAddToCart`, `executeOrderNow`, provider reads, option selector, or analytics effects. Add stable IDs `pdp-purchase` and `pdp-dimensions-summary`, make ORDER NOW the visually primary full-width action and ADD TO CART secondary, and render the dimensions link only when real product dimensions exist.

- [ ] **Step 5: Run GREEN and purchase regressions**

Run the Task 1 command again. Expected: all tests pass, including existing deep-link, confirmation, cart, Order Now, and analytics cases in `ProductOptionSelector.spec.tsx`.

- [ ] **Step 6: Commit**

```bash
git add \
  small-house-commerce/frontend/src/components/product/pdp-facts.ts \
  small-house-commerce/frontend/src/components/product/pdp-facts.spec.ts \
  small-house-commerce/frontend/src/components/product/PdpClient.tsx \
  small-house-commerce/frontend/src/components/product/ProductOptionSelector.spec.tsx
git commit -m "feat(storefront): improve product hero conversion layout"
```

---

### Task 2: Conserved mixed details and real specifications

**Files:**
- Create: `small-house-commerce/frontend/src/components/product/pdp-detail-blocks.ts`
- Create: `small-house-commerce/frontend/src/components/product/pdp-detail-blocks.spec.ts`
- Create: `small-house-commerce/frontend/src/components/product/PdpDetails.tsx`
- Create: `small-house-commerce/frontend/src/components/product/PdpDetails.spec.tsx`
- Modify: `small-house-commerce/frontend/src/components/product/ProductDetailBody.tsx`
- Modify: `small-house-commerce/frontend/src/components/product/ProductSpecs.tsx`
- Modify: `small-house-commerce/frontend/src/components/product/PdpView.tsx`
- Modify: `small-house-commerce/backend/src/modules/catalog/products.service.ts`
- Modify: `small-house-commerce/backend/src/modules/catalog/products.service.spec.ts`
- Modify: `small-house-commerce/backend/src/modules/catalog/catalog-graph.service.ts`
- Modify: `small-house-commerce/backend/src/modules/catalog/catalog-graph.service.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface PartitionedDetailBlocks<T extends DetailBlockLike> {
    valid: T[];
    featured: T | null;
    remaining: T[];
  }
  export function partitionDetailBlocks<T extends DetailBlockLike>(
    blocks: readonly T[],
  ): PartitionedDetailBlocks<T>;

  export function PdpDetails(props: {
    product: Product;
    supportEmail: string;
    supportHours: string;
  }): ReactNode;
  ```
- `PdpDetails` consumes `usePdpPurchase().primaryDerived.displayVariant?.sku?.productWeight` and never creates state.

- [ ] **Step 1: Write failing conservation and ordering tests**

Add table-driven helper tests for: empty array; all blank URLs; one valid after blanks; multiple valid with blank interleaving. For every case assert:

```ts
expect([partition.featured, ...partition.remaining].filter(Boolean))
  .toEqual(partition.valid);
expect(partition.valid).toEqual(input.filter((b) => b.url.trim() !== ""));
```

Add backend tests that inspect Prisma read arguments and require all three detail-block read shapes—Admin product include, storefront PDP select, and catalog graph include—to use:

```ts
orderBy: [{ sortOrder: "asc" }, { id: "asc" }]
```

- [ ] **Step 2: Run ordering/conservation RED**

```bash
pnpm --dir small-house-commerce/frontend vitest run \
  src/components/product/pdp-detail-blocks.spec.ts
pnpm --dir small-house-commerce/backend test -- \
  src/modules/catalog/products.service.spec.ts \
  src/modules/catalog/catalog-graph.service.spec.ts
```

Expected: helper missing and backend expectations receive single-key ordering.

- [ ] **Step 3: Implement partition and stable reads**

Implement `partitionDetailBlocks` as one `filter`, `valid[0] ?? null`, and `valid.slice(1)`. Change only the three `orderBy` clauses; do not touch create/update order or graph patches.

- [ ] **Step 4: Run helper/backend GREEN**

Run Step 2 commands. Expected: all named suites pass.

- [ ] **Step 5: Write failing mixed-composition tests**

In `PdpDetails.spec.tsx`, render under the real `PdpPurchaseProvider` and assert exact heading/media order:

```ts
[
  "Description",
  "Why You’ll Love It",
  "featured.jpg",
  "Product Specifications",
  "remaining-1.jpg",
  "remaining-2.mp4",
  "Material & Dimensions",
  "Delivery & FAQs",
]
```

Assert `features` appears only under Why You’ll Love It; current display SKU `productWeight` appears; package dimensions/weights, Assembly, and Load Capacity do not. Select another real option through the provider UI and assert the weight updates to that display SKU.

- [ ] **Step 6: Run mixed-composition RED**

```bash
pnpm --dir small-house-commerce/frontend vitest run \
  src/components/product/PdpDetails.spec.tsx \
  src/components/product/ProductOptionSelector.spec.tsx
```

Expected: `PdpDetails` missing or current contiguous media deck/spec behavior fails the required order.

- [ ] **Step 7: Implement the mixed detail component**

Extend the one existing provider boundary in `PdpView` to include `PdpDetails`, leaving JSON-LD outside. `PdpDetails` reads only `primaryDerived.displayVariant` for weight. Refactor `ProductDetailBody` into truthful Description/Why/featured/remaining render primitives. Update `ProductSpecs` to accept `productWeight?: number | null`, remove `features` from its table, and render only real dimensions/materials/weight. Add a distinct Material & Dimensions presentation from the same fields without introducing new facts.

- [ ] **Step 8: Run frontend/backend GREEN**

Run Steps 2 and 6 commands. Expected: all pass, detail URLs/types/alts appear once, and existing provider tests remain green.

- [ ] **Step 9: Commit**

```bash
git add \
  small-house-commerce/frontend/src/components/product/pdp-detail-blocks.ts \
  small-house-commerce/frontend/src/components/product/pdp-detail-blocks.spec.ts \
  small-house-commerce/frontend/src/components/product/PdpDetails.tsx \
  small-house-commerce/frontend/src/components/product/PdpDetails.spec.tsx \
  small-house-commerce/frontend/src/components/product/ProductDetailBody.tsx \
  small-house-commerce/frontend/src/components/product/ProductSpecs.tsx \
  small-house-commerce/frontend/src/components/product/PdpView.tsx \
  small-house-commerce/backend/src/modules/catalog/products.service.ts \
  small-house-commerce/backend/src/modules/catalog/products.service.spec.ts \
  small-house-commerce/backend/src/modules/catalog/catalog-graph.service.ts \
  small-house-commerce/backend/src/modules/catalog/catalog-graph.service.spec.ts
git commit -m "feat(storefront): add mixed structured product details"
```

---

### Task 3: Complete sticky section navigation

**Files:**
- Create: `small-house-commerce/frontend/src/components/product/PdpSectionNav.tsx`
- Create: `small-house-commerce/frontend/src/components/product/PdpSectionNav.spec.tsx`
- Modify: `small-house-commerce/frontend/src/components/product/PdpView.tsx`
- Modify: `small-house-commerce/frontend/src/components/product/PdpDetails.tsx`

**Interfaces:**
- Produces `PdpSectionNav({ hasDetails, hasSpecifications }: { hasDetails: boolean; hasSpecifications: boolean }): ReactNode`.
- Consumes IDs: `#details`, `#specifications`, `#shipping-faq`, `#reviews`, and `#pdp-purchase`.

- [ ] **Step 1: Write failing anchor/accessibility tests**

Assert all five labels/hrefs, mobile and desktop rendering, `aria-label="Product sections"`, visible focus classes, and that every emitted href has exactly one matching DOM ID. Add a scroll-margin assertion on target section class names.

- [ ] **Step 2: Run RED**

```bash
pnpm --dir small-house-commerce/frontend vitest run \
  src/components/product/PdpSectionNav.spec.tsx \
  src/components/product/PdpDetails.spec.tsx
```

Expected: component/import missing or current nav lacks Specifications and Order Now and is desktop-only.

- [ ] **Step 3: Implement navigation and stable section IDs**

Extract the nav, include Details/Specifications conditionally only when truthful content exists, always include Delivery & FAQs, Reviews, and Order Now, and keep the bar horizontally scrollable rather than hidden on small screens. Use ordinary same-page anchors so browser focus/history behavior remains native.

- [ ] **Step 4: Run GREEN**

Run Step 2 command. Expected: all links resolve to unique targets and tests pass.

- [ ] **Step 5: Commit**

```bash
git add \
  small-house-commerce/frontend/src/components/product/PdpSectionNav.tsx \
  small-house-commerce/frontend/src/components/product/PdpSectionNav.spec.tsx \
  small-house-commerce/frontend/src/components/product/PdpView.tsx \
  small-house-commerce/frontend/src/components/product/PdpDetails.tsx
git commit -m "feat(storefront): improve product sticky navigation"
```

---

### Task 4: Truthful related and recently viewed rails

**Files:**
- Create: `small-house-commerce/frontend/src/lib/pdp-products.ts`
- Create: `small-house-commerce/frontend/src/lib/pdp-products.spec.ts`
- Create: `small-house-commerce/frontend/src/components/home/RecentlyViewed.spec.tsx`
- Modify: `small-house-commerce/frontend/src/components/home/RecentlyViewed.tsx`
- Modify: `small-house-commerce/frontend/src/components/product/PdpView.tsx`
- Create: `small-house-commerce/frontend/src/app/(storefront)/products/[slug]/page.spec.tsx`
- Modify: `small-house-commerce/frontend/src/app/(storefront)/products/[slug]/page.tsx`
- Create: `small-house-commerce/frontend/src/app/(storefront)/lp/[slug]/page.spec.tsx`
- Modify: `small-house-commerce/frontend/src/app/(storefront)/lp/[slug]/page.tsx`

**Interfaces:**
- Produces:
  ```ts
  export function selectableAvailableInventory(product: Product): number;
  export function selectRelatedProducts(
    products: readonly Product[], currentProductId: string, limit?: number,
  ): Product[];

  export function RecentlyViewed(props?: {
    excludeProductId?: string;
    limit?: number;
  }): ReactNode;
  ```
- Default `RecentlyViewed()` behavior remains unchanged for homepage consumers.

- [ ] **Step 1: Write failing selection tests**

Build products whose variants cover active/in-stock, active/OOS, disabled/in-stock, active/unpriced, current product, and five valid products. Require same input order, current exclusion, only selectable inventory > 0, and four-item cap. For Recently Viewed, seed IDs `[current, a, b, c, d, e]`, mock the real batch response in a different order, and assert rendered order `[a,b,c,d]` and request IDs exclude current before limiting.

- [ ] **Step 2: Run RED**

```bash
pnpm --dir small-house-commerce/frontend vitest run \
  src/lib/pdp-products.spec.ts \
  src/components/home/RecentlyViewed.spec.tsx
```

Expected: helper/component props missing; current component requests all IDs and cannot exclude current.

- [ ] **Step 3: Implement helpers and both route consumers**

Sum `availableInventory` only for variants whose SKU is `ACTIVE` and priced. Use `selectRelatedProducts` in both route files after their same-category fetch and request enough candidates (`pageSize=9`) to fill four after filtering without creating a new recommendation endpoint. Update Recently Viewed to filter/slice IDs before fetch, map response by ID, and restore requested visit order.

- [ ] **Step 4: Render both rails from the shared PDP view**

Keep existing ProductCard rendering, max four columns, truthful empty suppression, and add `<RecentlyViewed excludeProductId={product.id} limit={4} />` after Related. Do not record another view from this component.

- [ ] **Step 5: Run GREEN and route tests**

```bash
pnpm --dir small-house-commerce/frontend vitest run \
  src/lib/pdp-products.spec.ts \
  src/components/home/RecentlyViewed.spec.tsx \
  'src/app/(storefront)/products/[slug]/page.spec.tsx' \
  'src/app/(storefront)/lp/[slug]/page.spec.tsx'
```

Create both route specs in RED with mocked fetch responses that prove `/products/[slug]` and `/lp/[slug]` apply the shared selector before passing `related` to `PdpView`. Expected after implementation: all named suites pass.

- [ ] **Step 6: Commit**

```bash
git add \
  small-house-commerce/frontend/src/lib/pdp-products.ts \
  small-house-commerce/frontend/src/lib/pdp-products.spec.ts \
  small-house-commerce/frontend/src/components/home/RecentlyViewed.tsx \
  small-house-commerce/frontend/src/components/home/RecentlyViewed.spec.tsx \
  small-house-commerce/frontend/src/components/product/PdpView.tsx \
  'small-house-commerce/frontend/src/app/(storefront)/products/[slug]/page.tsx' \
  'small-house-commerce/frontend/src/app/(storefront)/products/[slug]/page.spec.tsx' \
  'small-house-commerce/frontend/src/app/(storefront)/lp/[slug]/page.tsx' \
  'small-house-commerce/frontend/src/app/(storefront)/lp/[slug]/page.spec.tsx'
git commit -m "feat(storefront): add related and recently viewed products"
```

---

### Task 5: Shared-state sticky buy bar

**Files:**
- Create: `small-house-commerce/frontend/src/components/product/PdpStickyBuy.tsx`
- Create: `small-house-commerce/frontend/src/components/product/PdpStickyBuy.spec.tsx`
- Modify: `small-house-commerce/frontend/src/components/product/PdpClient.tsx`
- Modify: `small-house-commerce/frontend/src/components/product/ProductOptionSelector.spec.tsx`
- Modify: `small-house-commerce/frontend/src/components/layout/BackToTop.tsx`
- Delete: `small-house-commerce/frontend/src/components/product/MobileStickyCta.tsx`

**Interfaces:**
- Produces:
  ```ts
  export interface PdpStickyBuyProps {
    product: Product;
    heroRef: RefObject<HTMLElement | null>;
    line: PurchaseLineState;
    derived: ProductSelectionDerived;
    busy: boolean;
    variantLabel: string | null;
    onQuantityChange(quantity: number): void;
    onIntent(intent: "ADD_TO_CART" | "ORDER_NOW", trigger: HTMLElement): void;
  }
  export function PdpStickyBuy(props: PdpStickyBuyProps): ReactNode;
  ```
- `PdpClient` passes `primaryLine`, `primaryDerived`, `setQuantity(primaryLine.clientLineId, quantity)`, and the exact existing `requestIntent` callback.

- [ ] **Step 1: Write failing observer and identity tests**

Mock `IntersectionObserver`, render the real provider/PdpClient, and assert: hidden while hero intersects; visible after non-intersection; current option change updates sticky variant/price; sticky quantity updates the hero quantity; sticky ADD TO CART calls the existing cart mock once and emits one conversion pair; sticky ORDER NOW uses the same confirmation dialog when unresolved. Add a no-`IntersectionObserver` case that keeps the bar hidden rather than throwing.

- [ ] **Step 2: Run RED**

```bash
pnpm --dir small-house-commerce/frontend vitest run \
  src/components/product/PdpStickyBuy.spec.tsx \
  src/components/product/ProductOptionSelector.spec.tsx
```

Expected: component missing/current mobile-only CTA has no observer and lacks shared desktop controls.

- [ ] **Step 3: Implement presentational sticky bar**

Add a `ref`/sentinel to the existing `#pdp-purchase` hero. Observe it with cleanup and derive only visual visibility state. Render one responsive bar (desktop rich, mobile compact), use effective cover media and current `derived.displayVariant`, and call only supplied shared actions. Apply safe-area bottom padding, reduced-motion classes, focus-visible styles, and sufficient page bottom padding only while the mobile bar can appear. Remove the old `MobileStickyCta` render/import so exactly one sticky purchase surface exists.

- [ ] **Step 4: Run GREEN and analytics regressions**

Run Step 2 command. Expected: all tests pass, including pre-existing exactly-once ViewContent/AddToCart/Order Now tests.

- [ ] **Step 5: Verify the legacy component was fully replaced**

```bash
! grep -R "MobileStickyCta" small-house-commerce/frontend/src --include='*.ts' --include='*.tsx'
```

Expected: exit 0 after deleting the obsolete component and updating the stale `BackToTop.tsx` comment to refer to the PDP sticky buy bar.

- [ ] **Step 6: Commit**

```bash
git add -A \
  small-house-commerce/frontend/src/components/product/PdpStickyBuy.tsx \
  small-house-commerce/frontend/src/components/product/PdpStickyBuy.spec.tsx \
  small-house-commerce/frontend/src/components/product/PdpClient.tsx \
  small-house-commerce/frontend/src/components/product/ProductOptionSelector.spec.tsx \
  small-house-commerce/frontend/src/components/layout/BackToTop.tsx \
  small-house-commerce/frontend/src/components/product/MobileStickyCta.tsx
git commit -m "feat(storefront): add shared-state sticky buy bar"
```

---

### Task 6: Real-browser phase gate, screenshots, and phase review

**Files:**
- Modify: `small-house-commerce/backend/prisma/seed-e2e.ts`
- Create: `small-house-commerce/frontend/e2e/pdp-ux-phase-1.spec.ts`
- Create/update: phase ledger in this plan’s `.superpowers/sdd/` workspace (gitignored)

**Interfaces:**
- Reuses seeded slugs `e2e-color-size` and its LP fixture, direct backend checks at `127.0.0.1:3210`, and frontend at `localhost:3211`.
- Produces screenshots under `small-house-commerce/frontend/screenshots/phase-pdp-ux-*.png` (gitignored evidence, not committed).

- [ ] **Step 1: Write failing Playwright acceptance**

Create `pdp-ux-phase-1.spec.ts` and add tests that seed deterministic description/features/dimensions/materials/productWeight/detail blocks and at least five same-category products spanning current/OOS/valid cases. Cover:

- `/products/e2e-color-size` and the existing LP route;
- exact hero order and primary/secondary actions;
- five nav anchors and Order Now target;
- detail-block URL order/conservation, real specs, no logistics dimensions;
- related excludes current/OOS and caps four;
- localStorage recent history excludes current and caps four;
- hero scroll causes one sticky bar; option/quantity changes synchronize; one sticky click causes one request/event;
- 375×812, 768×1024, 1440×900, 1920×1080 no page overflow;
- no console error, pageerror, hydration warning, failed product media request, or broken image.

Run the new test once before screenshot assertions are implemented. Expected: fail on missing new UI/selectors or fixture fields, not environment setup.

- [ ] **Step 2: Complete fixtures and screenshot assertions**

Use only the disposable guarded database. Add screenshots:

```text
phase-pdp-ux-hero-1440.png
phase-pdp-ux-details-1440.png
phase-pdp-ux-sticky-buy-1440.png
phase-pdp-ux-mobile-375.png
phase-pdp-ux-landing-1920.png
```

Fixture cleanup/restoration must run in `finally`; do not mutate production or `backend/uploads/`.

- [ ] **Step 3: Run the focused E2E gate**

```bash
pnpm --dir small-house-commerce/frontend exec playwright test \
  e2e/variant-options-media.spec.ts \
  e2e/pdp-ux-phase-1.spec.ts \
  --project=chromium
```

Expected: all tests pass.

- [ ] **Step 4: Inspect screenshots and browser state**

Open each screenshot with the image reader and use Chrome DevTools against the isolated 3211 server to inspect hero, mixed details, sticky buy, and LP at the four target widths. Record any visual issue as a failing test before fixing. Expected: no clipped CTA, overlap, duplicated media, broken image, or page-level horizontal overflow.

- [ ] **Step 5: Run phase-wide verification**

```bash
pnpm --dir small-house-commerce/backend test
pnpm --dir small-house-commerce/frontend test
pnpm --dir small-house-commerce/backend exec tsc --noEmit
pnpm --dir small-house-commerce/frontend exec tsc --noEmit
pnpm --dir small-house-commerce/backend lint
pnpm --dir small-house-commerce/frontend lint
pnpm --dir small-house-commerce/backend build
pnpm --dir small-house-commerce/frontend build
pnpm --dir small-house-commerce/frontend exec playwright test \
  e2e/variant-options-media.spec.ts \
  e2e/pdp-ux-phase-1.spec.ts \
  --project=chromium
```

Expected: zero test/build/type errors; only explicitly pre-existing lint warnings may remain and must be ledgered.

- [ ] **Step 6: Review the isolated phase diff**

Review from the phase start commit through HEAD against the spec’s five Review Focus entries. Fix any Critical/Important issue with a RED→GREEN test. Confirm no schema, migration, dependency, ProductForm, Catalog Graph write, resolver, Inline COD, Video, push, or deployment change.

- [ ] **Step 7: Commit acceptance evidence**

```bash
git add \
  small-house-commerce/backend/prisma/seed-e2e.ts \
  small-house-commerce/frontend/e2e/pdp-ux-phase-1.spec.ts
git commit -m "test(storefront): verify pdp ux phase 1"
```

Screenshots remain local and gitignored. Mark the PDP phase ledger complete, then automatically start the Notifications V1 plan.
