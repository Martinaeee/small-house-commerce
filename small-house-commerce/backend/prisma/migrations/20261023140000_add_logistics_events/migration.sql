-- §64-66 logistics events. The carrier wording is kept as reported; the
-- normalized state is what business rules read. (shipment_id, external_event_id)
-- is the idempotency key so a webhook delivered twice cannot create a second
-- event.

DO $$ BEGIN
  CREATE TYPE "LogisticsEventStatus" AS ENUM (
    'SHIPPED',
    'IN_TRANSIT',
    'OUT_FOR_DELIVERY',
    'SIGNED',
    'FAILED_DELIVERY',
    'RETURNING',
    'RETURNED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "logistics_events" (
  "id" UUID NOT NULL,
  "shipment_id" UUID NOT NULL,
  "carrier" TEXT NOT NULL,
  "external_event_id" TEXT,
  "external_status" TEXT NOT NULL,
  "normalized_status" "LogisticsEventStatus" NOT NULL,
  "event_time" TIMESTAMPTZ(3) NOT NULL,
  "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "province" TEXT,
  "city" TEXT,
  "raw_payload_reference" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "logistics_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "logistics_events_shipment_id_fkey"
    FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "logistics_events_shipment_id_external_event_id_key"
  ON "logistics_events" ("shipment_id", "external_event_id");

CREATE INDEX IF NOT EXISTS "logistics_events_shipment_id_event_time_idx"
  ON "logistics_events" ("shipment_id", "event_time");
