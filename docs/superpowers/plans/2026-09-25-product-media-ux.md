# Product Media UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Admin Product Media tab into clear shared, driver/value, exact-variant, and PDP-detail workspaces without changing any media data, resolver, graph, upload, or save semantics.

**Architecture:** `ProductForm` remains the sole controlled owner. Two focused controlled editors extract existing shared-gallery and detail-block JSX, while `ProductMediaScopesEditor` keeps its one graph mutator and receives pure read-only summary helpers for SKU impact and effective-source labels. UI-only expansion/drag state may live in child components; no child owns a second media draft.

**Tech Stack:** Next.js 16.3.4, React 19, TypeScript, Tailwind CSS 4, existing Admin i18n/ImageUrlInput/Catalog Graph helpers, Vitest/RTL, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-25-product-media-ux-design.md`

## Global Constraints

- Do not change ProductForm state/submission ownership, `serializeFormValue`, `stripUnsavableMedia`, `syncSharedMediaDraft`, `buildCatalogGraphPatch`, `toWireCatalogGraphPatch`, inventory writes, or save order.
- Do not change Catalog Graph shape/version/identity, `id ?? clientKey`, `combinationKey`, variant/SKU identity, scope XOR, or media REPLACE semantics.
- Do not change public Media Resolver precedence: exact variant → active driver option value → shared.
- Shared `value.images`, scoped `graphDraft.media`, and `detailBlocks` remain separate data lines.
- Reuse existing uploader, 5MB handling, `siteMediaUrl`, and R2 contract; no dependency/schema/migration/API change.
- Switching driver preserves inactive/old scopes; deletion remains explicit.
- Pure summary helpers may derive facts but may not mutate graph input or become a second resolver.
- Do not touch PDP purchase behavior, Inline COD, Video autoplay, import/export, Global Search, Notifications, or `backend/uploads/`.
- Do not merge, push, create a PR, or deploy.

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

普通 UI / API 只读能力 / 派生逻辑不再次询问。本 Phase 必须完成 Implementation → Tests → Browser/E2E Verification → Screenshots → Review → Independent Commit；随后执行三 Phase 整体 fresh-context review、修复全部 Critical/Important、跑完整验证并停止。

## Review Focus

1. Blank unsaved shared/scoped cards must remain editable/droppable but must not count as effective resolver media; Tasks 1–3 distinguish row versus usable counts.
2. Newly created entities that adopt server IDs must keep expanded/selected variant and scope identity; Task 3 retains semantic keys and existing adoption regressions.
3. A driver switch with legacy/inactive scopes must change only `isMediaDriver`, preserve every row, and label inactive scopes honestly; Task 3 snapshots the whole graph before/after.
4. Exact-variant summary fallback must follow stable refs when labels are duplicated/renamed and never infer by text or array index; Task 1 builds duplicate-label cases.
5. Extracted shared/detail editors must preserve drag/sort/cover/upload/problem-rail focus and identical serialization through create/edit save flows; Tasks 2, 4, and 5 assert payload equivalence and real API readback.

---

### Task 1: Pure media summaries and effective-source mirror

**Files:**
- Create: `small-house-commerce/frontend/src/lib/admin-product-media-summary.ts`
- Create: `small-house-commerce/frontend/src/lib/admin-product-media-summary.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface AdminMediaSummary {
    rowCount: number;
    usableCount: number;
    imageCount: number;
    videoCount: number;
    altCompleteCount: number;
  }

  export function summarizeAdminMedia(
    rows: readonly Pick<AdminMediaDraft,
      "url" | "type" | "altText" | "sortOrder">[],
  ): AdminMediaSummary;

  export function impactedSkuCount(
    draft: AdminCatalogGraphDraft,
    option: AdminOptionDraft | null,
  ): number;

  export interface VariantMediaResolutionSummary {
    source: "EXACT" | "OPTION_VALUE" | "SHARED";
    count: number;
    optionValueRef: EntityRef | null;
  }

  export function summarizeVariantMediaResolution(
    draft: AdminCatalogGraphDraft,
    variant: AdminVariantDraft,
  ): VariantMediaResolutionSummary;
  ```
- “Usable” means `url.trim() !== ""`; source precedence considers only usable rows, matching what save/resolution can retain.

- [ ] **Step 1: Write failing media-summary tests**

Cover mixed image/video rows, blank URLs, whitespace alts, unsorted input, and prove input remains deeply equal after every call. For impacted SKU count, cover no option (all SKU-bearing variants), active/inactive values, variants without SKU, and duplicate labels with different refs. For resolver summary, cover exact > option > shared, empty exact falling through, no driver, inactive driver, and duplicate/renamed labels resolved only by `entityRowKey` refs.

```ts
expect(summarizeAdminMedia([
  { url: "hero.jpg", type: "IMAGE", altText: "Hero", sortOrder: 1 },
  { url: "  ", type: "VIDEO", altText: null, sortOrder: 0 },
])).toEqual({
  rowCount: 2,
  usableCount: 1,
  imageCount: 1,
  videoCount: 1,
  altCompleteCount: 1,
});
```

- [ ] **Step 2: Run RED**

```bash
pnpm --dir small-house-commerce/frontend vitest run \
  src/lib/admin-product-media-summary.spec.ts
