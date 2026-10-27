-- Meta Conversions API outbox.
--
-- One row per distinct Meta event occurrence. The unique event_id is the same
-- value the browser Pixel receives as `eventID`, so Meta deduplicates the two
-- channels. Rows are delivered by the backend with retries; nothing is lost
-- when Meta or the network is down.

-- CreateEnum
CREATE TYPE "MetaConversionStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "meta_conversion_events" (
    "id" UUID NOT NULL,
    "event_name" VARCHAR(40) NOT NULL,
    "event_id" VARCHAR(120) NOT NULL,
    "event_time" TIMESTAMPTZ(3) NOT NULL,
    "action_source" VARCHAR(20) NOT NULL DEFAULT 'website',
    "event_source_url" VARCHAR(1024) NOT NULL,
    "custom_data" JSONB,
    "fbp" VARCHAR(200),
    "fbc" VARCHAR(300),
    "client_ip" VARCHAR(60),
    "client_user_agent" VARCHAR(512),
    "phone_hash" VARCHAR(64),
    "status" "MetaConversionStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(1024),
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meta_conversion_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "meta_conversion_events_event_id_key" ON "meta_conversion_events"("event_id");

-- CreateIndex
CREATE INDEX "meta_conversion_events_status_next_attempt_at_idx" ON "meta_conversion_events"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "meta_conversion_events_created_at_idx" ON "meta_conversion_events"("created_at");
