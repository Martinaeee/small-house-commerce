import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient, Prisma } from '../src/generated/prisma/client.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { CatalogGraphService } from '../src/modules/catalog/catalog-graph.service.js';
import { ProductsService } from '../src/modules/catalog/products.service.js';
import { ReviewsService } from '../src/modules/catalog/reviews.service.js';
import { InventoryService } from '../src/modules/inventory/inventory.service.js';
import { canonicalCombinationKey } from '../src/modules/catalog/catalog-graph.js';
import { catalogGraphPatchSchema, type CatalogGraphPatch, type VariantWrite } from '../src/modules/catalog/dto/catalog-graph.dto.js';
import { createProductSchema } from '../src/modules/catalog/dto/product.dto.js';
import type { VariantCardMedia } from '../src/modules/catalog/variant-card-media.js';
const guardPath = new URL('../../frontend/src/test/product-card-v2-test-target.ts', import.meta.url).href;
const { assertProductCardV2TestTarget, PRODUCT_CARD_V2_OWNER }: {
  assertProductCardV2TestTarget(databaseUrl: string | undefined, root: string | undefined): { databaseUrl: string; root: string };
  PRODUCT_CARD_V2_OWNER: string;
} = await import(guardPath);

vi.mock('../src/common/revalidation.js', async importOriginal => {
  const original = await importOriginal<typeof import('../src/common/revalidation.js')>();
  return { ...original, revalidateCache: vi.fn(async () => {}) };
});

const target = assertProductCardV2TestTarget(process.env.CARD_V2_DB_URL, process.env.CARD_V2_ROOT);
if (process.env.DATABASE_URL !== target.databaseUrl) throw new Error('Explicit V2 database identity must match');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: target.databaseUrl }), log: [{ level: 'query', emit: 'event' }] });
const db = prisma as PrismaService;
const silentBackInStock = {
  snapshotForChangedSkusWithin: async () => new Map<string, number>(),
  claimTransitionsWithin: async () => [],
  deliverClaims: async () => undefined,
};
const graph = new CatalogGraphService(db);
const products = new ProductsService(
  db,
  new ReviewsService(db),
  new InventoryService(db, silentBackInStock as never),
  graph,
);
const queries: string[] = [];
prisma.$on('query', event => queries.push(event.query));
const run = randomUUID().slice(0, 8);
let categoryId: string;
let warehouseId: string;

type Fixture = { id: string; optionId: string; valueIds: string[]; variantIds: string[]; skuCodes: string[]; skuIds: string[] };
function pair(label: string): VariantCardMedia {
  return { cover: { type: 'IMAGE', url: `/uploads/v2-${label}-cover.webp`, altText: `${label} cover` },
    hover: { type: 'IMAGE', url: `/uploads/v2-${label}-hover.webp`, altText: `${label} hover` } };
}
async function fixture(flags: { status?: 'DRAFT' | 'ACTIVE'; missingCover?: boolean; noDefault?: boolean; prices?: [number | null, number | null] } = {}): Promise<Fixture> {
  const token = randomUUID().slice(0, 8);
  const product = await prisma.product.create({ data: { name: `V2 PG ${run} ${token}`, slug: `v2-pg-${run}-${token}`,
    categoryId, status: flags.status ?? 'DRAFT', solutions: [], catalogGraphVersion: 1,
    images: { create: [
      { type: 'IMAGE', url: '/uploads/v2-shared.webp', altText: 'Shared gallery', sortOrder: 0, isScene: true },
      { type: 'IMAGE', url: '/uploads/v2-gallery-two.webp', altText: null, sortOrder: 1 },
    ] },
  } });
  const option = await prisma.productOption.create({ data: { productId: product.id, kind: 'STYLE', name: 'Style', position: 0, presentation: 'TEXT', isMediaDriver: true } });
  const valueIds: string[] = [], variantIds: string[] = [], skuIds: string[] = [], skuCodes: string[] = [];
  for (const [position, label] of ['A', 'B'].entries()) {
    const value = await prisma.productOptionValue.create({ data: { productId: product.id, optionId: option.id, label, position } });
    const variant = await prisma.productVariant.create({ data: { productId: product.id, name: label, position,
      combinationKey: canonicalCombinationKey([{ optionId: option.id, valueId: value.id }]),
      cardMedia: flags.missingCover && position === 1 ? Prisma.DbNull : pair(`${token}-${label}`),
      optionValues: { create: { optionId: option.id, optionValueId: value.id } },
    } });
    const skuCode = `V2PG-${token}-${label}`;
    const sku = await prisma.sku.create({ data: { productId: product.id, variantId: variant.id, skuCode,
      price: flags.prices ? flags.prices[position] : 100 + position * 20, compareAtPrice: 160, packageWidth: 55,
    } });
    await prisma.inventory.create({ data: { skuId: sku.id, warehouseId, onHand: 8, reserved: 2 } });
    valueIds.push(value.id); variantIds.push(variant.id); skuIds.push(sku.id); skuCodes.push(skuCode);
  }
  if (!flags.noDefault) await prisma.product.update({ where: { id: product.id }, data: { defaultDisplayVariantId: variantIds[0] } });
  return { id: product.id, optionId: option.id, valueIds, variantIds, skuIds, skuCodes };
}
function row(f: Fixture, index: number, extra: Partial<Omit<VariantWrite, 'id' | 'clientKey'>> = {}): VariantWrite {
  return { id: f.variantIds[index]!, position: index, optionValueRefs: [{ id: f.valueIds[index]! }], ...extra };
}
function patch(variants: VariantWrite[], extra: Partial<CatalogGraphPatch> = {}): CatalogGraphPatch {
  return catalogGraphPatchSchema.parse({ options: [], media: [], variants, ...extra });
}
async function snapshot(id: string) {
  return prisma.product.findUniqueOrThrow({ where: { id }, include: { variants: { orderBy: { id: 'asc' }, include: { sku: { include: { inventory: true } }, optionValues: true } }, images: { orderBy: { id: 'asc' } } } });
}

