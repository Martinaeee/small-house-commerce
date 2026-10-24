-- Stage 3B close-out: a return now belongs to the box it came back in, and a
-- fully returned shipment/order stops sitting in "shipping".
--
-- Additive only: two enum values on each status domain and a nullable column
-- that is backfilled before it is made NOT NULL. New values are not written to
-- existing rows here, so this migration can run inside one transaction.

DO $$ BEGIN
  ALTER TYPE "OrderStatus" ADD VALUE 'RETURNED';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE "OrderStatus" ADD VALUE 'PARTIALLY_RETURNED';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE "ShipmentStatus" ADD VALUE 'RETURNED';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE "ShipmentStatus" ADD VALUE 'PARTIALLY_RETURNED';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "return_acceptances"
  ADD COLUMN IF NOT EXISTS "shipment_id" UUID;

-- Historical rows (local drafts only; production never ran migration 64) did
-- not record a box. Pick the lowest shipment that carried any of the accepted
-- lines so the row stays valid; new rows always require an explicit box.
UPDATE "return_acceptances" ra
SET "shipment_id" = picked.shipment_id
FROM (
  SELECT ra2.id, MIN(si."shipment_id"::text)::uuid AS shipment_id
  FROM "return_acceptances" ra2
  JOIN "return_acceptance_items" rai ON rai."return_acceptance_id" = ra2.id
  JOIN "shipment_items" si ON si."order_item_id" = rai."order_item_id"
  GROUP BY ra2.id
) picked
WHERE ra.id = picked.id
  AND ra."shipment_id" IS NULL;

ALTER TABLE "return_acceptances"
  ALTER COLUMN "shipment_id" SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE "return_acceptances"
    ADD CONSTRAINT "return_acceptances_shipment_id_fkey"
    FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "return_acceptances_shipment_id_idx"
  ON "return_acceptances"("shipment_id");
