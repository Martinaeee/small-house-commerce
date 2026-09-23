-- CreateEnum
CREATE TYPE "ProductOptionKind" AS ENUM ('COLOR', 'SIZE', 'MATERIAL', 'STYLE');

-- CreateEnum
CREATE TYPE "ProductOptionPresentation" AS ENUM ('IMAGE', 'SWATCH', 'TEXT');

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN "option_snapshot" JSONB;

-- AlterTable
ALTER TABLE "product_images"
ADD COLUMN "option_value_id" UUID,
ADD COLUMN "variant_id" UUID;

-- AlterTable
ALTER TABLE "product_variants" ADD COLUMN "combination_key" TEXT;

-- AlterTable
ALTER TABLE "products"
ADD COLUMN "catalog_graph_version" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "default_display_variant_id" UUID;

-- CreateTable
CREATE TABLE "product_options" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "kind" "ProductOptionKind" NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "presentation" "ProductOptionPresentation" NOT NULL,
    "is_media_driver" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_option_values" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "option_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "swatch_hex" TEXT,
    "thumbnail_url" TEXT,
    "thumbnail_alt" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_option_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variant_option_values" (
    "variant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "option_id" UUID NOT NULL,
    "option_value_id" UUID NOT NULL,

    CONSTRAINT "product_variant_option_values_pkey" PRIMARY KEY ("variant_id", "option_id")
);

-- CreateIndex
CREATE INDEX "product_options_product_id_idx" ON "product_options"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_options_id_product_id_key" ON "product_options"("id", "product_id");

-- Active option replacements must not be blocked by disabled historical rows.
CREATE UNIQUE INDEX product_options_active_name_key
ON product_options (product_id, lower(name))
WHERE is_active = true;

CREATE UNIQUE INDEX product_options_active_position_key
ON product_options (product_id, position)
WHERE is_active = true;

CREATE UNIQUE INDEX product_options_active_media_driver_key
ON product_options (product_id)
WHERE is_active = true AND is_media_driver = true;

-- CreateIndex
CREATE INDEX "product_option_values_option_id_product_id_idx" ON "product_option_values"("option_id", "product_id");

-- CreateIndex
CREATE INDEX "product_option_values_product_id_idx" ON "product_option_values"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_option_values_id_product_id_key" ON "product_option_values"("id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_option_values_id_option_id_product_id_key" ON "product_option_values"("id", "option_id", "product_id");

-- CreateIndex
CREATE INDEX "product_variant_option_values_option_id_product_id_idx" ON "product_variant_option_values"("option_id", "product_id");

-- CreateIndex
CREATE INDEX "product_variant_option_values_option_value_id_option_id_pro_idx" ON "product_variant_option_values"("option_value_id", "option_id", "product_id");

-- CreateIndex
CREATE INDEX "product_images_option_value_id_product_id_idx" ON "product_images"("option_value_id", "product_id");

-- CreateIndex
CREATE INDEX "product_images_variant_id_product_id_idx" ON "product_images"("variant_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_id_product_id_key" ON "product_variants"("id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_product_id_combination_key_key" ON "product_variants"("product_id", "combination_key");

-- AddCheckConstraint
ALTER TABLE "product_images"
ADD CONSTRAINT "product_images_exclusive_scope_check"
CHECK ("option_value_id" IS NULL OR "variant_id" IS NULL)
NOT VALID;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_default_display_variant_id_id_fkey" FOREIGN KEY ("default_display_variant_id", "id") REFERENCES "product_variants"("id", "product_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_option_value_id_product_id_fkey" FOREIGN KEY ("option_value_id", "product_id") REFERENCES "product_option_values"("id", "product_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_variant_id_product_id_fkey" FOREIGN KEY ("variant_id", "product_id") REFERENCES "product_variants"("id", "product_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_options" ADD CONSTRAINT "product_options_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_option_values" ADD CONSTRAINT "product_option_values_option_id_product_id_fkey" FOREIGN KEY ("option_id", "product_id") REFERENCES "product_options"("id", "product_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variant_option_values" ADD CONSTRAINT "product_variant_option_values_variant_id_product_id_fkey" FOREIGN KEY ("variant_id", "product_id") REFERENCES "product_variants"("id", "product_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variant_option_values" ADD CONSTRAINT "product_variant_option_values_option_id_product_id_fkey" FOREIGN KEY ("option_id", "product_id") REFERENCES "product_options"("id", "product_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variant_option_values" ADD CONSTRAINT "product_variant_option_values_option_value_id_option_id_pr_fkey" FOREIGN KEY ("option_value_id", "option_id", "product_id") REFERENCES "product_option_values"("id", "option_id", "product_id") ON DELETE CASCADE ON UPDATE CASCADE;