beforeAll(async () => {
  await prisma.$connect();
  const [identity] = await prisma.$queryRaw<Array<{ name: string; owner: string }>>`SELECT current_database() AS name, shobj_description(oid, 'pg_database') AS owner FROM pg_database WHERE datname = current_database()`;
  if (identity?.name !== 'small_house_product_card_v2_20261011_test' || identity.owner !== PRODUCT_CARD_V2_OWNER) throw new Error('Refused unowned PostgreSQL database');
  categoryId = (await prisma.category.create({ data: { name: `V2 PG ${run}`, slug: `v2-pg-${run}`, status: 'ACTIVE' } })).id;
  warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { status: 'ACTIVE' } })).id;
});
afterAll(async () => { await prisma.$disconnect(); });

describe('Product card V2 real PostgreSQL', () => {
  it('persists card-only snapshots without changing gallery, SKU or inventory identity', async () => {
    const f = await fixture();
    const before = await snapshot(f.id);
    await graph.applyPatch(f.id, 1, patch([row(f, 0, { cardMedia: pair('new-A') })]));
    const after = await snapshot(f.id);
    expect(after.catalogGraphVersion).toBe(2);
    expect(after.images).toEqual(before.images);
    expect(after.variants.find(v => v.id === f.variantIds[0])!.cardMedia).toEqual(pair('new-A'));
    expect(after.variants.find(v => v.id === f.variantIds[1])!.cardMedia).toEqual(before.variants.find(v => v.id === f.variantIds[1])!.cardMedia);
    for (const variant of after.variants) expect(variant.sku).toEqual(before.variants.find(v => v.id === variant.id)!.sku);
  });

  it('preserves omitted card metadata during a price-only edit', async () => {
    const f = await fixture();
    const before = await snapshot(f.id);
    await graph.applyPatch(f.id, 1, patch([row(f, 0, { sku: { skuCode: f.skuCodes[0]!, status: 'ACTIVE', price: 149 } })]));
    const after = await snapshot(f.id);
    const current = after.variants.find(v => v.id === f.variantIds[0])!;
    expect(Number(current.sku!.price)).toBe(149);
    expect(current.cardMedia).toEqual(before.variants.find(v => v.id === current.id)!.cardMedia);
    expect(current.sku!.id).toBe(f.skuIds[0]);
    expect(current.sku!.inventory).toEqual(before.variants.find(v => v.id === current.id)!.sku!.inventory);
    expect(current.sku!.packageWidth).toBe(55);
  });

  it('stores explicit null as SQL NULL rather than JSON null', async () => {
    const f = await fixture();
    await graph.applyPatch(f.id, 1, patch([row(f, 0, { cardMedia: null })]));
    const [stored] = await prisma.$queryRaw<Array<{ isSqlNull: boolean }>>`SELECT card_media IS NULL AS "isSqlNull" FROM product_variants WHERE id = ${f.variantIds[0]}::uuid`;
    expect(stored?.isSqlNull).toBe(true);
  });

  it('clears each slot independently and never borrows a gallery image', async () => {
    const f = await fixture({ status: 'ACTIVE' });
    const old = await snapshot(f.id);
    await prisma.product.update({ where: { id: f.id }, data: { status: 'DRAFT' } });
    const own = pair('slots');
    await graph.applyPatch(f.id, 1, patch([row(f, 0, { cardMedia: { ...own, hover: null } })]));
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: f.variantIds[0] } })).cardMedia).toEqual({ cover: own.cover, hover: null });
    await graph.applyPatch(f.id, 2, patch([row(f, 0, { cardMedia: { cover: null, hover: own.hover } })]));
    expect((await snapshot(f.id)).images).toEqual(old.images);
    await prisma.product.update({ where: { id: f.id }, data: { status: 'ACTIVE' } });
    const [publicProduct] = await products.storefrontByIds([f.id]);
    expect(publicProduct!.cardMedia.variants.find(v => v.variantId === f.variantIds[0])).toMatchObject({ cover: null, scene: null });
  });

  it('materializes legacy rows without recreating SKU/stock or stealing the other snapshot', async () => {
    const token = randomUUID().slice(0, 8);
    const created = await products.create(createProductSchema.parse({ name: `V2 Legacy ${token}`, slug: `v2-legacy-${token}`, categoryId, status: 'DRAFT', images: [],
      variants: ['A', 'B'].map((name, position) => ({ name, position, cardMedia: pair(`legacy-${name}`), sku: { skuCode: `V2LEG-${token}-${name}`, price: 100, status: 'ACTIVE' } })),
    }));
    const old = await snapshot(created.id);
    const rows = old.variants.slice().sort((a, b) => a.position - b.position);
    const saved = await graph.applyPatch(created.id, 0, catalogGraphPatchSchema.parse({
      options: [{ clientKey: 'style', kind: 'STYLE', name: 'Style', position: 0, presentation: 'TEXT', isMediaDriver: true, isActive: true,
        values: rows.map((v, position) => ({ clientKey: `value-${position}`, label: v.name, position, isActive: true })) }],
      variants: rows.map((v, position) => ({ id: v.id, position, optionValueRefs: [{ clientKey: `value-${position}` }], ...(position === 0 ? { cardMedia: pair('legacy-new-A') } : {}) })), media: [],
    }));
    expect(saved.catalogGraphVersion).toBe(1);
    const after = await snapshot(created.id);
    expect(after.variants.map(v => v.id).sort()).toEqual(old.variants.map(v => v.id).sort());
    expect(after.variants.find(v => v.id === rows[0]!.id)!.cardMedia).toEqual(pair('legacy-new-A'));
    expect(after.variants.find(v => v.id === rows[1]!.id)!.cardMedia).toEqual(pair('legacy-B'));
    for (const variant of after.variants) expect(variant.sku!.id).toBe(old.variants.find(v => v.id === variant.id)!.sku!.id);
  });

  it('allows only one concurrent graph write and reports the actual version mismatch', async () => {
    const f = await fixture();
    const results = await Promise.allSettled([
      graph.applyPatch(f.id, 1, patch([row(f, 0, { cardMedia: pair('writer-A') })])),
      graph.applyPatch(f.id, 1, patch([row(f, 0, { cardMedia: pair('writer-B') })])),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(r => r.status === 'rejected');
    expect(rejected?.status === 'rejected' ? rejected.reason : null).toMatchObject({ code: 'CATALOG_GRAPH_VERSION_MISMATCH', expectedVersion: 1, actualVersion: 2 });
    const after = await snapshot(f.id);
    expect(after.catalogGraphVersion).toBe(2);
    expect([pair('writer-A'), pair('writer-B')]).toContainEqual(after.variants.find(v => v.id === f.variantIds[0])!.cardMedia);
  });

  it('does not rewrite snapshots when gallery images are deleted or reordered', async () => {
    const f = await fixture({ status: 'ACTIVE' });
    const before = await snapshot(f.id);
    await graph.applyPatch(f.id, 1, patch([], { media: [{ id: before.images[0]!.id, type: 'IMAGE', url: '/uploads/changed-gallery.webp', sortOrder: 9 }],
      retirements: { optionIds: [], optionValueIds: [], variantIds: [], mediaIds: [before.images[1]!.id] } }));
    const after = await snapshot(f.id);
    expect(after.images).toHaveLength(1);
    expect(after.images[0]!.url).toBe('/uploads/changed-gallery.webp');
    expect(after.variants.map(v => ({ id: v.id, cardMedia: v.cardMedia }))).toEqual(before.variants.map(v => ({ id: v.id, cardMedia: v.cardMedia })));
    const [publicProduct] = await products.storefrontByIds([f.id]);
    expect(publicProduct!.cardMedia.unselected.cover!.url).toBe((before.variants.find(v => v.id === f.variantIds[0])!.cardMedia as VariantCardMedia).cover!.url);
  });

  it.each(['cover', 'default'] as const)('rolls back the complete final ACTIVE snapshot when %s is incomplete', async failure => {
    const f = await fixture({ missingCover: failure === 'cover', noDefault: failure === 'default' });
    const before = await snapshot(f.id);
    await expect(graph.applyPatchWithProductMutation(f.id, 1, patch([row(f, 0, { cardMedia: pair('attempt') })]), async tx => {
      await tx.product.update({ where: { id: f.id }, data: { status: 'ACTIVE', name: 'Should roll back' } });
    })).rejects.toMatchObject({ response: { code: 'PRODUCT_CARD_MEDIA_INCOMPLETE' } });
    expect(await snapshot(f.id)).toEqual(before);
  });

  it('allows DRAFT gaps and preserves ACTIVE rejection during a scalar-only legacy save', async () => {
    const f = await fixture({ missingCover: true });
    await graph.applyPatch(f.id, 1, patch([row(f, 0, { cardMedia: null })]));
    const before = await snapshot(f.id);
    await expect(products.update(f.id, { status: 'ACTIVE', name: 'Attempt publish' })).rejects.toMatchObject({ response: { code: 'PRODUCT_CARD_MEDIA_INCOMPLETE' } });
    expect(await snapshot(f.id)).toEqual(before);
  });

  it('rolls back an entire bulk publication when one product is incomplete', async () => {
    const good = await fixture(), bad = await fixture({ missingCover: true });
    await expect(products.bulkSetStatus([good.id, bad.id], 'ACTIVE')).rejects.toMatchObject({ response: { code: 'PRODUCT_CARD_MEDIA_INCOMPLETE' } });
    expect((await prisma.product.findMany({ where: { id: { in: [good.id, bad.id] } }, select: { status: true } })).map(p => p.status)).toEqual(['DRAFT', 'DRAFT']);
  });

  it('accepts a zero-priced out-of-stock SKU without requiring an unpriced variant cover/default', async () => {
    const f = await fixture({ prices: [0, null], missingCover: true, noDefault: true });
    await prisma.inventory.updateMany({ where: { skuId: { in: f.skuIds } }, data: { onHand: 0, reserved: 0 } });
    await graph.applyPatchWithProductMutation(f.id, 1, patch([]), async tx => { await tx.product.update({ where: { id: f.id }, data: { status: 'ACTIVE' } }); });
    const [publicProduct] = await products.storefrontByIds([f.id]);
    expect(publicProduct!.variants.find(v => v.id === f.variantIds[0])!.sku).toMatchObject({ price: 0, availableInventory: 0 });
    expect(publicProduct!.cardMedia.variants.map(v => v.variantId)).toEqual([f.variantIds[0]]);
  });

  it('does not infer the card default from the first legacy variant or expose raw JSON', async () => {
    const f = await fixture({ status: 'ACTIVE', noDefault: true });
    await prisma.product.update({ where: { id: f.id }, data: { catalogGraphVersion: 0 } });
    const [publicProduct] = await products.storefrontByIds([f.id]);
    expect(publicProduct!.cardMedia.displayVariantId).toBeNull();
    expect(publicProduct!.cardMedia.unselected).toEqual({ cover: null, scene: null });
    for (const variant of publicProduct!.variants) expect(variant).not.toHaveProperty('cardMedia');
  });

  it('keeps actual list and internal by-ids card/media SELECT counts constant for 1 versus 20 products', async () => {
    const fixtures = [];
    for (let i = 0; i < 20; i++) fixtures.push(await fixture({ status: 'ACTIVE' }));
    const relevant = () => queries.filter(sql => /^SELECT/i.test(sql.trim()) && /product_variants|product_images/.test(sql));
    queries.length = 0;
    await products.storefrontByIds(fixtures.slice(0, 1).map(f => f.id));
    const oneByIds = relevant().length;
    queries.length = 0;
    const twenty = await products.storefrontByIds(fixtures.map(f => f.id));
    const twentyByIds = relevant().length;
    expect(twenty).toHaveLength(20);
    expect(oneByIds).toBeGreaterThan(0);
    expect(twentyByIds).toBe(oneByIds);
    queries.length = 0;
    await products.storefrontList({ categoryId, page: 1, pageSize: 1 });
    const oneList = relevant().length;
    queries.length = 0;
    await products.storefrontList({ categoryId, page: 1, pageSize: 20 });
    const twentyList = relevant().length;
    expect(oneList).toBeGreaterThan(0);
    expect(twentyList).toBe(oneList);
    writeFileSync(join(target.root, 'postgres-query-budget.json'), JSON.stringify({ oneByIds, twentyByIds, oneList, twentyList }, null, 2));
  }, 30_000);
});
