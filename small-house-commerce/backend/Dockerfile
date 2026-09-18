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
# --chown on every COPY sets ownership as the files land; a trailing
# `RUN chown -R node:node /app` would copy-up the whole tree (~547 MB layer:
# node_modules + dist + generated). --chmod needs BuildKit (enabled by the
# `# syntax=docker/dockerfile:1` directive at the top of this file).
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --chown=node:node --from=build /app/prisma7.config.ts ./
COPY --chown=node:node --from=build /app/prisma ./prisma
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node --from=build /app/src/generated ./src/generated
COPY --chown=node:node --chmod=755 docker-entrypoint.sh ./
# Upload volume mount point: pre-created and owned by node so the named
# volume inherits the ownership on first mount (node writes uploaded images).
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=40s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["./docker-entrypoint.sh"]
