\set ON_ERROR_STOP on

-- Pre-Release-C preflight fixture.
--
-- Usage (one psql session; the migration must run after the fixture):
--   psql -v scenario=<name> -f catalog-graph-release-c-preflight-fixture.sql \
--        -f ../../prisma/migrations/20260921110000_validate_variant_options/migration.sql
--
-- scenario=valid must COMMIT (exit 0). Every other scenario must fail closed
-- (exit non-zero); its transaction is rolled back when psql disconnects,
-- leaving the database at its Release B state. duplicate_assignment is stopped
-- earlier by the product_variant_option_values primary key (two values for one
-- option); every other invalid scenario is stopped by the preflight RAISE.
--
-- Invalid scenarios: null_key, malformed_sentinel, cross_id_sentinel,
-- mixed_graph0, partial_option, partial_value, version1_sentinel,
-- missing_assignment, duplicate_assignment, missing_candidate,
-- incomplete_assignment, extra_assignment, partial_assignment,
-- inactive_assignment, other_noncanonical.
BEGIN;
SELECT set_config('task8.preflight_scenario', :'scenario', false);

DO $fixture$
DECLARE
  scenario text := current_setting('task8.preflight_scenario');
  category_id uuid := '82000000-0000-4000-8000-000000000001';
  product_id uuid := '82000000-0000-4000-8000-000000000101';
  option_a uuid := '82000000-0000-4000-8000-000000000201';
  option_b uuid := '82000000-0000-4000-8000-000000000202';
  value_a uuid := '82000000-0000-4000-8000-000000000301';
  value_b uuid := '82000000-0000-4000-8000-000000000302';
  variant_a uuid := '82000000-0000-4000-8000-000000000401';
  variant_b uuid := '82000000-0000-4000-8000-000000000402';
