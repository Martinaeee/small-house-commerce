-- Fuzzy product search (spec §3.2): bundled Postgres trigram extension.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Partial GIN indexes: storefront search matches ACTIVE products only.
CREATE INDEX IF NOT EXISTS products_name_trgm_idx
  ON products USING gin (name gin_trgm_ops)
  WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS products_slug_trgm_idx
  ON products USING gin (slug gin_trgm_ops)
  WHERE status = 'ACTIVE';
