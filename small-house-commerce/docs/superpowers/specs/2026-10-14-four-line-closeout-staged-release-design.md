# Four-Line Feature Closeout and Staged Release Design

## Status

Approved in conversation on 2026-10-14. This document coordinates the closeout and staged production release of the remaining local FAQ, Marketing, variant-dimensions/packaging, and Bundle work. It does not redesign the already-approved feature specifications; those remain authoritative for each subsystem.

## Context

The shared `feature/homepage-builder` worktree contains more than 1,600 tracked and untracked entries from several completed, active, and historical workstreams. Its branch is diverged from production `main`, so neither its commit range nor its dirty tree can be treated as a release candidate.

A separate session owns Release B / Homepage Builder. That session has confirmed that it excludes FAQ, Marketing, Product Workbench, and Bundle. It may modify a narrow set of shared configuration, API, i18n, layout, global-style, and preview files. This release program must wait for Release B to finish and must use its deployed final `main` commit as the base for every subsequent release.

Content-level comparison corrected two earlier inventory assumptions:

1. The compact Product Workbench and bulk media refinements are already patch-equivalent to production `main`, except for files subsequently changed by other workstreams. They require a baseline audit, not another release.
2. SKU Bundle Phase 2 has a hard prerequisite: Variant Dimensions and Packaging Assist Phase 1. Phase 1 is present only as uncommitted local work and is not in production, so it must be completed and released before Bundle.

## Goal

Finish and release the remaining functionality in four independently testable and independently reversible production waves:

1. Unified Product FAQ closeout.
2. Marketing Workbench and performance/attribution closeout.
3. Variant Dimensions and Packaging Assist Phase 1.
4. SKU Bundle Inventory Phase 2.

Each wave starts from the latest production `main`, contains only its own manifest, passes a full release gate, and is deployed and verified before the next wave begins.

## Explicit non-goals

- Do not include or modify Release B / Homepage Builder implementation or its release candidate.
- Do not release the Product Workbench/media line again; only prove that the intended shipped behavior remains in the current base.
- Do not build a coupon system, a complete shipment/fulfilment workflow, R2 credential-backed storage, or Product Highlights in this program.
- Do not clean, reset, stash, stage wholesale, or deploy the shared dirty worktree.
- Do not remove local uploads, `.superpowers` evidence, or another session's runtime/release artifacts.
- Do not change product pricing, ordinary SKU inventory semantics, customer-risk classification, duplicate-order detection, review verification, Back-in-stock fail-closed behavior, Newsletter behavior, or Storefront Shell publication semantics except where the approved Bundle design explicitly expands inventory movements for Bundle components.

## Release coordination and baseline rules

### Release B ownership boundary

Release B owns Homepage Builder and its migration. Its reported shared files are:

- `docker-compose.prod.yml`
- `backend/src/config/configuration.ts`
- `backend/src/config/env.validation.ts`
- `frontend/next.config.ts`
- `frontend/playwright.config.ts`
- `frontend/src/i18n/en.ts`
- `frontend/src/i18n/zh.ts`
- `frontend/src/lib/api.ts`
- `frontend/src/lib/admin-api.ts`
- `frontend/src/app/(storefront)/layout.tsx`
- `frontend/src/app/globals.css`
- `frontend/src/components/admin/PreviewPane.tsx`

This program must not edit Release B's candidate repository. After Release B is deployed, fetch the final `main` SHA and fast-forward this coordination repository to that exact commit before importing any feature code. Shared files are merged semantically, never copied wholesale from the dirty source tree.

### Immutable wave baselines

For each wave:

1. Fetch GitHub through the configured proxy.
2. Record the latest deployed `main` SHA and production migration count.
3. Create a fresh local release clone/branch from that SHA.
4. Import only the wave's allowlisted files and surgically apply only the wave's hunks in shared files.
5. Produce a machine-readable manifest of added, modified, and intentionally excluded files.
6. Verify the candidate diff against its baseline before tests and again before push.
7. After deployment, use the newly deployed SHA as the next wave's baseline.

No wave may be assembled by merging `feature/homepage-builder` or copying a whole directory containing unrelated changes.

### Migration normalization

None of the FAQ, Marketing, Phase 1, or Bundle migrations has been deployed to production. Their historical local directory names are older than migrations already in production. In each clean release candidate:

- Preserve the reviewed SQL and data semantics.
- Replace unreleased historical migration directories with an append-only release sequence whose names sort strictly after the latest migration in that wave's baseline.
- Keep logically distinct destructive-risk or data-backfill steps separate when rollback/rehearsal needs to identify them.
- Never rename, edit, or replace a migration already recorded in production `_prisma_migrations`.
- Rehearse from a production-shaped schema and separately rehearse upgrade from the immediately preceding deployed wave.
- Run Prisma generate before backend build and deployment.

