-- Checkout autosave drafts (2026-11-03 design). Additive: new table only.
-- A draft is not an order: it reserves no stock, creates no customer and is
-- never pushed to Qianyi or Meta. Rows are token-scoped; only the sha256 of
-- the capability token is stored.
CREATE TYPE "CheckoutDraftStatus" AS ENUM ('OPEN', 'CONVERTED', 'EXPIRED');

CREATE TABLE "checkout_drafts" (
    "id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "token_issued_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "CheckoutDraftStatus" NOT NULL DEFAULT 'OPEN',
    "has_user_input" BOOLEAN NOT NULL DEFAULT false,
    "client_revision" INTEGER NOT NULL DEFAULT 0,
    "contact_name" VARCHAR(120),
    "contact_phone" VARCHAR(24),
    "snapshot" JSONB NOT NULL DEFAULT '{}',
    "product_snapshot" JSONB NOT NULL DEFAULT '[]',
    "order_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "checkout_drafts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "checkout_drafts_token_hash_key" ON "checkout_drafts"("token_hash");
CREATE UNIQUE INDEX "checkout_drafts_order_id_key" ON "checkout_drafts"("order_id");
CREATE INDEX "checkout_drafts_status_updated_at_idx" ON "checkout_drafts"("status", "updated_at");
CREATE INDEX "checkout_drafts_expires_at_idx" ON "checkout_drafts"("expires_at");
CREATE INDEX "checkout_drafts_contact_phone_idx" ON "checkout_drafts"("contact_phone");

ALTER TABLE "checkout_drafts"
  ADD CONSTRAINT "checkout_drafts_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
