# Marketing Workbench Closeout Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not dispatch new Agent or Workflow runs.

**Goal:** Extract the completed Marketing Workbench onto the deployed FAQ baseline, fix two recorded correctness/continuity gaps, clear the previously environment-blocked attribution and PostgreSQL gates, rehearse the legacy backfill, and release it safely.

**Architecture:** Keep the existing owner-scoped Marketing domain, versioned landing-page documents, server-validated Puck content, stable AID/campaign links, immutable touch/order attribution, daily costs, and cohort-based reports. Closeout changes are narrow: null-safe report serialization and route-context preservation; the larger work is clean extraction, migration/backfill rehearsal, complete browser/regression proof, and staged deployment.

**Tech Stack:** NestJS 12, Prisma 7.10.0, PostgreSQL 18, Next.js 16.3.4, React 19.2.8, Puck 0.23.0, Recharts 3.10.1, Tiptap, sanitize-html, Vitest, Playwright/Chromium.

**Spec:** `small-house-commerce/docs/superpowers/specs/2026-10-14-four-line-closeout-staged-release-design.md`; feature contracts in `2026-10-09-marketing-workbench-design.md` and `2026-10-11-marketing-workflow-performance-design.md`.

## Global Constraints

- Start from the exact FAQ SHA deployed by Wave 1; never start from the dirty source branch.
- Import only the Marketing manifest. Preserve FAQ, Release B/Homepage, Product Card V2, Storefront Shell, Newsletter, Back-in-stock, reviews, and ordinary checkout behavior.
- Shared files receive semantic hunks only. Especially protect Prisma schemas/RBAC, `app.module.ts`, order service/DTOs, uploads module, APIs, i18n, package manifests/lockfiles, storefront route/layout, and Next configuration.
- Preserve `MARKETING_VIEW_OWN`, `MARKETING_VIEW_ALL`, `MARKETING_MANAGE_OWN`, and `MARKETING_MANAGE_ALL` separation; do not revive `CAMPAIGN_LINK_BUILD` as a bypass.
- Marketing identity is server-owned: callers cannot submit arbitrary owner/AID/link attribution fields.
- Landing-page save, publish, disable, preview, link creation, attribution, costs, and reports remain separate protocols with CAS/version checks.
- Read installed Next.js docs before changing route/notFound/cache/revalidation behavior.
- Every behavior change follows RED → GREEN. Use fresh isolated schemas and owned runtime ports; ordinary-role tokens remain in memory.
- Do not change product price, SKU stock, order totals, risk, duplicate-order, status, shipment, Newsletter promotion, or Back-in-stock semantics.

## Review Focus

1. **A report row omits `pageTotalVisits`:** Task 2 tests `undefined` and `null` both serialize to `null`, never `NaN` or zero.
2. **A forged `landingPageId` is carried through Links navigation:** Task 3 verifies route preservation does not widen backend visibility/manage authorization.
3. **A legacy backfill runs twice or meets a newer draft:** Task 4 tests idempotence and version-mismatch abort without overwrite.
4. **A campaign credential becomes disabled/expired between cart and checkout:** Task 4 verifies order attribution rejects it without changing order/inventory semantics.
5. **Costs are incomplete for a period:** Task 5 verifies CPA/ROAS stay unavailable in API, table, summary, and chart rather than becoming zero or infinity.

---

### Task 1: Assemble the Marketing-only candidate and normalized migrations

**Files:**
- Create: `.superpowers/release-four-lines-20261014/manifests/marketing-files.txt`
- Create: `.superpowers/release-four-lines-20261014/manifests/marketing-source-sha256.tsv`
- Create: `.superpowers/release-four-lines-20261014/manifests/marketing-shared-hunks.md`
- Create: `.superpowers/release-four-lines-20261014/manifests/marketing-migration-map.tsv`
- Import exclusive paths: `backend/src/modules/marketing/**`, `frontend/src/app/admin/(shell)/marketing/**`, `frontend/src/components/admin/marketing/**`, `frontend/src/lib/marketing-api.ts`, `marketing-media.ts`, landing-page document/render components, and their tests.
- Surgically modify representative shared paths: Prisma marketing/landing/order/identity schemas; RBAC; app/orders/uploads modules; order DTO/service; AdminShell; APIs; i18n; package manifests/lockfiles; storefront landing route and revalidation route.

**Interfaces:**
- Consumes: deployed FAQ baseline and read-only source implementation/evidence.
- Produces: isolated Marketing candidate with eight normalized migration steps and a closed file manifest.

