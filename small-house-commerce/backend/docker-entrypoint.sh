#!/bin/sh
set -e

echo "[entrypoint] Applying database migrations (prisma migrate deploy)…"
pnpm exec prisma migrate deploy

echo "[entrypoint] Starting API server…"
exec node dist/main
