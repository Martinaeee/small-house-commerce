# Unified Product FAQ Closeout Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not dispatch new Agent or Workflow runs.

**Goal:** Extract the completed FAQ subsystem onto the latest deployed base, finish five documented authoring gaps, and release it without crossing shared/product permissions or data boundaries.

**Architecture:** The existing shared FAQ singleton, product-owned FAQ rows, one resolver, shared PUT, and product PATCH remain authoritative. Closeout adds pure ordering/preview/copy helpers, a read-only impact calculation endpoint, and authoritative list refresh after product saves; the release candidate is built from an explicit manifest in a fresh branch.

**Tech Stack:** NestJS 12, Prisma 7.10.0, PostgreSQL 18, Next.js 16.3.4, React 19.2.8, TypeScript, Zod, Vitest, Testing Library, Playwright/Chromium.

**Spec:** `small-house-commerce/docs/superpowers/specs/2026-10-14-four-line-closeout-staged-release-design.md`; feature contracts in `2026-10-09-product-faq-design.md` and `2026-10-10-faq-closeout-design.md`.

## Global Constraints

- Start from the SHA recorded by the master plan after Release B and Product Workbench audit; never start from `feature/homepage-builder`.
- Exclusive FAQ files may be copied after hashing; shared files (`app.module.ts`, Prisma schemas/RBAC/seed, Catalog module/service, AdminShell, ProductForm, APIs, i18n, lockfiles) receive reviewed semantic hunks only.
- Preserve shared writes as `PUT /admin/faq/shared` with `SharedFaqSet.version`; preserve product writes as the existing product PATCH transaction with each `ProductFaq.version`.
- Preserve `PRODUCT_FAQ_SHARED_MANAGE` versus `PRODUCT_MANAGE`; Marketing/OPTIMIZER permissions never imply FAQ permissions.
- Answers remain structured non-HTML blocks; allowed links remain `http`, `https`, and `mailto` only.
- Do not alter SKU, stock, price, media, order, review, Homepage, Marketing, Storefront Shell, Newsletter, or Back-in-stock behavior.
- Read installed Next.js guides before changing route/cache behavior.
- Every closeout behavior follows RED → GREEN; full suites and real browser verification are required before release.
- Use isolated schemas/runtimes and in-memory ordinary-role tokens; do not touch other sessions' ports, `.next`, uploads, fixtures, or candidates.

## Review Focus

1. **Impact preview succeeds but the shared version changes before save:** Task 5 tests that PUT still returns the named 409 and the draft remains visible.
2. **CUSTOM copy is clicked twice or shared items carry audience/category metadata:** Task 4 tests new IDs, exact product-owned fields, no metadata leakage, and explicit append behavior.
3. **Reordering within a category accidentally scrambles other categories or public positions:** Task 3 tests a mixed-category array and exact final positions.
4. **A product save changes default-list membership while another request finishes later:** Task 6 tests authoritative reload sequencing and prevents stale totals from winning.
5. **Targeted shared content is previewed for an unknown/wrong product:** Task 4 tests `productId=null`, selected, and unselected products against the same helper.

---

### Task 1: Assemble the FAQ-only candidate and manifest

**Files:**
- Create: `.superpowers/release-four-lines-20261014/manifests/faq-files.txt`
- Create: `.superpowers/release-four-lines-20261014/manifests/faq-source-sha256.tsv`
- Create: `.superpowers/release-four-lines-20261014/manifests/faq-shared-hunks.md`
- Import exclusive paths: `backend/src/modules/catalog/faq/**`, `backend/src/modules/catalog/dto/product-faq.dto.ts`, `frontend/src/app/admin/(shell)/faq/**`, `frontend/src/components/admin/faq/**`, `FaqWorkspace.tsx`, `ProductFaqPanel.tsx`, `frontend/src/lib/faq-api.ts`, `frontend/e2e/product-faq.spec.ts`.
- Surgically modify representative shared paths: Prisma `schema/faq.prisma` and `schema/identity.prisma`, `prisma/rbac.ts`, `catalog.module.ts`, `products.service.ts`, `AdminShell.tsx`, `ProductForm.tsx`, `admin-api.ts`, `api.ts`, `i18n/en.ts`, `i18n/zh.ts`.

