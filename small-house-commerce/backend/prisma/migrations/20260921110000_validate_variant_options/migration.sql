BEGIN;

-- Refuse to tighten the catalog graph unless every product is in one of the
-- two rollout-safe states:
--   1. graph-v0 compatibility: no normalized graph rows and every persisted
--      variant carries its exact self-ID legacy sentinel; or
--   2. materialized graph: every variant has one active value per active
--      option and its key is the canonical assignment-derived identity.
-- This migration reports corruption but never repairs it.
DO $preflight$
DECLARE
    null_key_count bigint;
    null_key_examples text[];
    invalid_product_count bigint;
    invalid_product_examples text[];
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

    WITH product_state AS (
        SELECT
            p."id" AS "product_id",
            p."catalog_graph_version",
            p."default_display_variant_id",
            (
                SELECT count(*)
                FROM "product_variants" pv
                WHERE pv."product_id" = p."id"
            ) AS "variant_count",
            (
                SELECT count(*)
                FROM "product_options" po
                WHERE po."product_id" = p."id"
            ) AS "option_count",
            (
                SELECT count(*)
                FROM "product_option_values" pov
                WHERE pov."product_id" = p."id"
            ) AS "value_count",
            (
                SELECT count(*)
                FROM "product_variant_option_values" pvov
                WHERE pvov."product_id" = p."id"
            ) AS "assignment_count",
            (
                SELECT count(*)
                FROM "product_options" po
                WHERE po."product_id" = p."id"
                  AND po."is_active" = true
            ) AS "active_option_count",
            (
                SELECT CASE count(*)
                    WHEN 0 THEN 1::bigint
                    WHEN 1 THEN max(option_values."active_value_count")
                    WHEN 2 THEN
                        max(option_values."active_value_count")
                        * min(option_values."active_value_count")
                    ELSE -1::bigint
                END
                FROM (
                    SELECT
                        po."id",
                        count(pov."id") AS "active_value_count"
                    FROM "product_options" po
                    LEFT JOIN "product_option_values" pov
                      ON pov."option_id" = po."id"
                     AND pov."product_id" = po."product_id"
                     AND pov."is_active" = true
                    WHERE po."product_id" = p."id"
                      AND po."is_active" = true
                    GROUP BY po."id"
                ) option_values
            ) AS "expected_variant_count",
            EXISTS (
                SELECT 1
                FROM "product_options" po
                WHERE po."product_id" = p."id"
                  AND po."is_active" = true
                  AND NOT EXISTS (
                      SELECT 1
                      FROM "product_option_values" pov
                      WHERE pov."product_id" = p."id"
                        AND pov."option_id" = po."id"
                        AND pov."is_active" = true
                  )
            ) AS "active_option_without_value"
        FROM "products" p
    ),
    invalid_products AS (
        SELECT ps."product_id"
        FROM product_state ps
        WHERE ps."catalog_graph_version" < 0
           OR (
                ps."default_display_variant_id" IS NOT NULL
                AND NOT EXISTS (
                    SELECT 1
                    FROM "product_variants" default_variant
                    WHERE default_variant."id" = ps."default_display_variant_id"
                      AND default_variant."product_id" = ps."product_id"
                )
           )
           OR (
                ps."catalog_graph_version" = 0
                AND (
                    ps."option_count" <> 0
                    OR ps."value_count" <> 0
                    OR ps."assignment_count" <> 0
                    OR (
                        ps."variant_count" > 0
                        AND EXISTS (
                            SELECT 1
                            FROM "product_variants" legacy_variant
                            WHERE legacy_variant."product_id" = ps."product_id"
                              AND legacy_variant."combination_key" IS DISTINCT FROM
                                  '__legacy_unmapped__:' || legacy_variant."id"::text
                        )
                    )
                )
           )
           OR (
                ps."catalog_graph_version" >= 1
                AND (
                    ps."variant_count" = 0
                    OR ps."variant_count" <> ps."expected_variant_count"
                    OR ps."active_option_count" > 2
                    OR ps."active_option_without_value"
                    OR EXISTS (
                        SELECT 1
                        FROM "product_variants" materialized_variant
                        CROSS JOIN LATERAL (
                            SELECT
                                count(*) AS "total_assignments",
                                count(*) FILTER (
                                    WHERE po."is_active" = true
                                      AND pov."is_active" = true
                                ) AS "active_assignments",
                                -- COLLATE "C" orders byte-wise; this only agrees with the
                                -- JS-side localeCompare() key build because option and
                                -- option_value ids are UUIDs (ASCII hex + dashes sort
                                -- identically under both collations). If those ids ever
                                -- become human-readable text, re-derive this expected key
                                -- before trusting the preflight.
                                COALESCE(
                                    string_agg(
                                        pvov."option_id"::text || ':' || pvov."option_value_id"::text,
                                        '|' ORDER BY
                                            (pvov."option_id"::text || ':' || pvov."option_value_id"::text) COLLATE "C"
                                    ),
                                    ''
                                ) AS "expected_combination_key"
                            FROM "product_variant_option_values" pvov
                            JOIN "product_options" po
                              ON po."id" = pvov."option_id"
                             AND po."product_id" = pvov."product_id"
                            JOIN "product_option_values" pov
                              ON pov."id" = pvov."option_value_id"
                             AND pov."option_id" = pvov."option_id"
                             AND pov."product_id" = pvov."product_id"
                            WHERE pvov."variant_id" = materialized_variant."id"
                              AND pvov."product_id" = materialized_variant."product_id"
                        ) assignment_state
                        WHERE materialized_variant."product_id" = ps."product_id"
                          AND (
                              assignment_state."total_assignments" <> ps."active_option_count"
                              OR assignment_state."active_assignments" <> ps."active_option_count"
                              OR materialized_variant."combination_key" IS DISTINCT FROM
                                  assignment_state."expected_combination_key"
                              OR left(
                                  materialized_variant."combination_key",
                                  length('__legacy_unmapped__:')
                              ) = '__legacy_unmapped__:'
                          )
                    )
                )
           )
    )
    SELECT
        count(*),
        COALESCE(
            (array_agg(
                format('product=%s', "product_id")
                ORDER BY "product_id"
            ))[1:10],
            ARRAY[]::text[]
        )
    INTO invalid_product_count, invalid_product_examples
    FROM invalid_products;

    IF null_key_count > 0 OR invalid_product_count > 0 THEN
        RAISE EXCEPTION USING
            MESSAGE = format(
                'catalog graph tightening preflight failed: null combination keys=%s examples=%s; invalid product graphs=%s examples=%s',
                null_key_count,
                null_key_examples,
                invalid_product_count,
                invalid_product_examples
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
