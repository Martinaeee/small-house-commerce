#!/bin/sh
set -e

echo "[entrypoint] Applying database migrations (prisma migrate deploy)…"
pnpm exec prisma migrate deploy

echo "[entrypoint] Reconciling CAMPAIGN_LINK_BUILD role grants…"
pnpm run rbac:reconcile-campaign-link

echo "[entrypoint] Reconciling Newsletter role grants…"
pnpm run rbac:reconcile-newsletter

echo "[entrypoint] Reconciling Storefront Shell role grants…"
pnpm run rbac:reconcile-storefront-shell

echo "[entrypoint] Starting API server…"
exec node dist/main