**Interfaces:**
- Consumes: master-plan baseline SHA and the dirty source tree only as a read-only donor.
- Produces: a compilable FAQ candidate whose diff is a subset of `faq-files.txt`.

- [ ] **Step 1: Create the wave branch from the deployed base**

```bash
BASE_SHA=$(git rev-parse release/four-lines-20261014)
git checkout -b release/faq-closeout "$BASE_SHA"
mkdir -p ../manifests ../evidence/faq
```

Expected: clean branch at the post-Release-B/audit documentation base.

- [ ] **Step 2: Write the exclusive/shared allowlist before copying anything**

The manifest must include every imported file and mark each line `EXCLUSIVE`, `SHARED_HUNK`, `MIGRATION_REPLACED`, or `TEST`. It must explicitly exclude Homepage files, Marketing modules, Bundle files, variant packaging files, generated Prisma output, uploads, `.next`, and `.superpowers` source evidence.

Expected: reviewers can tell how every candidate path enters the release.

- [ ] **Step 3: Hash exclusive source files and copy only those files**

```bash
SOURCE_REPO='/Users/Admin1/Desktop/菲律宾家居/建站/codex建站/.claude/worktrees/homepage-builder'
while IFS=$'\t' read -r kind path; do
  test "$kind" = EXCLUSIVE -o "$kind" = TEST || continue
  shasum -a 256 "$SOURCE_REPO/$path" >> ../manifests/faq-source-sha256.tsv
  mkdir -p "$(dirname "$path")"
  cp "$SOURCE_REPO/$path" "$path"
done < ../manifests/faq-files.txt
```

Expected: only manifest paths are copied and every copy has a source hash.

- [ ] **Step 4: Apply shared-file hunks one concern at a time**

For each shared file, compare baseline, source, and current candidate. Record the imported FAQ symbols in `faq-shared-hunks.md`; do not copy the full source file. Required examples include:

```text
identity.prisma: PRODUCT_FAQ_SHARED_MANAGE enum value and FAQ relations only
rbac.ts: descriptor and SUPER_ADMIN/ADMIN grants only
catalog.module.ts: FAQ controllers/services only
products.service.ts: raw FAQ select/write/resolve hooks only
AdminShell.tsx: FAQ nav permission union only
ProductForm.tsx: ProductFaqPanel value/onChange/savedValue/productId only
admin-api.ts/api.ts: FAQ contracts/methods only
i18n: faq_* and product_faq_* keys only
```

Expected: Release B's i18n/API/layout changes remain byte-for-byte except at documented insertion hunks.

- [ ] **Step 5: Verify manifest closure**

```bash
git status --short
git diff --name-only "$BASE_SHA" -- | sort > ../evidence/faq/actual-files.txt
cut -f2 ../manifests/faq-files.txt | sort -u > ../evidence/faq/allowed-files.txt
comm -23 ../evidence/faq/actual-files.txt ../evidence/faq/allowed-files.txt
```

Expected: `comm` prints nothing. Any unexpected path stops assembly.

- [ ] **Step 6: Run the imported focused baseline tests**

```bash
pnpm --dir small-house-commerce/backend exec vitest run \
  src/modules/catalog/faq \
  src/modules/catalog/products.service.faq.spec.ts \
  src/modules/catalog/public-faq.spec.ts
pnpm --dir small-house-commerce/frontend exec vitest run \
  src/components/admin/FaqWorkspace.spec.tsx \
  src/components/admin/ProductFaqPanel.spec.tsx \
  src/components/admin/faq \
  src/components/product/ProductFaqSection.spec.tsx
```

