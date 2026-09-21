\set ON_ERROR_STOP on

SELECT to_regclass('public.product_options') IS NOT NULL AS options_exist;
SELECT to_regclass('public.product_option_values') IS NOT NULL AS values_exist;
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'product_variants'
  AND column_name = 'combination_key';
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'order_items'
  AND column_name = 'option_snapshot';

DO $contract$
DECLARE
  kind_values text[];
  presentation_values text[];
BEGIN
  IF to_regclass('public.product_options') IS NULL THEN
    RAISE EXCEPTION 'catalog graph contract: product_options does not exist';
  END IF;
  IF to_regclass('public.product_option_values') IS NULL THEN
    RAISE EXCEPTION 'catalog graph contract: product_option_values does not exist';
  END IF;
  IF to_regclass('public.product_variant_option_values') IS NULL THEN
    RAISE EXCEPTION 'catalog graph contract: product_variant_option_values does not exist';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'products'
      AND column_name = 'catalog_graph_version'
      AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'catalog graph contract: products.catalog_graph_version is missing or nullable';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'products'
      AND column_name = 'default_display_variant_id'
      AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'catalog graph contract: products.default_display_variant_id is missing or required';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'product_variants'
      AND column_name = 'combination_key'
      AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'catalog graph contract: product_variants.combination_key is missing or required';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'product_images'
      AND column_name = 'option_value_id'
      AND is_nullable = 'YES'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'product_images'
      AND column_name = 'variant_id'
      AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'catalog graph contract: nullable product image scope columns are missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'order_items'
      AND column_name = 'option_snapshot'
      AND is_nullable = 'YES'
      AND data_type = 'jsonb'
  ) THEN
    RAISE EXCEPTION 'catalog graph contract: nullable JSONB order_items.option_snapshot is missing';
  END IF;

  SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder)
  INTO kind_values
  FROM pg_type AS t
  JOIN pg_enum AS e ON e.enumtypid = t.oid
  JOIN pg_namespace AS n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public'
    AND t.typname = 'ProductOptionKind';

  IF kind_values IS DISTINCT FROM ARRAY['COLOR', 'SIZE', 'MATERIAL', 'STYLE']::text[] THEN
    RAISE EXCEPTION 'catalog graph contract: ProductOptionKind values are %, expected COLOR/SIZE/MATERIAL/STYLE', kind_values;
  END IF;

  SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder)
  INTO presentation_values
  FROM pg_type AS t
  JOIN pg_enum AS e ON e.enumtypid = t.oid
  JOIN pg_namespace AS n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public'
    AND t.typname = 'ProductOptionPresentation';

  IF presentation_values IS DISTINCT FROM ARRAY['IMAGE', 'SWATCH', 'TEXT']::text[] THEN
    RAISE EXCEPTION 'catalog graph contract: ProductOptionPresentation values are %, expected IMAGE/SWATCH/TEXT', presentation_values;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'product_options'
      AND indexname = 'product_options_active_name_key'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'product_options'
      AND indexname = 'product_options_active_position_key'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'product_options'
      AND indexname = 'product_options_active_media_driver_key'
  ) THEN
    RAISE EXCEPTION 'catalog graph contract: required partial product option indexes are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'product_images_exclusive_scope_check'
      AND conrelid = 'public.product_images'::regclass
      AND contype = 'c'
      AND NOT convalidated
  ) THEN
    RAISE EXCEPTION 'catalog graph contract: media exclusive-scope CHECK must exist as NOT VALID';
  END IF;
END
$contract$;

BEGIN;

INSERT INTO categories (id, name, slug, updated_at)
VALUES ('00000000-0000-7000-8000-000000000201', 'Task 2 Contract', 'task-2-contract', now());

INSERT INTO products (id, name, slug, category_id, updated_at)
VALUES
  ('00000000-0000-7000-8000-000000000301', 'Task 2 Product A', 'task-2-product-a', '00000000-0000-7000-8000-000000000201', now()),
  ('00000000-0000-7000-8000-000000000302', 'Task 2 Product B', 'task-2-product-b', '00000000-0000-7000-8000-000000000201', now());

INSERT INTO product_variants (id, product_id, name, position, combination_key, updated_at)
VALUES
  ('00000000-0000-7000-8000-000000000401', '00000000-0000-7000-8000-000000000301', 'Yellow', 0, '00000000-0000-7000-8000-000000000501:00000000-0000-7000-8000-000000000601', now()),
  ('00000000-0000-7000-8000-000000000402', '00000000-0000-7000-8000-000000000302', 'Blue', 0, '00000000-0000-7000-8000-000000000502:00000000-0000-7000-8000-000000000602', now()),
  ('00000000-0000-7000-8000-000000000403', '00000000-0000-7000-8000-000000000301', 'Unassigned', 1, NULL, now());

