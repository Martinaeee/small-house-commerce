// Deterministic E2E seed for the Playwright acceptance gate (Task 20).
//
// Creates one product for every Phase-1 variant scenario — legacy Style,
// Color-only, Size-only, Color×Size, and an exact scoped-media override —
// plus inventory, scoped media SVGs, and one landing page.
//
// SAFETY: refuses any DATABASE_URL whose database name does not look like a
// disposable test database (see testDatabaseGuard). It is meant for
// `small_house_variant_test`-style databases that get wiped and reseeded;
// running it against a developer's catalog or production must fail closed.
//
// Prereqs: `prisma migrate deploy` + `prisma db seed` (roles) must have run
// on the same database; this seed creates the E2E admin only when the
// SUPER_ADMIN role exists.
//
// Run: DATABASE_URL=... pnpm exec tsx prisma/seed-e2e.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import argon2 from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PrismaClient,
  ProductStatus,
  type Product,
} from '../src/generated/prisma/client.js';
import {
  canonicalCombinationKey,
  legacyUnmappedCombinationKey,
} from '../src/modules/catalog/catalog-graph.js';

/** E2E admin credentials (documented in the Playwright config). */
export const E2E_ADMIN_EMAIL = 'e2e-admin@smallhouse.test';
export const E2E_ADMIN_PASSWORD = 'E2eAdminPass123!';

/**
 * Fails closed unless the database name is unmistakably a disposable test
 * database (`*_test`, `*-test`, `test_*`, `e2e`, ...). Exported for the spec
 * that pins the refusal behavior.
 */