Expected: imported historical behavior is green before closeout changes. If not, diagnose baseline integration before adding features.

- [ ] **Step 7: Commit the isolated import**

```bash
git add -- $(cut -f2 ../manifests/faq-files.txt)
git commit -m "feat(faq): assemble unified product FAQ"
```

Expected: commit contains only FAQ manifest paths.

### Task 2: Normalize FAQ persistence, permission, and migration rollout

**Files:**
- Replace unreleased local migrations: `20261012090000_add_product_faq`, `20261012093000_add_product_faq_permission`, `20261012100000_seed_shared_faq` with new post-baseline names.
- Modify: `backend/prisma/schema/faq.prisma`, `identity.prisma`, `rbac.ts`, `rbac.spec.ts`, `seed-e2e.ts`, `seed-e2e.spec.ts`, `docker-entrypoint.sh`, `package.json` only for the FAQ reconciliation command if required.
- Test: FAQ migration SQL rehearsal and RBAC specs.

**Interfaces:**
- Consumes: imported FAQ schema/services and baseline migration history.
- Produces: append-only FAQ migrations, singleton seed/reconcile behavior, and exact role grants.

- [ ] **Step 1: Write failing migration/RBAC assertions against the clean candidate**

```ts
expect(permissionCodes.filter((code) => code === "PRODUCT_FAQ_SHARED_MANAGE")).toHaveLength(1);
expect(rolePermissions.ADMIN).toContain("PRODUCT_FAQ_SHARED_MANAGE");
expect(rolePermissions.OPTIMIZER).not.toContain("PRODUCT_FAQ_SHARED_MANAGE");
expect(rolePermissions.CUSTOMER_SERVICE).not.toContain("PRODUCT_FAQ_SHARED_MANAGE");
```

Add SQL assertions for a singleton shared set, product FAQ uniqueness, JSON defaults, version defaults, and foreign-key deletion behavior.

- [ ] **Step 2: Run the focused tests and observe RED**

```bash
pnpm --dir small-house-commerce/backend exec vitest run prisma/rbac.spec.ts prisma/seed-e2e.spec.ts src/modules/catalog/faq
```

Expected: failures identify missing permission/schema/reconciliation in the clean candidate, not unrelated compile errors.

- [ ] **Step 3: Create normalized append-only migrations**

Derive `LATEST_MIGRATION` from the current base; assign three consecutive names that sort after it. Preserve the reviewed SQL sequence:

```text
1. ProductFaq/SharedFaqSet schema and constraints
2. PRODUCT_FAQ_SHARED_MANAGE enum/permission support
3. Idempotent LUWAG shared singleton seed
```

Record old→new names and SQL SHA-256 values in `faq-migration-map.tsv`. Do not retain the old historical directories in the candidate.

- [ ] **Step 4: Implement only the missing schema/RBAC/reconcile wiring**

Reuse the existing RBAC reconciliation pattern and duplicate-free assertions. The runtime reconciliation must be idempotent and must grant the permission only to SUPER_ADMIN and ADMIN.

- [ ] **Step 5: Re-run focused tests to GREEN**

```bash
pnpm --dir small-house-commerce/backend exec vitest run prisma/rbac.spec.ts prisma/seed-e2e.spec.ts src/modules/catalog/faq
```

Expected: all focused tests pass.

- [ ] **Step 6: Rehearse fresh and upgrade migrations**

Use unique schemas with explicit `PrismaPg(..., { schema })`. Verify `prisma migrate status`, singleton count=1, permission count=1, expected grants=2, unintended grants=0, and no product/SKU/order row-count change.

- [ ] **Step 7: Commit persistence and rollout wiring**

```bash
git add small-house-commerce/backend/prisma small-house-commerce/backend/src/modules/catalog/faq \
  small-house-commerce/backend/docker-entrypoint.sh small-house-commerce/backend/package.json
 git commit -m "feat(faq): add versioned FAQ persistence and permission"
```