- [ ] **Step 1: Create the wave branch from the deployed FAQ SHA**

```bash
FAQ_SHA=$(awk -F= '$1=="FAQ_SHA" {print $2}' ../evidence/release-b-baseline.txt)
test -n "$FAQ_SHA"
git checkout -b release/marketing-closeout "$FAQ_SHA"
mkdir -p ../manifests ../evidence/marketing
```

Expected: branch starts exactly at the deployed FAQ commit.

- [ ] **Step 2: Write and classify the Marketing manifest before import**

Mark every path `EXCLUSIVE`, `SHARED_HUNK`, `MIGRATION_REPLACED`, `DEPENDENCY`, `TEST`, or `RUNTIME_EVIDENCE`. Explicitly exclude FAQ source, Homepage source, Phase 1, Bundle, generated Prisma output, uploads, `.next`, and source `.superpowers` directories.

- [ ] **Step 3: Copy hashed exclusive files and apply shared hunks semantically**

Required shared-hunk boundaries include:

```text
identity/rbac: four MARKETING_* permissions and intended grants only
landing-page schema: ownership, draft/published versions, statuses, CAS fields only
order schema/service: immutable marketing credential/snapshot integration only
uploads: page-scoped authorized media method without weakening product upload defaults
AdminShell/API/i18n: marketing routes/contracts/keys only
package manifests: exact dependencies needed by imported code; preserve existing versions
Next revalidation: landing-page path/tag invalidation only
```

Expected: current FAQ and Release B behavior remains in shared files.

- [ ] **Step 4: Normalize the eight unreleased Marketing migrations**

Map and preserve semantics for:

```text
add_optimizer_profiles
add_marketing_permissions
add_landing_page_ownership_drafts
add_campaign_links
add_marketing_touch_visits
add_order_marketing_snapshot
add_ad_cost_entries
protect_landing_visit_history
```

Assign consecutive names after the FAQ baseline's latest migration. Record old/new names and SQL SHA-256. Do not import already-deployed `add_order_customer_note`, Newsletter, Back-in-stock, Product Card, Storefront Shell, or Homepage migrations as Marketing migrations.

- [ ] **Step 5: Verify manifest closure and install dependencies from the candidate lockfiles**

```bash
git diff --name-only "$FAQ_SHA" -- | sort > ../evidence/marketing/actual-files.txt
cut -f2 ../manifests/marketing-files.txt | sort -u > ../evidence/marketing/allowed-files.txt
comm -23 ../evidence/marketing/actual-files.txt ../evidence/marketing/allowed-files.txt
pnpm --dir small-house-commerce/backend install --frozen-lockfile
pnpm --dir small-house-commerce/frontend install --frozen-lockfile
```

Expected: `comm` is empty and frozen installs succeed without rewriting lockfiles.

- [ ] **Step 6: Run imported focused suites before closeout changes**

```bash
pnpm --dir small-house-commerce/backend exec vitest run src/modules/marketing
pnpm --dir small-house-commerce/frontend exec vitest run \
  src/components/admin/marketing \
  src/lib/marketing-api.spec.ts \
  src/lib/marketing-media.spec.ts
```

Expected: historical Marketing behavior passes on the FAQ base. Diagnose any integration failure before closeout work.

- [ ] **Step 7: Commit the isolated import**

```bash
git add -- $(cut -f2 ../manifests/marketing-files.txt)
git commit -m "feat(marketing): assemble owner-scoped workbench"
```

### Task 2: Make report serialization null-safe

**Files:**
- Modify: `backend/src/modules/marketing/marketing-report-metrics.ts`
- Modify: `backend/src/modules/marketing/marketing-report-metrics.spec.ts`

**Interfaces:**
- Consumes: `MarketingReportRawRow` and existing `PerformanceTotals` null contract.
- Produces: `serializeMarketingReportRow` that maps absent/null `pageTotalVisits` to `null`.

- [ ] **Step 1: Write the failing undefined-column regression**

```ts
it("keeps an omitted aggregate page total unavailable instead of serializing NaN", () => {
  const row = rawRow({ pageTotalVisits: undefined });
  const serialized = serializeMarketingReportRow(row);
  expect(serialized.pageTotalVisits).toBeNull();
  expect(Number.isNaN(serialized.pageTotalVisits)).toBe(false);
});
```

Keep the existing explicit zero test: `0n` must serialize as `0`, not `null`.

- [ ] **Step 2: Run the metric spec to observe RED**

