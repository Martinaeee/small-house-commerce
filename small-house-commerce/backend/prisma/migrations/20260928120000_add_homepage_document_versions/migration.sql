-- Homepage V2: versioned homepage document tables + backfill of v1 from the
-- legacy homepage_sections tables. Additive only: no legacy table or column is
-- touched; after this migration the legacy tables are frozen read-only and
-- serve as the emergency-rollback data source.
--
-- Hand-written on purpose: the "homepage_documents_singleton" CHECK constraint
-- is not representable in the Prisma schema, so `prisma migrate dev` would
-- treat it as drift and may drop it. Always apply with `prisma migrate deploy`.

-- CreateTable
CREATE TABLE "homepage_documents" (
  "id" UUID NOT NULL,
  "draft" JSONB NOT NULL,
  "draftRev" INTEGER NOT NULL DEFAULT 1,
  "draftUpdatedById" UUID,
  "publishedVersionId" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "homepage_documents_pkey" PRIMARY KEY ("id")
);

-- Singleton guard: this table must never hold more than one row.
ALTER TABLE "homepage_documents"
  ADD CONSTRAINT "homepage_documents_singleton"
  CHECK ("id" = '00000000-0000-0000-0000-000000000001');

-- CreateTable
CREATE TABLE "homepage_versions" (
  "id" UUID NOT NULL,
  "versionNo" INTEGER NOT NULL,
  "document" JSONB NOT NULL,
  "note" TEXT,
  "createdById" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publishAt" TIMESTAMPTZ(3) NOT NULL,
  "unpublishAt" TIMESTAMPTZ(3),
  CONSTRAINT "homepage_versions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "homepage_versions_versionNo_key" ON "homepage_versions"("versionNo");
CREATE INDEX "homepage_versions_publishAt_idx" ON "homepage_versions"("publishAt");

-- 回填：旧区块 → 文档 v1（结构搬运，payload 原样；HERO 旧 payload 由 TS normalize 处理）
WITH sections AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', s.id,
      'type', s."type"::text,
      'title', s.title,
      'subtitle', s.subtitle,
      'enabled', s.enabled,
      'sortOrder', s."sort_order",
      'schedule', jsonb_build_object('publishAt', NULL, 'unpublishAt', NULL),
      'payload', COALESCE(s.payload, '{}'::jsonb),
      'products', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'productId', p."product_id",
          'sortOrder', p."sort_order",
          'badge', p.badge
        ) ORDER BY p."sort_order")
        FROM "homepage_section_products" p WHERE p."section_id" = s.id
      ), '[]'::jsonb)
    ) ORDER BY s."sort_order", s."created_at"), '[]'::jsonb) AS list
  FROM "homepage_sections" s
), doc AS (
  SELECT jsonb_build_object(
    'schemaVersion', 1,
    'sections', sections.list,
    'announcement', jsonb_build_object(
      'enabled', true,
      'rotationMs', 5000,
      'items', jsonb_build_array(jsonb_build_object(
        'id', '00000000-0000-7000-8000-0000000000a1',
        'text', 'Free Metro Manila delivery on orders ₱3,000+ · Cash on Delivery nationwide',
        'link', NULL, 'linkLabel', NULL,
        'textColor', '#292724', 'backgroundColor', '#F2EFE9',
        'schedule', jsonb_build_object('publishAt', NULL, 'unpublishAt', NULL),
        'enabled', true, 'sortOrder', 0
      ))
    )
  ) AS document
  FROM sections
)
INSERT INTO "homepage_documents" ("id", "draft", "draftRev", "updatedAt")
SELECT '00000000-0000-0000-0000-000000000001', doc.document, 1, CURRENT_TIMESTAMP FROM doc;

INSERT INTO "homepage_versions" ("id", "versionNo", "document", "note", "publishAt")
SELECT gen_random_uuid(), 1, d."draft", 'Migrated from homepage_sections', CURRENT_TIMESTAMP
FROM "homepage_documents" d WHERE d."id" = '00000000-0000-0000-0000-000000000001';
-- publishAt=迁移时刻使 v1 立即生效（PostgreSQL 13+ 内置 gen_random_uuid()）。