Expected: no unrelated schema or permission enters the commit.

### Task 3: Add shared-question ordering controls

**Files:**
- Create: `frontend/src/components/admin/faq/faq-view.spec.ts`
- Create: `frontend/src/components/admin/faq/FaqSharedSection.spec.tsx`
- Modify: `frontend/src/components/admin/faq/faq-view.ts`
- Modify: `frontend/src/components/admin/faq/FaqSharedSection.tsx`
- Modify: `frontend/src/components/admin/FaqWorkspace.tsx`
- Modify: `frontend/src/i18n/en.ts`, `frontend/src/i18n/zh.ts`
- Test: `FaqSharedSection.spec.tsx`, `FaqWorkspace.spec.tsx`.

**Interfaces:**
- Consumes: `withPositions`, `faqCategoryOf`, current `AdminFaqItem[]`, and shared CAS save.
- Produces: `moveFaqItemWithinCategory(items, itemId, direction): AdminFaqItem[]` and `onMove(item, direction)` UI wiring.

- [ ] **Step 1: Write the failing mixed-category helper test**

```ts
it("swaps adjacent siblings in one category without scrambling another category", () => {
  const next = moveFaqItemWithinCategory(
    [shippingA, paymentB, shippingC],
    shippingC.id,
    -1,
  );
  expect(next.map((item) => item.id)).toEqual([
    shippingC.id,
    paymentB.id,
    shippingA.id,
  ]);
  expect(next.map((item) => item.position)).toEqual([0, 1, 2]);
});
```

Also assert first/last bounds return the original order.

- [ ] **Step 2: Run the helper test to observe RED**

```bash
pnpm --dir small-house-commerce/frontend exec vitest run src/components/admin/faq/faq-view.spec.ts
```

Expected: FAIL because `moveFaqItemWithinCategory` is absent.

- [ ] **Step 3: Implement the pure helper**

```ts
export function moveFaqItemWithinCategory(
  items: AdminFaqItem[],
  itemId: string,
  direction: -1 | 1,
): AdminFaqItem[] {
  const source = items.findIndex((item) => item.id === itemId);
  if (source < 0) return items;
  const category = faqCategoryOf(items[source]);
  const siblingIndexes = items.flatMap((item, index) =>
    faqCategoryOf(item) === category ? [index] : [],
  );
  const sibling = siblingIndexes.indexOf(source);
  const target = siblingIndexes[sibling + direction];
  if (target === undefined) return items;
  const next = [...items];
  [next[source], next[target]] = [next[target], next[source]];
  return withPositions(next);
}
```

- [ ] **Step 4: Write failing UI tests for keyboard-visible move controls**

Render a category with two rows; assert `Move up`/`Move down` buttons are reachable by role, boundary-disabled, invoke `onMove` with the exact item and direction, and remain available without pointer hover.

- [ ] **Step 5: Run the UI tests to observe RED**

```bash
pnpm --dir small-house-commerce/frontend exec vitest run \
  src/components/admin/faq/FaqSharedSection.spec.tsx \
  src/components/admin/FaqWorkspace.spec.tsx
```

Expected: FAIL because shared rows expose no move callbacks.

- [ ] **Step 6: Wire controls through `FaqSharedSection` and `FaqWorkspace`**

Add `onMove: (item: AdminFaqItem, direction: -1 | 1) => void`; use the helper to build the next library and route it through the existing shared-save path and impact confirmation added in Task 5. Disable controls at category boundaries.

- [ ] **Step 7: Run focused tests to GREEN and commit**