```

Expected: module missing.

- [ ] **Step 3: Implement pure helpers**

Use `entityRowKey` for all entity/ref comparisons, filter usable rows only for effective-source counts, and use actual variant `optionValueRefs`/`sku` presence for impacts. Do not import or call save mutators and do not mutate/sort source arrays in place.

- [ ] **Step 4: Run GREEN**

Run Step 2 command. Expected: all cases pass.

- [ ] **Step 5: Commit**

```bash
git add \
  small-house-commerce/frontend/src/lib/admin-product-media-summary.ts \
  small-house-commerce/frontend/src/lib/admin-product-media-summary.spec.ts
git commit -m "feat(admin): add product media workspace summaries"
```

---

### Task 2: Controlled shared-media workspace

**Files:**
- Create: `small-house-commerce/frontend/src/components/admin/product-form/SharedMediaWorkspace.tsx`
- Create: `small-house-commerce/frontend/src/components/admin/product-form/SharedMediaWorkspace.spec.tsx`
- Modify: `small-house-commerce/frontend/src/components/admin/product-form/ProductMediaPanel.tsx`
- Modify: `small-house-commerce/frontend/src/components/admin/ProductForm.tsx`
- Modify: `small-house-commerce/frontend/src/components/admin/ProductForm.gallery.spec.ts`
- Modify: `small-house-commerce/frontend/src/components/admin/ProductForm.spec.tsx`
- Modify: `small-house-commerce/frontend/src/i18n/zh.ts`
- Modify: `small-house-commerce/frontend/src/i18n/en.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface SharedMediaWorkspaceProps {
    images: readonly ImageFormValue[];
    pending: boolean;
    highlightKey?: string | null;
    onPatch(index: number, patch: Partial<ImageFormValue>): void;
    onMove(index: number, delta: -1 | 1): void;
    onReorder(from: number, to: number): void;
    onSetCover(index: number): void;
    onRemove(index: number): void;
    onAdd(type: "IMAGE" | "VIDEO"): void;
  }
  ```
- `ProductForm` continues to own `value.images` and all mutations; the child owns only transient drag/expanded-card state.

- [ ] **Step 1: Write failing controlled-workspace tests**

Render with frozen props and spies. Assert 140–160px cards, real row/usable/image/video/alt summaries, order and cover badges, blank card presence, existing ImageUrlInput, URL/type/alt editing, drag reorder, move left/right, set cover, remove, expand, and add image/video callbacks. Rerender with unchanged props after callback and assert no local draft mutation occurred.

- [ ] **Step 2: Run RED**

```bash
pnpm --dir small-house-commerce/frontend vitest run \
  src/components/admin/product-form/SharedMediaWorkspace.spec.tsx
```

Expected: component missing.

- [ ] **Step 3: Extract existing shared-gallery JSX**

Move presentation and transient drag state only. Reuse existing ProductForm handlers or expose thin callbacks with exactly the same array operations and stable sort renumbering. Do not alter uploader props, URL normalization, cover-as-first semantics, blank-card retention, or problem-rail highlighting.

- [ ] **Step 4: Replace ReactNode slot with controlled props**

Change `ProductMediaPanel` from `sharedGallery: ReactNode` to `sharedMedia: SharedMediaWorkspaceProps` and render one `SharedMediaWorkspace`. Keep `graphDraft` and `detailBlocks` separate.

- [ ] **Step 5: Run component and ProductForm GREEN**

```bash
pnpm --dir small-house-commerce/frontend vitest run \
  src/components/admin/product-form/SharedMediaWorkspace.spec.tsx \
  src/components/admin/ProductForm.gallery.spec.ts \
  src/components/admin/ProductForm.spec.tsx