## Wave 0: baseline audit and no-op Product Workbench check

Before Wave 1, verify on the post-Release-B base that the already-shipped Product Workbench/media behaviors remain present:

- compact admin controls;
- widened product editing column and fixed preview rail;
- compact media grid and hover/focus/touch actions;
- batch file and URL addition;
- durable queue state and save locking;
- full-page preview scrolling with overscroll containment;
- unified media gallery behavior.

Compare patch IDs and file content against the approved Product Workbench ledger and production `main`. Any remaining differences in `ProductForm`, `VariantMatrix`, i18n, or preview files must be attributed to FAQ, Phase 1, Bundle, or Release B before they can enter a later wave. Wave 0 produces evidence only and has no deployment.

## Wave 1: Unified Product FAQ closeout

### Existing implementation to preserve

Reuse the current FAQ persistence, shared/product permissions, raw structured answer model, resolver, public projection, unified `/admin/faq` workspace, product editor panel, targeted shared audiences, product-question duplication, CAS boundaries, and storefront rendering. The authoritative documents are:

- `docs/superpowers/specs/2026-10-09-product-faq-design.md`
- `docs/superpowers/specs/2026-10-10-faq-closeout-design.md`
- `docs/superpowers/plans/2026-10-09-product-faq-unified-workbench.md`

The implementation must continue to use:

- shared writes through the shared FAQ endpoint and `SharedFaqSet.version`;
- product writes through the existing product PATCH transaction and each `ProductFaq.version`;
- `PRODUCT_FAQ_SHARED_MANAGE` for shared editing;
- `PRODUCT_MANAGE` for product-specific editing;
- one resolver for PDP, landing-page, and preview output;
- non-HTML structured answers and protocol-filtered links.

### Closeout gaps to finish

Complete the explicitly recorded design gaps rather than shipping them as hidden omissions:

1. Shared-question ordering with keyboard-accessible move controls in addition to drag behavior where present.
2. Product editor read-only shared/effective preview, filtered for the current product and clearly marked when it includes unsaved product-specific content.
3. An explicit CUSTOM-mode action that copies currently applicable shared questions into new product-owned items with new IDs; subsequent edits must not affect the shared library.
4. Shared-save impact confirmation showing the count of distinct ACTIVE, non-CUSTOM products affected by at least one enabled shared question; disabling/removing a shared question uses the same confirmation.
5. Immediate refresh of overview totals and default-group membership after a successful product FAQ save.

Retain the later closeout behavior for product-question duplication and targeted shared audiences. Do not auto-change a product's FAQ mode when its audience changes.

### FAQ failure behavior

- A shared CAS conflict reloads only shared state and never overwrites product drafts.
- A product CAS conflict reloads only that product and preserves other product drafts.
- A failed impact-count request blocks shared save with a readable error rather than guessing a count.
- Deleted or inaccessible targeted product IDs must produce a readable validation response and removable selections.
- Invalid answer links degrade to text and never execute HTML.

### FAQ release acceptance

- Focused backend/frontend tests observe RED before every closeout behavior change and GREEN afterward.
- Full backend/frontend unit suites, type checks, lint, and production builds pass.
- Fresh PostgreSQL migration and upgrade rehearsal pass.
- Real Chromium verifies shared-only, product-only, and combined-permission roles; shared/product save isolation; CAS recovery; duplicate/copy/reorder; targeted audiences across pages; desktop/mobile layout; product editor consistency; PDP and landing-page output; no console errors.
- Production verification checks permission grants, shared singleton/version, public FAQ projection, representative PDP output, cache revalidation, and unchanged product/SKU/order counts.

## Wave 2: Marketing Workbench closeout

### Existing implementation to preserve

Reuse the approved Marketing Workbench architecture:

- optimizer profiles and stable server-owned AID;
- owner-scoped view/manage permissions;
- versioned landing-page drafts and publication;
- Puck-backed structured content and server validation/sanitization;
- page-scoped media upload authorization;
- campaign links and touch credentials;
- immutable order attribution snapshots;
- daily advertising costs with CAS/audit behavior;
- performance reports with Manila date semantics and verified cohorts;
- private previews that do not count public visits.

The authoritative documents are:

- `docs/superpowers/specs/2026-10-09-marketing-workbench-design.md`
- `docs/superpowers/specs/2026-10-11-marketing-workflow-performance-design.md`
- `docs/superpowers/plans/2026-10-09-marketing-workbench.md`
- `docs/superpowers/plans/2026-10-11-marketing-workflow-performance.md`

### Closeout gaps to finish

