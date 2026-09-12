# Production Deployment Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship everything needed to run the Small House stack on a single VPS behind automatic HTTPS — production Docker images for backend and frontend, a compose stack with PostgreSQL + Caddy, and a deployment runbook — without touching any external account.

**Architecture:** Multi-stage Docker builds on `node:22-bookworm-slim` with frozen pnpm 12.3.4 installs. Backend image runs `prisma migrate deploy` on boot then `node dist/main`; frontend image runs the Next.js 16 standalone server. Caddy 2 terminates TLS (Let's Encrypt) and reverse-proxies: page/asset traffic goes to the frontend, while `/api/v1` and `/api/v1/*` are routed **directly to the backend** over the internal Docker network. The Next rewrite in `next.config.ts` never carries production browser traffic: Next 16 evaluates `rewrites()` at build time and bakes the destination into `routes-manifest.json`, so its target cannot be changed at runtime (Task 3 review BLOCKER-1 ruling). A runtime `API_TARGET` ENV is still required on the frontend container — but only for Server Components, whose `serverApiUrl()` reads it at request time for SSR/ISR fetches. No port except 80/443 is published.

**Tech Stack:** Docker / Docker Compose v2, Node 22, pnpm 12.3.4 (corepack), Prisma 7.10 (`prisma7.config.ts`, plain `pnpm exec prisma ...` — never `--schema`), Next 16 standalone output, Caddy 2, PostgreSQL 18.

**Spec:** `docs/DEVELOPMENT_PLAN.md` §5 Production Deployment (Domain, Hosting, SSL, mobile/performance testing); existing `docker-compose.yml` (local dev DB) stays untouched.

## Global Constraints

- **No new npm dependencies.** Docker base images and the Caddy image are infrastructure, not npm packages.
- Never modify the existing dev `docker-compose.yml` (the `small-house-postgres` container is in use). All new infra lives in `docker-compose.prod.yml` and `deploy/`.
- Commits use explicit paths only: `git add <paths>` — never `git add -A`, `git add .`, or `git commit -am`.
- Never stage these protected paths: `docs/frontend/HOMEPAGE_SPEC.md`, `docs/superpowers/plans/2026-09-11-pdp-refinement.md`, `docs/research/`.
- Do not push. Do not buy domains/servers. Do not create DNS records. Verification uses throwaway local containers only; every smoke container/volume is torn down in the same task.
- Do not run migrations against the dev database (`localhost:5432` / `small-house-postgres`). Smoke tests use an ephemeral PostgreSQL on host port 55432 or a compose project named `sh-smoke`, torn down afterwards.
- The backend is ESM with `@prisma/adapter-pg` (PrismaPg). Runtime config: `DATABASE_URL`, `JWT_SECRET` (≥32 chars), `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`, `NODE_ENV`, `PORT` — all boot-validated by `src/config/env.validation.ts`.
- pnpm 11+ build scripts are allowlisted in each project's `pnpm-workspace.yaml` (`allowBuilds`: `@prisma/engines`, `argon2`, `esbuild`, `prisma` / `unrs-resolver`) — that file MUST be copied into each build context or installs silently skip native builds.
- The Prisma client is generated into gitignored `backend/src/generated/prisma` (2.6 MB, 7 TS entries) by `pnpm exec prisma generate`; `nest build` compiles it into `dist/generated`. Both trees are needed in the image (dist for the API, src/generated for one-off `tsx prisma/seed.ts`).
- Exact copy and all storefront behavior must remain unchanged; the only application-code change permitted is adding `output: "standalone"` to `next.config.ts`.

---

### Task 1: Next standalone output + Docker ignore files

**Files:**
- Modify: `frontend/next.config.ts`
- Create: `frontend/.dockerignore`
- Create: `backend/.dockerignore`

**Interfaces:**
- Consumes: existing Next config (rewrites to `${API_TARGET}/api/v1/:path*`).
- Produces: `.next/standalone` build output consumed by Task 3's image; build contexts for Tasks 2–3.

- [ ] **Step 1: Enable standalone output**

Set the full content of `frontend/next.config.ts` to:

```ts
import type { NextConfig } from "next";

const API_TARGET = process.env.API_TARGET ?? "http://localhost:3000";

const nextConfig: NextConfig = {
  // Minimal self-contained server output for the production Docker image
  // (Task 3). `next dev` is unaffected; rewrites below still apply.
  output: "standalone",

  // Proxy the storefront API to the backend so the browser never hits CORS.
  // All API calls from the frontend use relative /api/v1 paths.
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${API_TARGET}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
```

- [ ] **Step 2: Verify dev build still produces a working standalone bundle**

Run from `frontend/`:

```bash
pnpm build
test -d .next/standalone && echo "standalone OK"
PORT=3100 HOSTNAME=127.0.0.1 API_TARGET=http://localhost:3000 node .next/standalone/server.js &
SERVER_PID=$!
sleep 2
curl -fsS http://127.0.0.1:3100/ -o /dev/null && echo "standalone serves OK"
kill $SERVER_PID
```

Expected: build succeeds, both echoes print. (Backend need not be up for `/` to render.) Then run `pnpm lint` and `pnpm exec tsc --noEmit` — expect zero findings.

- [ ] **Step 3: Create `frontend/.dockerignore`**

```dockerignore
.git
.gitignore
node_modules
.next
npm-debug.log*
pnpm-debug.log*
.env
.env.*
README.md
Dockerfile
.dockerignore
```

- [ ] **Step 4: Create `backend/.dockerignore`**

```dockerignore
.git
.gitignore
node_modules
dist
src/generated
.env
.env.*
coverage
*.tsbuildinfo
test
README.md
Dockerfile
.dockerignore
```

- [ ] **Step 5: Commit**

```bash
git add frontend/next.config.ts frontend/.dockerignore backend/.dockerignore
git commit -m "chore(deploy): next standalone output and docker ignore files"
```

---

### Task 2: Backend production image with migrate-on-boot

**Files:**
- Create: `backend/Dockerfile`
- Create: `backend/docker-entrypoint.sh`

**Interfaces:**
- Consumes: `prisma/migrations/**`, `prisma/schema/**`, `prisma7.config.ts`, `pnpm-workspace.yaml`, Nest build at `dist/`.
- Produces: image `small-house-backend` (local tag) listening on `$PORT` (default 3000), health endpoint `GET /api/v1` ("Hello World!"), auto-migrating on container start.

- [ ] **Step 1: Create `backend/docker-entrypoint.sh`**

```sh
#!/bin/sh
set -e

echo "[entrypoint] Applying database migrations (prisma migrate deploy)…"
pnpm exec prisma migrate deploy

echo "[entrypoint] Starting API server…"
exec node dist/main
```

- [ ] **Step 2: Create `backend/Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1

# ---- base: Node 22 + pnpm, runtime libs for Prisma/argon2 ----------------
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable \
 && corepack prepare pnpm@12.3.4 --activate \
 && apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ---- build: full deps, prisma generate, nest build -----------------------
FROM base AS build
# Toolchain only as a fallback if argon2 has no prebuild for the platform.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY prisma7.config.ts tsconfig.json tsconfig.build.json nest-cli.json ./
COPY prisma ./prisma
COPY src ./src
RUN pnpm exec prisma generate
RUN pnpm run build

# ---- runner: full node_modules kept (CLI needed for migrate + tsx seed) --
FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/prisma7.config.ts ./
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/generated ./src/generated
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh && chown -R node:node /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=40s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["./docker-entrypoint.sh"]
```

- [ ] **Step 3: Build the image**

Run from repository root (`small-house-commerce/`):

```bash
docker build -t small-house-backend:dev ./backend
```

Expected: build completes; argon2/prisma native steps succeed (the `allowBuilds` list travels in `pnpm-workspace.yaml`).

- [ ] **Step 4: Smoke boot against a throwaway database**

```bash
docker run -d --rm --name sh-smoke-db -e POSTGRES_PASSWORD=postgres -p 55432:5432 postgres:18-alpine
# wait for readiness
for i in $(seq 1 30); do docker exec sh-smoke-db pg_isready -U postgres && break || sleep 1; done

docker run --rm --name sh-smoke-backend \
  --link sh-smoke-db:db \
  -e NODE_ENV=production \
  -e DATABASE_URL="postgresql://postgres:postgres@db:5432/postgres?schema=public" \
  -e JWT_SECRET="smoke-secret-0123456789abcdef0123456789abcdef" \
  -p 55300:3000 \
  small-house-backend:dev &
RUN_PID=$!
for i in $(seq 1 40); do curl -fsS http://127.0.0.1:55300/api/v1 && break || sleep 2; done
```

Expected: logs show all 12 migrations applying in order the first boot; second boot (repeat the run once) reports "Already in sync"; `/api/v1` returns `Hello World!`.

Teardown (required):

```bash
docker stop sh-smoke-db
wait $RUN_PID 2>/dev/null || true
```

- [ ] **Step 5: Commit**

```bash
git add backend/Dockerfile backend/docker-entrypoint.sh
git commit -m "chore(deploy): backend production image with migrate-on-boot"
```

---

### Task 3: Frontend production image (Next standalone)

**Files:**
- Create: `frontend/Dockerfile`

**Interfaces:**
- Consumes: `.next/standalone`, `.next/static`, `public/` from Task 1's build config.
- Produces: image `small-house-frontend` (local tag) on port 3000; `NEXT_PUBLIC_META_PIXEL_ID` is a build ARG; runtime ENV `API_TARGET` (default `http://backend:3000`) is consumed at **request time by Server Components** via `serverApiUrl()` (`src/lib/api.ts`) for SSR/ISR data fetches. Do NOT confuse it with the `rewrites()` destination: Next 16 bakes that into `.next/routes-manifest.json` at build time (review BLOCKER-1), so the rewrite can never be retargeted at runtime — in production browser API calls bypass the image anyway because Caddy routes `/api/v1/*` straight to the backend (Task 4). Artifacts must be owned by the runtime user (`--chown=node:node`), otherwise every prerendered route logs an `EACCES: Failed to update prerender cache` stack on first hit (review MAJOR-1).

- [ ] **Step 1: Create `frontend/Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1

# ---- base ----------------------------------------------------------------
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable \
 && corepack prepare pnpm@12.3.4 --activate
WORKDIR /app

# ---- build: NEXT_PUBLIC_* must be present at build time -------------------
FROM base AS build
ARG NEXT_PUBLIC_META_PIXEL_ID=""
ENV NEXT_PUBLIC_META_PIXEL_ID=$NEXT_PUBLIC_META_PIXEL_ID
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

# ---- runner: only the standalone trace ------------------------------------
# API_TARGET here is read at REQUEST time by serverApiUrl() in Server
# Components (SSR/ISR fetches). It does NOT affect rewrites(): that
# destination is baked into routes-manifest.json at build time and stays
# dev-only — in production Caddy routes browser /api/v1/* calls straight
# to the backend, while server-side fetches call this URL directly.
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV API_TARGET=http://backend:3000
# --chown so the node user can update the prerender cache at runtime
# (root-owned artifacts make every cold route log EACCES).
COPY --chown=node:node --from=build /app/public ./public
COPY --chown=node:node --from=build /app/.next/standalone ./
COPY --chown=node:node --from=build /app/.next/static ./.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
```

- [ ] **Step 2: Build the image**

From repository root:

```bash
docker build --build-arg NEXT_PUBLIC_META_PIXEL_ID=000000000000000 -t small-house-frontend:dev ./frontend
```

Expected: all 15 app-router entries compile (13/13 static generations; the extra two are `/robots.txt` and `/sitemap.xml`); image build ends successfully.

- [ ] **Step 3: Smoke serve**

```bash
docker run -d --rm --name sh-smoke-frontend -p 55301:3000 small-house-frontend:dev
for i in $(seq 1 30); do curl -fsS http://127.0.0.1:55301/ -o /dev/null && echo "frontend serves OK" && break || sleep 1; done
# Hit several prerendered routes (first hit writes the prerender cache).
for p in / /login /collections /cart /register /account; do curl -fsS "http://127.0.0.1:55301$p" -o /dev/null; done
sleep 2
# MAJOR-1 regression gate: zero prerender-cache permission errors.
docker logs sh-smoke-frontend 2>&1 | grep -c "EACCES" || true
docker stop sh-smoke-frontend
```

Expected: homepage HTML returns 200; the `grep -c EACCES` line prints **0** (no `Failed to update prerender cache` stack traces); no Facebook script is present with the dummy pixel ID mismatch behavior beyond what `tracking.ts` already defines (dummy ID merely exercises the build arg path). Delayed background-ISR fetch errors against `http://backend:3000` (DNS failure) are EXPECTED in this image-only smoke — no backend container is reachable — and are explicitly NOT a finding; they disappear in the Task 4 full-stack smoke, where `API_TARGET` resolves and the frontend log must contain zero fetch/proxy errors after page hits. API-path verification through Caddy is Task 4.

- [ ] **Step 4: Commit**

```bash
git add frontend/Dockerfile
git commit -m "chore(deploy): frontend standalone production image"
```

---

### Task 4: Production compose stack, Caddy, env template, runbook

**Files:**
- Create: `docker-compose.prod.yml`
- Create: `deploy/Caddyfile`
- Create: `deploy/env.deploy.example` (no leading dot — the root `.env*` ignore rule does not cover this name)
- Create: `docs/DEPLOYMENT.md`

**Interfaces:**
- Consumes: images from Tasks 2–3.
- Produces: `docker compose -f docker-compose.prod.yml up -d` stack (project `small-house-prod`): db + backend (auto-migrate) + frontend + Caddy with volumes; runbook for first deploy, admin bootstrap, backups, upgrades.

- [ ] **Step 1: Create `docker-compose.prod.yml`**

```yaml
name: small-house-prod

services:
  db:
    image: postgres:18-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    volumes:
      - prod_pgdata:/var/lib/postgresql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 5s
      timeout: 5s
      retries: 12

  backend:
    build:
      context: ./backend
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    environment:
      NODE_ENV: production
      PORT: "3000"
      DATABASE_URL: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}?schema=public
      JWT_SECRET: ${JWT_SECRET}
      JWT_ACCESS_TTL: ${JWT_ACCESS_TTL:-1h}
      JWT_REFRESH_TTL: ${JWT_REFRESH_TTL:-7d}

  frontend:
    build:
      context: ./frontend
      args:
        NEXT_PUBLIC_META_PIXEL_ID: ${NEXT_PUBLIC_META_PIXEL_ID:-}
    restart: unless-stopped
    depends_on:
      backend:
        condition: service_healthy
    environment:
      NODE_ENV: production
      PORT: "3000"
      # Used at request time by Server Components (serverApiUrl) for SSR/ISR
      # data fetches. It does not steer browser traffic: Caddy routes
      # /api/v1/* directly to the backend, and the baked Next rewrite is
      # dev-only.
      API_TARGET: http://backend:3000

  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    depends_on:
      - frontend
      - backend
    ports:
      - "80:80"
      - "443:443"
    environment:
      DOMAIN: ${DOMAIN}
      ACME_EMAIL: ${ACME_EMAIL}
    volumes:
      - ./deploy/Caddyfile:/etc/caddy/Caddyfile:ro
      - prod_caddy_data:/data
      - prod_caddy_config:/config

volumes:
  prod_pgdata:
  prod_caddy_data:
  prod_caddy_config:
```

- [ ] **Step 2: Create `deploy/Caddyfile`**

```caddy
{
	email {$ACME_EMAIL}
}

{$DOMAIN} {
	encode gzip
	# API traffic goes straight to the backend. Next 16 bakes rewrites()
	# destinations at build time, so the frontend's dev-only /api/v1
	# rewrite cannot be retargeted at runtime and must not sit on this path.
	# handle accepts a single matcher, so name a path matcher with both
	# patterns (caddy 2.11 rejects multiple bare path args to handle).
	@api path /api/v1 /api/v1/*
	handle @api {
		reverse_proxy backend:3000
	}
	handle {
		reverse_proxy frontend:3000
	}
}
```

The two patterns matter: `/api/v1/*` matches subpaths but not the bare health path `/api/v1`, so both are listed on the named matcher. `handle` blocks are mutually exclusive and the API block must stay first. Validate syntax by supplying the placeholder env vars (the bare `email {$ACME_EMAIL}` directive fails validation when the placeholder expands to empty): `docker run --rm -e DOMAIN=:80 -e ACME_EMAIL=ops@example.test -v "$PWD/deploy/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile` → "Valid configuration".

- [ ] **Step 3: Create `deploy/env.deploy.example`**

```dotenv
# Copy to .env.deploy next to docker-compose.prod.yml and fill in.
# cp deploy/env.deploy.example .env.deploy
# Compose v2 reads .env in the project directory automatically.

# --- Database ---------------------------------------------------------------
POSTGRES_USER=smallhouse
POSTGRES_DB=small_house
# Generate URL-safe hex: openssl rand -hex 24
# (base64 '/' or '+' is invalid unencoded in the DATABASE_URL userinfo —
# Prisma P1013 boot crash; ~38% of `rand -base64 24` outputs contain '/'.)
POSTGRES_PASSWORD=

# --- API auth ---------------------------------------------------------------
# Generate: node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
JWT_SECRET=
JWT_ACCESS_TTL=1h
JWT_REFRESH_TTL=7d

# --- TLS / domain -----------------------------------------------------------
# Real production: the exact domain with an A record pointing at this server.
DOMAIN=shop.example.com
ACME_EMAIL=admin@example.com

# --- Marketing --------------------------------------------------------------
# Meta Pixel ID is baked into the frontend image — changing it requires a rebuild.
NEXT_PUBLIC_META_PIXEL_ID=
```

- [ ] **Step 4: Create `docs/DEPLOYMENT.md`** with exactly these sections and content:

````markdown
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

Logical backup (cron recommended, e.g. nightly 03:17):

```bash
17 3 * * * cd /path/to/small-house-commerce && docker compose -f docker-compose.prod.yml exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | zstd > /srv/backups/small-house-$(date +\%F).sql.zst
```

The `sh -c '...'` single quotes are essential: `$POSTGRES_USER`/`$POSTGRES_DB` must expand **inside** the db container, where compose sets them. Cron's host shell has neither variable, so an unquoted/outer expansion runs `pg_dump -U "" ""` and silently writes a 0-byte archive.

Restore into a fresh database:

```bash
zstd -d -c backup.sql.zst | docker compose -f docker-compose.prod.yml exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
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

Migrations in this project are forward-only and non-destructive. Code rollback is `git checkout <prev> && build && up -d`, but a revision whose schema changed requires restoring the database backup taken before the upgrade — take a backup immediately before every production upgrade. The `postgres:18-alpine` data directory lives at `/var/lib/postgresql/18/docker` inside the `prod_pgdata` volume (image-major versioned): upgrading the db image to a new major version (e.g. 18 → 19) does not upgrade data in place — plan a dump/restore or `pg_upgrade`.

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
# Wait for the API (the entrypoint applies migrations before serving):
for i in $(seq 1 60); do
  docker compose -p sh-smoke -f /tmp/sh-smoke.compose.yml exec -T backend \
    node -e "fetch('http://localhost:3000/api/v1').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
    && break
  sleep 2
done
```

(Run from anywhere; substitute the absolute path to the `small-house-commerce` directory.)

`DOMAIN=:80` makes Caddy serve plain HTTP (no ACME attempt). Seed the category tree, and only THEN start the frontend + Caddy (proves the frontend's runtime `API_TARGET` Server Component path, not just browser routing). Warm a category DETAIL page and poll until its SSR HTML contains the seeded category name (the homepage nav does not render root category names server-side) — with the ordered startup the poll normally succeeds immediately; it remains a safety net, not a 5-minute wait. Then verify pages, API paths, and log hygiene:

```bash
docker compose -p sh-smoke -f /tmp/sh-smoke.compose.yml \
  exec -T backend pnpm exec tsx prisma/seed-categories.ts
docker compose -p sh-smoke --project-directory "$PD" \
  -f /tmp/sh-smoke.compose.yml --env-file /tmp/sh-smoke.env up -d --build frontend caddy
curl -fsS http://127.0.0.1:8080/categories/bedroom-essentials -o /dev/null   # warm
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
````

- [ ] **Step 5: Validate compose config**

```bash
cd small-house-commerce
docker compose --env-file deploy/env.deploy.example -f docker-compose.prod.yml config >/dev/null && echo "compose config OK"
```

Expected: warnings about empty required values are acceptable for the template, no parse errors.

- [ ] **Step 6: Full local smoke with throwaway project**

Follow the exact procedure documented in `docs/DEPLOYMENT.md` §10 (temp compose copy under `/tmp` with Caddy remapped to `127.0.0.1:8080:80`, temp env file with `DOMAIN=:80`, project name `sh-smoke`, `--project-directory` pointing at the real project dir). Start **db + backend only**, wait for the API, seed, and only then start frontend + Caddy — that order is load-bearing: a frontend booted before seeding primes its fetch data-cache (`revalidate: 300`) with the empty categories list and 404s category pages for ~5 minutes (Task 4 review MAJOR-3 ruling). Then verify:

```bash
PD=/ABSOLUTE/PATH/TO/small-house-commerce
# Seed the category tree so real SSR content proves the runtime API_TARGET
# path works — empty pages served from build-time fallback would mask a
# silently-wrong fetch target (Task 3 re-review INFO).
docker compose -p sh-smoke -f /tmp/sh-smoke.compose.yml \
  exec -T backend pnpm exec tsx prisma/seed-categories.ts
docker compose -p sh-smoke --project-directory "$PD" \
  -f /tmp/sh-smoke.compose.yml --env-file /tmp/sh-smoke.env up -d --build frontend caddy
# The category DETAIL page renders the fetched category name in SSR HTML
# (the homepage nav does not render root names server-side). Warm it, then
# poll as a safety net; with the ordered startup it succeeds on iteration 1.
curl -fsS http://127.0.0.1:8080/categories/bedroom-essentials -o /dev/null
SSR_OK=""
for i in $(seq 1 60); do
  curl -fsS http://127.0.0.1:8080/categories/bedroom-essentials | grep -q "Bedroom Essentials" && { SSR_OK=1; break; }
  sleep 5
done
[ "$SSR_OK" = 1 ] && echo "SSR shows seeded category OK" || { echo "SSR content never updated"; exit 1; }
curl -fsS http://127.0.0.1:8080/api/v1 && echo "API health via caddy OK"
curl -fsS "http://127.0.0.1:8080/api/v1/storefront/categories" -o /dev/null && echo "API wildcard route via caddy OK"
# More pages exercising Server Component fetches via the runtime API_TARGET.
for p in /collections /search; do curl -fsS "http://127.0.0.1:8080$p" -o /dev/null; done
sleep 5
# Must be 0: no failed SSR/ISR backend fetches (runtime API_TARGET works),
# no EACCES prerender-cache errors either.
docker compose -p sh-smoke -f /tmp/sh-smoke.compose.yml logs frontend \
  | grep -cE "ECONNRESET|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|fetch failed|EACCES"
docker compose -p sh-smoke -f /tmp/sh-smoke.compose.yml --env-file /tmp/sh-smoke.env down -v
rm -f /tmp/sh-smoke.compose.yml /tmp/sh-smoke.compose.yml.bak /tmp/sh-smoke.env
```

Expected: `SSR shows seeded category OK` — the category DETAIL page `/categories/bedroom-essentials` SSR HTML contains the seeded category name (the homepage never renders root names server-side; the marker moved here in the `e025fe4` ruling); homepage 200 through Caddy; bare API path returns `Hello World!` (exact `/api/v1` matcher) and `/api/v1/storefront/categories` returns **200 JSON** with the seeded tree (`/api/v1/*` wildcard matcher); the frontend-log error grep prints **0**; teardown removes all `sh-smoke_*` volumes and leaves the dev `small-house-postgres` container running (`docker ps`). Nothing is created in the project directory.

- [ ] **Step 7: Commit**

```bash
git add docker-compose.prod.yml deploy/Caddyfile deploy/env.deploy.example docs/DEPLOYMENT.md
git commit -m "docs(deploy): prod compose stack, Caddy TLS, env template and runbook"
```

Do NOT add `docker-compose.override-smoke.yml` or any `.env.deploy` file.

---

## Final verification (all tasks)

1. `docker build -t small-house-backend:dev ./backend` and `... frontend` both succeed from clean cache.
2. Frontend gates stay green: `pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm build` in `frontend/`.
3. Backend gates stay green: `pnpm lint`, `pnpm run build`, `pnpm test` in `backend/`.
4. `git status` shows no new tracked files beyond the deployment artifacts; protected paths unstaged; dev containers still up.
5. No code path changed besides `output: "standalone"` — confirm with `git diff main -- backend/src frontend/src` showing only `next.config.ts`.