```

Expected: all pass; existing serialization/sort/drop contracts are unchanged.

- [ ] **Step 6: Commit**

```bash
git add \
  small-house-commerce/frontend/src/components/admin/product-form/SharedMediaWorkspace.tsx \
  small-house-commerce/frontend/src/components/admin/product-form/SharedMediaWorkspace.spec.tsx \
  small-house-commerce/frontend/src/components/admin/product-form/ProductMediaPanel.tsx \
  small-house-commerce/frontend/src/components/admin/ProductForm.tsx \
  small-house-commerce/frontend/src/components/admin/ProductForm.gallery.spec.ts \
  small-house-commerce/frontend/src/components/admin/ProductForm.spec.tsx \
  small-house-commerce/frontend/src/i18n/zh.ts \
  small-house-commerce/frontend/src/i18n/en.ts
git commit -m "feat(admin): improve shared media workspace"
```

---

### Task 3: Driver, option-value, and exact-variant summaries

**Files:**
- Modify: `small-house-commerce/frontend/src/components/admin/ProductMediaScopesEditor.tsx`
- Modify: `small-house-commerce/frontend/src/components/admin/ProductMediaScopesEditor.spec.tsx`
- Modify: `small-house-commerce/frontend/src/lib/admin-product-media-summary.ts`
- Modify: `small-house-commerce/frontend/src/lib/admin-product-media-summary.spec.ts`
- Modify: `small-house-commerce/frontend/src/i18n/zh.ts`
- Modify: `small-house-commerce/frontend/src/i18n/en.ts`

**Interfaces:**
- Consumes `summarizeAdminMedia`, `impactedSkuCount`, and `summarizeVariantMediaResolution` from Task 1.
- Preserves existing `onChange(mutate)`, `rowKey`, `freshClientKey`, `variantSemanticKey`, `renumberScopes`, scoped uploader, and all current add/patch/move/remove callbacks.

- [ ] **Step 1: Write driver-card RED**

Extend existing tests to require Shared only plus one card per active option, real impacted SKU count, exactly one selected driver, and one `onChange` mutator that only changes option `isMediaDriver` booleans. Snapshot all media rows before/after and assert driver switching leaves them byte-for-byte unchanged.

- [ ] **Step 2: Write option-scope summary RED**

Require every active driver value plus any inactive/legacy value that already has a scope to remain visible. Assert real row/type/usable/alt counts, active/inactive labels, truthful fallback text, explicit “replaces shared gallery” text, and existing edit/remove actions. Empty rows must remain editable but report zero usable media.

- [ ] **Step 3: Write exact-variant summary RED**

Require a collapsed-by-default native details/summary list with exact, driver-value, and shared labels/counts from the helper. Expand and verify the existing exact editor, stable selection through server-ID adoption, scope XOR, move/remove/renumber, and duplicate-label refs. Existing tests for switching driver preserving old scopes and collapsed exact editor remain mandatory.

- [ ] **Step 4: Run RED**

```bash
pnpm --dir small-house-commerce/frontend vitest run \
  src/components/admin/ProductMediaScopesEditor.spec.tsx \
  src/lib/admin-product-media-summary.spec.ts
```

Expected: current select/long-form editor lacks cards/summaries and resolver labels.

- [ ] **Step 5: Refactor presentation around existing mutations**

Replace the driver select with semantic cards, wrap each option-value editor in summary/expand presentation, and render exact variants as collapsed summary rows. Do not rewrite the existing mutation functions except to move them intact. Keep `variantSemanticKey` selection rather than array index or mutable IDs.

- [ ] **Step 6: Run GREEN plus graph contracts**

```bash
pnpm --dir small-house-commerce/frontend vitest run \
  src/components/admin/ProductMediaScopesEditor.spec.tsx \
  src/lib/admin-product-media-summary.spec.ts \
  src/lib/admin-product-graph.spec.ts \
  src/components/admin/ProductForm.gallery.spec.ts
```

Expected: all pass; scope XOR and identity tests remain green.

- [ ] **Step 7: Commit**

```bash
git add \
  small-house-commerce/frontend/src/components/admin/ProductMediaScopesEditor.tsx \
  small-house-commerce/frontend/src/components/admin/ProductMediaScopesEditor.spec.tsx \
  small-house-commerce/frontend/src/lib/admin-product-media-summary.ts \
  small-house-commerce/frontend/src/lib/admin-product-media-summary.spec.ts \
  small-house-commerce/frontend/src/i18n/zh.ts \
  small-house-commerce/frontend/src/i18n/en.ts