```bash
pnpm --dir small-house-commerce/backend exec vitest run src/modules/marketing/marketing-report-metrics.spec.ts
```

Expected: FAIL because `Number(undefined)` yields `NaN`.

- [ ] **Step 3: Implement the narrow null-safe contract**

```ts
export type MarketingReportRawRow = Record<CountField, bigint> & {
  // existing fields
  pageTotalVisits?: bigint | null;
};

pageTotalVisits:
  row.pageTotalVisits == null ? null : Number(row.pageTotalVisits),
```

Do not coerce missing data to zero.

- [ ] **Step 4: Run focused and service tests to GREEN**

```bash
pnpm --dir small-house-commerce/backend exec vitest run \
  src/modules/marketing/marketing-report-metrics.spec.ts \
  src/modules/marketing/marketing-report.service.spec.ts \
  src/modules/marketing/marketing-performance.service.spec.ts
```

- [ ] **Step 5: Commit**

```bash
git add small-house-commerce/backend/src/modules/marketing/marketing-report-metrics*
git commit -m "fix(marketing): keep missing page totals unavailable"
```

### Task 3: Preserve supported page context in Links navigation

**Files:**
- Modify: `frontend/src/components/admin/marketing/MarketingWorkbench.tsx`
- Modify: `frontend/src/components/admin/marketing/WorkbenchRoutes.spec.tsx` or add `MarketingWorkbench.spec.tsx`.

**Interfaces:**
- Consumes: `productId`, `landingPageId`, `linkId` route props.
- Produces: Links href with `productId` and `landingPageId`; Costs/Reports href with all supported identifiers.

- [ ] **Step 1: Write the failing href regression**

```tsx
render(
  <MarketingWorkbench
    view="costs"
    productId="product-1"
    landingPageId="page-1"
    linkId="link-1"
  />,
);
expect(screen.getByRole("link", { name: "Campaign links" })).toHaveAttribute(
  "href",
  "/admin/marketing/links?productId=product-1&landingPageId=page-1",
);
```

Assert `linkId` remains on Costs/Reports but is omitted from Links because `CampaignLinksList` does not accept a single-link filter. Add a forged-page route test proving the backend still returns 404/403 by scope.

- [ ] **Step 2: Run the frontend spec to observe RED**

```bash
pnpm --dir small-house-commerce/frontend exec vitest run \
  src/components/admin/marketing/WorkbenchRoutes.spec.tsx
```

Expected: Links href contains only `productId`.

- [ ] **Step 3: Build separate supported query suffixes**

```ts
const linkParams = new URLSearchParams(productId ? { productId } : {});
if (landingPageId) linkParams.set("landingPageId", landingPageId);
const linksSuffix = linkParams.size ? `?${linkParams}` : "";

const accountingParams = new URLSearchParams(linkParams);
if (linkId) accountingParams.set("linkId", linkId);
const accountingSuffix = accountingParams.size ? `?${accountingParams}` : "";
```

Use `linksSuffix` for Links and `accountingSuffix` for Costs/Reports.

- [ ] **Step 4: Run route/component tests to GREEN**

```bash
pnpm --dir small-house-commerce/frontend exec vitest run \
  src/components/admin/marketing/WorkbenchRoutes.spec.tsx \
  src/components/admin/marketing/CampaignLinksList.spec.tsx
```

- [ ] **Step 5: Commit**

```bash
git add small-house-commerce/frontend/src/components/admin/marketing/MarketingWorkbench.tsx \
  small-house-commerce/frontend/src/components/admin/marketing/WorkbenchRoutes.spec.tsx
git commit -m "fix(marketing): preserve page context across accounting tabs"
```

### Task 4: Clear PostgreSQL, attribution, and legacy-backfill gates

**Files:**
- Test: `backend/src/modules/marketing/*integration.spec.ts`
- Test: `backend/test` order/checkout regressions touched by attribution.
- Verify/modify only if a regression proves a defect: `marketing-touch.service.ts`, `orders.service.ts`, `legacy-migration.ts`, `legacy-migration-runner.ts`.
- Runtime evidence: `.superpowers/sdd/2026-10-14-marketing-closeout-release/runtime/frontend/marketing-attribution-browser.mts`.

**Interfaces:**
- Consumes: fresh schema containing the deployed `orders.customer_note` migration plus normalized Marketing migrations.
- Produces: green five-spec PostgreSQL batch, real checkout attribution, and dry-run/apply/idempotent legacy backfill evidence.

