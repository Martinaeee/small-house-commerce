ALTER TABLE "campaign_links"
  ADD COLUMN "post_date" DATE,
  ADD COLUMN "post_url" VARCHAR(2048),
  ADD COLUMN "archived_at" TIMESTAMPTZ(3);

CREATE INDEX "campaign_links_owner_user_id_archived_at_product_id_idx"
  ON "campaign_links" ("owner_user_id", "archived_at", "product_id");

CREATE INDEX "campaign_links_product_id_source_type_post_date_idx"
  ON "campaign_links" ("product_id", "source_type", "post_date");
