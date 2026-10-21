import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PermissionCode, RoleCode } from '../src/generated/prisma/client.js';
import { RBAC_GRANTS, RBAC_PERMISSIONS } from './rbac.js';

/**
 * Storefront shell storage contract (plan Task 3, spec §12/§16).
 *
 * These assertions are the reviewable statement of what the additive schema
 * change must contain: the singleton tables, the append-only asset registry,
 * the permission, and a migration that seeds the current LUWAG shell without
 * touching anything else. They read the files rather than a database so they
 * run in the default suite.
 */

const prismaDir = dirname(fileURLToPath(import.meta.url));
const schemaDir = join(prismaDir, 'schema');
const migrationsDir = join(prismaDir, 'migrations');

const settingsSchema = readFileSync(join(schemaDir, 'settings.prisma'), 'utf8');
const identitySchema = readFileSync(join(schemaDir, 'identity.prisma'), 'utf8');
const schema = `${settingsSchema}\n${identitySchema}`;

const MIGRATION_NAME = '20261015100000_add_storefront_shell';
const migrationDir = join(migrationsDir, MIGRATION_NAME);
const migration = readFileSync(join(migrationDir, 'migration.sql'), 'utf8');
const packageJson = readFileSync(join(prismaDir, '..', 'package.json'), 'utf8');
const dockerEntrypoint = readFileSync(join(prismaDir, '..', 'docker-entrypoint.sh'), 'utf8');

describe('StorefrontShell Prisma models', () => {
  it('declares the singleton shell table and the append-only asset registry', () => {
    expect(schema).toContain('model StorefrontShell');
    expect(schema).toContain('model StorefrontShellAsset');
    expect(schema).toContain('enum StorefrontShellAssetKind');
    expect(schema).toContain('enum StorefrontShellAssetStorage');
  });

  it('maps the models onto the table names the migration creates', () => {
    expect(schema).toContain('@@map("storefront_shells")');
    expect(schema).toContain('@@map("storefront_shell_assets")');
  });

  it('declares STOREFRONT_SHELL_MANAGE on PermissionCode', () => {
    expect(identitySchema).toMatch(/enum PermissionCode \{[\s\S]*STOREFRONT_SHELL_MANAGE[\s\S]*\}/);
  });

  it('relates the shell audit users and asset creator back to User', () => {
    expect(identitySchema).toContain('StorefrontShellDraftUpdater');
    expect(identitySchema).toContain('StorefrontShellPublisher');
    expect(identitySchema).toContain('StorefrontShellAssetCreator');
  });
});

describe('RBAC storefront shell permission', () => {
  it('declares the permission with a description', () => {
    expect(RBAC_PERMISSIONS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: PermissionCode.STOREFRONT_SHELL_MANAGE,
          description: expect.any(String),
        }),
      ]),
    );
  });

  it('grants it to SUPER_ADMIN and withholds it from every other role', () => {
    expect(RBAC_GRANTS[RoleCode.SUPER_ADMIN]).toContain(
      PermissionCode.STOREFRONT_SHELL_MANAGE,
    );
    for (const role of [
      RoleCode.ADMIN,
      RoleCode.OPTIMIZER,
      RoleCode.CONFIRMOR,
      RoleCode.WAREHOUSE,
      RoleCode.FINANCE,
    ]) {
      expect(RBAC_GRANTS[role]).not.toContain(PermissionCode.STOREFRONT_SHELL_MANAGE);
    }
  });

  it('reconciles the permission row and SUPER_ADMIN grant on every API startup', () => {
    expect(packageJson).toContain('rbac:reconcile-storefront-shell');
    expect(packageJson).toContain('reconcile-storefront-shell-permission-runner.ts');
    expect(dockerEntrypoint).toContain('pnpm run rbac:reconcile-storefront-shell');
  });
});

describe('add_storefront_shell migration', () => {
  it('is the newest migration and is additive only', () => {
    const names = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(names).toContain(MIGRATION_NAME);
    expect(migration).not.toMatch(/DROP TABLE|DROP COLUMN|ON DELETE CASCADE|DELETE FROM|TRUNCATE/i);
  });

  it('bounds the lock wait and adds the permission enum value idempotently', () => {
    expect(migration).toContain("SET lock_timeout = '5s'");
    expect(migration).toContain("ADD VALUE IF NOT EXISTS 'STOREFRONT_SHELL_MANAGE'");
  });

  it('creates the singleton table with the fixed id guard', () => {
    expect(migration).toContain('CREATE TABLE "storefront_shells"');
    expect(migration).toContain('CHECK ("id" = \'00000000-0000-0000-0000-000000000002\')');
  });

  it('creates the append-only asset registry', () => {
    expect(migration).toContain('CREATE TABLE "storefront_shell_assets"');
    expect(migration).toContain('"storage_key" TEXT NOT NULL');
  });

  it('seeds draft and published documents with the current LUWAG shell', () => {
    expect(migration).toContain('INSERT INTO "storefront_shells"');
    // Current compile-time theme tokens must be present verbatim.
    for (const token of ['#c9a77b', '#6b4f3a', '#faf8f5', '#ffffff', '#222222']) {
      expect(migration).toContain(token);
    }
    // The three legacy flat collection links and the root categories.
    for (const slug of ['new-arrivals', 'small-space-solutions', 'best-sellers']) {
      expect(migration).toContain(slug);
    }
    // Footer copy carried over from the hard-coded Footer.
    expect(migration).toContain('Small-space furniture, made roomy');
    expect(migration).toContain('Cash on Delivery nationwide');
    expect(migration).toContain('/track-order');
  });

  it('copies the live support contact values rather than hard-coding them', () => {
    expect(migration).toMatch(/support_email/);
    expect(migration).toMatch(/support_hours/);
  });

  it('never rewrites catalog, inventory, order, customer or marketing facts', () => {
    for (const table of [
      '"products"',
      '"skus"',
      '"inventory"',
      '"orders"',
      '"order_attributions"',
      '"customers"',
      '"product_landing_pages"',
      '"landing_page_visits"',
    ]) {
      expect(migration).not.toMatch(new RegExp(`(UPDATE|DELETE FROM|ALTER TABLE)\\s+${table}`, 'i'));
    }
  });
});
