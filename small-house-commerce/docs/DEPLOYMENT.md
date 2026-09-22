# Production Deployment Runbook

Single-VPS deployment for the Small House stack: Caddy 2 (TLS) routes pages to the Next.js 16 standalone server and sends browser `/api/v1/*` calls directly to the NestJS API → PostgreSQL 18, all on one Docker host. Artifacts: `docker-compose.prod.yml`, `deploy/Caddyfile`, `backend/Dockerfile`, `frontend/Dockerfile`. Two distinct API paths exist by design: browser calls are same-origin `/api/v1/*` routed by Caddy straight to the backend (the Next rewrite target is baked at image build time and cannot carry prod traffic); Server Components fetch the backend directly at container runtime using the `API_TARGET` ENV (`http://backend:3000`).

## 1. Prerequisites

- One Linux VPS (tested shape: 2 vCPU / 2 GB RAM / 20 GB disk), Ubuntu 24.04.
- Docker Engine + Docker Compose v2 (`docker compose version` works).
- A domain name with an **A record** pointing to the server's public IP (e.g. `shop.example.com → 203.0.113.10`).
- DNS fully propagated before first boot, so Caddy can issue the Let's Encrypt certificate.
- Firewall: open **22, 80, 443 only**. PostgreSQL and the app ports are never published to the host.
- Host `zstd` CLI for the §7 backup/restore pipes (not present on a minimal Ubuntu 24.04): `sudo apt-get update && sudo apt-get install -y zstd`

## 2. Configure

```bash
cp deploy/env.deploy.example .env.deploy
# edit .env.deploy: set POSTGRES_PASSWORD, JWT_SECRET, DOMAIN, ACME_EMAIL,
# and NEXT_PUBLIC_META_PIXEL_ID
```

Generate secrets:

```bash
openssl rand -hex 24             # POSTGRES_PASSWORD — hex ONLY: a base64 '/' breaks the DATABASE_URL userinfo (Prisma P1013)
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"  # JWT_SECRET
```

Note: compose v2 auto-loads `./.env`; the file is named `.env.deploy`, so export it or run compose with `--env-file .env.deploy`. The `build`/`up`/upgrade commands below need that flag; `logs`/`exec`/`ps` act on already-running containers and work without it.

## 3. Build and start

```bash
docker compose --env-file .env.deploy -f docker-compose.prod.yml build
docker compose --env-file .env.deploy -f docker-compose.prod.yml up -d
```

The backend entrypoint runs `prisma migrate deploy` before serving — fresh databases get all migrations automatically. Watch first boot:

```bash
docker compose -f docker-compose.prod.yml logs -f backend
```

## 4. Bootstrap the first administrator and reference data

One-off, after the backend is healthy:

```bash
docker compose -f docker-compose.prod.yml exec \
  -e ADMIN_EMAIL=admin@yourdomain.tld \
  -e ADMIN_PASSWORD='choose-a-strong-password' \
  backend pnpm exec prisma db seed
```

Then the storefront category tree:

```bash
docker compose -f docker-compose.prod.yml exec backend \
  pnpm exec tsx prisma/seed-categories.ts
```

Both seeds are idempotent. The random-password fallback prints to the backend logs if `ADMIN_PASSWORD` is omitted. On a brand-new stack the frontend may boot before the category seed runs; category detail pages can then return 404 for up to 5 minutes (fetch cache `revalidate: 300`) and self-heal — run both seeds promptly after first boot. The §10 smoke eliminates the race entirely by starting the frontend only after seeding.

## 5. Verify

- `https://YOUR_DOMAIN/` — homepage renders, padlock shows (TLS auto-issued).
- `https://YOUR_DOMAIN/api/v1` — `Hello World!` through Caddy → backend (direct route, no Next hop).
- Place a COD test order end to end (search → add to cart → checkout → order-success), then mark it cancelled in the admin API once the admin panel ships.
- `docker compose -f docker-compose.prod.yml ps` — every service healthy.

## 6. Logs and operations

```bash
docker compose -f docker-compose.prod.yml logs -f frontend
docker compose -f docker-compose.prod.yml restart backend
```

## 7. Backups

Logical backup (cron recommended, e.g. nightly 03:17). First create the destination directory once (the redirect fails with no such directory on a fresh VPS):

```bash
sudo install -d -o root -g root -m 0750 /srv/backups
```