INSERT INTO product_options (
  id,
  product_id,
  kind,
  name,
  position,
  presentation,
  is_media_driver,
  is_active,
  updated_at
)
VALUES
  ('00000000-0000-7000-8000-000000000501', '00000000-0000-7000-8000-000000000301', 'COLOR', 'Color', 0, 'SWATCH', true, true, now()),
  ('00000000-0000-7000-8000-000000000502', '00000000-0000-7000-8000-000000000302', 'COLOR', 'Color', 0, 'SWATCH', true, true, now());

INSERT INTO product_option_values (
  id,
  product_id,
  option_id,
  label,
  position,
  is_active,
  updated_at
)
VALUES
  ('00000000-0000-7000-8000-000000000601', '00000000-0000-7000-8000-000000000301', '00000000-0000-7000-8000-000000000501', 'Yellow', 0, true, now()),
  ('00000000-0000-7000-8000-000000000602', '00000000-0000-7000-8000-000000000302', '00000000-0000-7000-8000-000000000502', 'Blue', 0, true, now());

INSERT INTO product_variant_option_values (
  variant_id,
  product_id,
  option_id,
  option_value_id
)
VALUES (
  '00000000-0000-7000-8000-000000000401',
  '00000000-0000-7000-8000-000000000301',
  '00000000-0000-7000-8000-000000000501',
  '00000000-0000-7000-8000-000000000601'
);

INSERT INTO product_images (id, product_id, url, option_value_id)
VALUES (
  '00000000-0000-7000-8000-000000000701',
  '00000000-0000-7000-8000-000000000301',
  'https://example.com/task-2-option.jpg',
  '00000000-0000-7000-8000-000000000601'
);

INSERT INTO product_images (id, product_id, url, variant_id)
VALUES (
  '00000000-0000-7000-8000-000000000702',
  '00000000-0000-7000-8000-000000000301',
  'https://example.com/task-2-variant.jpg',
  '00000000-0000-7000-8000-000000000401'
);

UPDATE products
SET default_display_variant_id = '00000000-0000-7000-8000-000000000401'
WHERE id = '00000000-0000-7000-8000-000000000301';

-- Disabled historical rows must not block active replacements.
INSERT INTO product_options (
  id,
  product_id,
  kind,
  name,
  position,
  presentation,
  is_media_driver,
  is_active,
  updated_at
)
VALUES (
  '00000000-0000-7000-8000-000000000503',
  '00000000-0000-7000-8000-000000000301',
  'COLOR',
  'color',
  0,
  'TEXT',
  true,
  false,
  now()
);

SAVEPOINT duplicate_active_name;
\set ON_ERROR_STOP off
INSERT INTO product_options (
  id, product_id, kind, name, position, presentation, is_media_driver, is_active, updated_at
)
VALUES (
  '00000000-0000-7000-8000-000000000511',
  '00000000-0000-7000-8000-000000000301',
  'STYLE',
  'color',
  1,
  'TEXT',
  false,
  true,
  now()
);
\set duplicate_active_name_failed :ERROR
ROLLBACK TO SAVEPOINT duplicate_active_name;
\set ON_ERROR_STOP on
\if :duplicate_active_name_failed
  \echo 'ok - duplicate active case-insensitive option name rejected'
\else
  \echo 'not ok - duplicate active case-insensitive option name was accepted'
  \quit 1
\endif

SAVEPOINT duplicate_active_position;
\set ON_ERROR_STOP off
INSERT INTO product_options (
  id, product_id, kind, name, position, presentation, is_media_driver, is_active, updated_at
)
VALUES (
  '00000000-0000-7000-8000-000000000512',
  '00000000-0000-7000-8000-000000000301',
  'STYLE',
  'Finish',
  0,
  'TEXT',
  false,
  true,
  now()
);
\set duplicate_active_position_failed :ERROR
ROLLBACK TO SAVEPOINT duplicate_active_position;
\set ON_ERROR_STOP on
\if :duplicate_active_position_failed
  \echo 'ok - duplicate active option position rejected'
\else
  \echo 'not ok - duplicate active option position was accepted'
  \quit 1
\endif

SAVEPOINT duplicate_active_media_driver;
\set ON_ERROR_STOP off
INSERT INTO product_options (
  id, product_id, kind, name, position, presentation, is_media_driver, is_active, updated_at
)
VALUES (
  '00000000-0000-7000-8000-000000000513',
  '00000000-0000-7000-8000-000000000301',
  'SIZE',
  'Size',
  1,
  'TEXT',
  true,
  true,
  now()
);
\set duplicate_active_media_driver_failed :ERROR
ROLLBACK TO SAVEPOINT duplicate_active_media_driver;
\set ON_ERROR_STOP on
\if :duplicate_active_media_driver_failed
  \echo 'ok - second active media driver rejected'
