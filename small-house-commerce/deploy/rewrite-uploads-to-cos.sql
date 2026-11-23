-- Rewrites stored media URLs from the local /uploads/<key> path to the COS
-- public base. Run ONLY after migrate-uploads-to-cos.cjs reports 0 failures.
-- Take a fresh database backup first. The local files stay in place, so old
-- links inside already-sent emails and checkout drafts keep working.
--
-- Usage:
--   psql "$DATABASE_URL" -v base='https://<bucket>.cos.<region>.myqcloud.com' \
--     -f deploy/rewrite-uploads-to-cos.sql

\set ON_ERROR_STOP on

BEGIN;

UPDATE product_images
SET url = replace(url, '/uploads/', :'base' || '/')
WHERE url LIKE '/uploads/%';

UPDATE product_detail_blocks
SET url = replace(url, '/uploads/', :'base' || '/')
WHERE url LIKE '/uploads/%';

UPDATE product_option_values
SET thumbnail_url = replace(thumbnail_url, '/uploads/', :'base' || '/')
WHERE thumbnail_url LIKE '/uploads/%';

UPDATE hero_styles
SET background_image_url = replace(background_image_url, '/uploads/', :'base' || '/')
WHERE background_image_url LIKE '/uploads/%';

UPDATE storefront_shell_assets
SET public_url = replace(public_url, '/uploads/', :'base' || '/')
WHERE public_url LIKE '/uploads/%';

UPDATE homepage_sections
SET payload = replace(payload::text, '/uploads/', :'base' || '/')::jsonb
WHERE payload::text LIKE '%/uploads/%';

UPDATE homepage_documents
SET draft = replace(draft::text, '/uploads/', :'base' || '/')::jsonb
WHERE draft::text LIKE '%/uploads/%';

UPDATE homepage_versions
SET document = replace(document::text, '/uploads/', :'base' || '/')::jsonb
WHERE document::text LIKE '%/uploads/%';

UPDATE product_landing_pages
SET draft_content = replace(draft_content::text, '/uploads/', :'base' || '/')::jsonb
WHERE draft_content::text LIKE '%/uploads/%';

UPDATE product_landing_pages
SET published_content = replace(published_content::text, '/uploads/', :'base' || '/')::jsonb
WHERE published_content::text LIKE '%/uploads/%';

UPDATE product_variants
SET card_media = replace(card_media::text, '/uploads/', :'base' || '/')::jsonb
WHERE card_media::text LIKE '%/uploads/%';

COMMIT;
