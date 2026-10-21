SET lock_timeout = '5s';

ALTER TABLE "orders" ADD COLUMN "promo_code" TEXT;

ALTER TABLE "site_settings" ADD COLUMN "newsletter_band_enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "site_settings" ADD COLUMN "newsletter_popup_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "site_settings" ADD COLUMN "newsletter_popup_delay_seconds" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "site_settings" ADD COLUMN "newsletter_offer_title" TEXT NOT NULL DEFAULT '';
ALTER TABLE "site_settings" ADD COLUMN "newsletter_offer_body" TEXT NOT NULL DEFAULT '';

ALTER TYPE "PermissionCode" ADD VALUE IF NOT EXISTS 'NEWSLETTER_READ';
ALTER TYPE "PermissionCode" ADD VALUE IF NOT EXISTS 'NEWSLETTER_WRITE';

CREATE TYPE "SubscriberStatus" AS ENUM ('SUBSCRIBED', 'UNSUBSCRIBED');
CREATE TYPE "SubscribeSource" AS ENUM ('POPUP', 'FOOTER');
CREATE TYPE "NewsletterDiscountType" AS ENUM ('PERCENT', 'FIXED');
CREATE TYPE "PromotionStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

CREATE TABLE "newsletter_subscribers" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "status" "SubscriberStatus" NOT NULL DEFAULT 'SUBSCRIBED',
    "source" "SubscribeSource" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "unsubscribed_at" TIMESTAMPTZ(3),
    CONSTRAINT "newsletter_subscribers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "newsletter_subscribers_email_key" ON "newsletter_subscribers"("email");

CREATE TABLE "newsletter_promotions" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "discount_type" "NewsletterDiscountType" NOT NULL,
    "discount_value" DECIMAL(10,2) NOT NULL,
    "min_spend" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "max_uses" INTEGER,
    "per_customer_limit" INTEGER,
    "valid_from" TIMESTAMPTZ(3),
    "valid_until" TIMESTAMPTZ(3),
    "status" "PromotionStatus" NOT NULL DEFAULT 'ACTIVE',
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "newsletter_promotions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "newsletter_promotions_code_key" ON "newsletter_promotions"("code");
-- At most one ACTIVE promotion at a time (spec §3.2).
CREATE UNIQUE INDEX "newsletter_promotions_single_active"
    ON "newsletter_promotions"("status") WHERE "status" = 'ACTIVE';

CREATE TABLE "promo_code_redemptions" (
    "id" UUID NOT NULL,
    "promotion_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "code_snapshot" TEXT NOT NULL,
    "normalized_phone" TEXT NOT NULL,
    "discount_amount" DECIMAL(10,2) NOT NULL,
    "released_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "promo_code_redemptions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "promo_code_redemptions_order_id_key" ON "promo_code_redemptions"("order_id");
CREATE INDEX "promo_code_redemptions_promotion_id_released_at_idx"
    ON "promo_code_redemptions"("promotion_id", "released_at");
CREATE INDEX "promo_code_redemptions_promotion_id_normalized_phone_released_at_idx"
    ON "promo_code_redemptions"("promotion_id", "normalized_phone", "released_at");
ALTER TABLE "promo_code_redemptions" ADD CONSTRAINT "promo_code_redemptions_promotion_id_fkey"
    FOREIGN KEY ("promotion_id") REFERENCES "newsletter_promotions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "promo_code_redemptions" ADD CONSTRAINT "promo_code_redemptions_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
