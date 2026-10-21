-- Storefront shell storage (spec 2026-10-12-storefront-shell-brand-editor-design §12, §16).
--
-- Additive only: two new tables, two new enums, one new permission value, and a
-- seeded singleton document equivalent to the current LUWAG Header/Footer/theme.
-- No catalog, inventory, order, customer or marketing row is read for writing or
-- rewritten here.

-- Bounded lock wait: this migration must not block the storefront on a busy
-- table. It only creates new objects, so a timeout is safe to surface.
SET lock_timeout = '5s';

-- The permission value is added here; the permission ROW and its SUPER_ADMIN
-- grant are seeded through the existing RBAC mechanism (prisma/rbac.ts +
-- prisma/seed.ts), matching how every other permission was introduced.
ALTER TYPE "PermissionCode" ADD VALUE IF NOT EXISTS 'STOREFRONT_SHELL_MANAGE';

-- CreateEnum
CREATE TYPE "StorefrontShellAssetKind" AS ENUM ('HORIZONTAL', 'SQUARE');

-- CreateEnum
CREATE TYPE "StorefrontShellAssetStorage" AS ENUM ('LOCAL', 'R2');

-- CreateTable: the singleton shell document. The fixed id is the singleton
-- guard; `version` is the CAS token and `published_revision` the public one.
CREATE TABLE "storefront_shells" (
    "id" UUID NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "draft_document" JSONB NOT NULL,
    "published_document" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "published_revision" INTEGER NOT NULL DEFAULT 1,
    "draft_updated_by_user_id" UUID,
    "published_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "published_at" TIMESTAMPTZ(3),

    CONSTRAINT "storefront_shells_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "storefront_shells_singleton_id" CHECK ("id" = '00000000-0000-0000-0000-000000000002')
);