1. Make `serializeMarketingReportRow` handle a missing `pageTotalVisits` as an explicit nullable/zero-policy value instead of producing `NaN`; tests must lock the chosen existing API contract.
2. Preserve `landingPageId`/`linkId` context when moving to the Links tab from a page-scoped workbench where the target contract supports it; do not leak unauthorized IDs.
3. Re-run the previously blocked attribution checkout and five-spec PostgreSQL batch on a fresh schema that includes the already-deployed `orders.customer_note` migration.
4. Rehearse the canonical legacy landing-page backfill in dry-run and apply modes with version checks, sanitizer parity, row counts, and idempotence.
5. Revalidate the sticky action footer in the campaign-link dialog at short viewport heights while preserving focus trapping and keyboard submission.

### Marketing failure behavior

- Unknown, expired, disabled, or unauthorized campaign credentials do not attribute an order.
- Owner-scoped readers cannot infer other owners through lookup endpoints.
- Cost coverage gaps keep CPA/ROAS unavailable rather than inventing zero spend.
- Draft save never publishes; disable never saves unrelated unsaved content.
- Private preview never increments public visits.
- Backfill aborts on version mismatch and never overwrites a newer document.

### Marketing release acceptance

- All prior Marketing unit/integration tests plus closeout tests pass on the clean candidate.
- Backend/frontend full suites, type checks, lint, and production builds pass.
- Fresh and upgrade migration rehearsals pass; the backfill dry-run/apply/idempotence report is retained.
- Real Chromium covers normal optimizer, finance read-only, and admin manage-all roles using form login and in-memory tokens; editor/publish/disable/media/link/cost/report flows; mobile layout; no unauthorized commerce writes; no page errors.
- The real landing-page-to-cart-to-checkout flow creates exactly one order and persists immutable attribution without changing inventory/risk/duplicate-order semantics.
- Production verification checks public/private page behavior, touch endpoint, campaign-link resolution, role scoping, report totals against database facts, and logs.

## Wave 3: Variant Dimensions and Packaging Assist Phase 1

### Contract

Complete the approved Phase 1 plan before Bundle work begins:

- nullable per-SKU product-dimension overrides with product-level fallback;
- backend/admin/storefront contracts using existing centimeter units;
- backend labels and input order as 长 × 宽 × 高, mapped to Width × Depth × Height without swapping historical values;
- apply-to-all and fill-empty actions affecting only materialized sellable SKU rows;
- deterministic packaging-text parser with explicit units, assumptions, warnings, and ambiguity handling;
- confirmation-only writes into existing package fields;
- selected-variant storefront specifications using overrides/fallbacks;
- no automatic volumetric-weight mutation and no external service/LLM parser.

The authoritative documents are:

- `docs/superpowers/specs/2026-10-09-variant-packaging-bundle-design.md` (Phase 1)
- `docs/superpowers/plans/2026-10-09-variant-packaging-phase1.md`

### Phase 1 failure behavior

- Ambiguous or malformed pasted packaging text cannot write fields.
- Unitless input displays the documented assumption before confirmation.
- Bulk actions never materialize missing SKU candidates or change prices, stock, codes, option assignments, or package values outside the confirmed fields.
- Clearing an override restores inheritance; it does not copy the current parent value.

### Phase 1 release acceptance

- Complete all four plan tasks and add a durable execution ledger.
- Full backend/frontend tests, types, lint, build, migration rehearsal, and real browser editor/save/reload/PDP checks pass.
- Browser verification covers `120 × 60 × 75` as 长 120 / 宽 60 / 高 75 in admin and Width 120 / Depth 60 / Height 75 in storefront output.
- Production verification checks schema nullability, representative fallback/override behavior, and unchanged package/inventory values for existing SKUs.

Bundle Phase 2 remains blocked until Wave 3 is deployed and verified.

## Wave 4: SKU Bundle Inventory Phase 2

### Contract

Complete the existing six-task Bundle plan:

- ordinary Product plus virtual `Sku.isBundle` representation;
- validated ordered `SkuBundleComponent` relations to concrete ordinary component SKUs;
- no nested/cyclic Bundle components;
- component-derived available quantity;
- fail-closed cart and checkout validation;
- aggregated component requirements in one order transaction;
- reservation, release, order edit, cancellation, shipment, and signed flows using component inventory exactly once;
- immutable order-item component snapshots;
- catalog reference protection and hard rejection of direct stock writes to virtual Bundle SKUs;
- backend endpoints and admin component editor with stable SKU identity mapping.

The authoritative documents are:

- `docs/superpowers/specs/2026-10-09-variant-packaging-bundle-design.md` (Phase 2)
- `docs/superpowers/plans/2026-10-09-bundle-inventory-phase2.md`

### Bundle transaction invariants

