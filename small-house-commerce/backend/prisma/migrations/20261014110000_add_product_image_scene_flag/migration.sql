ALTER TABLE "product_images"
  ADD COLUMN "is_scene" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "product_images"
  ADD CONSTRAINT "product_images_scene_image_check"
  CHECK (NOT "is_scene" OR "type" = 'IMAGE');

CREATE UNIQUE INDEX "product_images_scene_shared_key"
  ON "product_images" ("product_id")
  WHERE "is_scene" AND "option_value_id" IS NULL AND "variant_id" IS NULL;

CREATE UNIQUE INDEX "product_images_scene_option_value_key"
  ON "product_images" ("product_id", "option_value_id")
  WHERE "is_scene" AND "option_value_id" IS NOT NULL AND "variant_id" IS NULL;

CREATE UNIQUE INDEX "product_images_scene_variant_key"
  ON "product_images" ("product_id", "variant_id")
  WHERE "is_scene" AND "variant_id" IS NOT NULL AND "option_value_id" IS NULL;
