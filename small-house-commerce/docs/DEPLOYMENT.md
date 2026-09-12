# Production Deployment Runbook

Single-VPS deployment for the Small House stack: Caddy 2 (TLS) routes pages to the Next.js 16 standalone server and sends browser `/api/v1/*` calls directly to the NestJS API → PostgreSQL 18, all on one Docker host. Artifacts: `docker-compose.prod.yml`, `deploy/Caddyfile`, `backend/Dockerfile`, `frontend/Dockerfile`. Two distinct API paths exist by design: browser calls are same-origin `/api/v1/*` routed by Caddy straight to the backend (the Next rewrite target is baked at image build time and cannot carry prod traffic); Server Components fetch the backend directly at container runtime using the `API_TARGET` ENV (`http://backend:3000`).

## 1. Prerequisites

- One Linux VPS (tested shape: 2 vCPU / 2 GB RAM / 20 GB disk), Ubuntu 24.04.
- Docker Engine + Docker Compose v2 (`docker compose version` works).
- A domain name with an **A record** pointing to the server's public IP (e.g. `shop.example.com → 203.0.113.10`).
- DNS fully propagated before first boot, so Caddy can issue the Let's Encrypt certificate.
- Firewall: open **22, 80, 443 only**. PostgreSQL and the app ports are never published to the host.

## 2. Configure

```bash
cp deploy/env.deploy.example .env.deploy
# edit .env.deploy: set POSTGRES_PASSWORD, JWT_SECRET, DOMAIN, ACME_EMAIL,
# and NEXT_PUBLIC_META_PIXEL_ID
```

Generate secrets:

```bash
openssl rand -base64 24            # POSTGRES_PASSWORD
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"  # JWT_SECRET
```

Note: compose v2 auto-loads `./.env`; the file is named `.env.deploy`, so export it or run compose with `--env-file .env.deploy`. Every command below uses that flag.

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

Both seeds are idempotent. The random-password fallback prints to the backend logs if `ADMIN_PASSWORD` is omitted.

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

Logical backup (cron recommended, e.g. nightly 03:17):

```bash
17 3 * * * cd /path/to/small-house-commerce && docker compose -f docker-compose.prod.yml exec -T db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | zstd > /srv/backups/small-house-$(date +\%F).sql.zst
```

Restore into a fresh database:

```bash
zstd -d -c backup.sql.zst | docker compose -f docker-compose.prod.yml exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
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

Migrations in this project are forward-only and non-destructive. Code rollback is `git checkout <prev> && build && up -d`, but a revision whose schema changed requires restoring the database backup taken before the upgrade — take a backup immediately before every production upgrade.

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
docker compose -p sh-smoke \
  --project-directory /ABSOLUTE/PATH/TO/small-house-commerce \
  -f /tmp/sh-smoke.compose.yml --env-file /tmp/sh-smoke.env up -d --build
```

(Run from anywhere; substitute the absolute path to the `small-house-commerce` directory.)

`DOMAIN=:80` makes Caddy serve plain HTTP (no ACME attempt). Seed the category tree (proves the frontend's runtime `API_TARGET` Server Component path, not just browser routing), warm a category DETAIL page once to trigger ISR regeneration, poll until its SSR HTML contains the seeded category name (the homepage nav does not render root category names server-side), then verify pages, API paths, and log hygiene:

```bash
docker compose -p sh-smoke --project-directory /ABSOLUTE/PATH/TO/small-house-commerce \
  -f /tmp/sh-smoke.compose.yml exec -T backend pnpm exec tsx prisma/seed-categories.ts
curl -fsS http://127.0.0.1:8080/categories/bedroom-essentials -o /dev/null   # warm
# Background regeneration can take minutes, not seconds — poll, don't sleep.
for i in $(seq 1 60); do
  curl -fsS http://127.0.0.1:8080/categories/bedroom-essentials | grep -q "Bedroom Essentials" && break
  sleep 5
done
curl -fsS http://127.0.0.1:8080/categories/bedroom-essentials | grep -q "Bedroom Essentials"   # SSR shows seeded data
curl -fsS http://127.0.0.1:8080/api/v1                              # Hello World!
curl -fsS http://127.0.0.1:8080/api/v1/storefront/categories -o /dev/null
docker compose -p sh-smoke -f /tmp/sh-smoke.compose.yml logs frontend \
  | grep -cE "ECONNRESET|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|fetch failed|EACCES"   # must be 0
```

Then tear down INCLUDING the smoke volumes:

```bash
docker compose -p sh-smoke -f /tmp/sh-smoke.compose.yml down -v
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
- Behind Caddy the app trusts exactly one proxy hop (`trust proxy = 1` in `main.ts`); do not add a second proxy without adjusting it.
