ALTER TABLE "skus"
  ADD COLUMN "is_bundle" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "bundle_version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "order_items" ADD COLUMN "bundle_snapshot" JSONB;

CREATE TABLE "sku_bundle_components" (
  "id" UUID NOT NULL,
  "bundle_sku_id" UUID NOT NULL,
  "component_sku_id" UUID NOT NULL,
  "quantity" INTEGER NOT NULL,
  "position" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "sku_bundle_components_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sku_bundle_components_quantity_check" CHECK ("quantity" BETWEEN 1 AND 1000),
  CONSTRAINT "sku_bundle_components_position_check" CHECK ("position" >= 0),
  CONSTRAINT "sku_bundle_components_no_self" CHECK ("bundle_sku_id" <> "component_sku_id"),
  CONSTRAINT "sku_bundle_components_bundle_sku_id_fkey" FOREIGN KEY ("bundle_sku_id") REFERENCES "skus"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "sku_bundle_components_component_sku_id_fkey" FOREIGN KEY ("component_sku_id") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "sku_bundle_components_bundle_sku_id_component_sku_id_key" ON "sku_bundle_components"("bundle_sku_id", "component_sku_id");
CREATE INDEX "sku_bundle_components_component_sku_id_idx" ON "sku_bundle_components"("component_sku_id");
