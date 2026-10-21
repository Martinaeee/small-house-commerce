# Homepage Builder P2 Section Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Each task ends with a RED → GREEN test cycle and an independent review gate.

**Goal:** Add a real Add Section library and type-specific editors for all nine existing non-Hero homepage section types while preserving the P1 versioned document, validation, save, publish, and preview contracts.

**Architecture:** Keep `HomepageDocument` as the single source of truth and add a typed frontend section-payload layer that mirrors the existing backend Zod schemas. A section registry will own labels, default factories, and editor components; the editor shell will route the selected section to that registry while all mutations continue through `HomepageEditor`'s reducer. The first P2 slice changes frontend admin code and tests only; it does not add section types, database columns, migrations, or backend APIs.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind v4, Vitest, React Testing Library, Playwright, existing admin API and homepage document reducer.

**Spec:** `small-house-commerce/docs/superpowers/specs/2026-09-29-homepage-builder-p2-section-builder-design.md`

## Global Constraints

- Preserve the stored document envelope `{ schemaVersion, sections, announcement }` and all existing P1 save/publish/version routes.
- Reuse the current backend payload contracts in `backend/src/modules/cms/dto/homepage-section.dto.ts`; do not add a migration, database field, or new backend section type.
- All document writes go through the existing reducer; buffered fields dispatch `mutate` against the latest document and discrete actions dispatch `commit`.
- Existing Hero, Announcement, preview, conflict, autosave, restore, and publish behavior must remain unchanged.
- Do not touch ProductForm, Catalog Graph, inventory, order, media-upload, or `backend/uploads/` code.
- Admin copy requires zh/en i18n parity; storefront copy remains English-only.
- Footer, Header, navigation, Mega Menu, and new blocks such as Countdown/Promo/Newsletter are out of scope for this plan.
- Every task writes tests first, runs the failing test, implements the smallest change, and runs its focused and relevant full suite.

## Review Focus

- A new section must be valid for the exact backend payload schema before the first save; task 1 tests every factory against the mirrored contract.
- A section inserted between two existing sections must receive stable identity and deterministic sort order without changing unrelated section products or payloads; task 2 tests insertion and reorder.
- A buffered edit made immediately before switching to another section must land on the original section and never overwrite the newly selected section; task 3 tests target identity and latest-document mutation.
- Product/category/entity rows must preserve stable ids and ordering while an async lookup is pending or returns out of order; tasks 4–6 test identity and stale-response handling.
- A malformed or legacy optional payload must render an editor with safe defaults rather than crash the builder; task 3 tests runtime normalization and the final browser task covers the real route.

---

### Task 1: Typed section contracts, defaults, and pure mutators

**Files:**
- Create: `small-house-commerce/frontend/src/lib/homepage-section-payloads.ts`
- Create: `small-house-commerce/frontend/src/lib/homepage-section-factory.ts`
- Modify: `small-house-commerce/frontend/src/lib/homepage-document.ts`
- Test: `small-house-commerce/frontend/src/lib/homepage-section-factory.spec.ts`
- Test: `small-house-commerce/frontend/src/lib/homepage-document.spec.ts`

**Interfaces:**
- Consumes: `HomepageSection`, `HomepageDocument`, `SectionType`, existing UUID/clone conventions, and backend schema field names in `homepage-section.dto.ts`.
- Produces: typed payload aliases for `USP`, `CATEGORY_TILES`, `PRODUCT_GRID`, `SOLUTIONS`, `PRODUCT_STORY`, `ROOM_INSPIRATION`, `UGC`, `BRAND_STORY`, and `CONFIDENCE`; `defaultSection(type, id, sortOrder)`; `insertSection(document, section, afterId)`; `updateSectionPayload(document, sectionId, updater)`; `duplicateSection` support for every nine types.

- [ ] **Step 1: Write the failing tests.**

