-- CreateEnum
CREATE TYPE "DetailBlockType" AS ENUM ('IMAGE', 'VIDEO');

-- CreateTable
CREATE TABLE "product_detail_blocks" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "type" "DetailBlockType" NOT NULL,
    "url" TEXT NOT NULL,
    "alt_text" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_detail_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_detail_blocks_product_id_idx" ON "product_detail_blocks"("product_id");

-- AddForeignKey
ALTER TABLE "product_detail_blocks" ADD CONSTRAINT "product_detail_blocks_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
