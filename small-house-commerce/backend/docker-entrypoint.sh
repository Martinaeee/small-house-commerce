#!/bin/sh
set -e

echo "[entrypoint] Applying database migrations (prisma migrate deploy)…"
pnpm exec prisma migrate deploy

echo "[entrypoint] Reconciling CAMPAIGN_LINK_BUILD role grants…"
pnpm run rbac:reconcile-campaign-link

echo "[entrypoint] Starting API server…"
exec node dist/main
