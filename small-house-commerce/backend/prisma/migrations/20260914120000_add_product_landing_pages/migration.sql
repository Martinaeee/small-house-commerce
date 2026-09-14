-- CreateEnum
CREATE TYPE "LandingPageStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateTable
CREATE TABLE "product_landing_pages" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "ad_code" TEXT,
    "slug" TEXT NOT NULL,
    "title_override" TEXT,
    "images_override" JSONB,
    "seo_title" TEXT,
    "seo_description" TEXT,
    "promo_enabled" BOOLEAN NOT NULL DEFAULT false,
    "promo_headline" TEXT,
    "promo_subtext" TEXT,
    "start_at" TIMESTAMPTZ(3),
    "end_at" TIMESTAMPTZ(3),
    "status" "LandingPageStatus" NOT NULL DEFAULT 'ACTIVE',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "product_landing_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "landing_page_visits" (
    "id" UUID NOT NULL,
    "landing_page_id" UUID NOT NULL,
    "visit_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "landing_page_visits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_landing_pages_slug_key" ON "product_landing_pages"("slug");
CREATE INDEX "product_landing_pages_product_id_status_idx" ON "product_landing_pages"("product_id", "status");
CREATE UNIQUE INDEX "landing_page_visits_landing_page_id_visit_key_key" ON "landing_page_visits"("landing_page_id", "visit_key");
CREATE INDEX "landing_page_visits_landing_page_id_created_at_idx" ON "landing_page_visits"("landing_page_id", "created_at");

-- AddForeignKey
ALTER TABLE "product_landing_pages" ADD CONSTRAINT "product_landing_pages_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "landing_page_visits" ADD CONSTRAINT "landing_page_visits_landing_page_id_fkey" FOREIGN KEY ("landing_page_id") REFERENCES "product_landing_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
