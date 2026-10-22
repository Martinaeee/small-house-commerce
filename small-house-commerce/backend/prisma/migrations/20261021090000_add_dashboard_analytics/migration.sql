-- Dashboard analytics (operator workbench §17-18).
--
-- Additive only: one enum, one event table, one nullable order column and the
-- indexes the dashboard aggregates need. No existing row is read for writing
-- or rewritten here.
--
-- The partial unique index is the impression dedupe rule: one impression per
-- session per homepage section per Manila day. It is expressed in SQL because
-- Prisma cannot declare filtered indexes; the service writes `event_day` from
-- the Asia/Manila calendar so the index expression stays IMMUTABLE.

SET lock_timeout = '5s';

-- CreateEnum
CREATE TYPE "AnalyticsEventName" AS ENUM (
    'PAGE_VIEW',
    'PRODUCT_VIEW',
    'ADD_TO_CART',
    'BEGIN_CHECKOUT',
    'PURCHASE',
    'HOMEPAGE_SECTION_IMPRESSION',
    'HOMEPAGE_SECTION_CLICK',
    'SEARCH'
);

-- CreateTable
CREATE TABLE "analytics_events" (
    "id" UUID NOT NULL,
    "event_name" "AnalyticsEventName" NOT NULL,
    "session_id" VARCHAR(100) NOT NULL,
    "customer_id" UUID,
    "page_url" VARCHAR(1024) NOT NULL,
    "page_path" VARCHAR(512) NOT NULL,
    "device_type" VARCHAR(16) NOT NULL,
    "referrer" VARCHAR(1024),
    "utm_source" VARCHAR(120),
    "utm_medium" VARCHAR(120),
    "utm_campaign" VARCHAR(120),
    "entity_id" VARCHAR(120),
    "section_id" VARCHAR(120),
    "section_type" VARCHAR(40),
    "destination" VARCHAR(1024),
    "product_id" UUID,
    "campaign_id" VARCHAR(120),
    "metadata" JSONB,
    "event_day" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "analytics_events_event_name_created_at_idx" ON "analytics_events"("event_name", "created_at");
CREATE INDEX "analytics_events_event_name_event_day_idx" ON "analytics_events"("event_name", "event_day");
CREATE INDEX "analytics_events_session_id_created_at_idx" ON "analytics_events"("session_id", "created_at");
CREATE INDEX "analytics_events_section_id_event_name_event_day_idx" ON "analytics_events"("section_id", "event_name", "event_day");
CREATE INDEX "analytics_events_product_id_event_name_event_day_idx" ON "analytics_events"("product_id", "event_name", "event_day");
CREATE INDEX "analytics_events_created_at_idx" ON "analytics_events"("created_at");

-- One impression per session, section and Manila day. Repeats are dropped by
-- `ON CONFLICT DO NOTHING` in the ingest path instead of inflating CTR.
CREATE UNIQUE INDEX "analytics_events_impression_daily_dedupe"
    ON "analytics_events"("session_id", "section_id", "event_day")
    WHERE "event_name" = 'HOMEPAGE_SECTION_IMPRESSION';

-- AlterTable: the browser session that placed the order. Nullable because
-- orders can be created from the admin workbench, where no session exists.
ALTER TABLE "orders" ADD COLUMN "tracking_session_id" VARCHAR(100);

-- CreateIndex (dashboard aggregation paths)
CREATE INDEX "orders_payment_status_idx" ON "orders"("payment_status");
CREATE INDEX "orders_tracking_session_id_idx" ON "orders"("tracking_session_id");
CREATE INDEX "order_shipping_address_province_idx" ON "order_shipping_address"("province");
CREATE INDEX "order_items_product_id_idx" ON "order_items"("product_id");
CREATE INDEX "order_items_sku_id_idx" ON "order_items"("sku_id");
