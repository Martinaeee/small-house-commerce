-- Keep checkout draft provenance after the draft retention window ends.
-- Actual order creation stays unchanged (analytics/revenue keep that clock).
ALTER TABLE "orders" ADD COLUMN "draft_started_at" TIMESTAMPTZ(3);

-- Existing converted drafts can still supply their start time. No order
-- status, totals, stock, payment or attribution is changed by this backfill.
UPDATE "orders" AS o
SET "draft_started_at" = LEAST(d."created_at", o."created_at")
FROM "checkout_drafts" AS d
WHERE d."order_id" = o."id" AND d."status" = 'CONVERTED';

-- One non-null clock lets Prisma sort mixed draft/ordinary orders before
-- pagination, without changing created_at or reimplementing every filter in SQL.
ALTER TABLE "orders" ADD COLUMN "workbench_started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "orders"
SET "workbench_started_at" = COALESCE("draft_started_at", "created_at");
CREATE INDEX "orders_workbench_started_at_id_idx" ON "orders"("workbench_started_at", "id");
