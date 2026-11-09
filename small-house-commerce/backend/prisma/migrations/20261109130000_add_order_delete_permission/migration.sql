-- Permanent order deletion is a separate, super-admin-only capability.
-- PostgreSQL cannot use a new enum value in the transaction that adds it;
-- the permission row and role grants are reconciled at container start by
-- `rbac:reconcile-order-permissions`.
ALTER TYPE "PermissionCode" ADD VALUE IF NOT EXISTS 'ORDER_DELETE';