```bash
pnpm --dir small-house-commerce/frontend exec vitest run \
  src/components/admin/faq/faq-view.spec.ts \
  src/components/admin/faq/FaqSharedSection.spec.tsx \
  src/components/admin/FaqWorkspace.spec.tsx
git add small-house-commerce/frontend/src/components/admin/faq \
  small-house-commerce/frontend/src/components/admin/FaqWorkspace.tsx \
  small-house-commerce/frontend/src/i18n/{en,zh}.ts
git commit -m "feat(faq): add shared question ordering"
```

### Task 4: Add effective preview and CUSTOM copy-to-product

**Files:**
- Modify: `frontend/src/components/admin/faq/faq-view.ts`
- Modify: `frontend/src/components/admin/faq/faq-view.spec.ts`
- Modify: `frontend/src/components/admin/ProductFaqPanel.tsx`
- Modify: `frontend/src/components/admin/ProductFaqPanel.spec.tsx`
- Reuse: `frontend/src/components/product/ProductFaqSection.tsx`
- Modify: `frontend/src/i18n/en.ts`, `zh.ts`.

**Interfaces:**
- Consumes: `audienceAppliesTo`, `AdminProductFaq`, current shared preview API, and `ProductFaqSection`.
- Produces: `resolveAdminFaqPreview(...)` and `copyApplicableSharedItems(...)`.

- [ ] **Step 1: Write failing pure-helper tests**

```ts
it.each([
  ["SHARED", [sharedA.id]],
  ["EXTEND", [sharedA.id, productA.id]],
  ["CUSTOM", [productA.id]],
] as const)("resolves %s preview in server order", (mode, ids) => {
  expect(
    resolveAdminFaqPreview(shared, { mode, items: [productA], version: 2 }, productId)
      .map((item) => item.id),
  ).toEqual(ids);
});

it("copies only applicable enabled shared questions as new product-owned items", () => {
  const ids = ["copy-1", "copy-2"];
  const copied = copyApplicableSharedItems(shared, productId, 3, () => ids.shift()!);
  expect(copied.map(({ id, position }) => ({ id, position }))).toEqual([
    { id: "copy-1", position: 3 },
    { id: "copy-2", position: 4 },
  ]);
  expect(copied.every((item) => !("audience" in item) && !("category" in item))).toBe(true);
});
```

Cover unknown product IDs and repeated calls producing distinct IDs.

- [ ] **Step 2: Run helper tests to observe RED**

```bash
pnpm --dir small-house-commerce/frontend exec vitest run src/components/admin/faq/faq-view.spec.ts
```

Expected: FAIL because both helpers are absent.

- [ ] **Step 3: Implement exact-field preview and copy helpers**

`resolveAdminFaqPreview` filters enabled/applicable shared items, filters enabled product items, sorts each source by position, selects sources by mode, and renumbers the combined output. `copyApplicableSharedItems` constructs only `{id,title,answer,enabled,position,defaultOpen}` and never spreads a shared item wholesale.

- [ ] **Step 4: Write failing ProductFaqPanel tests**

Assert:

```ts
expect(screen.getByText("Unsaved customer preview")).toBeInTheDocument();
expect(screen.getByRole("button", { name: "Copy applicable shared questions" })).toBeEnabled();
```

Click copy in CUSTOM mode; verify `onChange` receives appended product-owned items, original own items are preserved, a second explicit click creates another independent set, and SHARED/EXTEND do not show the copy action. Verify targeted shared questions only appear for the selected product.

- [ ] **Step 5: Run ProductFaqPanel tests to observe RED**

```bash
pnpm --dir small-house-commerce/frontend exec vitest run src/components/admin/ProductFaqPanel.spec.tsx
```

Expected: semantic failures for missing effective preview and copy action.

- [ ] **Step 6: Render the effective preview and explicit copy action**

Reuse `ProductFaqSection` with the pure helper output. Add a visible unsaved-preview label when `value` differs from `savedValue`. In CUSTOM mode, add a confirmation action that appends copies to the draft only; it must not call any API or change mode.

- [ ] **Step 7: Run focused tests to GREEN and commit**

