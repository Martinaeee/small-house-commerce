-- J&T Express tracking: carrier wording on events, poll bookkeeping on shipments.
-- Additive only; nothing existing is rewritten.

ALTER TABLE "logistics_events"
  ADD COLUMN "external_description" TEXT,
  ADD COLUMN "staff_contact" VARCHAR(40),
  ADD COLUMN "signature_image_url" TEXT;

ALTER TABLE "shipments"
  ADD COLUMN "tracking_checked_at" TIMESTAMPTZ(3),
  ADD COLUMN "tracking_error" VARCHAR(300),
  ADD COLUMN "tracking_failures" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "shipments_status_tracking_checked_at_idx"
  ON "shipments" ("status", "tracking_checked_at");
