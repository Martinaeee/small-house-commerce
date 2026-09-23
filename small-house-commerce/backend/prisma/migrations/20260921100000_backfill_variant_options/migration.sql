BEGIN;

-- Materialize the compatibility projection with the same PostgreSQL-native
-- deterministic identities used by catalog-compat.ts. A bare ON CONFLICT keeps
-- partial runs safe even when another active row occupies a guarded slot; the
-- final version update below then refuses to publish an incomplete graph.
INSERT INTO "product_options" (
    "id",
    "product_id",
    "kind",
    "name",
    "position",
    "presentation",
    "is_media_driver",
    "is_active",
    "created_at",
    "updated_at"
)
SELECT
    md5('small-house/catalog/legacy-style-option/v1:' || p."id"::text)::uuid,
    p."id",
    'STYLE'::"ProductOptionKind",
    'Style',
    0,
    'TEXT'::"ProductOptionPresentation",
    false,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "products" p
WHERE p."catalog_graph_version" = 0
  AND EXISTS (
      SELECT 1
      FROM "product_variants" pv
      WHERE pv."product_id" = p."id"
  )
ON CONFLICT DO NOTHING;

INSERT INTO "product_option_values" (
    "id",
    "product_id",
    "option_id",
    "label",
    "position",
    "swatch_hex",
    "thumbnail_url",
    "thumbnail_alt",
    "is_active",
    "created_at",
    "updated_at"
)
SELECT
    md5('small-house/catalog/legacy-style-value/v1:' || pv."id"::text)::uuid,
    pv."product_id",
    po."id",
    pv."name",
    pv."position",
    NULL,
    NULL,
    NULL,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "product_variants" pv
JOIN "products" p
  ON p."id" = pv."product_id"
 AND p."catalog_graph_version" = 0
JOIN "product_options" po
  ON po."id" = md5('small-house/catalog/legacy-style-option/v1:' || p."id"::text)::uuid
 AND po."product_id" = p."id"
 AND po."kind" = 'STYLE'::"ProductOptionKind"
 AND po."name" = 'Style'
 AND po."position" = 0
 AND po."presentation" = 'TEXT'::"ProductOptionPresentation"
 AND po."is_media_driver" = false
 AND po."is_active" = true
ON CONFLICT DO NOTHING;

INSERT INTO "product_variant_option_values" (
    "variant_id",
    "product_id",
    "option_id",
    "option_value_id"
)
SELECT
    pv."id",
    pv."product_id",
    po."id",
    pov."id"
FROM "product_variants" pv
JOIN "products" p
  ON p."id" = pv."product_id"
 AND p."catalog_graph_version" = 0
JOIN "product_options" po
  ON po."id" = md5('small-house/catalog/legacy-style-option/v1:' || p."id"::text)::uuid
 AND po."product_id" = p."id"
 AND po."kind" = 'STYLE'::"ProductOptionKind"
 AND po."name" = 'Style'
 AND po."position" = 0
 AND po."presentation" = 'TEXT'::"ProductOptionPresentation"
 AND po."is_media_driver" = false
 AND po."is_active" = true
JOIN "product_option_values" pov
  ON pov."id" = md5('small-house/catalog/legacy-style-value/v1:' || pv."id"::text)::uuid
 AND pov."product_id" = pv."product_id"
 AND pov."option_id" = po."id"
 AND pov."label" = pv."name"
 AND pov."position" = pv."position"
 AND pov."swatch_hex" IS NULL
 AND pov."thumbnail_url" IS NULL
 AND pov."thumbnail_alt" IS NULL
 AND pov."is_active" = true
ON CONFLICT DO NOTHING;

-- A one-option graph has a one-pair canonical key. Avoid an update if a
-- corrupted row already occupies the target key; the completeness gate will
-- leave that product at graph version 0 for audit and repair.
UPDATE "product_variants" pv
SET "combination_key" =
    md5('small-house/catalog/legacy-style-option/v1:' || pv."product_id"::text)::uuid::text
    || ':' ||
    md5('small-house/catalog/legacy-style-value/v1:' || pv."id"::text)::uuid::text
FROM "products" p
WHERE p."id" = pv."product_id"
  AND p."catalog_graph_version" = 0
  AND NOT EXISTS (
      SELECT 1
      FROM "product_variants" occupied
      WHERE occupied."product_id" = pv."product_id"
        AND occupied."id" <> pv."id"
        AND occupied."combination_key" =
            md5('small-house/catalog/legacy-style-option/v1:' || pv."product_id"::text)::uuid::text
            || ':' ||
            md5('small-house/catalog/legacy-style-value/v1:' || pv."id"::text)::uuid::text
  );

