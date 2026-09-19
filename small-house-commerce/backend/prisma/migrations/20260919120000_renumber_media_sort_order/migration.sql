-- Renumber gallery and detail-block sort_order to a dense 0..n-1 per product.
--
-- The admin media editor used to append new cards with a blank sort_order,
-- which serialized to 0. Products edited that way ended up with every image at
-- sort_order 0, so the editor badged them all as the cover and the storefront
-- gallery ordered them arbitrarily.
--
-- The rows are already stored in the intended visual order (the admin grid and
-- the storefront both read `ORDER BY sort_order ASC`), so the row order within
-- each product is the truth; only the numbers need repairing. Tie-broken by
-- created_at, then id, so the result is deterministic.
WITH renumbered AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY product_id
      ORDER BY sort_order ASC, created_at ASC, id ASC
    ) - 1 AS new_sort_order
  FROM "product_images"
)
UPDATE "product_images" AS target
SET "sort_order" = renumbered.new_sort_order
FROM renumbered
WHERE target.id = renumbered.id
  AND target."sort_order" IS DISTINCT FROM renumbered.new_sort_order;

WITH renumbered AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY product_id
      ORDER BY sort_order ASC, created_at ASC, id ASC
    ) - 1 AS new_sort_order
  FROM "product_detail_blocks"
)
UPDATE "product_detail_blocks" AS target
SET "sort_order" = renumbered.new_sort_order
FROM renumbered
WHERE target.id = renumbered.id
  AND target."sort_order" IS DISTINCT FROM renumbered.new_sort_order;
