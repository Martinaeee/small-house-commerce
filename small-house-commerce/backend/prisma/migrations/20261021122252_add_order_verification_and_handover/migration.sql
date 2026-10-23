-- CreateEnum
CREATE TYPE "VerificationCategory" AS ENUM ('CUSTOMER_INFO', 'PRODUCT_INFO', 'SHIPPING_ADDRESS', 'COD_PAYMENT', 'DELIVERY_SCHEDULE', 'RISK_REVIEW', 'OTHER');

-- CreateEnum
CREATE TYPE "VerificationItemStatus" AS ENUM ('PENDING', 'DONE', 'PROBLEM', 'SKIPPED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "VerificationEventType" AS ENUM ('ASSIGNED', 'REASSIGNED', 'RESULT_SET', 'CONTACT_ATTEMPT', 'NOTE', 'NEXT_FOLLOW_UP', 'INVALIDATED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "VerificationPriority" AS ENUM ('NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "VerificationTemplateScope" AS ENUM ('SYSTEM', 'CUSTOM');

-- CreateEnum
CREATE TYPE "OrderHandoverEventType" AS ENUM ('HANDED_OVER', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "OrderHandoverDisposition" AS ENUM ('ACCEPTED', 'REJECTED', 'WITHDRAWN');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "next_follow_up_at" TIMESTAMPTZ(3),
ADD COLUMN     "verification_required" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "order_verification_assignments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "assignee_id" UUID,
    "assigned_by_id" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ(3),
    "priority" "VerificationPriority" NOT NULL DEFAULT 'NORMAL',
    "next_follow_up_at" TIMESTAMPTZ(3),
    "note" TEXT,
    "rev" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "order_verification_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_verification_items" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "assignment_id" UUID,
    "item_key" TEXT NOT NULL,
    "category" "VerificationCategory" NOT NULL,
    "title_snapshot" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "assignee_id" UUID,
    "status" "VerificationItemStatus" NOT NULL DEFAULT 'PENDING',
    "result" TEXT,
    "note" TEXT,
    "operator_id" UUID,
    "completed_at" TIMESTAMPTZ(3),
    "next_follow_up_at" TIMESTAMPTZ(3),
    "skipped_reason" TEXT,
    "subject_fingerprint" TEXT,
    "invalidated_at" TIMESTAMPTZ(3),
    "invalidated_reason" TEXT,
    "rev" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "order_verification_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_verification_events" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "item_id" UUID,
    "assignment_id" UUID,
    "type" "VerificationEventType" NOT NULL,
    "from_status" "VerificationItemStatus",
    "to_status" "VerificationItemStatus",
    "result" TEXT,
    "note" TEXT,
    "operator_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_verification_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_verification_approvals" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "assignment_id" UUID,
    "basis" JSONB NOT NULL,
    "snapshot_hash" TEXT NOT NULL,
    "approved_by_id" UUID NOT NULL,
    "approved_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_verification_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_item_templates" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "scope" "VerificationTemplateScope" NOT NULL DEFAULT 'SYSTEM',
    "owner_id" UUID,
    "items" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "verification_item_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_handover_events" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "type" "OrderHandoverEventType" NOT NULL,
    "disposition" "OrderHandoverDisposition" NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "operator_id" UUID NOT NULL,
    "reason" TEXT,
    "note" TEXT,
    "items" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_handover_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_verification_assignments_order_id_idx" ON "order_verification_assignments"("order_id");

-- CreateIndex
CREATE INDEX "order_verification_assignments_assignee_id_closed_at_idx" ON "order_verification_assignments"("assignee_id", "closed_at");

-- CreateIndex
CREATE INDEX "order_verification_assignments_next_follow_up_at_idx" ON "order_verification_assignments"("next_follow_up_at");

-- CreateIndex
CREATE INDEX "order_verification_items_order_id_status_idx" ON "order_verification_items"("order_id", "status");
CREATE INDEX "order_verification_items_assignee_id_idx" ON "order_verification_items"("assignee_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_verification_items_order_id_item_key_key" ON "order_verification_items"("order_id", "item_key");

-- CreateIndex
CREATE INDEX "order_verification_events_order_id_created_at_idx" ON "order_verification_events"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "order_verification_events_item_id_created_at_idx" ON "order_verification_events"("item_id", "created_at");

-- CreateIndex
CREATE INDEX "order_verification_approvals_order_id_approved_at_idx" ON "order_verification_approvals"("order_id", "approved_at");

-- CreateIndex
CREATE INDEX "verification_item_templates_scope_idx" ON "verification_item_templates"("scope");

-- CreateIndex
CREATE INDEX "order_handover_events_order_id_occurred_at_idx" ON "order_handover_events"("order_id", "occurred_at");

-- CreateIndex
CREATE INDEX "order_items_sku_id_idx" ON "order_items"("sku_id");

-- CreateIndex
CREATE INDEX "orders_next_follow_up_at_idx" ON "orders"("next_follow_up_at");

-- AddForeignKey
ALTER TABLE "order_verification_assignments" ADD CONSTRAINT "order_verification_assignments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_verification_items" ADD CONSTRAINT "order_verification_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_verification_items" ADD CONSTRAINT "order_verification_items_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "order_verification_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_verification_events" ADD CONSTRAINT "order_verification_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_verification_events" ADD CONSTRAINT "order_verification_events_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "order_verification_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_verification_events" ADD CONSTRAINT "order_verification_events_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "order_verification_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_verification_approvals" ADD CONSTRAINT "order_verification_approvals_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_verification_approvals" ADD CONSTRAINT "order_verification_approvals_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "order_verification_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_handover_events" ADD CONSTRAINT "order_handover_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- NOTE: the pre-existing index-name drift on
-- promo_code_redemptions_promotion_id_normalized_phone_* is NOT fixed here on
-- purpose: it comes from migration 20261014190000 (PostgreSQL truncated the
-- name to 63 characters) and has nothing to do with order verification. It
-- needs its own one-line migration if the schema should become drift-free.