```ts
it.each(SECTION_TYPES)("creates a backend-valid default for %s", (type) => {
  const section = defaultSection(type, `section-${type}`, 20);
  expect(section.type).toBe(type);
  expect(section.enabled).toBe(true);
  expect(section.products).toEqual([]);
  expect(validatePayload(type, section.payload)).toEqual({ ok: true });
});

it("inserts after the selected section and renumbers only section sortOrder", () => {
  const next = insertSection(documentFixture(), defaultSection("USP", "new", 0), "hero");
  expect(next.sections.map(({ id }) => id)).toEqual(["hero", "new", "grid"]);
  expect(next.sections.find(({ id }) => id === "grid")?.payload).toEqual(
    documentFixture().sections.find(({ id }) => id === "grid")?.payload,
  );
});

it("updates a typed payload without changing section products or siblings", () => {
  const next = updateSectionPayload(documentFixture(), "usp", (payload) => ({
    ...payload,
    items: [{ label: "Fast delivery" }],
  }));
  expect(next.sections.find(({ id }) => id === "usp")?.products).toEqual([]);
  expect(next.sections.find(({ id }) => id === "grid")?.payload).toEqual(
    documentFixture().sections.find(({ id }) => id === "grid")?.payload,
  );
});
```

- [ ] **Step 2: Run focused tests to verify RED.**

Run: `pnpm --dir small-house-commerce/frontend exec vitest run src/lib/homepage-section-factory.spec.ts src/lib/homepage-document.spec.ts`

Expected: the new factory/mutator imports or assertions fail because typed payloads and insertion helpers do not exist.

- [ ] **Step 3: Implement the minimum typed model and factories.**

Mirror the backend fields exactly:

```ts
export type UspPayload = { items?: Array<{ icon?: "shield" | "home" | "lock" | "truck"; label: string; sub?: string }> };
export type CategoryTilesPayload = { categoryIds?: string[] };
export type ProductGridPayload = { columns?: 2 | 4 };
export type SolutionsPayload = { items?: Array<{ title: string; blurb?: string; link: string }> };
export type ProductStoryPayload = { imageUrl?: string; heading?: string; body?: string; ctaText?: string; ctaLink?: string; productId?: string };
export type RoomInspirationPayload = { imageUrl?: string; heading?: string; body?: string; scenes?: RoomScene[] };
export type UgcPayload = { entries?: Array<{ imageUrl?: string; name: string; location?: string; comment: string; productId?: string }> };
export type TextBlockPayload = { heading?: string; body?: string; bullets?: string[] };
```

`defaultSection()` must initialize optional arrays as empty only where the existing storefront and backend accept them, preserve `products: []`, and leave `title` as `null` so the admin registry can render a localized label without writing admin-language copy into the storefront document. `insertSection()` must clone the document, insert at the requested position, and renumber section sort orders in deterministic increments. `updateSectionPayload()` must return the original document reference for an unknown section id and clone only the affected section path.

- [ ] **Step 4: Run focused tests to verify GREEN.**

Run the same Vitest command. Expected: all new factory/mutator tests and all existing homepage-document tests pass.

- [ ] **Step 5: Run type-check and commit the task.**

Run: `pnpm --dir small-house-commerce/frontend exec tsc --noEmit`

Commit: `feat(homepage): add typed section factories and mutators`

---

### Task 2: Add Section dialog and module-tree integration

**Files:**
- Create: `small-house-commerce/frontend/src/components/admin/homepage/AddSectionDialog.tsx`
- Modify: `small-house-commerce/frontend/src/components/admin/homepage/ModuleTree.tsx`
- Modify: `small-house-commerce/frontend/src/components/admin/homepage/ModuleTree.spec.tsx`
- Modify: `small-house-commerce/frontend/src/i18n/zh.ts`
- Modify: `small-house-commerce/frontend/src/i18n/en.ts`

**Interfaces:**
- Consumes: `defaultSection`, `insertSection`, the ordered `SECTION_TYPES` list from Task 1, and the existing `HomepageEditorContext` selection/reducer.
- Produces: an accessible `AddSectionDialog` opened by an Add Section button; insertion selects the new section, restores focus on close, and leaves existing module-tree reorder/toggle behavior intact.

- [ ] **Step 1: Write RED tests.**

Add component tests for:

- Add Section trigger is visible and keyboard reachable;
- opening the dialog exposes nine localized choices and a close button;
- selecting `USP` inserts it after the selected module and selects it;
- selecting with no module selected appends the section;
- Escape/close returns focus to the trigger;
- Add Section does not alter existing section product rows or announcement data;
- duplicate/delete controls remain available for all types after the registry change.

Example assertion:

```tsx
fireEvent.click(screen.getByRole("button", { name: "Add section" }));
fireEvent.click(screen.getByRole("button", { name: "USP" }));
expect(order()).toBe("hero,usp,grid");
expect(screen.getByRole("button", { name: "USP" })).toHaveAttribute("aria-pressed", "true");
```

- [ ] **Step 2: Run `ModuleTree.spec.tsx` to verify RED.**

