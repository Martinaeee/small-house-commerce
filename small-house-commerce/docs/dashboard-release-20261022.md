# Dashboard release record — 2026-10-22

The operator workbench (draft: `docs/dashboard-operator-workbench-draft.md`)
had to be released onto the live baseline. This file records what the baseline
actually was, why the dashboard was **ported** instead of merged, what shipped,
and how it was verified.

---

## 1. The baseline, measured (not assumed)

| Fact | Value | How it was checked |
|---|---|---|
| Production box HEAD | `6cb0dd5` "feat(plp): the product card offers one restock action too" | `git -C /opt/small-house-commerce rev-parse HEAD` over `ssh smallhouse-prod` |
| GitHub `origin/main` | `2c923e3` (the box was **one commit ahead** of GitHub) | `git ls-remote` / `git rev-parse origin/main` |
| Production DB | 57 migrations applied | `select count(*) from _prisma_migrations where finished_at is not null` |
| Production containers | db + caddy up 13 days, backend + frontend healthy (rebuilt 2026-10-22 13:13) | `docker ps` |
| Dashboard branch | `feature/homepage-builder` = `af1e15c` | local |
| Divergence | branch **+93 / −108** commits vs `origin/main`, merge-base `1f62c08` | `git rev-list --count` |
| Merge probe | **286 conflicted files** (185 add/add, 101 modify/modify); hunks: 123 files 1-2, 86 files 3-5, 41 files 6-10, 36 files 11+ | `git merge --no-commit origin/main` then `git ls-files -u` |
| Worst clusters | `frontend/components/admin` 75 · `backend/modules/catalog` 27 · `frontend/src/lib` 27 · `frontend/components/product` 22 · `frontend/components/home` 21 · `backend/modules/cms` 14 · `backend/modules/marketing` 14 | cluster count of the conflicted paths |

**A merge was not a release.** 185 of the conflicts are *add/add*: both lines
built the same feature (the homepage editor, the FAQ workspace, the marketing
workbench, bundles, back-in-stock, the newsletter popup) independently, with no
shared ancestor. Resolving them means choosing between two diverged product
behaviours, file by file — and a wrong choice silently reverts a shipped
production feature. The one genuinely new feature here is the dashboard, so the
dashboard was **ported** instead.

## 2. The migration trap (why "just merge" would have broken production)

Both lines ship the same features under **different migration timestamps**:

| Dashboard branch | Production |
|---|---|
| `20261012090000_add_product_faq` | `20261015110000_add_product_faq` |
| `20261012100000_seed_shared_faq` | `20261015112000_seed_shared_faq` |
| `20261010090000_add_optimizer_profiles` | `20261015120000_add_optimizer_profiles` |
| `20261014120000_add_campaign_links` | `20261015120300_add_campaign_links` |
| …14 in total | … |

Replaying the branch's copies on the production database re-applies DDL that
production already has — `ERROR: type "FaqMode" already exists` (reproduced
locally on the dev clone). The port therefore carries **exactly one** new
migration:

`20261021090000_add_dashboard_analytics` — one enum, one table
(`analytics_events`), one nullable column (`orders.tracking_session_id`) and
the aggregation indexes. Additive; no existing row is rewritten.

Verified against production's applied list: 57 applied → 58 after the deploy,
with **no** applied migration missing from the port branch.

## 3. What the port branch contains

`integration/dashboard-on-prod`, based on the production box's own HEAD
(`6cb0dd5`), so the deploy is a clean fast-forward.