- [ ] **Step 1: Create fresh and immediate-upgrade schemas with explicit adapter isolation**

```ts
const adapter = new PrismaPg(
  { connectionString: process.env.DATABASE_URL! },
  { schema: process.env.DATABASE_SCHEMA! },
);
```

Apply the complete baseline through FAQ, then Marketing pending migrations. Verify `orders.customer_note` exists before tests.

- [ ] **Step 2: Run the formerly blocked PostgreSQL batch**

```bash
pnpm --dir small-house-commerce/backend exec vitest run \
  src/modules/marketing/marketing-report.integration.spec.ts \
  src/modules/marketing/marketing-performance.integration.spec.ts \
  src/modules/marketing/marketing-touch.integration.spec.ts \
  src/modules/marketing/ad-costs.integration.spec.ts \
  src/modules/catalog/landing/landing-workbench.integration.spec.ts
```

Expected: all files/tests pass with no skip caused by schema drift. If a behavioral failure appears, write a smaller regression first and fix only its root cause.

- [ ] **Step 3: Add or confirm backfill version/idempotence tests**

```ts
it("is idempotent and refuses to overwrite a newer document version", async () => {
  const first = await backfillLegacyLandingPages(prisma, { apply: true, pageIds: [page.id] });
  const second = await backfillLegacyLandingPages(prisma, { apply: true, pageIds: [page.id] });
  expect(first.updated).toBe(1);
  expect(second.updated).toBe(0);
  await expect(backfillAfterConcurrentDraft()).rejects.toThrow(/version/i);
});
```

Run RED only if the current implementation lacks either guarantee; otherwise retain the passing characterization and record no production change.

- [ ] **Step 4: Rehearse dry-run/apply/idempotence through an explicit-schema integration spec**

Create `backend/src/modules/marketing/legacy-migration.integration.spec.ts`. Instantiate the generated `PrismaClient` with:

```ts
const prisma = new PrismaClient({
  adapter: new PrismaPg(
    { connectionString: process.env.DATABASE_URL! },
    { schema: process.env.DATABASE_SCHEMA! },
  ),
});
```

Cast only at the tested service boundary, then call `backfillLegacyLandingPages(prisma as PrismaService)` for dry-run, apply, and second apply. Separately unit-test `parseLegacyBackfillCommand` with a public-schema URL and the exact `--confirm-database` guard; do not weaken the production CLI's public-schema requirement.

```bash
pnpm --dir small-house-commerce/backend exec vitest run \
  src/modules/marketing/legacy-migration.spec.ts \
  src/modules/marketing/legacy-migration.integration.spec.ts
```

Expected: dry-run writes zero; first apply updates the predicted rows with canonical sanitized snapshots; second apply updates zero; counts, versions, publication state, media, SEO, and schedules match the report.

- [ ] **Step 5: Run real landing-page → cart → checkout attribution**

Copy the previously retained browser script into this plan's ignored runtime and point it at owned ports/schema. Log in through the real form; keep tokens in memory. Assert exactly one order POST, order creation success, immutable optimizer/link/page/source/touchedAt snapshots, correct inventory reservation, unchanged pricing/risk/duplicate semantics, and zero page errors.

- [ ] **Step 6: Commit only proven fixes, or record a no-code cleared gate**

If Steps 2–5 pass without code changes, write evidence and do not create an artificial source commit. If a defect is fixed, commit its RED/GREEN test and minimal fix together.

### Task 5: Run full Marketing release/browser/review gate

**Files:**
- Create: `.superpowers/sdd/2026-10-14-marketing-closeout-release/progress.md`
- Create: `.superpowers/sdd/2026-10-14-marketing-closeout-release/review-package.md`
- Runtime scripts: copy the existing Marketing workflow/performance/native/media/controls/final-fixes/attribution scripts into this plan's ignored runtime.

**Interfaces:**
- Consumes: complete Marketing candidate.
- Produces: immutable `MARKETING_RELEASE_SHA` and release evidence.

- [ ] **Step 1: Run complete backend/frontend suites**

```bash
pnpm --dir small-house-commerce/backend test
pnpm --dir small-house-commerce/frontend test
```

Expected: zero failures; record exact pass/skip counts.

- [ ] **Step 2: Run type, lint, Prisma, build, and diff gates**