```bash
pnpm --dir small-house-commerce/frontend exec vitest run \
  src/components/admin/faq/faq-view.spec.ts \
  src/components/admin/ProductFaqPanel.spec.tsx \
  src/components/product/ProductFaqSection.spec.tsx
git add small-house-commerce/frontend/src/components/admin/ProductFaqPanel* \
  small-house-commerce/frontend/src/components/admin/faq/faq-view* \
  small-house-commerce/frontend/src/i18n/{en,zh}.ts
git commit -m "feat(faq): preview and copy effective questions"
```

### Task 5: Add server-calculated shared-save impact confirmation

**Files:**
- Modify: `backend/src/modules/catalog/faq/dto/shared-faq.dto.ts`
- Modify: `backend/src/modules/catalog/faq/admin/shared-faq.controller.ts`
- Modify: `backend/src/modules/catalog/faq/shared-faq.service.ts`
- Modify tests: controller/service specs.
- Modify: `frontend/src/lib/admin-api.ts`, `frontend/src/lib/faq-api.ts`, API specs.
- Modify: `frontend/src/components/admin/FaqWorkspace.tsx`, `FaqWorkspace.spec.tsx`, i18n.

**Interfaces:**
- Consumes: `faqItemsSchema`, `applyingProductCount`, `SharedFaqSet.version` and proposed draft items.
- Produces: `POST /admin/faq/shared/impact` → `{ productCount: number; version: number }` and confirm-before-PUT flow.

- [ ] **Step 1: Write failing backend impact tests**

```ts
it("previews the proposed library impact without writing or incrementing version", async () => {
  const before = await service.get();
  const impact = await service.previewImpact(targetedItems, before.version);
  expect(impact).toEqual({ productCount: 2, version: before.version });
  expect((await service.get()).version).toBe(before.version);
});
```

Also test disabled-only→0, ACTIVE non-CUSTOM distinct count, invalid/deleted audience IDs→400, stale expectedVersion→named 409, and no `sharedFaqSet.update` call.

- [ ] **Step 2: Run backend tests to observe RED**

```bash
pnpm --dir small-house-commerce/backend exec vitest run \
  src/modules/catalog/faq/shared-faq.service.spec.ts \
  src/modules/catalog/faq/admin/shared-faq.controller.spec.ts
```

Expected: FAIL because impact schema/service/route are absent.

- [ ] **Step 3: Implement reusable impact calculation**

Extract private helpers that load ACTIVE non-CUSTOM IDs and validate targeted audience IDs. `previewImpact(rawItems, expectedVersion)` parses with `faqItemsSchema`, checks current version, validates selected IDs, and returns the proposed count without a write.

Add the guarded route:

```ts
@Post("impact")
@HttpCode(200)
impact(
  @Body(new ZodValidationPipe(updateSharedFaqSchema)) input: UpdateSharedFaqInput,
) {
  return this.sharedFaq.previewImpact(input.items, input.expectedVersion);
}
```

- [ ] **Step 4: Run backend tests to GREEN**

```bash
pnpm --dir small-house-commerce/backend exec vitest run \
  src/modules/catalog/faq/shared-faq.service.spec.ts \
  src/modules/catalog/faq/admin/shared-faq.controller.spec.ts
```

- [ ] **Step 5: Write failing frontend confirmation tests**

Mock `faqApi.previewSharedImpact`. Trigger add/edit/toggle/delete/reorder and assert impact is requested before PUT. Cancel the confirmation and assert `updateShared` is not called. Confirm and assert PUT receives the exact draft/version. Reject impact and assert a readable error while the dialog/draft stays open. Return impact then make PUT 409 and assert conflict reload remains the existing named flow.

- [ ] **Step 6: Run frontend tests to observe RED**

```bash
pnpm --dir small-house-commerce/frontend exec vitest run \
  src/lib/faq-api.spec.ts \
  src/components/admin/FaqWorkspace.spec.tsx
```

