-- Derived handover marker for the stage-2 work queues.
-- The append-only order_handover_events rows remain the source of truth;
-- this column only answers "has every ordered unit reached the warehouse?".
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "handover_completed_at" TIMESTAMPTZ(3);

CREATE INDEX IF NOT EXISTS "orders_order_status_handover_completed_at_idx"
  ON "orders" ("order_status", "handover_completed_at");
