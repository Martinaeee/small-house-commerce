-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PermissionCode" ADD VALUE 'ORDER_ASSIGN';
ALTER TYPE "PermissionCode" ADD VALUE 'ORDER_VERIFY';
ALTER TYPE "PermissionCode" ADD VALUE 'ORDER_NOTE_WRITE';
ALTER TYPE "PermissionCode" ADD VALUE 'ORDER_RISK_WRITE';
ALTER TYPE "PermissionCode" ADD VALUE 'ORDER_MERGE';
ALTER TYPE "PermissionCode" ADD VALUE 'ORDER_HANDOVER';

-- NOTE: the pre-existing index-name drift on
-- promo_code_redemptions_promotion_id_normalized_phone_* is NOT fixed here on
-- purpose: it comes from migration 20261014190000 (PostgreSQL truncated the
-- name to 63 characters) and has nothing to do with the order permissions.
