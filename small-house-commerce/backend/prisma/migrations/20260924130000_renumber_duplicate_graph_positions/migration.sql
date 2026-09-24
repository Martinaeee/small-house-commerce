-- Renumber graph positions that the legacy backfill copied verbatim.
--
-- 20260921100000_backfill_variant_options materializes one option value per
-- legacy variant and copies the variant's position onto it. Legacy products
-- routinely store every variant at position 0, so the backfilled values
-- inherited that: "Round Seat Folding Bar Stool" ended up with two active
-- values at position 0 and its two variants at position 0 as well. The write
-- path rejects duplicate active positions (the storefront picker is ordered by
-- them), so those products could no longer be saved from the admin.
--
-- Row order within each option/product is the truth — the admin editor and the
-- storefront both read ORDER BY position ASC — so only the numbers need
-- repairing. Tie-broken by created_at, then id, which keeps the migration
-- deterministic and safe to re-run.
WITH renumbered AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY option_id
      ORDER BY position ASC, created_at ASC, id ASC
    ) - 1 AS new_position
  FROM "product_option_values"
)
UPDATE "product_option_values" AS target
SET "position" = renumbered.new_position
FROM renumbered
WHERE target.id = renumbered.id
  AND target."position" IS DISTINCT FROM renumbered.new_position;

WITH renumbered AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY product_id
      ORDER BY position ASC, created_at ASC, id ASC
    ) - 1 AS new_position
  FROM "product_variants"
)
UPDATE "product_variants" AS target
SET "position" = renumbered.new_position
FROM renumbered
WHERE target.id = renumbered.id
  AND target."position" IS DISTINCT FROM renumbered.new_position;