BEGIN
  INSERT INTO categories (id, name, slug, updated_at)
  VALUES (category_id, 'Task 8 preflight', 'task-8-preflight-' || scenario, now());

  IF scenario = 'valid' THEN
    INSERT INTO products (
      id, name, slug, category_id, catalog_graph_version, updated_at
    )
    VALUES
      (
        product_id,
        'Valid materialized',
        'task-8-valid-materialized',
        category_id,
        1,
        now()
      ),
      (
        '82000000-0000-4000-8000-000000000102',
        'Valid legacy sentinel',
        'task-8-valid-sentinel',
        category_id,
        0,
        now()
      ),
      (
        '82000000-0000-4000-8000-000000000103',
        'Valid empty legacy',
        'task-8-valid-empty',
        category_id,
        0,
        now()
      ),
      (
        '82000000-0000-4000-8000-000000000104',
        'Valid materialized two option',
        'task-8-valid-materialized-two',
        category_id,
        1,
        now()
      );

    INSERT INTO product_options (
      id, product_id, kind, name, position, presentation,
      is_media_driver, is_active, updated_at
    ) VALUES (
      option_a, product_id, 'COLOR', 'Color', 0, 'SWATCH', true, true, now()
    );
    INSERT INTO product_option_values (
      id, product_id, option_id, label, position, is_active, updated_at
    ) VALUES (
      value_a, product_id, option_a, 'Red', 0, true, now()
    );
    INSERT INTO product_variants (
      id, product_id, name, position, combination_key, updated_at
    ) VALUES (
      variant_a,
      product_id,
      'Red',
      0,
      option_a::text || ':' || value_a::text,
      now()
    );
    INSERT INTO product_variant_option_values (
      variant_id, product_id, option_id, option_value_id
    ) VALUES (variant_a, product_id, option_a, value_a);
    UPDATE products
    SET default_display_variant_id = variant_a
    WHERE id = product_id;

    INSERT INTO product_variants (
      id, product_id, name, position, combination_key, updated_at
    )
    VALUES
      (
        '82000000-0000-4000-8000-000000000403',
        '82000000-0000-4000-8000-000000000102',
        'Legacy A',
        0,
        '__legacy_unmapped__:82000000-0000-4000-8000-000000000403',
        now()
      ),
      (
        '82000000-0000-4000-8000-000000000404',
        '82000000-0000-4000-8000-000000000102',
        'Legacy B',
        1,
        '__legacy_unmapped__:82000000-0000-4000-8000-000000000404',
        now()
      );

    -- Two-option materialized graph: the canonical key must list every active
    -- option's active value in bytewise (COLLATE "C") pair order.
    INSERT INTO product_options (
      id, product_id, kind, name, position, presentation,
      is_media_driver, is_active, updated_at
    ) VALUES
      (
        '82000000-0000-4000-8000-000000000203',
        '82000000-0000-4000-8000-000000000104',
        'COLOR', 'Color', 0, 'SWATCH', true, true, now()
      ),
      (
        '82000000-0000-4000-8000-000000000204',
        '82000000-0000-4000-8000-000000000104',
        'SIZE', 'Size', 1, 'TEXT', false, true, now()
      );
    INSERT INTO product_option_values (
      id, product_id, option_id, label, position, is_active, updated_at
    ) VALUES
      (
        '82000000-0000-4000-8000-000000000303',
        '82000000-0000-4000-8000-000000000104',
        '82000000-0000-4000-8000-000000000203',
        'Red', 0, true, now()
      ),
      (
        '82000000-0000-4000-8000-000000000304',
        '82000000-0000-4000-8000-000000000104',
        '82000000-0000-4000-8000-000000000204',
        'Large', 0, true, now()
      );
    INSERT INTO product_variants (
      id, product_id, name, position, combination_key, updated_at
    ) VALUES (
      '82000000-0000-4000-8000-000000000405',
      '82000000-0000-4000-8000-000000000104',
      'Red / Large',
      0,
      '82000000-0000-4000-8000-000000000203:82000000-0000-4000-8000-000000000303'
        || '|82000000-0000-4000-8000-000000000204:82000000-0000-4000-8000-000000000304',
      now()
    );
    INSERT INTO product_variant_option_values (
      variant_id, product_id, option_id, option_value_id
    ) VALUES
      (
        '82000000-0000-4000-8000-000000000405',
        '82000000-0000-4000-8000-000000000104',
        '82000000-0000-4000-8000-000000000203',
        '82000000-0000-4000-8000-000000000303'
      ),
      (
        '82000000-0000-4000-8000-000000000405',
        '82000000-0000-4000-8000-000000000104',
        '82000000-0000-4000-8000-000000000204',
        '82000000-0000-4000-8000-000000000304'
      );
    UPDATE products
    SET default_display_variant_id = '82000000-0000-4000-8000-000000000405'
    WHERE id = '82000000-0000-4000-8000-000000000104';

    RETURN;
  END IF;

  INSERT INTO products (
    id, name, slug, category_id, catalog_graph_version, updated_at
  ) VALUES (
    product_id,
    'Invalid ' || scenario,
    'task-8-invalid-' || scenario,
    category_id,
    CASE
      WHEN scenario IN (
        'version1_sentinel',
        'missing_assignment',
        'extra_assignment',
        'duplicate_assignment',
        'incomplete_assignment',
        'missing_candidate',
        'inactive_assignment',
        'other_noncanonical',
        'partial_assignment'
      ) THEN 1
      ELSE 0
    END,
    now()
  );

  IF scenario = 'null_key' THEN
    INSERT INTO product_variants (
      id, product_id, name, position, combination_key, updated_at
    ) VALUES (variant_a, product_id, 'Null', 0, NULL, now());
    RETURN;
  ELSIF scenario = 'malformed_sentinel' THEN
    INSERT INTO product_variants (
      id, product_id, name, position, combination_key, updated_at
    ) VALUES (
      variant_a,
      product_id,
      'Malformed',
      0,
      '__legacy_unmapped__:' || variant_a::text || ':suffix',
      now()
    );
    RETURN;
  ELSIF scenario = 'cross_id_sentinel' THEN
    INSERT INTO product_variants (
      id, product_id, name, position, combination_key, updated_at
    )
    VALUES
      (
        variant_a,
        product_id,
        'Cross A',
        0,
        '__legacy_unmapped__:' || variant_b::text,
        now()
      ),
      (
        variant_b,
        product_id,
        'Cross B',
        1,
        '__legacy_unmapped__:' || variant_a::text,
        now()
      );
    RETURN;
  ELSIF scenario = 'mixed_graph0' THEN
    INSERT INTO product_variants (
      id, product_id, name, position, combination_key, updated_at
    )
    VALUES
      (
        variant_a,
        product_id,
        'Sentinel',
        0,
        '__legacy_unmapped__:' || variant_a::text,
        now()
      ),
      (variant_b, product_id, 'Canonical-like', 1, 'other:key', now());
    RETURN;
  END IF;

  INSERT INTO product_options (
    id, product_id, kind, name, position, presentation,
    is_media_driver, is_active, updated_at
  ) VALUES (
    option_a,
    product_id,
    'COLOR',
    'Color',
    0,
    'SWATCH',
    true,
    true,
    now()
  );

  IF scenario = 'partial_option' THEN
    INSERT INTO product_variants (
      id, product_id, name, position, combination_key, updated_at
    ) VALUES (
      variant_a,
      product_id,
      'Partial option',
      0,
      '__legacy_unmapped__:' || variant_a::text,
      now()
    );
    RETURN;
  END IF;

  INSERT INTO product_option_values (
    id, product_id, option_id, label, position, is_active, updated_at
  ) VALUES (
    value_a,
    product_id,
    option_a,
    'Red',
    0,
    scenario <> 'inactive_assignment',
    now()
  );

  IF scenario = 'partial_value' THEN
    INSERT INTO product_variants (
      id, product_id, name, position, combination_key, updated_at
    ) VALUES (
      variant_a,
      product_id,
      'Partial value',
      0,
      '__legacy_unmapped__:' || variant_a::text,
      now()
    );
    RETURN;
  ELSIF scenario = 'version1_sentinel' THEN
    INSERT INTO product_variants (
      id, product_id, name, position, combination_key, updated_at
    ) VALUES (
      variant_a,
      product_id,
      'Version one sentinel',
      0,
      '__legacy_unmapped__:' || variant_a::text,
      now()
    );
    RETURN;
  ELSIF scenario = 'missing_assignment' THEN
    INSERT INTO product_variants (
      id, product_id, name, position, combination_key, updated_at
    ) VALUES (
      variant_a,
      product_id,
      'Missing assignment',
      0,
      option_a::text || ':' || value_a::text,
      now()
    );
    RETURN;
  ELSIF scenario = 'duplicate_assignment' THEN
    INSERT INTO product_option_values (
      id, product_id, option_id, label, position, is_active, updated_at
    ) VALUES (value_b, product_id, option_a, 'Blue', 1, true, now());
    INSERT INTO product_variants (
      id, product_id, name, position, combination_key, updated_at
    ) VALUES (
      variant_a,
      product_id,
      'Duplicate assignment',
      0,
      option_a::text || ':' || value_a::text,
      now()
    );
    INSERT INTO product_variant_option_values (
      variant_id, product_id, option_id, option_value_id
    )
    VALUES
      (variant_a, product_id, option_a, value_a),
      (variant_a, product_id, option_a, value_b);
    RETURN;
  ELSIF scenario = 'missing_candidate' THEN
    INSERT INTO product_option_values (
      id, product_id, option_id, label, position, is_active, updated_at
    ) VALUES (value_b, product_id, option_a, 'Blue', 1, true, now());
    INSERT INTO product_variants (
      id, product_id, name, position, combination_key, updated_at
    ) VALUES (
      variant_a,
      product_id,
      'Only red',
      0,
      option_a::text || ':' || value_a::text,
      now()
    );
    INSERT INTO product_variant_option_values (
      variant_id, product_id, option_id, option_value_id
    ) VALUES (variant_a, product_id, option_a, value_a);
    RETURN;
  ELSIF scenario = 'incomplete_assignment' THEN
    INSERT INTO product_options (
      id, product_id, kind, name, position, presentation,
      is_media_driver, is_active, updated_at
    ) VALUES (
      option_b, product_id, 'SIZE', 'Size', 1, 'TEXT', false, true, now()
    );
    INSERT INTO product_option_values (
      id, product_id, option_id, label, position, is_active, updated_at
    ) VALUES (value_b, product_id, option_b, 'Large', 0, true, now());
    INSERT INTO product_variants (
      id, product_id, name, position, combination_key, updated_at
    ) VALUES (
      variant_a,
      product_id,
      'Missing size',
      0,
      option_a::text || ':' || value_a::text,
      now()
    );
    INSERT INTO product_variant_option_values (
      variant_id, product_id, option_id, option_value_id
    ) VALUES (variant_a, product_id, option_a, value_a);
    RETURN;
  END IF;

  IF scenario = 'extra_assignment' THEN
    INSERT INTO product_options (
      id, product_id, kind, name, position, presentation,
      is_media_driver, is_active, updated_at
    ) VALUES (
      option_b, product_id, 'SIZE', 'Size', 1, 'TEXT', false, true, now()
    );
    INSERT INTO product_option_values (
      id, product_id, option_id, label, position, is_active, updated_at
    ) VALUES (value_b, product_id, option_b, 'Large', 0, true, now());
  END IF;

  INSERT INTO product_variants (
    id, product_id, name, position, combination_key, updated_at
  ) VALUES (
    variant_a,
    product_id,
    'Assigned',
    0,
    CASE
      WHEN scenario = 'partial_assignment'
        THEN '__legacy_unmapped__:' || variant_a::text
      WHEN scenario = 'other_noncanonical'
        THEN 'not:canonical'
      ELSE option_a::text || ':' || value_a::text
    END,
    now()
  );
  INSERT INTO product_variant_option_values (
    variant_id, product_id, option_id, option_value_id
  ) VALUES (variant_a, product_id, option_a, value_a);

  IF scenario = 'extra_assignment' THEN
    INSERT INTO product_variant_option_values (
      variant_id, product_id, option_id, option_value_id
    ) VALUES (variant_a, product_id, option_b, value_b);
  ELSIF scenario NOT IN (
    'partial_assignment',
    'inactive_assignment',
    'other_noncanonical'
  ) THEN
    RAISE EXCEPTION 'unknown Task 8 preflight fixture scenario: %', scenario;
  END IF;
END
$fixture$;

\echo 'Task 8 preflight fixture loaded; append Release C migration in this session'
