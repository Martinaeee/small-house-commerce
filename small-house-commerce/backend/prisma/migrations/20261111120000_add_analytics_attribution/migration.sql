-- Verified attribution landed on first-party analytics events.
-- Every column is nullable: historical rows keep NULL and older readers ignore it.
--
-- Prisma 7.10.0 does not wrap a migration in a transaction on its own (verified
-- with a failing probe migration: the CREATE TABLE persisted). Keep the
-- explicit transaction so a failed ALTER/CREATE INDEX leaves no partial DDL.
BEGIN;

ALTER TABLE "analytics_events"
  ADD COLUMN "optimizer_id" UUID,
  ADD COLUMN "aid_snapshot" VARCHAR(64),
  ADD COLUMN "ad_id" VARCHAR(64),
  ADD COLUMN "ad_id_source" VARCHAR(24),
  ADD COLUMN "ad_id_missing_reason" VARCHAR(48),
  ADD COLUMN "adset_id" VARCHAR(64),
  ADD COLUMN "attribution_paid" BOOLEAN,
  ADD COLUMN "link_resolution" VARCHAR(16),
  ADD COLUMN "attribution_conflict" BOOLEAN,
  ADD COLUMN "conflict_detail" VARCHAR(240);

CREATE INDEX "analytics_events_ad_id_event_name_event_day_idx"
  ON "analytics_events"("ad_id", "event_name", "event_day");
CREATE INDEX "analytics_events_optimizer_id_event_name_event_day_idx"
  ON "analytics_events"("optimizer_id", "event_name", "event_day");
CREATE INDEX "analytics_events_campaign_link_id_ad_id_event_day_idx"
  ON "analytics_events"("campaign_link_id", "ad_id", "event_day");

CREATE INDEX "order_attributions_link_id_ad_id_idx"
  ON "order_attributions"("link_id", "ad_id");
CREATE INDEX "order_attributions_ad_id_attributed_at_idx"
  ON "order_attributions"("ad_id", "attributed_at");

COMMIT;
