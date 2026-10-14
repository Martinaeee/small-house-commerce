# Four-Line Closeout Release Program Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not dispatch new Agent or Workflow runs; the user has required native execution for this program.

**Goal:** Coordinate four independent, sequential production releases—FAQ, Marketing, Variant Dimensions/Packaging Phase 1, and Bundle Phase 2—without mixing the shared dirty worktree or Release B.

**Architecture:** A clean coordination repository tracks the approved documents and release evidence. Each wave creates a fresh candidate from the latest deployed `main`, imports only an allowlisted feature manifest, completes its child plan, deploys, verifies production, and becomes the immutable base of the next wave. Product Workbench/media is audited as an already-shipped no-op rather than released again.

**Tech Stack:** Git, pnpm, Next.js 16.3.4, React 19.2.8, NestJS 12, Prisma 7.10.0, PostgreSQL 18, Vitest, Playwright/Chromium, Docker Compose, Caddy.

**Spec:** `small-house-commerce/docs/superpowers/specs/2026-10-14-four-line-closeout-staged-release-design.md`

**Child plans:**
- `small-house-commerce/docs/superpowers/plans/2026-10-14-faq-closeout-release.md`
- `small-house-commerce/docs/superpowers/plans/2026-10-14-marketing-closeout-release.md`
- `small-house-commerce/docs/superpowers/plans/2026-10-14-variant-packaging-phase1-release.md`
- `small-house-commerce/docs/superpowers/plans/2026-10-14-bundle-phase2-release.md`

## Global Constraints

- Wait for the Release B owner to report the final deployed `main` SHA; verify GitHub and production independently before importing feature code.
- Never merge, reset, clean, stash, stage wholesale, or deploy `feature/homepage-builder`.
- Never touch `.superpowers/release-homepage-builder-20261014/` or another session's runtime, candidate, port, `.next`, upload, or database fixtures.
- GitHub network operations use `-c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897`.
- Each wave uses a fresh branch/clone, an explicit allowlist, source SHA-256 hashes, a baseline diff, an isolated schema/runtime, and independent rollback assets.
- Every behavior change follows RED → GREEN. Existing implementation may be imported as evidence, but any discovered defect gets a failing regression before its fix.
- Read the installed Next.js guides under `small-house-commerce/frontend/node_modules/next/dist/docs/` before changing Next.js APIs, caching, routing, or configuration.
- Ordinary-role access and refresh tokens stay only in process memory; never print or write them to disk.
- Before any backend production build/deploy, run Prisma validate and Prisma generate in the release candidate.
- Preserve the production reviews upload-path hotfix checksum and Back-in-stock fail-closed behavior.
- FAQ, Marketing, and Phase 1 may deploy directly only after their full gates pass; Bundle stops at a dedicated inventory/order production risk gate for explicit confirmation.
- Coupon codes, full fulfilment, R2 credentials, Highlights, and duplicate Product Workbench/media release are out of scope.

## Review Focus

1. **Release B moves a shared file after this program starts:** Task 1 re-fetches and hashes the deployed base; every child plan rejects a patch that would replace rather than semantically merge that file.
2. **An unreleased historical migration sorts behind production migrations:** Task 2 proves every wave's normalized migration names sort after its immediate baseline and rehearses both fresh and upgrade paths.
3. **A scoped suite passes while another subsystem regresses:** Tasks 4–7 require both focused and full backend/frontend gates before promotion.
4. **A deploy advances GitHub but not production, or production but not the handoff record:** Tasks 4–7 compare all three SHAs and stop until they match or rollback is explicitly performed.
5. **A rebuild drops the reviews hotfix or enables email without credentials:** Tasks 3–7 checksum the hotfix and exercise Back-in-stock's 503/hidden fail-closed contract before and after every backend deployment.

---

### Task 1: Adopt the deployed Release B baseline

**Files:**
- Modify: this coordination repository's Git branch only.
- Create: `.superpowers/release-four-lines-20261014/evidence/release-b-baseline.txt`
- Create: `.superpowers/release-four-lines-20261014/evidence/shared-file-hashes.tsv`

**Interfaces:**
- Consumes: Release B owner's final SHA; GitHub `main`; production repository HEAD and migration table.
- Produces: `PROGRAM_BASE_SHA`, `PROGRAM_BASE_MIGRATION_COUNT`, and shared-file hashes consumed by every child plan.

- [ ] **Step 1: Wait for the Release B completion signal and capture the candidate SHA without trusting it yet**

