-- Internal, operator-facing product number ("P-000001").
--
-- Additive and nullable: existing rows are backfilled in a stable order
-- (created_at, id) so the numbering is reproducible, then the sequence is
-- advanced past them so new products continue the series instead of colliding.
-- A code is assigned once, never reused, and never shown on the storefront.
CREATE SEQUENCE "product_code_seq";

ALTER TABLE "products" ADD COLUMN "product_code" TEXT;

WITH numbered AS (
  SELECT
    id,
    ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS position
  FROM "products"
)
UPDATE "products" AS target
SET "product_code" = 'P-' || lpad(numbered.position::text, 6, '0')
FROM numbered
WHERE target.id = numbered.id;

-- Empty table: leave the sequence uncalled so the first product gets P-000001.
SELECT setval(
  'product_code_seq',
  GREATEST((SELECT count(*) FROM "products"), 1),
  (SELECT count(*) FROM "products") > 0
);

CREATE UNIQUE INDEX "products_product_code_key" ON "products"("product_code");
