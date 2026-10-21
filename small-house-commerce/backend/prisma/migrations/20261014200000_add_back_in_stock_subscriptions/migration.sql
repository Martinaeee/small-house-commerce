SET lock_timeout = '5s';

ALTER TABLE "site_settings" ADD COLUMN "support_phone" TEXT NOT NULL DEFAULT '';

CREATE TYPE "BackInStockStatus" AS ENUM ('PENDING', 'SENT', 'CANCELLED');

CREATE TABLE "back_in_stock_subscriptions" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "sku_id" UUID NOT NULL,
    "status" "BackInStockStatus" NOT NULL DEFAULT 'PENDING',
    "product_name" TEXT NOT NULL,
    "product_slug" TEXT NOT NULL,
    "last_error" TEXT,
    "notified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "back_in_stock_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "back_in_stock_subscriptions_email_sku_id_key"
    ON "back_in_stock_subscriptions"("email", "sku_id");
CREATE INDEX "back_in_stock_subscriptions_status_created_at_idx"
    ON "back_in_stock_subscriptions"("status", "created_at");
CREATE INDEX "back_in_stock_subscriptions_sku_id_status_idx"
    ON "back_in_stock_subscriptions"("sku_id", "status");

ALTER TABLE "back_in_stock_subscriptions"
    ADD CONSTRAINT "back_in_stock_subscriptions_sku_id_fkey"
    FOREIGN KEY ("sku_id") REFERENCES "skus"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
