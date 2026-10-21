CREATE TYPE "CampaignLinkStatus" AS ENUM ('ACTIVE', 'DISABLED');

CREATE TABLE "campaign_links" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "aid_snapshot" TEXT NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "variant_name_snapshot" TEXT,
    "landing_page_id" UUID,
    "name" TEXT NOT NULL,
    "source_type" "SourceType" NOT NULL,
    "campaign_id" TEXT,
    "adset_id" TEXT,
    "ad_id" TEXT,
    "utm_source" TEXT,
    "utm_medium" TEXT,
    "utm_campaign" TEXT,
    "utm_content" TEXT,
    "utm_term" TEXT,
    "status" "CampaignLinkStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "campaign_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "campaign_links_code_key" ON "campaign_links"("code");
CREATE INDEX "campaign_links_owner_user_id_created_at_idx" ON "campaign_links"("owner_user_id", "created_at");
CREATE INDEX "campaign_links_product_id_idx" ON "campaign_links"("product_id");
CREATE INDEX "campaign_links_landing_page_id_idx" ON "campaign_links"("landing_page_id");
ALTER TABLE "campaign_links" ADD CONSTRAINT "campaign_links_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "campaign_links" ADD CONSTRAINT "campaign_links_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "campaign_links" ADD CONSTRAINT "campaign_links_landing_page_id_fkey" FOREIGN KEY ("landing_page_id") REFERENCES "product_landing_pages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