Expected: failures for missing impact method and confirmation order.

- [ ] **Step 7: Implement API method and confirmation**

Add `previewSharedImpact(items, expectedVersion)`. Use a native or existing accessible confirmation that includes the returned distinct product count and the approved impact copy. Keep the original item dialog open on cancel/error; only PUT after confirm.

- [ ] **Step 8: Run focused tests to GREEN and commit**

```bash
pnpm --dir small-house-commerce/backend exec vitest run src/modules/catalog/faq
pnpm --dir small-house-commerce/frontend exec vitest run src/lib/faq-api.spec.ts src/components/admin/FaqWorkspace.spec.tsx
git add small-house-commerce/backend/src/modules/catalog/faq \
  small-house-commerce/frontend/src/lib/{admin-api,faq-api}* \
  small-house-commerce/frontend/src/components/admin/FaqWorkspace* \
  small-house-commerce/frontend/src/i18n/{en,zh}.ts
git commit -m "feat(faq): confirm shared library impact"
```

### Task 6: Refresh product totals and membership after saves

**Files:**
- Modify: `frontend/src/components/admin/FaqWorkspace.tsx`
- Modify: `frontend/src/components/admin/FaqWorkspace.spec.tsx`

**Interfaces:**
- Consumes: existing sequenced `loadProducts`, `reloadProducts`, `productsRequestId`, and successful product PATCH response.
- Produces: authoritative post-save group membership and totals without stale response overwrite.

- [ ] **Step 1: Write failing membership and race tests**

```ts
it("reloads authoritative totals when a saved product leaves the default group", async () => {
  // Initial total 2; save the visible CUSTOM product as SHARED with no items.
  // The post-save list returns total 1 and omits it.
  expect(await screen.findByTestId("faq-product-total")).toHaveTextContent("1");
  expect(screen.queryByText(product.name)).not.toBeInTheDocument();
});
```

Add a deferred first reload and a faster second reload; assert the late first response cannot restore the old total/list. Verify a failed/409 save does not reload or change totals.

- [ ] **Step 2: Run the tests to observe RED**

```bash
pnpm --dir small-house-commerce/frontend exec vitest run src/components/admin/FaqWorkspace.spec.tsx
```

Expected: total/membership remain stale after an existing-group save.

- [ ] **Step 3: Reload authoritative product groups after every successful save**

Keep the returned FAQ version for immediate local feedback, close the successful dialog, then invoke the existing sequenced reload. Do not reload on failure or conflict. Do not add a second list implementation.

- [ ] **Step 4: Run tests to GREEN and commit**

```bash
pnpm --dir small-house-commerce/frontend exec vitest run src/components/admin/FaqWorkspace.spec.tsx
git add small-house-commerce/frontend/src/components/admin/FaqWorkspace.tsx \
  small-house-commerce/frontend/src/components/admin/FaqWorkspace.spec.tsx
git commit -m "fix(faq): refresh product membership after save"
```

### Task 7: Run the FAQ release gate and exact-manifest self-review

**Files:**
- Create: `.superpowers/sdd/2026-10-14-faq-closeout-release/progress.md`
- Create: `.superpowers/sdd/2026-10-14-faq-closeout-release/review-package.md`
- Update: FAQ manifest/evidence files.

**Interfaces:**
- Consumes: complete FAQ candidate.
- Produces: a green release SHA and evidence ready for production.

- [ ] **Step 1: Run full backend and frontend unit suites**

```bash
pnpm --dir small-house-commerce/backend test
pnpm --dir small-house-commerce/frontend test
```