Run: `pnpm --dir small-house-commerce/frontend exec vitest run src/components/admin/homepage/ModuleTree.spec.tsx`

Expected: Add Section queries fail because no trigger/dialog exists.

- [ ] **Step 3: Implement the dialog and insertion path.**

Use a native dialog-compatible existing `Dialog` component or the project’s existing dialog pattern. Render registry metadata, use `aria-labelledby`, return focus to the trigger, and call `dispatch({ type: "commit", document: insertSection(...) })` exactly once per selection. Do not create a second local document state. Add localized labels and descriptions for all nine current types.

Expand `ADDABLE_SECTION_TYPES` to all current non-Hero types only after the duplicate behavior has a valid factory. Keep Hero and Announcement out of Add Section.

- [ ] **Step 4: Run focused tests and the homepage component suite.**

Run: `pnpm --dir small-house-commerce/frontend exec vitest run src/components/admin/homepage/ModuleTree.spec.tsx src/components/admin/homepage/HomepageEditor.spec.tsx`

Expected: all tests pass, including existing keyboard drag and selection tests.

- [ ] **Step 5: Type-check/lint and commit.**

Run: `pnpm --dir small-house-commerce/frontend exec tsc --noEmit && pnpm --dir small-house-commerce/frontend exec eslint src/components/admin/homepage/AddSectionDialog.tsx src/components/admin/homepage/ModuleTree.tsx src/components/admin/homepage/ModuleTree.spec.tsx`

Commit: `feat(homepage): add section library to module tree`

---

### Task 3: Section editor registry, routing, normalization, and shared panels

**Files:**
- Create: `small-house-commerce/frontend/src/components/admin/homepage/sections/section-editor-registry.ts`
- Create: `small-house-commerce/frontend/src/components/admin/homepage/sections/SectionEditorPanel.tsx`
- Create: `small-house-commerce/frontend/src/components/admin/homepage/sections/SectionCommonFields.tsx`
- Create: `small-house-commerce/frontend/src/components/admin/homepage/sections/SectionStyleFields.tsx`
- Create: `small-house-commerce/frontend/src/lib/homepage-section-normalize.ts`
- Modify: `small-house-commerce/frontend/src/components/admin/homepage/HomepageEditor.tsx`
- Modify: `small-house-commerce/frontend/src/components/admin/homepage/HomepageEditor.spec.tsx`
- Test: `small-house-commerce/frontend/src/components/admin/homepage/sections/SectionEditorPanel.spec.tsx`
- Test: `small-house-commerce/frontend/src/lib/homepage-section-normalize.spec.ts`

**Interfaces:**
- Consumes: typed payloads/factories from Task 1, Add Section selection from Task 2, and existing `HomepageEditorContext` callbacks.
- Produces: registry metadata for all nine types, a routing panel that renders a type editor or a safe empty state, `normalizeSectionForEditor(section)` that supplies read-safe defaults without mutating the document.

- [ ] **Step 1: Write RED tests.**

Pin:

- each non-Hero type resolves to a distinct editor registry entry;
- a selected `USP`, `CATEGORY_TILES`, and `PRODUCT_GRID` routes away from HeroStyleSettings;
- a malformed optional payload such as `{}` renders safe empty controls and does not throw;
- switching from a selected Hero element to a non-Hero section clears no document data and does not reuse a pending Hero buffer;
- common title/subtitle/enabled/schedule fields dispatch latest-document mutations;
- style fields preserve unrelated style keys and clear back to inherited/absent state.

- [ ] **Step 2: Run focused tests to verify RED.**

Run: `pnpm --dir small-house-commerce/frontend exec vitest run src/components/admin/homepage/sections/SectionEditorPanel.spec.tsx src/lib/homepage-section-normalize.spec.ts src/components/admin/homepage/HomepageEditor.spec.tsx`

Expected: imports/routing assertions fail because no section editor registry or non-Hero route exists.

- [ ] **Step 3: Implement registry and routing.**

Registry entries must expose:

```ts
type SectionEditorDefinition = {
  type: Exclude<SectionType, "HERO">;
  labelKey: TKey;
  descriptionKey: TKey;
  createDefault: (id: string, sortOrder: number) => HomepageSection;
  Editor: ComponentType<SectionEditorProps>;
};
```

`SectionEditorPanel` receives the selected section id and dispatch callbacks. It must normalize reads only, then write the smallest typed patch through `mutate`. `HomepageEditorShell` routes selected non-Hero sections after Hero-specific routes and before the generic HeroStyleSettings fallback.

