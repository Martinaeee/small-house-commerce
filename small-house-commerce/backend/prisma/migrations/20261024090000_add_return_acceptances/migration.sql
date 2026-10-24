-- §85 RTO / return acceptance. Good units return to sellable stock; damaged
-- units stay recorded here only. The per-line cap is enforced in the service.

CREATE TABLE IF NOT EXISTS "return_acceptances" (
  "id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "reason" TEXT,
  "received_by" UUID NOT NULL,
  "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "return_acceptances_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "return_acceptances_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "orders"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "return_acceptance_items" (
  "id" UUID NOT NULL,
  "return_acceptance_id" UUID NOT NULL,
  "order_item_id" UUID NOT NULL,
  "quantity_good" INTEGER NOT NULL,
  "quantity_damaged" INTEGER NOT NULL,
  "condition_note" TEXT,
  CONSTRAINT "return_acceptance_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "return_acceptance_items_return_acceptance_id_fkey"
    FOREIGN KEY ("return_acceptance_id") REFERENCES "return_acceptances"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "return_acceptance_items_order_item_id_fkey"
    FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "return_acceptance_items_return_acceptance_id_order_item_id_key"
  ON "return_acceptance_items" ("return_acceptance_id", "order_item_id");

CREATE INDEX IF NOT EXISTS "return_acceptances_order_id_received_at_idx"
  ON "return_acceptances" ("order_id", "received_at");

CREATE INDEX IF NOT EXISTS "return_acceptance_items_order_item_id_idx"
  ON "return_acceptance_items" ("order_item_id");