Expected: zero failures; record exact passed/skipped counts.

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
git diff --check "$BASE_SHA"..HEAD
```

Expected: exit 0. Classify every warning; do not conceal baseline failures.

- [ ] **Step 3: Rehearse fresh and upgrade migrations**

Expected: pending count equals the normalized FAQ migration count; singleton/permission/grant invariants and unchanged commerce row counts pass.

- [ ] **Step 4: Run real Chromium acceptance**

Use `frontend/e2e/product-faq.spec.ts` plus added closeout scenarios. Cover shared-only/product-only/full roles, ordering, effective preview, CUSTOM copy, impact cancel/confirm/error/409, targeted audiences, refresh membership, desktop/mobile, PDP and landing output, and zero page errors. Use normal login and in-memory tokens.

Expected: all scenarios pass and screenshots are visually inspected.

- [ ] **Step 5: Perform a separate exact-manifest self-review**

No Agent review is dispatched under the user's standing constraint. Review every changed production file against the three specs and all five Review Focus cases. Record `Final review: self-review (Agent use prohibited)` and disclose this weaker assurance.

- [ ] **Step 6: Fix Critical/Important findings once, with RED → GREEN**

For each surviving finding: add a failing regression, implement one fix, run focused and full suites, and record it. Defer Minor findings in the ledger; do not opportunistically expand scope.

- [ ] **Step 7: Commit the final FAQ release candidate**

```bash
git status --short
git commit --allow-empty -m "chore(faq): finalize release gate"
FAQ_RELEASE_SHA=$(git rev-parse HEAD)
```

Expected: manifest closure, clean tree, and a recorded immutable SHA.

### Task 8: Push, deploy, and verify FAQ production

**Files:**
- Create: `.superpowers/release-four-lines-20261014/evidence/wave-1-faq-production.md`
- Update after success: persistent FAQ and production handoff memories.

**Interfaces:**
- Consumes: green `FAQ_RELEASE_SHA`.
- Produces: deployed FAQ baseline consumed by Marketing.

- [ ] **Step 1: Create verified backup and rollback images before push/deploy**

```bash
ssh smallhouse-prod 'set -eu
  stamp=$(date +%Y%m%dT%H%M%S%z)
  dir=/root/deploy-backups/faq-$stamp
  mkdir -p "$dir"
  docker exec small-house-prod-db pg_dump -U smallhouse -Fc small_house > "$dir/pre-faq.dump"
  pg_restore --list "$dir/pre-faq.dump" > "$dir/pre-faq.list"
  sha256sum "$dir/pre-faq.dump" > "$dir/SHA256SUMS"
  docker image tag small-house-prod-backend:latest small-house-prod-backend:rollback-pre-faq
  docker image tag small-house-prod-frontend:latest small-house-prod-frontend:rollback-pre-faq
'
```

Expected: nonempty dump, readable restore list, checksum, and both rollback tags.

- [ ] **Step 2: Record the reviews hotfix checksum and service state**

Verify the known reviews file SHA-256, four container restart counts, Back-in-stock config unset state, and current public/API smokes. Store results in the wave evidence.

- [ ] **Step 3: Push the fast-forward release through the proxy**

```bash
git -c http.proxy=http://127.0.0.1:7897 \
    -c https.proxy=http://127.0.0.1:7897 \
    push origin HEAD:main
```

Expected: fast-forward only; remote `main` equals `FAQ_RELEASE_SHA`.

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

Expected: build exit 0, only rehearsed FAQ migrations apply, backend/frontend become healthy, DB/Caddy are not recreated.

- [ ] **Step 5: Run production acceptance**

Verify public FAQ API/PDP/landing behavior, admin routes (401 unauthenticated and authorized role matrix with in-memory tokens), permission counts/grants, singleton/version, no leaked audience IDs, cache revalidation, logs, restart counts, Back-in-stock fail-closed, Newsletter, Storefront Shell, Homepage, reviews hotfix checksum, and unchanged product/SKU/order/inventory counts.

- [ ] **Step 6: Record and commit the production handoff evidence**

Document SHA, migration count, image digests, backup path/checksum, rollback tags, test/browser counts, production responses, and known limitations. Update existing memories without duplicating them.
