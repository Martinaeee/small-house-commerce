-- Storefront intelligence P1: read-only access to the observability workbench.
-- PostgreSQL cannot use a new enum value in the transaction that adds it;
-- the permission row and role grants are reconciled at container start by
-- `rbac:reconcile-observability-view`.
ALTER TYPE "PermissionCode" ADD VALUE IF NOT EXISTS 'OBSERVABILITY_VIEW';