After the peer reports deployment and production verification complete, derive the remote value and compare it with the SHA in that message:

```bash
RELEASE_B_SHA=$(git -c http.proxy=http://127.0.0.1:7897 \
  -c https.proxy=http://127.0.0.1:7897 \
  ls-remote origin refs/heads/main | cut -f1)
test "${#RELEASE_B_SHA}" -eq 40
```

Expected: `RELEASE_B_SHA` exactly matches the peer-reported final SHA. Do not proceed while the peer reports rehearsal, approval, deployment, or production verification as incomplete.

- [ ] **Step 2: Verify GitHub `main` through the required proxy**

```bash
git -c http.proxy=http://127.0.0.1:7897 \
    -c https.proxy=http://127.0.0.1:7897 \
    ls-remote origin refs/heads/main
```

Expected: the returned SHA exactly equals `RELEASE_B_SHA`.

- [ ] **Step 3: Verify production HEAD, applied migration count, container health, and the Homepage migration**

```bash
ssh smallhouse-prod 'set -eu
  cd /opt/small-house-commerce/small-house-commerce
  printf "HEAD="; git rev-parse HEAD
  docker compose --env-file .env.deploy -f docker-compose.prod.yml ps
  docker exec small-house-prod-db psql -U smallhouse -d small_house -Atc \
    "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null"
  docker exec small-house-prod-db psql -U smallhouse -d small_house -Atc \
    "select migration_name from _prisma_migrations where migration_name = '\''20260928120000_add_homepage_document_versions'\'' and finished_at is not null"
'
```

Expected: production HEAD equals `RELEASE_B_SHA`; all four containers are healthy/running; the Release B migration is applied exactly once.

- [ ] **Step 4: Rebase the documentation commit onto the deployed baseline**

```bash
cd .superpowers/release-four-lines-20261014/repo
git fetch origin "$RELEASE_B_SHA"
git rebase --onto "$RELEASE_B_SHA" cdeaa36926c2 release/four-lines-20261014
PROGRAM_BASE_SHA=$(git rev-parse "$RELEASE_B_SHA")
```

Expected: only the documentation commit is replayed; no feature source file appears in `git diff "$PROGRAM_BASE_SHA"..HEAD`.

- [ ] **Step 5: Record the baseline and shared-file hashes**

```bash
mkdir -p ../evidence
PROGRAM_BASE_MIGRATION_COUNT=$(ssh smallhouse-prod \
  "docker exec small-house-prod-db psql -U smallhouse -d small_house -Atc \"select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null\"")
{
  printf 'PROGRAM_BASE_SHA=%s\n' "$PROGRAM_BASE_SHA"
  printf 'PROGRAM_BASE_MIGRATION_COUNT=%s\n' "$PROGRAM_BASE_MIGRATION_COUNT"
} > ../evidence/release-b-baseline.txt
for path in \
  docker-compose.prod.yml \
  small-house-commerce/backend/src/config/configuration.ts \
  small-house-commerce/backend/src/config/env.validation.ts \
  small-house-commerce/frontend/next.config.ts \
  small-house-commerce/frontend/playwright.config.ts \
  small-house-commerce/frontend/src/i18n/en.ts \
  small-house-commerce/frontend/src/i18n/zh.ts \
  small-house-commerce/frontend/src/lib/api.ts \
  small-house-commerce/frontend/src/lib/admin-api.ts \
  'small-house-commerce/frontend/src/app/(storefront)/layout.tsx' \
  small-house-commerce/frontend/src/app/globals.css \
  small-house-commerce/frontend/src/components/admin/PreviewPane.tsx
  do shasum -a 256 "$path"; done > ../evidence/shared-file-hashes.tsv
```

Expected: twelve hashes are recorded and no file is missing.

- [ ] **Step 6: Commit the rebased documentation state if the rebase created a new commit**

```bash
git status --short
git log -2 --oneline
```

Expected: clean status; the docs commit is directly above `PROGRAM_BASE_SHA`. Do not push yet.

### Task 2: Normalize migration sequencing and define the wave manifest protocol

**Files:**
- Create: `.superpowers/release-four-lines-20261014/manifests/README.md`
- Create per wave: `.superpowers/release-four-lines-20261014/manifests/${WAVE}-files.txt`
- Create per wave: `.superpowers/release-four-lines-20261014/manifests/${WAVE}-source-sha256.tsv`
- Create per wave: `.superpowers/release-four-lines-20261014/manifests/${WAVE}-migration-map.tsv`