Common fields must use the current buffered hooks and target identity. No new save API, context field, or backend call is introduced.

- [ ] **Step 4: Run focused tests to verify GREEN.**

Run the same focused command. Expected: routing, normalization, and stale-target tests pass.

- [ ] **Step 5: Run full homepage tests and commit.**

Run: `pnpm --dir small-house-commerce/frontend exec vitest run src/components/admin/homepage`

Commit: `feat(homepage): route typed section editors through builder shell`

---

### Task 4: USP, Category Tiles, and Product Grid editors

**Files:**
- Create: `small-house-commerce/frontend/src/components/admin/homepage/sections/UspSectionEditor.tsx`
- Create: `small-house-commerce/frontend/src/components/admin/homepage/sections/CategoryTilesSectionEditor.tsx`
- Create: `small-house-commerce/frontend/src/components/admin/homepage/sections/ProductGridSectionEditor.tsx`
- Create: `small-house-commerce/frontend/src/components/admin/homepage/sections/UspSectionEditor.spec.tsx`
- Create: `small-house-commerce/frontend/src/components/admin/homepage/sections/CategoryTilesSectionEditor.spec.tsx`
- Create: `small-house-commerce/frontend/src/components/admin/homepage/sections/ProductGridSectionEditor.spec.tsx`
- Modify: `small-house-commerce/frontend/src/components/admin/homepage/sections/section-editor-registry.ts`
- Modify: `small-house-commerce/frontend/src/i18n/zh.ts`
- Modify: `small-house-commerce/frontend/src/i18n/en.ts`
- Reuse: existing admin entity lookup, media input, and Product/Category selector primitives where available

**Interfaces:**
- Consumes: Task 1 typed payloads/mutators and Task 3 panel props/normalization.
- Produces: controlled editors whose changes update only their selected section and preserve existing `section.products`, `sortOrder`, schedule, and sibling sections.

- [ ] **Step 1: Write RED tests.**

Pin:

- USP adds/removes/reorders up to four items, validates non-empty labels, supports the four backend icons, and preserves pending text when another section is selected only after flushing the original target;
- Category Tiles searches/selects up to six categories, reorders by stable category id, and never writes a category name in place of an id;
- Product Grid edits 2/4 columns, product order, badge text, and empty-state behavior without changing product identity;
- all three editors render safe empty defaults for legacy `{}` payloads;
- disabled remove buttons explain the backend maximum/minimum constraint.

- [ ] **Step 2: Run focused tests to verify RED.**

Run the three new specs plus `SectionEditorPanel.spec.tsx`. Expected: editor modules are missing or assertions fail.

- [ ] **Step 3: Implement the three editors.**

Use stable keys (`productId`, `categoryId`, or generated row id only for unsaved rows), never array index as identity. Apply row changes through one `mutate` callback against the latest section. Serialize category/product selections into the existing wire fields. Keep Product Grid’s product join rows in `section.products`; keep `payload.columns` limited to 2 or 4.

- [ ] **Step 4: Run focused tests, full frontend tests, and type-check.**

Run: `pnpm --dir small-house-commerce/frontend exec vitest run src/components/admin/homepage/sections src/components/admin/homepage/HomepageEditor.spec.tsx && pnpm --dir small-house-commerce/frontend exec tsc --noEmit`

Expected: all focused tests and the existing frontend suite remain green.

- [ ] **Step 5: Commit.**

Commit: `feat(homepage): add core section content editors`

---

### Task 5: Solutions, Product Story, Room Inspiration, UGC, Brand Story, and Confidence editors

**Files:**
- Create: `small-house-commerce/frontend/src/components/admin/homepage/sections/SolutionsSectionEditor.tsx`
- Create: `small-house-commerce/frontend/src/components/admin/homepage/sections/ProductStorySectionEditor.tsx`
- Create: `small-house-commerce/frontend/src/components/admin/homepage/sections/RoomInspirationSectionEditor.tsx`
- Create: `small-house-commerce/frontend/src/components/admin/homepage/sections/UgcSectionEditor.tsx`
- Create: `small-house-commerce/frontend/src/components/admin/homepage/sections/TextBlockSectionEditor.tsx`
- Create: `small-house-commerce/frontend/src/components/admin/homepage/sections/SolutionsSectionEditor.spec.tsx`
- Create: `small-house-commerce/frontend/src/components/admin/homepage/sections/ProductStorySectionEditor.spec.tsx`
- Create: `small-house-commerce/frontend/src/components/admin/homepage/sections/RoomInspirationSectionEditor.spec.tsx`
- Create: `small-house-commerce/frontend/src/components/admin/homepage/sections/UgcSectionEditor.spec.tsx`
- Create: `small-house-commerce/frontend/src/components/admin/homepage/sections/TextBlockSectionEditor.spec.tsx`
- Modify: `small-house-commerce/frontend/src/components/admin/homepage/sections/section-editor-registry.ts`
- Modify: `small-house-commerce/frontend/src/i18n/zh.ts`
- Modify: `small-house-commerce/frontend/src/i18n/en.ts`