-- Publish only products whose complete persisted graph exactly matches the
-- legacy projection. The default uses position/id ordering and ignores stock,
-- so an ACTIVE priced SKU with zero on-hand remains eligible.
WITH candidate_products AS (
    SELECT
        p."id",
        (
            SELECT pv."id"
            FROM "product_variants" pv
            JOIN "skus" s ON s."variant_id" = pv."id"
            WHERE pv."product_id" = p."id"
              AND s."status" = 'ACTIVE'::"SkuStatus"
              AND s."price" IS NOT NULL
            ORDER BY pv."position" ASC, pv."id" ASC
            LIMIT 1
        ) AS "expected_default_variant_id"
    FROM "products" p
    WHERE p."catalog_graph_version" = 0
      AND EXISTS (
          SELECT 1
          FROM "product_variants" pv
          WHERE pv."product_id" = p."id"
      )
),
complete_products AS (
    SELECT cp."id", cp."expected_default_variant_id"
    FROM candidate_products cp
    WHERE (
        SELECT count(*)
        FROM "product_options" po
        WHERE po."product_id" = cp."id"
    ) = 1
      AND EXISTS (
          SELECT 1
          FROM "product_options" po
          WHERE po."id" = md5('small-house/catalog/legacy-style-option/v1:' || cp."id"::text)::uuid
            AND po."product_id" = cp."id"
            AND po."kind" = 'STYLE'::"ProductOptionKind"
            AND po."name" = 'Style'
            AND po."position" = 0
            AND po."presentation" = 'TEXT'::"ProductOptionPresentation"
            AND po."is_media_driver" = false
            AND po."is_active" = true
      )
      AND (
          SELECT count(*)
          FROM "product_option_values" pov
          WHERE pov."product_id" = cp."id"
      ) = (
          SELECT count(*)
          FROM "product_variants" pv
          WHERE pv."product_id" = cp."id"
      )
      AND NOT EXISTS (
          SELECT 1
          FROM "product_variants" pv
          WHERE pv."product_id" = cp."id"
            AND NOT EXISTS (
                SELECT 1
                FROM "product_option_values" pov
                WHERE pov."id" = md5('small-house/catalog/legacy-style-value/v1:' || pv."id"::text)::uuid
                  AND pov."product_id" = cp."id"
                  AND pov."option_id" = md5('small-house/catalog/legacy-style-option/v1:' || cp."id"::text)::uuid
                  AND pov."label" = pv."name"
                  AND pov."position" = pv."position"
                  AND pov."swatch_hex" IS NULL
                  AND pov."thumbnail_url" IS NULL
                  AND pov."thumbnail_alt" IS NULL
                  AND pov."is_active" = true
            )
      )
      AND (
          SELECT count(*)
          FROM "product_variant_option_values" pvov
          WHERE pvov."product_id" = cp."id"
      ) = (
          SELECT count(*)
          FROM "product_variants" pv
          WHERE pv."product_id" = cp."id"
      )
      AND NOT EXISTS (
          SELECT 1
          FROM "product_variants" pv
          WHERE pv."product_id" = cp."id"
            AND NOT EXISTS (
                SELECT 1
                FROM "product_variant_option_values" pvov
                WHERE pvov."variant_id" = pv."id"
                  AND pvov."product_id" = cp."id"
                  AND pvov."option_id" = md5('small-house/catalog/legacy-style-option/v1:' || cp."id"::text)::uuid
                  AND pvov."option_value_id" = md5('small-house/catalog/legacy-style-value/v1:' || pv."id"::text)::uuid
            )
      )
      AND NOT EXISTS (
          SELECT 1
          FROM "product_variants" pv
          WHERE pv."product_id" = cp."id"
            AND pv."combination_key" IS DISTINCT FROM (
                md5('small-house/catalog/legacy-style-option/v1:' || cp."id"::text)::uuid::text
                || ':' ||
                md5('small-house/catalog/legacy-style-value/v1:' || pv."id"::text)::uuid::text
            )
      )
)
UPDATE "products" p
SET "default_display_variant_id" = cp."expected_default_variant_id",
    "catalog_graph_version" = 1
FROM complete_products cp
WHERE p."id" = cp."id"
  AND p."catalog_graph_version" = 0;

COMMIT;