**Interfaces:**
- Consumes: `PROGRAM_BASE_SHA`, child-plan allowlists, and the latest migration directory in each wave baseline.
- Produces: an auditable import protocol and append-only migration names consumed by Tasks 4–7.

- [ ] **Step 1: Write the manifest contract**

```markdown
# Release manifest contract

Each `${WAVE}-files.txt` contains one repository-relative path per line.
Exclusive new files may be copied byte-for-byte after their source SHA-256 is recorded.
Existing/shared files must be changed by reviewed patch hunks; whole-file copying is forbidden.
Every candidate must satisfy:

- `git diff --name-only ${BASE_SHA}..HEAD` is a subset of the manifest;
- every manifest path exists or is explicitly marked `DELETE`;
- no Homepage/Release-B path enters unless the child plan names the exact semantic hunk;
- each unreleased migration is mapped to a new name lexicographically after the baseline's latest migration;
- SQL checksums and semantic invariants are recorded before the old local directory is discarded.
```

Expected: the contract makes exclusive-copy versus shared-hunk behavior unambiguous.

- [ ] **Step 2: Add a migration-order verifier command to the contract**

```bash
BASE_LATEST=$(find small-house-commerce/backend/prisma/migrations -mindepth 1 -maxdepth 1 -type d -print | sort | tail -1 | xargs basename)
FIRST_NEW=$(cut -f2 ".superpowers/release-four-lines-20261014/manifests/${WAVE}-migration-map.tsv" | sort | head -1)
test "$FIRST_NEW" \> "$BASE_LATEST"
```

Expected: the command exits zero for every child wave; otherwise assembly stops before Prisma runs.

- [ ] **Step 3: Define fresh and upgrade rehearsal commands**

```bash
# Fresh rehearsal schema/database name is unique per wave and run.
export DATABASE_SCHEMA="release_${WAVE}_fresh_${RUN_TAG}"
pnpm --dir small-house-commerce/backend exec prisma migrate deploy
pnpm --dir small-house-commerce/backend exec prisma validate
pnpm --dir small-house-commerce/backend exec prisma generate

# Upgrade rehearsal starts from a dump/schema at the immediately preceding deployed wave.
export DATABASE_SCHEMA="release_${WAVE}_upgrade_${RUN_TAG}"
pnpm --dir small-house-commerce/backend exec prisma migrate deploy
```

Expected: both paths apply only pending migrations, then `prisma migrate status` reports no pending or failed migration. Runtime clients using `PrismaPg` must receive `{ schema: DATABASE_SCHEMA }`, not only a URL query parameter.

- [ ] **Step 4: Commit the manifest protocol with the master plan**

```bash
git add small-house-commerce/docs/superpowers/plans/2026-10-14-*.md
git commit -m "docs: define staged closeout release execution"
```

Expected: one documentation-only commit; no feature source or migration is staged.

### Task 3: Audit Product Workbench/media as a no-op

**Files:**
- Create: `small-house-commerce/docs/superpowers/acceptance/2026-10-14-product-workbench-baseline-audit.md`
- Read: `small-house-commerce/docs/superpowers/plans/2026-10-09-admin-product-workbench.md`
- Read representative paths: `frontend/src/components/admin/Field.tsx`, `ProductForm.tsx`, `product-form/MediaAddRow.tsx`, `MediaGallery.tsx`, `useMediaBatchUpload.ts`, `PreviewPane.tsx`.

**Interfaces:**
- Consumes: post-Release-B `PROGRAM_BASE_SHA` and Product Workbench commits `a461c4f`, `3b317bd`, `817d091`, `cf359d8`, `bc99a78`, `249f0d4`, `aff2385`, `893c33b` from the source repository.
- Produces: a signed-off no-op audit; no deployable code.

- [ ] **Step 1: Compare each historical patch ID with the deployed base**

```bash
SOURCE_REPO='/Users/Admin1/Desktop/菲律宾家居/建站/codex建站/.claude/worktrees/homepage-builder'
for c in a461c4f 3b317bd 817d091 cf359d8 bc99a78 249f0d4 aff2385 893c33b; do
  git -C "$SOURCE_REPO" show "$c" --pretty=format: | git patch-id --stable
 done
```

Expected: the audit records which patches are upstream-equivalent. A non-equivalent patch is not automatically imported; inspect its intended behavior against current files.