- A Bundle line remains one customer-visible order item while component requirements are expanded transactionally.
- Repeated component SKUs across Bundle lines are aggregated before availability and reservation checks.
- Concurrent checkouts cannot oversell a component.
- Cancellation/release returns exactly the component quantities reserved for the affected unshipped quantity.
- Shipment decrements the component on-hand/reserved balances exactly once and never writes virtual SKU stock.
- Historical orders remain explainable after Bundle catalog edits through immutable snapshots.
- Ordinary SKU checkout, cart, inventory, Back-in-stock, risk, duplicate-order, and shipment behavior remains unchanged.

### Bundle failure behavior

- Missing, disabled, deleted, nested-Bundle, duplicate, self-referential, or nonpositive component definitions are rejected.
- Component unavailability fails the cart/checkout with the existing customer-safe unavailable-item contract.
- Partial transaction failure rolls back all component inventory movements and order writes.
- A referenced component SKU cannot be hard-deleted without a deliberate supported replacement path.

### Bundle release acceptance

- Re-run each plan task against the clean post-Phase-1 base; existing uncommitted code is evidence to audit, not proof of completion.
- Unit, integration, PostgreSQL concurrency, and E2E tests cover ordinary and Bundle paths, including multi-line aggregation, cancellation, edit, shipment, and snapshots.
- Full backend/frontend suites, types, lint, builds, migration rehearsals, and real Chromium admin/storefront/cart/checkout checks pass.
- Before production deployment, present the migration, transaction tests, backup/rollback assets, and known consequences as a dedicated inventory/order risk gate. Deploy only after explicit confirmation.
- Production verification checks Bundle availability against component facts, one controlled non-destructive checkout lifecycle if authorized, ordinary SKU invariants, and logs.

## Test and runtime isolation

- Use only dedicated schemas/databases explicitly created for the current release rehearsal; do not mutate shared fixtures used by another active session.
- Do not restart or bind ports owned by other sessions. Allocate and record unique backend/frontend ports per wave.
- Never delete the primary frontend `.next`; build and run candidates inside their release clone/runtime.
- Ordinary-role access tokens remain only in process memory and are never printed or written to disk.
- Test uploads use dedicated temporary storage. Production durable upload behavior is verified without deleting existing files.
- Tests that intentionally create orders, visits, costs, or inventory movements use unique tagged fixtures and clean up only those fixtures.

## Verification hierarchy

Every wave must produce fresh evidence in this order:

1. Scoped RED-to-GREEN tests for each behavior changed during closeout.
2. Focused subsystem unit and integration suites.
3. Full backend and frontend unit suites.
4. Backend and frontend type checks.
5. Lint with all warnings classified.
6. Prisma validate/generate and both production builds.
7. Fresh-schema and upgrade migration rehearsal.
8. Real Chromium acceptance with desktop and mobile viewports.
9. Independent review of the exact release manifest; when a reviewer tool is unavailable, a separately recorded self-review is required and weaker assurance is disclosed.
10. `git diff --check`, release-manifest audit, and comparison with the wave baseline.

A failing required gate stops the current wave. It is not reclassified as unrelated without evidence. Later waves do not begin until the current wave is deployed and production verification passes.

## Deployment and rollback

For each production wave:

1. Fetch and verify GitHub and production `main` alignment.
2. Create a timestamped `pg_dump` and verify it with `pg_restore --list`.
3. Record current image digests and create rollback image tags.
4. Preserve and checksum the production review-photo hotfix until it is represented in version control.
5. Push the fast-forward release commit through the required GitHub proxy.
6. Fast-forward production; run Prisma generate; build only the services affected by the manifest.
7. Apply migrations and required permission/data reconciliation commands.
8. Recreate affected services without restarting database/Caddy or unrelated services.
9. Run public, authenticated, database, browser, log, health, restart-count, and durability checks.
10. Record the deployed SHA, migration count, image digests, backup path/checksum, rollback tags, and acceptance results in the production handoff memory.

Rollback reverts only the current wave's images and, when necessary, restores the pre-wave database backup. Because database restore is destructive, it requires confirmation at incident time unless already covered by an active rollback instruction.

## Completion definition

The program is complete when:

- Release B remains intact and all four waves are independently represented in GitHub and production history.
- FAQ, Marketing, Phase 1, and Bundle each pass their local and production acceptance contracts.
- Product Workbench/media behavior is proven already present, with no duplicate release.
- Production migrations, role grants, public APIs, admin routes, frontend routes, and data invariants match the documented release manifests.
- The shared dirty worktree and other sessions' artifacts remain untouched.
- Deferred coupon, full fulfilment, R2 credentials, and Highlights work remains explicitly out of scope rather than being presented as completed.
