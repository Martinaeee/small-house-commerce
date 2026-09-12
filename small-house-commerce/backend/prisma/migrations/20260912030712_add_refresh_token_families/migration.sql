-- Refresh-token rotation families (final-review Rec 5). Additive: the column
-- stays nullable; existing rows are backfilled into singleton families and
-- every new row always carries a family id from the application.

-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN IF NOT EXISTS "family_id" UUID;
ALTER TABLE "customer_refresh_tokens" ADD COLUMN IF NOT EXISTS "family_id" UUID;

-- Backfill: each pre-existing token starts its own family. Idempotent.
UPDATE "refresh_tokens" SET "family_id" = "id" WHERE "family_id" IS NULL;
UPDATE "customer_refresh_tokens" SET "family_id" = "id" WHERE "family_id" IS NULL;

-- CreateIndex: family revocation deletes by (account, family).
CREATE INDEX IF NOT EXISTS "refresh_tokens_user_id_family_id_idx"
  ON "refresh_tokens"("user_id", "family_id");
CREATE INDEX IF NOT EXISTS "customer_refresh_tokens_account_id_family_id_idx"
  ON "customer_refresh_tokens"("account_id", "family_id");