\else
  \echo 'not ok - second active media driver was accepted'
  \quit 1
\endif

SAVEPOINT duplicate_combination_key;
\set ON_ERROR_STOP off
INSERT INTO product_variants (id, product_id, name, position, combination_key, updated_at)
VALUES (
  '00000000-0000-7000-8000-000000000411',
  '00000000-0000-7000-8000-000000000301',
  'Duplicate combination',
  2,
  '00000000-0000-7000-8000-000000000501:00000000-0000-7000-8000-000000000601',
  now()
);
\set duplicate_combination_key_failed :ERROR
ROLLBACK TO SAVEPOINT duplicate_combination_key;
\set ON_ERROR_STOP on
\if :duplicate_combination_key_failed
  \echo 'ok - duplicate non-null combination key rejected'
\else
  \echo 'not ok - duplicate non-null combination key was accepted'
  \quit 1
\endif

SAVEPOINT cross_product_assignment;
\set ON_ERROR_STOP off
INSERT INTO product_variant_option_values (
  variant_id, product_id, option_id, option_value_id
)
VALUES (
  '00000000-0000-7000-8000-000000000403',
  '00000000-0000-7000-8000-000000000301',
  '00000000-0000-7000-8000-000000000501',
  '00000000-0000-7000-8000-000000000602'
);
\set cross_product_assignment_failed :ERROR
ROLLBACK TO SAVEPOINT cross_product_assignment;
\set ON_ERROR_STOP on
\if :cross_product_assignment_failed
  \echo 'ok - cross-product variant option assignment rejected'
\else
  \echo 'not ok - cross-product variant option assignment was accepted'
  \quit 1
\endif

SAVEPOINT dual_media_scope;
\set ON_ERROR_STOP off
INSERT INTO product_images (id, product_id, url, option_value_id, variant_id)
VALUES (
  '00000000-0000-7000-8000-000000000711',
  '00000000-0000-7000-8000-000000000301',
  'https://example.com/task-2-dual.jpg',
  '00000000-0000-7000-8000-000000000601',
  '00000000-0000-7000-8000-000000000401'
);
\set dual_media_scope_failed :ERROR
ROLLBACK TO SAVEPOINT dual_media_scope;
\set ON_ERROR_STOP on
\if :dual_media_scope_failed
  \echo 'ok - dual media scope rejected'
\else
  \echo 'not ok - dual media scope was accepted'
  \quit 1
\endif

SAVEPOINT cross_product_option_media_scope;
\set ON_ERROR_STOP off
INSERT INTO product_images (id, product_id, url, option_value_id)
VALUES (
  '00000000-0000-7000-8000-000000000712',
  '00000000-0000-7000-8000-000000000301',
  'https://example.com/task-2-cross-option.jpg',
  '00000000-0000-7000-8000-000000000602'
);
\set cross_product_option_media_scope_failed :ERROR
ROLLBACK TO SAVEPOINT cross_product_option_media_scope;
\set ON_ERROR_STOP on
\if :cross_product_option_media_scope_failed
  \echo 'ok - cross-product option-value media scope rejected'
\else
  \echo 'not ok - cross-product option-value media scope was accepted'
  \quit 1
\endif

SAVEPOINT cross_product_variant_media_scope;
\set ON_ERROR_STOP off
INSERT INTO product_images (id, product_id, url, variant_id)
VALUES (
  '00000000-0000-7000-8000-000000000713',
  '00000000-0000-7000-8000-000000000301',
  'https://example.com/task-2-cross-variant.jpg',
  '00000000-0000-7000-8000-000000000402'
);
\set cross_product_variant_media_scope_failed :ERROR
ROLLBACK TO SAVEPOINT cross_product_variant_media_scope;
\set ON_ERROR_STOP on
\if :cross_product_variant_media_scope_failed
  \echo 'ok - cross-product variant media scope rejected'
\else
  \echo 'not ok - cross-product variant media scope was accepted'
  \quit 1
\endif

SAVEPOINT cross_product_default_variant;
\set ON_ERROR_STOP off
UPDATE products
SET default_display_variant_id = '00000000-0000-7000-8000-000000000402'
WHERE id = '00000000-0000-7000-8000-000000000301';
\set cross_product_default_variant_failed :ERROR
ROLLBACK TO SAVEPOINT cross_product_default_variant;
\set ON_ERROR_STOP on
\if :cross_product_default_variant_failed
  \echo 'ok - cross-product default display variant rejected'
\else
  \echo 'not ok - cross-product default display variant was accepted'
  \quit 1
\endif

ROLLBACK;
\echo 'catalog graph SQL contract passed'
