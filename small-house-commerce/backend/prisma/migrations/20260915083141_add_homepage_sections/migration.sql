-- CreateEnum
CREATE TYPE "HomepageSectionType" AS ENUM ('HERO', 'USP', 'CATEGORY_TILES', 'PRODUCT_GRID', 'SOLUTIONS', 'PRODUCT_STORY', 'ROOM_INSPIRATION', 'UGC', 'BRAND_STORY', 'CONFIDENCE');

-- CreateTable
CREATE TABLE "homepage_sections" (
    "id" UUID NOT NULL,
    "type" "HomepageSectionType" NOT NULL,
    "title" TEXT,
    "subtitle" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "homepage_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "homepage_section_products" (
    "id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "badge" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "homepage_section_products_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "homepage_sections_enabled_sort_order_idx" ON "homepage_sections"("enabled", "sort_order");

-- CreateIndex
CREATE INDEX "homepage_section_products_product_id_idx" ON "homepage_section_products"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "homepage_section_products_section_id_product_id_key" ON "homepage_section_products"("section_id", "product_id");

-- AddForeignKey
ALTER TABLE "homepage_section_products" ADD CONSTRAINT "homepage_section_products_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "homepage_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homepage_section_products" ADD CONSTRAINT "homepage_section_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
