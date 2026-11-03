-- Attribute first-party funnel events (add to cart, checkout started, …) to
-- the campaign link whose touch credential the batch carried. Additive and
-- nullable: historical events keep working with campaign_link_id NULL and
-- are never backfilled.
ALTER TABLE "analytics_events" ADD COLUMN "campaign_link_id" UUID;
CREATE INDEX "analytics_events_campaign_link_id_event_name_event_day_idx"
  ON "analytics_events" ("campaign_link_id", "event_name", "event_day");
