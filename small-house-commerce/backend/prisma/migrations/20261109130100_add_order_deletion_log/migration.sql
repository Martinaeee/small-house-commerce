-- Audit of permanent order deletions. No FK on purpose: the record outlives
-- the order it describes. `snapshot` keeps the deleted order plus its lines so
-- a mistaken deletion can still be reconstructed and investigated.
CREATE TABLE "order_deletion_log" (
  "id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "order_number" TEXT NOT NULL,
  "order_status" TEXT NOT NULL,
  "customer_id" UUID,
  "grand_total" DECIMAL(10,2),
  "qianyi_action" TEXT,
  "snapshot" JSONB NOT NULL,
  "operator_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_deletion_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "order_deletion_log_order_id_idx" ON "order_deletion_log"("order_id");
CREATE INDEX "order_deletion_log_created_at_idx" ON "order_deletion_log"("created_at");