-- CreateTable: append-only server-owned brand asset registry.
CREATE TABLE "storefront_shell_assets" (
    "id" UUID NOT NULL,
    "kind" "StorefrontShellAssetKind" NOT NULL,
    "storage" "StorefrontShellAssetStorage" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "public_url" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "durable" BOOLEAN NOT NULL,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "storefront_shell_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "storefront_shell_assets_storage_key_key" ON "storefront_shell_assets"("storage_key");

-- CreateIndex
CREATE INDEX "storefront_shell_assets_kind_created_at_idx" ON "storefront_shell_assets"("kind", "created_at");

-- AddForeignKey
ALTER TABLE "storefront_shells" ADD CONSTRAINT "storefront_shells_draft_updated_by_user_id_fkey" FOREIGN KEY ("draft_updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storefront_shells" ADD CONSTRAINT "storefront_shells_published_by_user_id_fkey" FOREIGN KEY ("published_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storefront_shell_assets" ADD CONSTRAINT "storefront_shell_assets_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed the singleton with a document equivalent to the current LUWAG shell:
-- the same Header order the compile-time `buildNav` produced (New Arrivals,
-- root categories by sort order, Solutions, Best Sellers), the same Footer
-- copy, the live support contact values, and the exact compile-time theme.
-- Draft and published start identical, so the first publish is a no-op for
-- shoppers.
WITH
roots AS (
    SELECT
        id,
        name,
        row_number() OVER (ORDER BY sort_order, name) - 1 AS idx
    FROM "categories"
    WHERE status = 'ACTIVE' AND parent_id IS NULL
),
nav_collections AS (
    SELECT id, name, slug, sort_order
    FROM "collections"
    WHERE status = 'ACTIVE' AND type = 'NAVIGATION'
),
header_items AS (
    SELECT 0 AS pos, jsonb_build_object(
        'id', c.id::text,
        'kind', 'STRUCTURED_LINK',
        'label', 'New Arrivals',
        'enabled', true,
        'link', jsonb_build_object('type', 'COLLECTION', 'id', c.id::text)
    ) AS item
    FROM nav_collections c
    WHERE c.slug = 'new-arrivals'
    UNION ALL
    SELECT (r.idx + 1) * 10 AS pos, jsonb_build_object(
        'id', r.id::text,
        'kind', 'CATEGORY_ROOT',
        'targetId', r.id::text,
        'labelOverride', r.name,
        'enabled', true
    ) AS item
    FROM roots r
    UNION ALL
    SELECT 50 AS pos, jsonb_build_object(
        'id', c.id::text,
        'kind', 'STRUCTURED_LINK',
        'label', 'Solutions',
        'enabled', true,
        'link', jsonb_build_object('type', 'COLLECTION', 'id', c.id::text)
    ) AS item
    FROM nav_collections c
    WHERE c.slug = 'small-space-solutions'
    UNION ALL
    SELECT 60 AS pos, jsonb_build_object(
        'id', c.id::text,
        'kind', 'STRUCTURED_LINK',
        'label', 'Best Sellers',
        'enabled', true,
        'link', jsonb_build_object('type', 'COLLECTION', 'id', c.id::text)
    ) AS item
    FROM nav_collections c
    WHERE c.slug = 'best-sellers'
),
document AS (
    SELECT jsonb_build_object(
        'schemaVersion', 1,
        'brand', jsonb_build_object(
            'brandName', 'LUWAG',
            'horizontalLogo', NULL,
            'squareMark', NULL
        ),
        'header', jsonb_build_object(
            'items', COALESCE(
                (SELECT jsonb_agg(h.item ORDER BY h.pos) FROM header_items h),
                '[]'::jsonb
            )
        ),
        'footer', jsonb_build_object(
            'tagline', 'Small-space furniture, made roomy',
            'description', 'Furniture for Filipino condos and rentals. Cash on delivery, nationwide.',
            'columns', jsonb_build_array(
                jsonb_build_object(
                    'id', '00000000-0000-7000-8000-000000000210',
                    'kind', 'LINKS',
                    'title', 'Shop',
                    'rows', COALESCE(
                        (
                            SELECT jsonb_agg(
                                jsonb_build_object(
                                    'id', nc.id::text,
                                    'kind', 'LINK',
                                    'label', nc.name,
                                    'link', jsonb_build_object('type', 'COLLECTION', 'id', nc.id::text)
                                )
                                ORDER BY nc.sort_order, nc.name
                            )
                            FROM nav_collections nc
                        ),
                        '[]'::jsonb
                    )
                ),
                jsonb_build_object(
                    'id', '00000000-0000-7000-8000-000000000220',
                    'kind', 'CONTACT',
                    'title', 'Contact',
                    'supportEmail', COALESCE(
                        (SELECT support_email FROM "site_settings" LIMIT 1),
                        'support@luwag.ph'
                    ),
                    'supportHours', COALESCE(
                        (SELECT support_hours FROM "site_settings" LIMIT 1),
                        'Mon–Sat, 9am–6pm (PHT)'
                    ),
                    'codText', 'Cash on Delivery nationwide',
                    'trackOrderLabel', 'Track Order',
                    'trackOrderLink', jsonb_build_object('type', 'INTERNAL', 'path', '/track-order')
                )
            ),
            'copyrightBrand', 'LUWAG Living'
        ),
        'theme', jsonb_build_object(
            'primary', '#c9a77b',
            'action', '#6b4f3a',
            'background', '#faf8f5',
            'surface', '#ffffff',
            'text', '#222222',
            'headingFont', 'SYSTEM',
            'bodyFont', 'SYSTEM'
        )
    ) AS document
    FROM (SELECT 1) AS one
)
INSERT INTO "storefront_shells" (
    "id",
    "schema_version",
    "draft_document",
    "published_document",
    "version",
    "published_revision",
    "created_at",
    "updated_at",
    "published_at"
)
SELECT
    '00000000-0000-0000-0000-000000000002',
    1,
    d.document,
    d.document,
    1,
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM document d;
