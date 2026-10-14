-- AlterEnum
-- The shared FAQ library permission. Rows and role grants are reconciled at
-- startup from prisma/rbac.ts, so this migration only widens the enum.
ALTER TYPE "PermissionCode" ADD VALUE 'PRODUCT_FAQ_SHARED_MANAGE';
