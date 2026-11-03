-- Qianyi ERP order sync: outbox, webhook archive and the mapping columns.
-- Additive only; nothing existing is rewritten.

CREATE TYPE "QianyiSyncKind" AS ENUM ('PUSH_ORDER', 'CLOSE_ORDER');
CREATE TYPE "QianyiSyncStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

ALTER TABLE "skus" ADD COLUMN "qianyi_sku_code" VARCHAR(255);
ALTER TABLE "orders" ADD COLUMN "qianyi_order_number" VARCHAR(64);
ALTER TABLE "shipments" ADD COLUMN "qianyi_outbound_number" VARCHAR(64);
ALTER TABLE "shipments" ADD COLUMN "qianyi_status" VARCHAR(40);

CREATE TABLE "qianyi_sync_jobs" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "kind" "QianyiSyncKind" NOT NULL,
    "status" "QianyiSyncStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" VARCHAR(1024),
    "request_payload" JSONB NOT NULL,
    "response_payload" JSONB,
    "external_order_number" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "qianyi_sync_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "qianyi_webhook_events" (
    "id" UUID NOT NULL,
    "service_type" VARCHAR(60) NOT NULL,
    "sign_valid" BOOLEAN NOT NULL DEFAULT false,
    "external_key" VARCHAR(200) NOT NULL,
    "payload" JSONB NOT NULL,
    "error" VARCHAR(1024),
    "processed_at" TIMESTAMPTZ(3),
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "qianyi_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "qianyi_sync_jobs_order_id_kind_key"
    ON "qianyi_sync_jobs"("order_id", "kind");
CREATE INDEX "qianyi_sync_jobs_status_next_attempt_at_idx"
    ON "qianyi_sync_jobs"("status", "next_attempt_at");
CREATE UNIQUE INDEX "qianyi_webhook_events_external_key_key"
    ON "qianyi_webhook_events"("external_key");
CREATE INDEX "qianyi_webhook_events_received_at_idx"
    ON "qianyi_webhook_events"("received_at");

ALTER TABLE "qianyi_sync_jobs"
    ADD CONSTRAINT "qianyi_sync_jobs_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
