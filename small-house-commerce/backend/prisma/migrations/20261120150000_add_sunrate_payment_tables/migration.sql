-- SUNRATE online payments (design 2026-11-20): per-method switches, gateway
-- payment attempts and the notification audit trail. Purely additive.

CREATE TYPE "SunrateAttemptStatus" AS ENUM ('CREATING', 'PENDING', 'UNKNOWN', 'SUCCEEDED', 'FAILED', 'REVIEW');

CREATE TABLE "payment_method_configs" (
    "method" VARCHAR(16) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payment_method_configs_pkey" PRIMARY KEY ("method")
);

CREATE TABLE "sunrate_payment_attempts" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "payment_id" UUID,
    "channel" VARCHAR(16) NOT NULL,
    "env" VARCHAR(12) NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "merchant_order_num" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "trans_id" TEXT,
    "card_brand" TEXT,
    "card_last4" TEXT,
    "status" "SunrateAttemptStatus" NOT NULL DEFAULT 'CREATING',
    "last_query_at" TIMESTAMPTZ(3),
    "last_result" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sunrate_payment_attempts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sunrate_notification_events" (
    "id" UUID NOT NULL,
    "order_num" VARCHAR(64) NOT NULL,
    "attempt_id" UUID,
    "signature_valid" BOOLEAN NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "outcome" VARCHAR(24),
    "payload" JSONB,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sunrate_notification_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sunrate_payment_attempts_merchant_order_num_key" ON "sunrate_payment_attempts"("merchant_order_num");
CREATE INDEX "sunrate_payment_attempts_order_id_idx" ON "sunrate_payment_attempts"("order_id");
CREATE INDEX "sunrate_notification_events_order_num_idx" ON "sunrate_notification_events"("order_num");

-- Only ONE active attempt may exist per order; terminal rows (SUCCEEDED /
-- FAILED) do not block a legitimate retry.
CREATE UNIQUE INDEX "sunrate_attempt_active_per_order"
  ON "sunrate_payment_attempts" ("order_id")
  WHERE status IN ('CREATING', 'PENDING', 'UNKNOWN', 'REVIEW');

-- A gateway transaction id is unique within an environment + merchant.
CREATE UNIQUE INDEX "sunrate_attempt_transid_unique"
  ON "sunrate_payment_attempts" ("env", "merchant_id", "trans_id")
  WHERE "trans_id" IS NOT NULL;

ALTER TABLE "sunrate_payment_attempts" ADD CONSTRAINT "sunrate_payment_attempts_payment_id_key" UNIQUE ("payment_id");
ALTER TABLE "sunrate_payment_attempts" ADD CONSTRAINT "sunrate_payment_attempts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sunrate_payment_attempts" ADD CONSTRAINT "sunrate_payment_attempts_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- COD is the default payment path and starts enabled; online methods start
-- disabled until the module and channels are switched on.
INSERT INTO "payment_method_configs" ("method", "enabled", "revision", "updated_at")
VALUES ('COD', true, 0, now()), ('CARD', false, 0, now()), ('GCASH', false, 0, now()), ('BPI', false, 0, now())
ON CONFLICT ("method") DO NOTHING;