git commit -m "feat(admin): improve scoped media summaries"
```

---

### Task 4: Separate controlled PDP detail-media workspace

**Files:**
- Create: `small-house-commerce/frontend/src/components/admin/product-form/DetailMediaWorkspace.tsx`
- Create: `small-house-commerce/frontend/src/components/admin/product-form/DetailMediaWorkspace.spec.tsx`
- Modify: `small-house-commerce/frontend/src/components/admin/product-form/ProductMediaPanel.tsx`
- Modify: `small-house-commerce/frontend/src/components/admin/ProductForm.tsx`
- Modify: `small-house-commerce/frontend/src/components/admin/ProductForm.spec.tsx`
- Modify: `small-house-commerce/frontend/src/i18n/zh.ts`
- Modify: `small-house-commerce/frontend/src/i18n/en.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface DetailMediaWorkspaceProps {
    blocks: readonly DetailBlockFormValue[];
    pending: boolean;
    highlightKey?: string | null;
    onPatch(index: number, patch: Partial<DetailBlockFormValue>): void;
    onMove(index: number, delta: -1 | 1): void;
    onRemove(index: number): void;
    onAdd(type: "IMAGE" | "VIDEO"): void;
  }
  ```
- ProductForm retains its existing `setDetailBlock`, `appendDetailBlock`, remove, and move array semantics.

- [ ] **Step 1: Write controlled detail-workspace RED**

Assert separate PDP-only explanation, real total/image/video/alt summary, current type/uploader/URL/alt controls, move up/down, remove, add image/video, problem-rail highlight, narrow layout, and no Gallery Driver/shared-gallery language. Freeze blocks and assert callbacks do not mutate props.

- [ ] **Step 2: Run RED**

```bash
pnpm --dir small-house-commerce/frontend vitest run \
  src/components/admin/product-form/DetailMediaWorkspace.spec.tsx
```

Expected: component missing.

- [ ] **Step 3: Extract existing detail-block JSX**

Move only presentation into the controlled component and reuse `ImageUrlInput`. Keep ProductForm callback ownership and exact block object fields/order. Change `ProductMediaPanel` from a generic `detailBlocks: ReactNode` slot to explicit controlled detail props and render exactly one detail workspace.

- [ ] **Step 4: Write/verify payload-equivalence regression**

In `ProductForm.spec.tsx`, edit one detail block, reorder, add video, and submit. Assert the same `detailBlocks` payload fields/order as before and that no row appears in `catalogGraph.media` or shared `images`.

- [ ] **Step 5: Run GREEN**

```bash
pnpm --dir small-house-commerce/frontend vitest run \
  src/components/admin/product-form/DetailMediaWorkspace.spec.tsx \
  src/components/admin/ProductForm.spec.tsx \
  src/components/admin/ProductForm.gallery.spec.ts \
  src/components/admin/ProductMediaScopesEditor.spec.tsx
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add \
  small-house-commerce/frontend/src/components/admin/product-form/DetailMediaWorkspace.tsx \
  small-house-commerce/frontend/src/components/admin/product-form/DetailMediaWorkspace.spec.tsx \
  small-house-commerce/frontend/src/components/admin/product-form/ProductMediaPanel.tsx \
  small-house-commerce/frontend/src/components/admin/ProductForm.tsx \
  small-house-commerce/frontend/src/components/admin/ProductForm.spec.tsx \
  small-house-commerce/frontend/src/i18n/zh.ts \
  small-house-commerce/frontend/src/i18n/en.ts
