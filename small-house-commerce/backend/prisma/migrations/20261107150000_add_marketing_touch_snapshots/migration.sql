-- First/last paid touch snapshots and the AID-first link mode.
CREATE TYPE "CampaignLinkAttributionMode" AS ENUM ('CL', 'AID');

ALTER TABLE "campaign_links"
  ADD COLUMN "attribution_mode" "CampaignLinkAttributionMode" NOT NULL DEFAULT 'CL';

ALTER TABLE "order_attributions"
  ADD COLUMN "first_touch" JSONB,
  ADD COLUMN "last_paid_touch" JSONB,
  ADD COLUMN "attribution_model" VARCHAR(20),
  ADD COLUMN "attribution_captured_at" TIMESTAMPTZ(3),
  ADD COLUMN "attribution_touch_id" VARCHAR(64);