| Area | Change |
|---|---|
| Backend | `modules/dashboard/**` (module, controller, service, metrics, range, config, types, dto) · `common/manila-day.ts` · `modules/orders/order-facts.ts` (shared order predicates) · `DashboardModule` registered in `app.module.ts` · `CatalogModule` now exports `MarketingReportService` (the dashboard's campaign card must use the very same report service) |
| Schema | `prisma/schema/analytics.prisma` (new) · `orders.trackingSessionId` + the aggregation indexes on `orders`, `order_items`, `order_shipping_address` |
| Migration | `20261021090000_add_dashboard_analytics` (one, additive) |
| Frontend | `components/admin/dashboard/**` · `lib/dashboard-api.ts` · the `/admin` route (`app/admin/(shell)/page.tsx`) · the admin nav entry (first seat, exact-path match) · 163 dashboard i18n keys per language |
| Order workbench | `paymentStatus` filter (query param + visible control) · From/To are **Manila calendar days** · a multi-status selection now shows the applied set instead of reading as "All statuses" |
| The four fixes | carried over from the dashboard branch: Manila-day drill-down links · period-scoped repeat purchase rate · exact failed-payment filter · profit card that states the formula it applied |

Nothing else from the dashboard branch came along: the other 92 commits (the
homepage editor rework, the product editor redesign, the FAQ workspace, the
marketing workbench, the media bulk upload) stay unreleased on
`feature/homepage-builder` until they are converged on their own terms.

## 4. Verification before the deploy

| Check | Result |
|---|---|
| Backend `vitest run` | 138 files · 2127 tests passed (21 integration files skipped without their database) |
| Frontend `vitest run --maxWorkers=2` | 271 files · 3080 tests passed |
| `tsc --noEmit` (both) | clean (two pre-existing spec-only type errors in files this work did not touch) |
| `nest build` | clean |
| `next build` | clean — the build lists the `/admin` route |
| Dashboard integration spec (`small_house_dashboard_dev`, 55 migrations) | 4/4 passed — period-scoped snapshot, Manila-day filter, payment-status filter, tile links |
| Live API on the port branch (`small_house_real`) | LAST_MONTH = 2026-09-01 → 2026-09-30 · net sales ₱41,979 · 14 valid orders · gross profit ₱16,779 (`partial: true`) · customer snapshot 11 new · 0 returning · 9.09% repeat · 11 period customers · every tile link carries `dateFrom=2026-09-01&dateTo=2026-09-30` |
| Drill-down reconciliation | `GET /admin/orders?dateFrom=2026-09-01&dateTo=2026-09-30` → **15 orders = the tile total** |
| Browser | the `/admin` page renders the KPIs, the customer snapshot (11 / 0 / 9.1%) and the reduced profit formula; the failed-payment link opens the list with Payment = FAILED and the eight statuses visible |

## 5. The release procedure (the box's own recipe)

Modelled on `/root/release-hero-links.sh`:

1. **Fingerprint** every public table (row count + md5) before and after.
2. **Back up** the database: `pg_dump --format=custom` into
   `/root/deploy-backups/<release>-<ts>/`, with a sha256.
3. **Tag the running images** `small-house-prod-backend:rollback-pre-<release>`
   and `…-frontend:…` — the rollback point is one `docker compose up -d` away.
4. **Fast-forward the clone**: fetch the reviewed commit from a git bundle
   (`git fetch <bundle> <branch>` + `git merge --ff-only`), refusing to move
   if the result is not the reviewed SHA.
5. **Build** `docker compose --env-file .env.deploy -f docker-compose.prod.yml
   build backend frontend`. The backend entrypoint runs `prisma migrate deploy`
   and the RBAC reconcilers on start.
6. **Restart** backend + frontend only. db and caddy are never touched.
7. **Verify**: fingerprint diff, migration count, container restart counts and
   health, error grep in the logs, HTTP checks on `/`, `/about`,
   `/api/v1/storefront/homepage`, `/admin/login` — plus the dashboard's own
   acceptance numbers below.

## 6. Post-deploy acceptance (the numbers to re-read on production)

| Check | Expected |
|---|---|
| `/admin` opens for an account with `ORDER_VIEW_ALL` | the workbench, first nav item |
| LAST_MONTH (2026-09-01 → 2026-09-30) | net sales, orders, gross profit, the customer snapshot |
| Customer snapshot | new + returning = the period's customers; the repeat rate divides by that group |
| Order tile drill-down | the list length equals the tile count, and From/To carry the Manila days |
| Failed-payment drill-down | `?paymentStatus=FAILED` + the status set; length equals the card |
| Migration count | 57 → 58 (one additive migration) |
| Containers | backend/frontend healthy, restart count 0, no errors in the logs |

## 7. Rollback

1. `git -C /opt/small-house-commerce merge --ff-only <previous SHA>`
   (the pre-deploy HEAD is recorded in the backup directory as `base-head.txt`).
2. `docker compose --env-file .env.deploy -f docker-compose.prod.yml build backend frontend`
   and `up -d backend frontend`.
3. If the database needs to go back: restore the `pg_dump` from the backup
   directory. The dashboard migration is additive, so leaving it in place is
   harmless — a rolled-back container does not read it.

---

## 8. What was deployed (2026-10-22T075243Z)

| | |
|---|---|
| Box HEAD | `6cb0dd5` → **`3872227`** (the reviewed SHA; the script refuses to move otherwise) |
| Migrations | 57 → **58** — one additive migration (`20261021090000_add_dashboard_analytics`) |
| `analytics_events` | present, 0 rows (the storefront has not sent traffic since the release) |
| Containers | backend/frontend/db healthy, **restart count 0** on all four; caddy untouched (13 days) |
| Backend log | no error, exception or fatal line in the 20 minutes after the restart |
| HTTP | `/` 200 · `/about` 200 · `/api/v1/storefront/homepage` 200 · `/admin/login` 200 · `/admin` 200 |
| Dashboard API | `/api/v1/admin/dashboard/{overview,products,marketing}` → **401** (the routes are live and guarded) |
| Backup | `/root/deploy-backups/dashboard-20261022T075243Z/pre-dashboard.dump` (339,693 B) + `backup.sha256`, plus the before/after table fingerprints, `base-head.txt`, `build.log` and `containers-after.txt` |
| Rollback images | `small-house-prod-backend:rollback-pre-dashboard-20261022T075243Z`, `small-house-prod-frontend:rollback-pre-dashboard-20261022T075243Z` |

**Fingerprint diff** — four lines, all explained:

| Table | Why |
|---|---|
| `_prisma_migrations` | one more applied migration |
| `analytics_events` | new, empty |
| `orders` | the new nullable `tracking_session_id` column is part of every row's text |
| `homepage_documents` | **not the deploy**: the row's `draftUpdatedById` is the production admin account, and its `draftRev` kept climbing (365 → 367 → 370) while the release was running — an operator was editing the homepage draft in the browser. The **published** document (the one the storefront renders) did not change, so the live site is unaffected. |

**Production numbers the dashboard now shows** (read straight from the
production database with the service's own SQL, Manila September window
2026-09-01 → 2026-09-30): net sales ₱1,047.00 · 3 valid orders of 4 created ·
customer snapshot 2 new · 0 returning · 1 repeat of 2 period customers (50%) ·
tiles: 0 to fulfil · 3 awaiting payment · 3 processing · 1 cancelled · 0 failed
payments · 4 orders in the period.

The production admin account is `admin@luwag.shop`; its password was not used
during the release, so the dashboard's own acceptance numbers were read from
the database rather than through a logged-in browser session.

