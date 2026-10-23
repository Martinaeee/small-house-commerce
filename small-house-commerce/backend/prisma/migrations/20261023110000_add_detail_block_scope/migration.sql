-- AlterTable
ALTER TABLE "product_detail_blocks"
ADD COLUMN "option_value_id" UUID,
ADD COLUMN "variant_id" UUID;

-- CreateIndex
CREATE INDEX "product_detail_blocks_option_value_id_product_id_idx" ON "product_detail_blocks"("option_value_id", "product_id");
CREATE INDEX "product_detail_blocks_variant_id_product_id_idx" ON "product_detail_blocks"("variant_id", "product_id");

-- AddCheck
ALTER TABLE "product_detail_blocks"
ADD CONSTRAINT "product_detail_blocks_exclusive_scope_check"
CHECK ("option_value_id" IS NULL OR "variant_id" IS NULL)
NOT VALID;

-- AddForeignKey
ALTER TABLE "product_detail_blocks" ADD CONSTRAINT "product_detail_blocks_option_value_id_product_id_fkey" FOREIGN KEY ("option_value_id", "product_id") REFERENCES "product_option_values"("id", "product_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_detail_blocks" ADD CONSTRAINT "product_detail_blocks_variant_id_product_id_fkey" FOREIGN KEY ("variant_id", "product_id") REFERENCES "product_variants"("id", "product_id") ON DELETE CASCADE ON UPDATE CASCADE;
