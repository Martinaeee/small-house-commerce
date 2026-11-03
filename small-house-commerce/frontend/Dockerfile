# syntax=docker/dockerfile:1

# ---- base ----------------------------------------------------------------
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
# Some regions cannot reach registry.npmjs.org reliably; the deploy may
# point corepack's binary download at a mirror (e.g.
# https://registry.npmmirror.com) through this build arg. Empty = the
# official registry.
ARG COREPACK_NPM_REGISTRY=""
ENV COREPACK_NPM_REGISTRY=$COREPACK_NPM_REGISTRY
RUN corepack enable \
 && corepack prepare pnpm@12.3.4 --activate
WORKDIR /app

# ---- build: NEXT_PUBLIC_* must be present at build time -------------------
FROM base AS build
ARG NEXT_PUBLIC_META_PIXEL_ID=""
ENV NEXT_PUBLIC_META_PIXEL_ID=$NEXT_PUBLIC_META_PIXEL_ID
# Public origin baked into metadata/sitemap/robots/JSON-LD. Empty falls back
# to the production domain in src/lib/site-url.ts.
ARG NEXT_PUBLIC_SITE_URL=""
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
# pnpm resolves packages against this registry (npmjs by default). A mirror
# exists for regions where npmjs is unreachable or flaky. Empty = official.
ARG NPM_CONFIG_REGISTRY=""
ENV NPM_CONFIG_REGISTRY=$NPM_CONFIG_REGISTRY
# Baked into the /api/v1 and /uploads rewrite destinations
# (routes-manifest.json). Caddy serves browser traffic directly, but the
# built-in image optimizer fetches local /uploads/* source files from inside
# this container, and that fetch must land on the backend.
ARG API_TARGET=""
ENV API_TARGET=$API_TARGET
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build
# The production image optimizer needs sharp on disk; fail the build here
# rather than serving 500s for every optimized image at runtime.
RUN node -e "require('sharp')"

# ---- runner: only the standalone trace ------------------------------------
# API_TARGET here is read at REQUEST time by serverApiUrl() in Server
# Components (SSR/ISR fetches). The build-stage ARG above bakes the rewrite
# destinations for the image optimizer's /uploads/* source fetches; the
# browser path is unaffected — Caddy routes /api/v1/* and /uploads/* straight
# to the backend.
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