**Interfaces:**
- Consumes: Task 3 panel contract and Task 4 entity/media row patterns.
- Produces: editors for all remaining existing non-Hero types with the exact backend field names and limits.

- [ ] **Step 1: Write RED tests.**

Pin exact payload behavior:

- Solutions supports six `{ title, blurb?, link }` rows and uses the existing link resolver/serializer;
- Product Story edits image, heading, body, CTA, and product id without overwriting omitted optional fields;
- Room Inspiration supports image, heading, body, five scenes, stable scene ids, eight hotspots per scene, unique product per scene, and clamped x/y percentages;
- UGC supports six entries with image/name/location/comment/product id;
- Brand Story and Confidence share a text-block editor but keep separate selected section identities and payloads;
- each editor handles malformed legacy optional fields without throwing and blocks only the exact schema-invalid action.

- [ ] **Step 2: Run focused tests to verify RED.**

Run all six new editor specs. Expected: missing editor modules or failing payload assertions.

- [ ] **Step 3: Implement with shared row and media primitives.**

Keep shared components presentational and controlled. Use explicit add/remove/reorder handlers per row type, preserve row ids/scenes, and use the existing media URL/upload and LinkPicker contracts through adapters rather than changing stored payload types. Do not add a new backend endpoint for any editor.

- [ ] **Step 4: Run focused tests plus all frontend tests and type-check.**

Run: `pnpm --dir small-house-commerce/frontend test && pnpm --dir small-house-commerce/frontend exec tsc --noEmit`

Expected: 101+ frontend files pass with no TypeScript errors.

- [ ] **Step 5: Commit.**

Commit: `feat(homepage): add remaining section content editors`

---

### Task 6: Shared style/advanced UI, i18n parity, and editor UX hardening

**Files:**
- Modify: `small-house-commerce/frontend/src/components/admin/homepage/sections/SectionCommonFields.tsx`
- Modify: `small-house-commerce/frontend/src/components/admin/homepage/sections/SectionStyleFields.tsx`
- Modify: `small-house-commerce/frontend/src/components/admin/homepage/sections/section-editor-registry.ts`
- Modify: `small-house-commerce/frontend/src/i18n/zh.ts`
- Modify: `small-house-commerce/frontend/src/i18n/en.ts`
- Test: `small-house-commerce/frontend/src/components/admin/homepage/sections/SectionCommonFields.spec.tsx`
- Test: `small-house-commerce/frontend/src/components/admin/homepage/sections/SectionStyleFields.spec.tsx`
- Modify: `small-house-commerce/frontend/src/components/admin/homepage/HomepageEditor.spec.tsx`

**Interfaces:**
- Consumes: all editors from Tasks 4–5.
- Produces: consistent Content/Style/Advanced groups, field-level errors, no horizontal overflow, and complete zh/en copy parity.

- [ ] **Step 1: Write RED tests.**

Pin shared title/subtitle buffering, enabled/schedule controls, style inheritance/clear behavior, max-width panel behavior at 375px, accessible group names, and a compile-time/runtime zh/en key parity check.

- [ ] **Step 2: Run focused tests to verify RED.**

Run section editor tests and i18n/type checks. Expected: new labels or behavior assertions fail before implementation.

- [ ] **Step 3: Implement shared panel behavior.**

Keep shared fields controlled by the selected section id. Use the established `mutate` path for buffered input and `commit` for toggles/selects. Ensure panel lists use local overflow containers and never create page-wide horizontal scrolling.

- [ ] **Step 4: Run full frontend tests, type-check, lint, and diff-check.**

Run:

```bash
pnpm --dir small-house-commerce/frontend test
pnpm --dir small-house-commerce/frontend exec tsc --noEmit
pnpm --dir small-house-commerce/frontend lint
git diff --check
```

