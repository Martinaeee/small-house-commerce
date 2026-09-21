BEGIN;

-- Refuse to tighten the catalog graph if Release B left any variant without a
-- canonical identity, or if persisted assignments do not form a complete,
-- canonical graph. This migration reports corruption but never repairs it.
DO $preflight$
DECLARE
    null_key_count bigint;
    null_key_examples text[];
    incomplete_graph_count bigint;
    incomplete_graph_examples text[];
BEGIN
    SELECT
        count(*),
        COALESCE(
            (array_agg(
                format('product=%s variant=%s', pv."product_id", pv."id")
                ORDER BY pv."product_id", pv."id"
            ))[1:10],
            ARRAY[]::text[]
        )
    INTO null_key_count, null_key_examples
    FROM "product_variants" pv
    WHERE pv."combination_key" IS NULL;

    WITH graph_state AS (
        SELECT
            pv."id" AS "variant_id",
            pv."product_id",
            pv."combination_key",
            p."catalog_graph_version",
            COALESCE(
                (
                    SELECT string_agg(
                        pvov."option_id"::text || ':' || pvov."option_value_id"::text,
                        '|' ORDER BY
                            (pvov."option_id"::text || ':' || pvov."option_value_id"::text) COLLATE "C"
                    )
                    FROM "product_variant_option_values" pvov
                    WHERE pvov."variant_id" = pv."id"
                      AND pvov."product_id" = pv."product_id"
                ),
                ''
            ) AS "expected_combination_key",
            EXISTS (
                SELECT 1
                FROM "product_options" po
                WHERE po."product_id" = pv."product_id"
                  AND po."is_active" = true
                  AND NOT EXISTS (
                      SELECT 1
                      FROM "product_variant_option_values" pvov
                      JOIN "product_option_values" pov
                        ON pov."id" = pvov."option_value_id"
                       AND pov."option_id" = pvov."option_id"
                       AND pov."product_id" = pvov."product_id"
                      WHERE pvov."variant_id" = pv."id"
                        AND pvov."product_id" = pv."product_id"
                        AND pvov."option_id" = po."id"
                        AND pov."is_active" = true
                  )
            ) AS "missing_active_assignment",
            EXISTS (
                SELECT 1
                FROM "product_variant_option_values" pvov
                JOIN "product_options" po
                  ON po."id" = pvov."option_id"
                 AND po."product_id" = pvov."product_id"
                JOIN "product_option_values" pov
                  ON pov."id" = pvov."option_value_id"
                 AND pov."option_id" = pvov."option_id"
                 AND pov."product_id" = pvov."product_id"
                WHERE pvov."variant_id" = pv."id"
                  AND pvov."product_id" = pv."product_id"
                  AND (po."is_active" = false OR pov."is_active" = false)
            ) AS "has_inactive_assignment"
        FROM "product_variants" pv
        JOIN "products" p ON p."id" = pv."product_id"
    ),
    incomplete_graph AS (
        SELECT *
        FROM graph_state
        WHERE "combination_key" IS NOT NULL
          AND (
              "catalog_graph_version" < 1
              OR "combination_key" IS DISTINCT FROM "expected_combination_key"
              OR "missing_active_assignment"
              OR "has_inactive_assignment"
          )
    )
    SELECT
        count(*),
        COALESCE(
            (array_agg(
                format('product=%s variant=%s', "product_id", "variant_id")
                ORDER BY "product_id", "variant_id"
            ))[1:10],
            ARRAY[]::text[]
        )
    INTO incomplete_graph_count, incomplete_graph_examples
    FROM incomplete_graph;

    IF null_key_count > 0 OR incomplete_graph_count > 0 THEN
        RAISE EXCEPTION USING
            MESSAGE = format(
                'catalog graph tightening preflight failed: null combination keys=%s examples=%s; incomplete/noncanonical variants=%s examples=%s',
                null_key_count,
                null_key_examples,
                incomplete_graph_count,
                incomplete_graph_examples
            ),
            HINT = 'Repair and re-audit the catalog graph before retrying this migration; no rows were changed.';
    END IF;
END
$preflight$;

-- This is the only NOT VALID catalog constraint from Release A. Composite
-- ownership foreign keys were created validated and are intentionally reused.
ALTER TABLE "product_images"
VALIDATE CONSTRAINT "product_images_exclusive_scope_check";

-- The existing product_variants_product_id_combination_key_key index already
-- enforces per-product uniqueness; only nullability is tightened here.
ALTER TABLE "product_variants"
ALTER COLUMN "combination_key" SET NOT NULL;

COMMIT;
