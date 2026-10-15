-- AlterEnum
-- Owner-scoped marketing permissions. The rows themselves are reconciled at
-- startup from prisma/rbac.ts (see prisma/reconcile-*), so this migration only
-- widens the enum, exactly like 20260926140000_add_campaign_link_permission.
ALTER TYPE "PermissionCode" ADD VALUE 'MARKETING_VIEW_OWN';
ALTER TYPE "PermissionCode" ADD VALUE 'MARKETING_MANAGE_OWN';
ALTER TYPE "PermissionCode" ADD VALUE 'MARKETING_VIEW_ALL';
ALTER TYPE "PermissionCode" ADD VALUE 'MARKETING_MANAGE_ALL';
