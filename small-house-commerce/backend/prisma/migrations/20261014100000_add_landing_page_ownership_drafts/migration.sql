ALTER TYPE "LandingPageStatus" ADD VALUE 'DRAFT';

ALTER TABLE "product_landing_pages"
  ADD COLUMN "owner_user_id" UUID,
  ADD COLUMN "draft_content" JSONB,
  ADD COLUMN "published_content" JSONB,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "published_revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "published_at" TIMESTAMPTZ(3),
  ADD COLUMN "source_content_hash" TEXT;

CREATE INDEX "product_landing_pages_owner_user_id_updated_at_idx"
  ON "product_landing_pages"("owner_user_id", "updated_at");

ALTER TABLE "product_landing_pages"
  ADD CONSTRAINT "product_landing_pages_owner_user_id_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