- [ ] **Step 2: Run focused Product Workbench tests on the post-Release-B base**

```bash
pnpm --dir small-house-commerce/frontend exec vitest run \
  src/components/admin/Field.spec.tsx \
  src/components/admin/ProductForm.spec.tsx \
  src/components/admin/product-form/MediaAddRow.spec.tsx \
  src/components/admin/product-form/SharedMediaWorkspace.spec.tsx \
  src/components/admin/product-form/ProductPreviewPanel.spec.tsx \
  src/components/admin/product-form/useMediaBatchUpload.spec.tsx
```

Expected: all pass without importing source-tree changes.

- [ ] **Step 3: Verify required behavior in a real browser without writes**

Run the existing product-editor browser coverage against an isolated seeded database and candidate frontend. Verify compact controls, fixed rail, media hover/focus/touch actions, batch queue, save lock, and preview scroll containment.

Expected: no page errors, no root horizontal overflow at 390/1280 px, and no production/shared data writes.

- [ ] **Step 4: Write and commit the no-op audit**

The acceptance file must list patch equivalence, focused test counts, browser checks, and any differences attributed to FAQ, Phase 1, Bundle, or Release B.

```bash
git add small-house-commerce/docs/superpowers/acceptance/2026-10-14-product-workbench-baseline-audit.md
git commit -m "docs: verify product workbench already shipped"
```

Expected: documentation only. If a Product Workbench requirement is genuinely absent, stop and amend the approved program scope rather than smuggling it into another wave.

### Task 4: Execute and deploy Wave 1 FAQ

**Files:**
- Follow: `small-house-commerce/docs/superpowers/plans/2026-10-14-faq-closeout-release.md`
- Update: `.superpowers/release-four-lines-20261014/evidence/wave-1-faq-production.md`

**Interfaces:**
- Consumes: post-audit main baseline and FAQ child plan.
- Produces: deployed `FAQ_SHA`, new production migration count, backup checksum, rollback tags, and production acceptance evidence.

- [ ] **Step 1: Execute every FAQ child-plan task through its local release gate**

Expected: the FAQ ledger records every RED → GREEN cycle, full gate, manifest audit, self-review, and release commit.

- [ ] **Step 2: Push, deploy, and verify FAQ exactly as the child plan specifies**

Expected: GitHub, production, and local release SHA match; permissions, data singleton, public projection, admin route, PDP/landing rendering, cache behavior, logs, and invariants pass.

- [ ] **Step 3: Record the new baseline**

```bash
FAQ_SHA=$(git rev-parse HEAD)
printf 'FAQ_SHA=%s\n' "$FAQ_SHA" >> ../evidence/release-b-baseline.txt
```

Expected: Task 5 starts from the deployed FAQ SHA, never from the pre-FAQ base.

### Task 5: Execute and deploy Wave 2 Marketing

**Files:**
- Follow: `small-house-commerce/docs/superpowers/plans/2026-10-14-marketing-closeout-release.md`
- Update: `.superpowers/release-four-lines-20261014/evidence/wave-2-marketing-production.md`

**Interfaces:**
- Consumes: deployed `FAQ_SHA` and Marketing child plan.
- Produces: deployed `MARKETING_SHA`, migration/backfill evidence, and production acceptance evidence.

- [ ] **Step 1: Rebase/create the Marketing candidate from `FAQ_SHA` and execute every child-plan task**

Expected: no FAQ files are reverted; Marketing tests include the previously blocked attribution order and PostgreSQL batch.

- [ ] **Step 2: Push, deploy, verify, and record the Marketing baseline**

```bash
MARKETING_SHA=$(git rev-parse HEAD)
printf 'MARKETING_SHA=%s\n' "$MARKETING_SHA" >> ../evidence/release-b-baseline.txt
```

Expected: GitHub/production/local SHA match; backfill is idempotent; role scoping and report facts pass; ordinary checkout/inventory/risk behavior is unchanged.

### Task 6: Execute and deploy Wave 3 Variant Dimensions/Packaging

**Files:**
- Follow: `small-house-commerce/docs/superpowers/plans/2026-10-14-variant-packaging-phase1-release.md`
- Update: `.superpowers/release-four-lines-20261014/evidence/wave-3-variant-packaging-production.md`

**Interfaces:**
- Consumes: deployed `MARKETING_SHA` and Phase 1 child plan.
- Produces: deployed `PHASE1_SHA`; the hard prerequisite consumed by Bundle.