```bash
pnpm --dir small-house-commerce/backend exec tsc --noEmit
pnpm --dir small-house-commerce/frontend exec tsc --noEmit
pnpm --dir small-house-commerce/backend lint
pnpm --dir small-house-commerce/frontend lint
pnpm --dir small-house-commerce/backend exec prisma validate
pnpm --dir small-house-commerce/backend exec prisma generate
pnpm --dir small-house-commerce/backend build
pnpm --dir small-house-commerce/frontend build
git diff --check "$FAQ_SHA"..HEAD
```

Expected: exit 0; classify all warnings.

- [ ] **Step 3: Rehearse fresh and FAQ→Marketing upgrades**

Verify all normalized migrations, permission/grant counts, legacy data preservation, referential restrictions, and backfill reports. Confirm no FAQ migration or data is reapplied/changed.

- [ ] **Step 4: Run real-browser matrix**

Run workflow, performance, native editor, media, controls, final-fixes, and attribution scripts. Cover normal optimizer, finance read-only, and manage-all admin in separate real-login contexts; short-height sticky action footer; 390/1200 viewports; draft/save/publish/disable/locale/media/link/cost/report/trend; incomplete costs; cache invalidation; no page errors or unauthorized commerce writes.

- [ ] **Step 5: Perform exact-manifest self-review**

Review all changed production files against both Marketing specs and the five Review Focus cases. Record that no Agent reviewer was used because the user prohibited new Agent/Workflow runs. Fix Critical/Important findings once via RED → GREEN; ledger Minor findings.

- [ ] **Step 6: Finalize the release SHA**

```bash
git status --short
git commit --allow-empty -m "chore(marketing): finalize release gate"
MARKETING_RELEASE_SHA=$(git rev-parse HEAD)
```

Expected: clean manifest-closed candidate.

### Task 6: Push, deploy, backfill, and verify Marketing production

**Files:**
- Create: `.superpowers/release-four-lines-20261014/evidence/wave-2-marketing-production.md`
- Update after success: Marketing and production handoff memories.

**Interfaces:**
- Consumes: green `MARKETING_RELEASE_SHA` and rehearsed backfill.
- Produces: deployed Marketing baseline consumed by Phase 1.

- [ ] **Step 1: Back up database and tag rollback images**

Create a timestamped custom-format `pg_dump`, verify `pg_restore --list`, checksum it, and tag backend/frontend images `rollback-pre-marketing`. Record current migration count, image digests, container restart counts, reviews hotfix checksum, and Back-in-stock fail-closed state.

- [ ] **Step 2: Push the exact fast-forward release through the proxy**

```bash
git -c http.proxy=http://127.0.0.1:7897 \
    -c https.proxy=http://127.0.0.1:7897 \
    push origin HEAD:main
```

Expected: remote main equals `MARKETING_RELEASE_SHA`.

- [ ] **Step 3: Fast-forward production, build with Prisma generation, migrate, and recreate services**

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

Expected: backend build logs include successful Prisma generation; only rehearsed Marketing migrations apply; services become healthy; DB/Caddy are not recreated.

- [ ] **Step 4: Run and inspect the production backfill dry-run**

```bash
ssh smallhouse-prod 'docker exec small-house-prod-backend pnpm marketing:backfill-legacy-pages'
```

Expected: `applied:false`; row IDs/counts/hashes match the rehearsed eligible set. Stop before apply if any unexpected row appears.

- [ ] **Step 5: Apply with the guarded database confirmation, then prove idempotence**

```bash
ssh smallhouse-prod 'set -eu
  docker exec small-house-prod-backend sh -lc '\''
    confirm=$(node -e "const u=new URL(process.env.DATABASE_URL);process.stdout.write(u.host+u.pathname)")
    pnpm marketing:backfill-legacy-pages -- --apply --confirm-database "$confirm"
    pnpm marketing:backfill-legacy-pages
  '\''
'
```

Expected: apply updates exactly the dry-run set; the following dry-run returns zero rows; no newer draft/version is overwritten.

- [ ] **Step 6: Run production acceptance**

Verify public/live/scheduled/disabled/private landing behavior, campaign touch/credential boundaries, admin route/role matrix, link/cost/report facts against SQL, cache revalidation, logs, restart counts, FAQ invariants, Homepage/Storefront Shell, Newsletter, Back-in-stock fail-closed, reviews hotfix, and ordinary cart/checkout/order facts. Do not create a production test order unless the approved smoke explicitly permits it.

- [ ] **Step 7: Record deployment evidence and new baseline**

Document SHA, migrations, backfill counts, images, backup/checksum, rollback tags, tests/browser matrix, production responses, and known limitations. Update existing Marketing and handoff memories rather than adding duplicates.