git commit -m "feat(admin): separate product detail media workspace"
```

---

### Task 5: Real-browser media gate, screenshots, and phase review

**Files:**
- Modify: `small-house-commerce/frontend/e2e/admin-product-editor.spec.ts`
- Modify: `small-house-commerce/frontend/e2e/variant-options-media.spec.ts` only for public conservation/readback assertions
- Create/update: phase ledger in this plan’s `.superpowers/sdd/` workspace (gitignored)

**Interfaces:**
- Reuses the guarded disposable Admin fixture and existing ProductForm save/readback helpers.
- Produces gitignored screenshots under `frontend/screenshots/phase-product-media-ux-*.png`.

- [ ] **Step 1: Write failing Admin acceptance**

Extend the existing media test to cover 375×812, 768×1024, 1440×900, and 1920×1080:

- 140–160px shared cards and wrapped toolbar;
- real shared count/type/order/alt summary;
- Shared only/Color/Size driver cards and real affected-SKU counts;
- option-value summaries including preserved inactive scope and edit expansion;
- exact-variant collapsed summaries for exact/value/shared fallback, then editor expansion;
- detail-media PDP-only workspace and actions;
- no page-level overflow, obscured controls, console error, pageerror, or hydration warning.

Run once before selector/fixture adjustments. Expected: fail on missing new summary/card UI.

- [ ] **Step 2: Add save/readback identity assertions**

Through the UI, reorder shared media, switch driver, edit one option-value scope, edit one exact scope, and reorder detail blocks. Save, fetch the real Admin product/graph, and assert:

- graph version increments normally;
- shared/scoped/detail rows remain disjoint;
- scope XOR and row IDs/client-key adoption remain stable;
- driver switch preserved inactive scope rows;
- sort orders are dense per existing contract;
- no package/inventory/write field changed incidentally.

Restore fixture in `finally`.

- [ ] **Step 3: Add public PDP conservation assertion**

In `variant-options-media.spec.ts`, read the same saved fixture and assert exact media resolver remains exact → value → shared, while detail-block URLs render once in saved order and never enter the gallery. This is a regression assertion only; do not modify resolver/PDP production code in this phase.

- [ ] **Step 4: Capture screenshots**

```text
phase-product-media-ux-shared-1440.png
phase-product-media-ux-driver-values-1440.png
phase-product-media-ux-exact-1920.png
phase-product-media-ux-detail-1440.png
phase-product-media-ux-mobile-375.png
```

Screenshots remain gitignored.

- [ ] **Step 5: Run focused E2E**

```bash
pnpm --dir small-house-commerce/frontend exec playwright test \
  e2e/admin-product-editor.spec.ts \
  e2e/variant-options-media.spec.ts \
  --project=chromium
```

Expected: all tests pass.

- [ ] **Step 6: Inspect screenshots and browser interactions**

Read all images and inspect actual open/collapse/drag/upload/driver/save interactions with Chrome DevTools on isolated 3211. Any defect becomes a RED test before fixing.

- [ ] **Step 7: Run phase-wide verification**

```bash
pnpm --dir small-house-commerce/frontend vitest run \
  src/lib/admin-product-media-summary.spec.ts \
  src/components/admin/product-form/SharedMediaWorkspace.spec.tsx \
  src/components/admin/ProductMediaScopesEditor.spec.tsx \
  src/components/admin/product-form/DetailMediaWorkspace.spec.tsx \
  src/components/admin/ProductForm.gallery.spec.ts \
  src/components/admin/ProductForm.spec.tsx \
  src/lib/admin-product-graph.spec.ts
pnpm --dir small-house-commerce/backend test
pnpm --dir small-house-commerce/frontend test
pnpm --dir small-house-commerce/backend exec tsc --noEmit
pnpm --dir small-house-commerce/frontend exec tsc --noEmit
pnpm --dir small-house-commerce/backend lint
pnpm --dir small-house-commerce/frontend lint
pnpm --dir small-house-commerce/backend build
pnpm --dir small-house-commerce/frontend build
pnpm --dir small-house-commerce/frontend exec playwright test \
  e2e/admin-product-editor.spec.ts \
  e2e/variant-options-media.spec.ts \
  --project=chromium
```

Expected: zero test/type/build errors; only ledgered pre-existing lint warnings.

- [ ] **Step 8: Review the isolated Product Media diff**

Check all five Review Focus entries and exact no-contract-change boundaries. Diff payload builders/resolver/schema/package manifests against phase base: they must be unchanged. Fix Critical/Important findings RED→GREEN; defer and report Minors.

- [ ] **Step 9: Commit browser acceptance**

```bash
git add \
  small-house-commerce/frontend/e2e/admin-product-editor.spec.ts \
  small-house-commerce/frontend/e2e/variant-options-media.spec.ts
git commit -m "test(admin): verify product media workspace ux"
```

Mark the Product Media phase ledger complete. Then run the single fresh-context whole-range review covering all three phase bases through HEAD, fix all Critical/Important findings in one TDD pass, rerun the complete backend/frontend/unit/type/lint/build/E2E gate, and stop without merge/push/PR/deploy.