export function testDatabaseGuard(
  databaseUrl: string | undefined,
): { ok: true; database: string } | { ok: false; reason: string } {
  if (!databaseUrl || !databaseUrl.startsWith('postgresql://')) {
    return {
      ok: false,
      reason: 'DATABASE_URL must be a postgresql:// connection string.',
    };
  }
  let database = '';
  try {
    const url = new URL(databaseUrl);
    database = decodeURIComponent(url.pathname.replace(/^\//, '')).split('?')[0] ?? '';
  } catch {
    return { ok: false, reason: 'DATABASE_URL is not a parseable URL.' };
  }
  if (!database) {
    return { ok: false, reason: 'DATABASE_URL has no database name.' };
  }
  // Accepts `small_house_variant_test`, `shop_test`, `shop-e2e`, `test_shop`;
  // rejects `small_house`, `small-house-prod`, `app`, ...
  if (!/(^|[_-])(e2e|test)([_-]|$)/.test(database)) {
    return {
      ok: false,
      reason:
        `Refusing to seed database "${database}": the name does not look like a ` +
        'disposable test database. Create one, e.g. `small_house_variant_test`, ' +
        'and point DATABASE_URL at it — this seed deletes its own products first.',
    };
  }
  return { ok: true, database };
}

// --- scenario data -----------------------------------------------------------

const CATEGORY_SLUG = 'e2e-catalog';
const LP_SLUG = 'e2e-lp-color-size';

/** Tiny self-contained SVG so no network access is needed to render media. */
function svg(label: string, fill: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><rect width="240" height="240" fill="${fill}"/><text x="120" y="128" font-family="sans-serif" font-size="22" fill="#ffffff" text-anchor="middle">${label}</text></svg>`;
}

interface SeedContext {
  prisma: PrismaClient;
  uploadDir: string;
}

/** Writes an SVG under /uploads/e2e and returns its public URL. */
function mediaFile(
  ctx: SeedContext,
  name: string,
  label: string,
  fill: string,
): string {
  writeFileSync(join(ctx.uploadDir, `${name}.svg`), svg(label, fill), 'utf8');
  return `/uploads/e2e/${name}.svg`;
}

async function ensureCategory(ctx: SeedContext): Promise<string> {
  const existing = await ctx.prisma.category.findUnique({
    where: { slug: CATEGORY_SLUG },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await ctx.prisma.category.create({
    data: { name: 'E2E Catalog', slug: CATEGORY_SLUG },
  });
  return created.id;
}

async function ensureWarehouse(ctx: SeedContext): Promise<string> {
  const existing = await ctx.prisma.warehouse.findFirst({
    where: { country: 'PH' },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await ctx.prisma.warehouse.create({
    data: {
      name: 'E2E Warehouse',
      country: 'PH',
      province: 'Metro Manila',
      city: 'Quezon City',
    },
  });
  return created.id;
}

async function ensureE2EAdmin(ctx: SeedContext): Promise<void> {
  const existing = await ctx.prisma.user.findUnique({
    where: { email: E2E_ADMIN_EMAIL },
    select: { id: true },
  });
  if (existing) return;

  const superAdmin = await ctx.prisma.role.findUnique({
    where: { code: 'SUPER_ADMIN' },
    select: { id: true },
  });
  if (!superAdmin) {
    throw new Error(
      'The SUPER_ADMIN role is missing — run `prisma db seed` on the test database first.',
    );
  }
  const passwordHash = await argon2.hash(E2E_ADMIN_PASSWORD);
  await ctx.prisma.user.create({
    data: {
      name: 'E2E Admin',
      email: E2E_ADMIN_EMAIL,
      passwordHash,
      roles: { create: [{ roleId: superAdmin.id }] },
    },
  });
}

async function setStock(
  ctx: SeedContext,
  warehouseId: string,
  skuId: string,
  onHand: number,
): Promise<void> {
  await ctx.prisma.inventory.upsert({
    where: { skuId_warehouseId: { skuId, warehouseId } },
    create: { skuId, warehouseId, onHand, reserved: 0 },
    update: { onHand, reserved: 0 },
  });
}

interface VariantSpec {
  name: string;
  skuCode: string;
  price: number;
  compareAtPrice?: number;
  onHand: number;
  /** Option-value labels in option order; empty for legacy variants. */
  values?: string[];
  /** Variant-scoped media that must outrank the option-value media. */
  exactMedia?: { name: string; label: string; fill: string } | null;
}

interface OptionSpec {
  kind: 'COLOR' | 'SIZE' | 'MATERIAL' | 'STYLE';
  name: string;
  presentation: 'IMAGE' | 'SWATCH' | 'TEXT';
  isMediaDriver: boolean;
  values: { label: string; swatchHex?: string }[];
}

interface ProductSpec {
  slug: string;
  name: string;
  typed: boolean;
  options?: OptionSpec[];
  variants: VariantSpec[];
  sharedMedia: { name: string; label: string; fill: string }[];
}

const VALUE_FILL: Record<string, string> = {
  Red: '#c0392b',
  Blue: '#2471a3',
  Small: '#7f8c8d',
  Medium: '#5d6d7e',
};

function productSpecs(): ProductSpec[] {
  return [
    {
      // Graph-v0 compatibility bridge: two legacy variants, no options. The
      // storefront projects them into a synthetic "Style" option.
      slug: 'e2e-legacy-style',
      name: 'E2E Legacy Style Shelf',
      typed: false,
      variants: [
        { name: 'Walnut', skuCode: 'E2E-LEGACY-WALNUT', price: 1499, onHand: 1000 },
        { name: 'Oak', skuCode: 'E2E-LEGACY-OAK', price: 1699, onHand: 1000 },
      ],
      sharedMedia: [{ name: 'legacy-shared-1', label: 'Legacy 1', fill: '#8d6e63' }],
    },
    {
      slug: 'e2e-color-only',
      name: 'E2E Color Only Stool',
      typed: true,
      options: [
        {
          kind: 'COLOR',
          name: 'Color',
          presentation: 'SWATCH',
          isMediaDriver: true,
          values: [
            { label: 'Red', swatchHex: '#c0392b' },
            { label: 'Blue', swatchHex: '#2471a3' },
          ],
        },
      ],
      variants: [
        {
          name: 'Red',
          skuCode: 'E2E-COLOR-RED',
          price: 1299,
          compareAtPrice: 1599,
          onHand: 1000,
          values: ['Red'],
        },
        { name: 'Blue', skuCode: 'E2E-COLOR-BLUE', price: 1199, onHand: 1000, values: ['Blue'] },
      ],
      sharedMedia: [{ name: 'color-only-shared-1', label: 'Shared', fill: '#8d6e63' }],
    },
    {
      slug: 'e2e-size-only',
      name: 'E2E Size Only Rack',
      typed: true,
      options: [
        {
          kind: 'SIZE',
          name: 'Size',
          presentation: 'TEXT',
          isMediaDriver: false,
          values: [{ label: 'Small' }, { label: 'Medium' }],
        },
      ],
      variants: [
        // Small is out of stock on purpose: the OOS save-for-later scenario.
        { name: 'Small', skuCode: 'E2E-SIZE-S', price: 999, onHand: 0, values: ['Small'] },
        { name: 'Medium', skuCode: 'E2E-SIZE-M', price: 999, onHand: 1000, values: ['Medium'] },
      ],
      sharedMedia: [{ name: 'size-only-shared-1', label: 'Shared', fill: '#8d6e63' }],
    },
    {
      slug: 'e2e-color-size',
      name: 'E2E Color x Size Cabinet',
      typed: true,
      options: [
        {
          kind: 'COLOR',
          name: 'Color',
          presentation: 'SWATCH',
          isMediaDriver: true,
          values: [
            { label: 'Red', swatchHex: '#c0392b' },
            { label: 'Blue', swatchHex: '#2471a3' },
          ],
        },
        {
          kind: 'SIZE',
          name: 'Size',
          presentation: 'TEXT',
          isMediaDriver: false,
          values: [{ label: 'Small' }, { label: 'Medium' }],
        },
      ],
      variants: [
        { name: 'Red / Small', skuCode: 'E2E-CS-RED-S', price: 1299, onHand: 1000, values: ['Red', 'Small'] },
        { name: 'Red / Medium', skuCode: 'E2E-CS-RED-M', price: 1299, onHand: 1000, values: ['Red', 'Medium'] },
        // One OOS combination inside the matrix.
        { name: 'Blue / Small', skuCode: 'E2E-CS-BLUE-S', price: 1199, onHand: 0, values: ['Blue', 'Small'] },
        { name: 'Blue / Medium', skuCode: 'E2E-CS-BLUE-M', price: 1199, onHand: 1000, values: ['Blue', 'Medium'] },
      ],
      sharedMedia: [{ name: 'color-size-shared-1', label: 'Shared', fill: '#8d6e63' }],
    },
    {
      // Exact scoped-media override: the Red variant carries its own
      // variant-scoped image, which must outrank the Red option-value media.
      slug: 'e2e-exact-override',
      name: 'E2E Exact Override Bench',
      typed: true,
      options: [
        {
          kind: 'COLOR',
          name: 'Color',
          presentation: 'SWATCH',
          isMediaDriver: true,
          values: [
            { label: 'Red', swatchHex: '#c0392b' },
            { label: 'Blue', swatchHex: '#2471a3' },
          ],
        },
      ],
      variants: [
        {
          name: 'Red',
          skuCode: 'E2E-OVR-RED',
          price: 2199,
          onHand: 1000,
          values: ['Red'],
          exactMedia: { name: 'exact-override-red', label: 'Exact Red', fill: '#96281b' },
        },
        { name: 'Blue', skuCode: 'E2E-OVR-BLUE', price: 2199, onHand: 1000, values: ['Blue'] },
      ],
      sharedMedia: [{ name: 'exact-override-shared-1', label: 'Shared', fill: '#8d6e63' }],
    },
  ];
}

async function createProduct(
  ctx: SeedContext,
  spec: ProductSpec,
  categoryId: string,
  warehouseId: string,
): Promise<Product> {
  const created = await ctx.prisma.product.create({
    data: {
      name: spec.name,
      slug: spec.slug,
      description: `E2E scenario product: ${spec.name}.`,
      categoryId,
      status: ProductStatus.ACTIVE,
      solutions: [],
      catalogGraphVersion: spec.typed ? 1 : 0,
      images: {
        create: spec.sharedMedia.map((media, index) => ({
          url: mediaFile(ctx, media.name, media.label, media.fill),
          type: 'IMAGE' as const,
          altText: `${spec.name} shared media ${index + 1}`,
          sortOrder: index,
        })),
      },
    },
  });

  // label -> { optionId, valueId }; options are created before variants, so
  // combination keys and assignments reference real rows throughout.
  const valueIds = new Map<string, { optionId: string; valueId: string }>();

  for (const [optionIndex, option] of (spec.options ?? []).entries()) {
    const optionRow = await ctx.prisma.productOption.create({
      data: {
        productId: created.id,
        kind: option.kind,
        name: option.name,
        position: optionIndex,
        presentation: option.presentation,
        isMediaDriver: option.isMediaDriver,
        isActive: true,
      },
    });
    for (const [valueIndex, value] of option.values.entries()) {
      const valueRow = await ctx.prisma.productOptionValue.create({
        data: {
          productId: created.id,
          optionId: optionRow.id,
          label: value.label,
          position: valueIndex,
          swatchHex: value.swatchHex ?? null,
          isActive: true,
        },
      });
      valueIds.set(value.label, { optionId: optionRow.id, valueId: valueRow.id });
      // Media-driver values get their own scoped gallery entry.
      if (option.isMediaDriver) {
        await ctx.prisma.productImage.create({
          data: {
            productId: created.id,
            optionValueId: valueRow.id,
            url: mediaFile(
              ctx,
              `${spec.slug}-${value.label.toLowerCase()}`,
              value.label,
              VALUE_FILL[value.label] ?? '#5d6d7e',
            ),
            type: 'IMAGE',
            altText: `${spec.name} ${value.label}`,
            sortOrder: 0,
          },
        });
      }
    }
  }

  let defaultDisplayVariantId: string | null = null;

  for (const [variantIndex, variant] of spec.variants.entries()) {
    const labels = variant.values ?? [];
    const variantId = crypto.randomUUID();
    const combinationKey =
      labels.length === 0
        ? // Legacy bridge: the replaceable self-ID sentinel the admin create
          // path and the Release B backfill assign to graph-v0 variants.
          legacyUnmappedCombinationKey(variantId)
        : canonicalCombinationKey(
            labels.map((label) => {
              const ids = valueIds.get(label);
              if (!ids) {
                throw new Error(`Option value "${label}" not seeded for ${spec.slug}`);
              }
              return ids;
            }),
          );

    const variantRow = await ctx.prisma.productVariant.create({
      data: {
        id: variantId,
        productId: created.id,
        name: variant.name,
        position: variantIndex,
        combinationKey,
      },
    });

    if (variantIndex === 0) defaultDisplayVariantId = variantRow.id;

    for (const label of labels) {
      const ids = valueIds.get(label);
      if (!ids) continue;
      await ctx.prisma.productVariantOptionValue.create({
        data: {
          productId: created.id,
          variantId: variantRow.id,
          optionId: ids.optionId,
          optionValueId: ids.valueId,
        },
      });
    }

    const skuRow = await ctx.prisma.sku.create({
      data: {
        productId: created.id,
        variantId: variantRow.id,
        skuCode: variant.skuCode,
        status: 'ACTIVE',
        price: variant.price,
        compareAtPrice: variant.compareAtPrice ?? null,
      },
    });
    await setStock(ctx, warehouseId, skuRow.id, variant.onHand);

    if (variant.exactMedia) {
      await ctx.prisma.productImage.create({
        data: {
          productId: created.id,
          variantId: variantRow.id,
          url: mediaFile(
            ctx,
            variant.exactMedia.name,
            variant.exactMedia.label,
            variant.exactMedia.fill,
          ),
          type: 'IMAGE',
          altText: `${variant.name} exact media`,
          sortOrder: 0,
        },
      });
    }
  }

  if (spec.typed && defaultDisplayVariantId) {
    await ctx.prisma.product.update({
      where: { id: created.id },
      data: { defaultDisplayVariantId },
    });
  }

  return created;
}

async function seedLandingPage(ctx: SeedContext, productId: string): Promise<void> {
  const existing = await ctx.prisma.productLandingPage.findUnique({
    where: { slug: LP_SLUG },
    select: { id: true },
  });
  if (existing) return;
  await ctx.prisma.productLandingPage.create({
    data: {
      productId,
      name: 'E2E landing page',
      slug: LP_SLUG,
      status: 'ACTIVE',
      promoEnabled: true,
      promoHeadline: 'E2E promo headline',
    },
  });
}

async function main(): Promise<void> {
  const guard = testDatabaseGuard(process.env.DATABASE_URL);
  if (!guard.ok) {
    console.error(`seed-e2e: ${guard.reason}`);
    process.exit(1);
  }
  console.log(`seed-e2e: seeding test database "${guard.database}".`);

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL as string });
  const prisma = new PrismaClient({ adapter });
  // Resolved from this file's location, so the upload directory lands in the
  // backend tree no matter which cwd the runner uses (main.ts serves
  // process.cwd()/uploads, so run the backend from backend/ in E2E).
  const uploadDir = join(import.meta.dirname, '..', 'uploads', 'e2e');
  mkdirSync(uploadDir, { recursive: true });
  const ctx: SeedContext = { prisma, uploadDir };

  try {
    await ensureE2EAdmin(ctx);
    const categoryId = await ensureCategory(ctx);
    const warehouseId = await ensureWarehouse(ctx);

    // Idempotent: when the scenario products already exist, KEEP them.
    // Recreating changes every variant/SKU id between runs, which fights the
    // `next dev` fetch cache (Next 16 dev caches are sticky — a reused dev
    // server would serve the previous generation's ids and the deep-link
    // scenarios would break). Recreate the database for fully fresh data.
    const existing = await prisma.product.count({
      where: { slug: { startsWith: 'e2e-' } },
    });
    if (existing >= productSpecs().length) {
      console.log(
        `seed-e2e: ${existing} scenario products already present — skipping recreation.`,
      );
      console.log('seed-e2e: done.');
      return;
    }
    if (existing > 0) {
      // Partial leftovers from an interrupted seed: recreate them. If real
      // orders already reference the SKUs the delete is FK-restricted —
      // recreate the database instead of force-wiping.
      try {
        await prisma.product.deleteMany({ where: { slug: { startsWith: 'e2e-' } } });
      } catch {
        console.error(
          'seed-e2e: previous E2E products are referenced (orders/carts) — recreate the test database instead.',
        );
        process.exit(1);
      }
    }

    for (const spec of productSpecs()) {
      const product = await createProduct(ctx, spec, categoryId, warehouseId);
      console.log(`seeded ${spec.slug} (${product.id})`);
      if (spec.slug === 'e2e-color-size') {
        await seedLandingPage(ctx, product.id);
      }
    }

    console.log('seed-e2e: done.');
  } finally {
    await prisma.$disconnect();
  }
}

// Run only when executed directly; importing the module (tests) is
// side-effect-free.
const invoked = process.argv[1] ?? '';
if (invoked.endsWith('seed-e2e.ts')) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