The directory is root-owned, so install the cron line in **root's** crontab (`sudo crontab -e`; the system crontab runs as root). If you instead run it from a non-root user's crontab, `chown` the directory to that user first — otherwise the nightly redirect fails silently with a permission error.

```bash
17 3 * * * cd /path/to/small-house-commerce && docker compose -f docker-compose.prod.yml exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | zstd > /srv/backups/small-house-$(date +\%F).sql.zst
```

The `sh -c '...'` single quotes are essential: `$POSTGRES_USER`/`$POSTGRES_DB` must expand **inside** the db container, where compose sets them. Cron's host shell has neither variable, so an unquoted/outer expansion runs `pg_dump -U "" ""` and silently writes a 0-byte archive.

Restore into a CLEAN database — a plain `pg_dump` archive restored over existing objects errors on every duplicate. Stop the backend, drop and recreate the target database (the postgres maintenance db survives this), restore, then start the backend again (`backup.sql.zst` is a placeholder — use the dated file cron wrote, e.g. `/srv/backups/small-house-2026-09-12.sql.zst`):

```bash
docker compose -f docker-compose.prod.yml stop backend
docker compose -f docker-compose.prod.yml exec -T db sh -c 'psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS \"$POSTGRES_DB\" WITH (FORCE);" -c "CREATE DATABASE \"$POSTGRES_DB\" OWNER \"$POSTGRES_USER\";"'
zstd -d -c /srv/backups/small-house-YYYY-MM-DD.sql.zst | docker compose -f docker-compose.prod.yml exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
docker compose -f docker-compose.prod.yml up -d backend
```

Keep at least 14 daily files; verify a restore monthly.

## 8. Upgrade

```bash
git pull --ff-only
docker compose --env-file .env.deploy -f docker-compose.prod.yml build
docker compose --env-file .env.deploy -f docker-compose.prod.yml up -d
```

`up` recreates changed services; the backend entrypoint reapplies migrations. A changed `NEXT_PUBLIC_META_PIXEL_ID` requires the frontend image to rebuild (the compose build arg changes).

## 9. Rollback

Migrations in this project are forward-only and non-destructive. Code rollback is `git checkout <prev> && build && up -d`, but a revision whose schema changed requires restoring the database backup taken before the upgrade — take a backup immediately before every production upgrade, and restore with the §7 clean-database procedure (stop backend → DROP/CREATE → restore → start backend); restoring the dump over the existing database fails on duplicate objects. The `postgres:18-alpine` data directory lives at `/var/lib/postgresql/18/docker` inside the `prod_pgdata` volume (image-major versioned): upgrading the db image to a new major version (e.g. 18 → 19) does not upgrade data in place — plan a dump/restore or `pg_upgrade`.

## 10. Local smoke (no domain, no TLS)

Builds the same stack on the local Docker engine with plain HTTP on localhost:8080. Use throwaway copies under `/tmp` (never committed):

```bash
cp docker-compose.prod.yml /tmp/sh-smoke.compose.yml
# `-i.bak` works on both macOS BSD sed and GNU sed.
# Remap the one published port to localhost and DELETE the 443 line —
# blanking it ("s/...//") leaves a null ports entry that compose rejects.
sed -i.bak 's/"80:80"/"127.0.0.1:8080:80"/; /"443:443"/d' /tmp/sh-smoke.compose.yml
cat > /tmp/sh-smoke.env <<'EOF'
POSTGRES_USER=sh
POSTGRES_PASSWORD=sh
POSTGRES_DB=small_house
JWT_SECRET=smoke-secret-0123456789abcdef0123456789abcdef
DOMAIN=:80
ACME_EMAIL=ops@example.test
NEXT_PUBLIC_META_PIXEL_ID=
EOF
# --project-directory keeps the ./backend ./frontend build contexts and the
# ./deploy/Caddyfile volume resolving against the real project dir, not /tmp.
# Start ONLY db + backend: the frontend must not exist before the category
# seed, otherwise its first categories fetch primes the fetch data-cache
# (revalidate 300s) with an empty list and category pages 404 for ~5 minutes.
PD=/ABSOLUTE/PATH/TO/small-house-commerce
docker compose -p sh-smoke --project-directory "$PD" \
  -f /tmp/sh-smoke.compose.yml --env-file /tmp/sh-smoke.env up -d --build db backend
# Wait for the API (the entrypoint applies migrations before serving).
# Fail loudly instead of silently continuing if it never comes up:
API_READY=""
for i in $(seq 1 60); do
  if docker compose -p sh-smoke -f /tmp/sh-smoke.compose.yml exec -T backend \
      node -e "fetch('http://localhost:3000/api/v1').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
    API_READY=1
    break
  fi
  sleep 2
done
[ -n "$API_READY" ] || { echo "backend API never became ready (check: docker compose -p sh-smoke -f /tmp/sh-smoke.compose.yml logs backend)" >&2; exit 1; }
```

