import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const prismaDir = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(prismaDir, 'migrations');
const deployedLatestMigration = '20261015100000_add_storefront_shell';
const faqMigrationNames = [
  '20261015110000_add_product_faq',
  '20261015111000_add_product_faq_permission',
  '20261015112000_seed_shared_faq',
] as const;

function migrationSql(name: (typeof faqMigrationNames)[number]): string {
  const path = join(migrationsDir, name, 'migration.sql');
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

const schemaMigration = migrationSql(faqMigrationNames[0]);
const permissionMigration = migrationSql(faqMigrationNames[1]);
const seedMigration = migrationSql(faqMigrationNames[2]);

describe('FAQ migration rollout', () => {
  it('uses three normalized append-only names after the deployed baseline', () => {
    const actual = readdirSync(migrationsDir)
      .filter((name) => /product_faq|shared_faq/.test(name))
      .sort();

    expect(actual).toEqual(faqMigrationNames);
    expect(
      faqMigrationNames.every((name) => name > deployedLatestMigration),
    ).toBe(true);
  });

  it('creates one product FAQ row per product with JSON and version defaults', () => {
    expect(schemaMigration).toMatch(
      /CREATE TYPE "FaqMode" AS ENUM \('SHARED', 'EXTEND', 'CUSTOM'\)/,
    );
    expect(schemaMigration).toMatch(
      /CREATE TABLE "product_faqs"[\s\S]*"product_id" UUID NOT NULL[\s\S]*"mode" "FaqMode" NOT NULL DEFAULT 'SHARED'[\s\S]*"items" JSONB NOT NULL DEFAULT '\[\]'[\s\S]*"version" INTEGER NOT NULL DEFAULT 0/,
    );
    expect(schemaMigration).toContain(
      'CONSTRAINT "product_faqs_pkey" PRIMARY KEY ("product_id")',
    );
  });

  it('creates the versioned shared FAQ set with empty JSON defaults', () => {
    expect(schemaMigration).toMatch(
      /CREATE TABLE "shared_faq_sets"[\s\S]*"id" UUID NOT NULL[\s\S]*"items" JSONB NOT NULL DEFAULT '\[\]'[\s\S]*"version" INTEGER NOT NULL DEFAULT 0/,
    );
    expect(schemaMigration).toContain(
      'CONSTRAINT "shared_faq_sets_pkey" PRIMARY KEY ("id")',
    );
  });

  it('deletes product-owned FAQ rows when their product is deleted', () => {
    expect(schemaMigration).toContain(
      'FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE',
    );
  });

  it('widens only the permission enum before runtime reconciliation', () => {
    expect(permissionMigration.trim()).toMatch(
      /ALTER TYPE "PermissionCode" ADD VALUE 'PRODUCT_FAQ_SHARED_MANAGE';$/,
    );
    expect(permissionMigration).not.toMatch(/INSERT|UPDATE|DELETE/i);
  });

  it('seeds the one fixed shared FAQ set without overwriting operator edits', () => {
    expect(seedMigration).toContain('00000000-0000-0000-0000-0000000000fa');
    expect(seedMigration.match(/INSERT INTO "shared_faq_sets"/g)).toHaveLength(
      1,
    );
    expect(seedMigration).toContain('ON CONFLICT ("id") DO NOTHING');
    expect(seedMigration).not.toMatch(/^\s*(UPDATE|DELETE)\s/im);
  });
});
