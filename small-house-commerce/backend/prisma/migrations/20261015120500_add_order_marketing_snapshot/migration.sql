BEGIN;

ALTER TABLE "order_attributions"
ADD COLUMN "legacy" BOOLEAN,
ADD COLUMN "link_id" UUID,
ADD COLUMN "owner_name_snapshot" TEXT,
ADD COLUMN "product_code_snapshot" TEXT,
ADD COLUMN "product_id" UUID,
ADD COLUMN "product_name_snapshot" TEXT,
ADD COLUMN "published_revision" INTEGER,
ADD COLUMN "touched_at" TIMESTAMPTZ(3);

CREATE INDEX "order_attributions_link_id_touched_at_idx" ON "order_attributions"("link_id", "touched_at");
CREATE INDEX "order_attributions_landing_page_id_touched_at_idx" ON "order_attributions"("landing_page_id", "touched_at");
CREATE INDEX "order_attributions_optimizer_id_touched_at_idx" ON "order_attributions"("optimizer_id", "touched_at");
ALTER TABLE "order_attributions" ADD CONSTRAINT "order_attributions_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "campaign_links"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