- [ ] **Step 1: Build the Phase 1 candidate from `MARKETING_SHA` and execute the child plan**

Expected: dimensions, parser, confirmation UI, graph save, fallback, and browser gates pass; ordinary package and inventory data remain unchanged.

- [ ] **Step 2: Push, deploy, verify, and record the Phase 1 baseline**

```bash
PHASE1_SHA=$(git rev-parse HEAD)
printf 'PHASE1_SHA=%s\n' "$PHASE1_SHA" >> ../evidence/release-b-baseline.txt
```

Expected: production schema and representative products prove override/fallback behavior; `120 × 60 × 75` axis mapping is correct; Bundle remains absent.

### Task 7: Complete Wave 4 Bundle and stop at the production risk gate

**Files:**
- Follow: `small-house-commerce/docs/superpowers/plans/2026-10-14-bundle-phase2-release.md`
- Create: `.superpowers/release-four-lines-20261014/evidence/wave-4-bundle-risk-gate.md`

**Interfaces:**
- Consumes: deployed `PHASE1_SHA` and Bundle child plan.
- Produces: a fully verified Bundle release commit plus a production risk packet; no production deployment before explicit confirmation.

- [ ] **Step 1: Build the Bundle candidate from `PHASE1_SHA` and execute all implementation/review tasks**

Expected: unit, integration, concurrency, E2E, browser, full suites, migration rehearsals, and manifest audit are green.

- [ ] **Step 2: Assemble the dedicated risk packet**

The packet must contain:

```markdown
- release SHA and exact manifest;
- normalized migration SQL and rehearsal results;
- component availability and oversell tests;
- reservation/release/edit/merge/cancel/shipment concurrency tests;
- ordinary-SKU regression results;
- production backup command and verified restore listing;
- backend/frontend rollback image tags;
- data-model rollback consequence (Bundle rows/snapshots created after deploy);
- proposed non-destructive production checks.
```

Expected: every claim links to fresh evidence from the candidate.

- [ ] **Step 3: Present the risk packet and wait for explicit production approval**

Expected: no Bundle push/deploy command runs from peer approval or inferred intent. The user's explicit confirmation is required because this wave changes inventory/order transaction behavior.

### Task 8: Deploy Bundle after approval and close the program

**Files:**
- Update: `.superpowers/release-four-lines-20261014/evidence/wave-4-bundle-production.md`
- Update: production handoff memory and the four feature memories.
- Create: `small-house-commerce/docs/superpowers/acceptance/2026-10-14-four-line-release-closeout.md`

**Interfaces:**
- Consumes: explicit Bundle risk approval and the green Bundle candidate.
- Produces: deployed `BUNDLE_SHA` and the final program closeout.

- [ ] **Step 1: Push and deploy the exact approved Bundle SHA**

Use the child plan's backup, fast-forward, generate, build, migrate, recreate, and smoke commands. Do not rebuild or restart DB/Caddy unless their own manifest requires it.

Expected: GitHub, production, and approved SHA match; migration count increases by the rehearsed amount only.

- [ ] **Step 2: Run production acceptance and ordinary-SKU controls**

Expected: derived Bundle availability matches component facts; virtual stock writes reject; controlled lifecycle checks behave as approved; ordinary cart/checkout/order/cancel/shipment, Back-in-stock fail-closed, Newsletter, Storefront Shell, Homepage, FAQ, Marketing, and review uploads remain intact.

- [ ] **Step 3: Run a final all-wave manifest and production audit**

```bash
git log --oneline "$PROGRAM_BASE_SHA"..HEAD
git diff --name-status "$PROGRAM_BASE_SHA"..HEAD
ssh smallhouse-prod 'cd /opt/small-house-commerce/small-house-commerce && git rev-parse HEAD'
```

Expected: only approved wave commits/files; production equals `HEAD`; no shared-worktree artifact appears.

- [ ] **Step 4: Write and commit the final closeout**

```bash
git add small-house-commerce/docs/superpowers/acceptance/2026-10-14-four-line-release-closeout.md
git commit -m "docs: close staged feature releases"
```

Expected: the document records SHAs, migration counts, image digests, backups/checksums, rollback tags, tests, browser evidence, production smokes, rulings, and deferred non-goals.

- [ ] **Step 5: Update persistent project memory**

Update existing feature/handoff memories instead of creating duplicates. State that Product Workbench was a no-op audit, not a new deploy. Do not mark coupon, full fulfilment, R2, or Highlights complete.