Expected: all tests pass; lint has no new errors; any pre-existing warnings are reported rather than silently ignored.

- [ ] **Step 5: Commit.**

Commit: `feat(homepage): standardize section editor panels and copy`

---

### Task 7: Draft/save/publish integration and regression coverage

**Files:**
- Modify: `small-house-commerce/frontend/src/components/admin/homepage/HomepageEditor.spec.tsx`
- Modify: `small-house-commerce/frontend/src/components/admin/homepage/ModuleTree.spec.tsx`
- Modify: `small-house-commerce/frontend/src/app/admin/(shell)/homepage/versions/page.spec.tsx` only if the new section shapes need a fixture update

**Interfaces:**
- Consumes: completed Add Section and editors from Tasks 1–6.
- Produces: proof that edited sections survive save/reload, conflict handling, version restore, preview, and publish gating.

- [ ] **Step 1: Write RED integration tests.**

Pin the real admin API call sequence for:

- add USP → edit label → Save Draft sends the full valid document;
- add Product Grid → edit columns/products → reload adopts the saved revision;
- save conflict still shows the existing conflict bar and does not silently drop section edits;
- restore a version containing a newly added section returns to the editor without publishing;
- draft preview shows the new section while the live storefront remains unchanged until publish.

- [ ] **Step 2: Run the integration tests to verify RED.**

Run focused homepage integration specs. Expected: new flow assertions fail before the integration wiring is complete.

- [ ] **Step 3: Implement only the missing wiring.**

Do not introduce a second save function. Reuse `save`, `saveForPublish`, `adminApi.getHomepageDraft`, and the existing version/preview helpers. Update fixtures only to represent valid section payloads.

- [ ] **Step 4: Run backend contract tests and full frontend tests.**

Run:

```bash
pnpm --dir small-house-commerce/backend test
pnpm --dir small-house-commerce/backend exec tsc -p tsconfig.build.json --noEmit
pnpm --dir small-house-commerce/frontend test
pnpm --dir small-house-commerce/frontend exec tsc --noEmit
```

Expected: existing backend contracts remain green without backend source changes; frontend suite is green.

- [ ] **Step 5: Commit.**

Commit: `test(homepage): cover section draft and publish flows`

---

### Task 8: Real-browser acceptance and final review gate

**Files:**
- Create: `small-house-commerce/frontend/e2e/homepage-builder-sections.spec.ts`
- Create: `small-house-commerce/.superpowers/sdd/2026-09-29-homepage-builder-p2/progress.md`

**Interfaces:**
- Consumes: the complete P2 builder.
- Produces: browser evidence and a final review package; no deployment or merge.

- [ ] **Step 1: Write browser tests.**

Cover authenticated admin flows at 375×812, 768×1024, and 1440×900:

- open Add Section with keyboard and add USP;
- edit USP and Product Grid content;
- add/reorder/delete/undo a section;
- save draft and reload;
- open draft preview and verify the section appears;
- confirm no live storefront change before publish;
- confirm no page error, console error, hydration warning, or horizontal overflow.

Use the isolated rehearsal database and clean up any created draft state in `finally`; do not connect to production or touch `backend/uploads/catalog/`.

- [ ] **Step 2: Run the browser suite and inspect screenshots.**

Run: `pnpm --dir small-house-commerce/frontend exec playwright test e2e/homepage-builder-sections.spec.ts --project=chromium`

Expected: all scenarios pass at all requested viewports and screenshots show the Add Section picker, editor panel, and preview result.

- [ ] **Step 3: Run final gates.**

Run:

```bash
pnpm --dir small-house-commerce/backend test
pnpm --dir small-house-commerce/backend exec tsc -p tsconfig.build.json --noEmit
pnpm --dir small-house-commerce/frontend test
pnpm --dir small-house-commerce/frontend exec tsc --noEmit
pnpm --dir small-house-commerce/frontend lint
git diff --check
```

- [ ] **Step 4: Request one fresh whole-branch review.**

Review the P2 spec, all task commits, the progress ledger, the five Review Focus inputs, and the browser evidence. Fix Critical/Important findings with a new RED → GREEN test and one final suite run. Do not push, merge, create a PR, or deploy.

- [ ] **Step 5: Record completion without deployment.**

Write the exact test counts, browser results, deferred minors, and any rulings to the P2 ledger. Keep the feature branch and all worktrees intact for the user’s next integration decision.
