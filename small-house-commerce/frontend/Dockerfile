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
# NOTE: no API_TARGET ENV here. Next 16 bakes rewrites() destinations into
# routes-manifest.json at build time; a runtime ENV cannot change them. In
# production Caddy routes /api/v1/* directly to the backend (see Task 4),
# so the baked dev rewrite is never exercised.
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
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