(Run from anywhere; substitute the absolute path to the `small-house-commerce` directory.)

`DOMAIN=:80` makes Caddy serve plain HTTP (no ACME attempt). Seed the category tree, and only THEN start the frontend + Caddy (proves the frontend's runtime `API_TARGET` Server Component path, not just browser routing). Warm a category DETAIL page and poll until its SSR HTML contains the seeded category name (the homepage nav does not render root category names server-side) — with the ordered startup the poll normally succeeds immediately; it remains a safety net, not a 5-minute wait. Then verify pages, API paths, and log hygiene:

```bash
docker compose -p sh-smoke -f /tmp/sh-smoke.compose.yml \
  exec -T backend pnpm exec tsx prisma/seed-categories.ts
docker compose -p sh-smoke --project-directory "$PD" \
  -f /tmp/sh-smoke.compose.yml --env-file /tmp/sh-smoke.env up -d --build frontend caddy
curl -fsS http://127.0.0.1:8080/categories/bedroom-essentials -o /dev/null   # warm
SSR_OK=""
for i in $(seq 1 60); do
  curl -fsS http://127.0.0.1:8080/categories/bedroom-essentials | grep -q "Bedroom Essentials" && { SSR_OK=1; break; }
  sleep 5
done
[ "$SSR_OK" = 1 ] && echo "SSR shows seeded category OK" || { echo "SSR content never updated" >&2; exit 1; }
curl -fsS http://127.0.0.1:8080/api/v1                              # Hello World!
curl -fsS http://127.0.0.1:8080/api/v1/storefront/categories -o /dev/null
docker compose -p sh-smoke -f /tmp/sh-smoke.compose.yml logs frontend \
  | grep -cE "ECONNRESET|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|fetch failed|EACCES"   # must be 0
```

Then tear down INCLUDING the smoke volumes (pass the env file so no blank-variable warnings print):

```bash
docker compose -p sh-smoke -f /tmp/sh-smoke.compose.yml --env-file /tmp/sh-smoke.env down -v
rm -f /tmp/sh-smoke.compose.yml /tmp/sh-smoke.compose.yml.bak /tmp/sh-smoke.env
```

Only the `sh-smoke` project's volumes are removed; dev databases and any real `small-house-prod` stack are untouched.

## 11. Troubleshooting

- **Backend restarts with env validation errors:** check every variable in `.env.deploy`; boot prints all missing keys at once.
- **Migration failure:** backend stops in the entrypoint; fix the migration forward (never reset in production); the DB is untouched up to the failed statement.
- **Caddy stuck on TLS:** confirm DNS A record and open ports 80/443; `docker compose logs caddy`.
- **Pixel not firing:** pixel ID is build-time; confirm the build arg via `docker compose config` and rebuild the frontend image.
- **Browser storefront API calls fail with 500/ECONNRESET:** the Caddyfile must route `/api/v1 /api/v1/*` to `backend:3000` directly. The Next standalone server bakes its rewrite target at image build time, so proxying *browser* API traffic through the frontend cannot work.
- **Pages render but with fetch-failed/ISR errors in the frontend log (stale or empty catalog data):** that is the runtime `API_TARGET` ENV, used directly by Server Components (not the rewrite). Confirm the frontend service has `API_TARGET=http://backend:3000` and that the backend is healthy on the compose network.
- **Category detail pages 404 right after first boot:** the frontend's fetch data-cache (`revalidate: 300`) can prime on the pre-seed empty categories list; run the §4 seeds — pages self-heal within 5 minutes. The §10 smoke avoids the race by starting frontend/Caddy only after seeding.
- Behind Caddy the app trusts exactly one proxy hop (`trust proxy = 1` in `main.ts`); do not add a second proxy without adjusting it.

## 12. Staged rollout — typed catalog graph (variant options & scoped media)

Phase 1 of the variant-options plan ships as four independent release stages.
Every stage leaves the previous one fully functional — the **catalog
compatibility backend is the rollback floor** for the whole program: the
storefront's `presentCatalogGraph` projection renders typed products and
legacy graph-v0 products through the same payload shape, so code from any
stage can serve a database from any earlier stage. Production migrations and
the backfill are **not executed until the database risk gate is approved**.

### Release A — expand schema + compatibility bridge (already in the tree)

- Migration `20260921090000_expand_variant_options_media`: additive tables
  (`product_options`, `product_option_values`, `product_variant_option_values`),
  nullable columns (`product_variants.combination_key`,
  `product_images.option_value_id/variant_id`, `order_items.option_snapshot`),
  partial unique indexes, composite same-product FKs. The dual-scope media
  CHECK is added `NOT VALID` — no existing row can violate it and validation
  is deferred to Release C.
- Graph-v0 creates keep working: every legacy variant gets a deterministic
  `__legacy_unmapped__:<variantId>` combination sentinel
  (`catalog-graph.ts`), so the tightened `combination_key NOT NULL` of
  Release C has nothing to break during the compatibility window.
- Frontend reads/writes are unchanged (legacy admin payloads, legacy
  storefront). Deploy is boring: build + `up -d`, entrypoint applies the
  migration.

### Release B — backfill + audit

- Migration `20260921100000_backfill_variant_options`: set-based
  `INSERT ... SELECT` / `UPDATE ... FROM` with deterministic UUIDs. Every
  legacy variant product gets one Style option/value per variant, the
  assignments, the one-pair canonical keys, a default display variant, and
  `catalog_graph_version = 1`. Variant/SKU/inventory/media/order **ids and
  references never change**; image scopes and historical snapshots are
  untouched.
- Audit before and after (`backend/package.json`):

  ```bash
  DATABASE_URL=... pnpm --dir backend run catalog:audit:snapshot -- --out /tmp/catalog-before.json
  # (deploy Release B, then:)
  DATABASE_URL=... pnpm --dir backend run catalog:audit:verify -- --snapshot /tmp/catalog-before.json
  ```

  The verifier compares SKU/variant identities, inventory values,
  reservations, movements, order references, and media ids/order; the gate
  passes only with zero identity/reference drift. Take the §7 backup first
  and keep the snapshot with it.

### Release C — validate and tighten constraints

- Migration `20260921110000_validate_variant_options`:
  `combination_key SET NOT NULL`, the `(product_id, combination_key)` unique
  index, and `VALIDATE CONSTRAINT` on the deferred composite FKs / media
  scope CHECK. Release B must have completed everywhere first — a graph-v0
  row that is not an exact self-ID sentinel fails the validation closed.
- Constraints are validated, not re-created: no table rewrite, but run it in
  a low-traffic window anyway.

### Release D — Admin & Storefront typed surfaces

- Admin: the product GET (and every update response) carries the typed graph
  (`options`/`media`/variant assignments) via
  `CatalogGraphService.adminSnapshot`, so the edit form's options editor,
  variant matrix, and scoped-media editor are live; graph-v0 products keep
  the legacy form until backfilled.
- Storefront: PDP/LP option selectors, scoped media resolver + `/media`
  endpoint, enriched cart lines, order option snapshots, per-SKU tracking/SEO.
- `pnpm generate` reminder: the Prisma client is NOT rebuilt by
  `pnpm --dir backend build` — run `pnpm --dir backend exec prisma generate`
  before any backend build/test in a fresh checkout or CI, or the generated
  client in `src/generated/prisma` will not know the new tables.

### Sequencing, backups, rollback

1. Approve the database risk gate (explicit user sign-off; §7 backup taken
   immediately before, plus the pre-deploy dump convention
   `~/deploy-backups/pre-<tag>.sql.gz` on the host).
2. Release A deploy (code + additive migration). Verify legacy editing and
   legacy storefront.
3. Snapshot → Release B deploy (backfill migration) → audit verify →
   smoke a few products in the admin edit page. Rollback floor: the
   compatibility backend renders both shapes, so code rollback to
   pre-Release-D commits is safe after the backfill; a database rollback
   past Release B requires the §7 clean restore.
4. Release C deploy (validation migration) after the audit is clean.
5. Release D deploy (typed Admin/Storefront). Rollback of Release D alone is
   a code rollback — all schema objects stay valid for the legacy paths.
6. Run the browser acceptance gate (`pnpm --dir frontend e2e`, i.e.
   `playwright test e2e/variant-options-media.spec.ts`) against a staging
   copy (see `frontend/playwright.config.ts` +
   `backend/prisma/seed-e2e.ts`) before promoting to production.
