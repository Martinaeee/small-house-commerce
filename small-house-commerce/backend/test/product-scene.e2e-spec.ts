import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CatalogGraphService } from '../src/modules/catalog/catalog-graph.service.js';
import { ProductsService } from '../src/modules/catalog/products.service.js';
import { ReviewsService } from '../src/modules/catalog/reviews.service.js';
import { InventoryService } from '../src/modules/inventory/inventory.service.js';
import { catalogGraphPatchSchema, CatalogGraphVersionRequiredError } from '../src/modules/catalog/dto/catalog-graph.dto.js';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../src/prisma/prisma.service.js';

vi.mock('../src/common/revalidation.js', () => ({
  CACHE_TAGS: { STOREFRONT: 'storefront' },
  revalidateCache: vi.fn(async () => undefined),
}));

const raw = process.env.PRODUCT_CARD_TEST_DATABASE_URL;
if (!raw) throw new Error('PRODUCT_CARD_TEST_DATABASE_URL is required');
const target = new URL(raw);
if (
  target.protocol !== 'postgresql:' ||
  !['localhost', '127.0.0.1'].includes(target.hostname) ||
  (target.port || '5432') !== '5432' ||
  target.pathname !== '/small_house_product_card_20261010_test' ||
  (target.searchParams.get('schema') ?? 'public') !== 'public'
) throw new Error('Refused product-card test database');

const prisma = new PrismaService(new ConfigService({ database: { url: raw } }));
const silentBackInStock = {
  snapshotForChangedSkusWithin: async () => new Map<string, number>(),
  claimTransitionsWithin: async () => [],
  deliverClaims: async () => undefined,
};
let categoryId: string;

beforeAll(async () => {
  await prisma.$connect();
  categoryId = (await prisma.category.create({
    data: { name: 'Local scene test', slug: `scene-test-${randomUUID()}` },
  })).id;
});
afterAll(async () => { await prisma.$disconnect(); });

async function fixture() {
  const product = await prisma.product.create({
    data: { name: 'Local scene test', slug: `scene-test-${randomUUID()}`, categoryId },
  });
  const option = await prisma.productOption.create({
    data: {
      productId: product.id, name: 'Color', kind: 'COLOR', position: 0,
      presentation: 'SWATCH', isMediaDriver: true,
    },
  });
  const value = await prisma.productOptionValue.create({
    data: { productId: product.id, optionId: option.id, label: 'Blue', position: 0 },
  });
  const variant = await prisma.productVariant.create({
    data: { productId: product.id, name: 'Blue', combinationKey: `${option.id}:${value.id}` },
  });
  await prisma.productVariantOptionValue.create({ data: {
    productId: product.id, variantId: variant.id, optionId: option.id, optionValueId: value.id,
  } });
  return { productId: product.id, optionId: option.id, optionValueId: value.id, variantId: variant.id };
}

const image = { url: '/uploads/local-scene.webp', type: 'IMAGE' as const, isScene: true };

describe('Scene media real PostgreSQL constraints', () => {
  it('gives existing-style image writes an explicit false default without changing sort order', async () => {
    const f = await fixture();
    const row = await prisma.productImage.create({
      data: { productId: f.productId, url: '/uploads/plain.webp', sortOrder: 7 },
    });
    expect(row).toMatchObject({ isScene: false, sortOrder: 7, type: 'IMAGE' });
  });

  it.each(['shared', 'option value', 'variant'] as const)('enforces one scene in a %s scope', async scope => {
    const f = await fixture();
    const data = {
      ...image, productId: f.productId,
      ...(scope === 'option value' ? { optionValueId: f.optionValueId } : {}),
      ...(scope === 'variant' ? { variantId: f.variantId } : {}),
    };
    await prisma.productImage.create({ data });
    await expect(prisma.productImage.create({
      data: { ...data, url: '/uploads/second-scene.webp', sortOrder: 99 },
    })).rejects.toMatchObject({ code: 'P2002' });
    expect(await prisma.productImage.count({ where: {
      productId: f.productId, isScene: true,
    } })).toBe(1);
  });

  it('allows a scene in each of the three distinct scopes of one product', async () => {
    const f = await fixture();
    await prisma.productImage.createMany({ data: [
      { ...image, productId: f.productId },
      { ...image, productId: f.productId, optionValueId: f.optionValueId },
      { ...image, productId: f.productId, variantId: f.variantId },
    ] });
    expect(await prisma.productImage.count({ where: { productId: f.productId, isScene: true } })).toBe(3);
  });

  it('allows separate option-value and variant scopes within the same product', async () => {
    const f = await fixture();
    const firstValue = await prisma.productOptionValue.findUniqueOrThrow({ where: { id: f.optionValueId } });
    const otherValue = await prisma.productOptionValue.create({ data: {
      productId: f.productId, optionId: firstValue.optionId, label: 'Red', position: 1,
    } });
    const otherVariant = await prisma.productVariant.create({ data: {
      productId: f.productId, name: 'Red', combinationKey: otherValue.id,
    } });
    await prisma.productImage.createMany({ data: [
      { ...image, productId: f.productId, optionValueId: f.optionValueId },
      { ...image, productId: f.productId, optionValueId: otherValue.id },
      { ...image, productId: f.productId, variantId: f.variantId },
      { ...image, productId: f.productId, variantId: otherVariant.id },
    ] });
    expect(await prisma.productImage.count({ where: { productId: f.productId, isScene: true } })).toBe(4);
  });

  it('allows unrelated products to have their own shared scene', async () => {
    const first = await fixture();
    const second = await fixture();
    await prisma.productImage.createMany({ data: [
      { ...image, productId: first.productId }, { ...image, productId: second.productId },
    ] });
    expect(await prisma.productImage.count({ where: {
      productId: { in: [first.productId, second.productId] }, isScene: true,
    } })).toBe(2);
  });

  it('allows unmarked images and videos alongside a scene without imposing sort-order uniqueness', async () => {
    const f = await fixture();
    await prisma.productImage.createMany({ data: [
      { ...image, productId: f.productId, sortOrder: 2 },
      { ...image, productId: f.productId, isScene: false, sortOrder: 2 },
      { ...image, productId: f.productId, isScene: false, type: 'VIDEO', sortOrder: 2 },
    ] });
    const rows = await prisma.productImage.findMany({ where: { productId: f.productId } });
    expect(rows).toHaveLength(3);
    expect(rows.filter(row => row.isScene)).toHaveLength(1);
    expect(rows.every(row => row.sortOrder === 2)).toBe(true);
  });

  it('rejects a scene video at the database boundary, including updates', async () => {
    const f = await fixture();
    await expect(prisma.productImage.create({ data: {
      ...image, productId: f.productId, type: 'VIDEO',
    } })).rejects.toThrow(/product_images_scene_image_check|check constraint/i);
    const row = await prisma.productImage.create({ data: {
      productId: f.productId, url: '/uploads/video.mp4', type: 'VIDEO',
    } });
    await expect(prisma.productImage.update({
      where: { id: row.id }, data: { isScene: true },
    })).rejects.toThrow(/product_images_scene_image_check|check constraint/i);
    expect(await prisma.productImage.findUniqueOrThrow({ where: { id: row.id } }))
      .toMatchObject({ type: 'VIDEO', isScene: false });
  });

  it('keeps the existing scope XOR constraint', async () => {
    const f = await fixture();
    await expect(prisma.productImage.create({ data: {
      ...image, productId: f.productId, optionValueId: f.optionValueId, variantId: f.variantId,
    } })).rejects.toThrow(/constraint/i);
    expect(await prisma.productImage.count({ where: { productId: f.productId } })).toBe(0);
  });
});

const graph = new CatalogGraphService(prisma);
const products = new ProductsService(prisma, new ReviewsService(prisma), new InventoryService(prisma, silentBackInStock as never), graph);

async function graphGallery(scope: 'shared' | 'option value' | 'variant' = 'shared') {
  const f = await fixture();
  await prisma.product.update({ where: { id: f.productId }, data: { catalogGraphVersion: 1 } });
  const scopeFields = scope === 'option value'
    ? { optionValueId: f.optionValueId }
    : scope === 'variant' ? { variantId: f.variantId } : {};
  const a = await prisma.productImage.create({ data: {
    ...image, ...scopeFields, productId: f.productId, url: '/uploads/a.webp', sortOrder: 2,
  } });
  const b = await prisma.productImage.create({ data: {
    ...image, ...scopeFields, productId: f.productId, url: '/uploads/b.webp', isScene: false, sortOrder: 5,
  } });
  const swap = catalogGraphPatchSchema.parse({ media: [
    { id: b.id, url: b.url, type: b.type, sortOrder: b.sortOrder, ...scopeFields, isScene: true },
    { id: a.id, url: a.url, type: a.type, sortOrder: a.sortOrder, ...scopeFields, isScene: false },
  ] });
  return { ...f, a, b, swap };
}
const readMedia = (productId: string) => prisma.productImage.findMany({
  where: { productId }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
});

describe('Scene saving real PostgreSQL transactions', () => {
  it.each(['shared', 'option value', 'variant'] as const)('swaps the %s scene even when the new true write comes first', async scope => {
    const f = await graphGallery(scope);
    const saved = await graph.applyPatch(f.productId, 1, f.swap);
    expect(saved.catalogGraphVersion).toBe(2);
    expect((await readMedia(f.productId)).map(row => ({ id: row.id, isScene: row.isScene, sortOrder: row.sortOrder })))
      .toEqual([
        { id: f.a.id, isScene: false, sortOrder: 2 },
        { id: f.b.id, isScene: true, sortOrder: 5 },
      ]);
  });

  it('rejects a conflicting final snapshot without changing version or flags', async () => {
    const f = await graphGallery();
    const before = await readMedia(f.productId);
    await expect(graph.applyPatch(f.productId, 1, catalogGraphPatchSchema.parse({ media: [
      { id: f.b.id, url: f.b.url, isScene: true, sortOrder: f.b.sortOrder },
    ] }))).rejects.toThrow(/scene/i);
    expect(await readMedia(f.productId)).toEqual(before);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: f.productId } })).catalogGraphVersion).toBe(1);
  });

  it('keeps version and scene flags intact after a stale revision', async () => {
    const f = await graphGallery();
    const before = await readMedia(f.productId);
    await expect(graph.applyPatch(f.productId, 0, f.swap)).rejects.toThrow(/version/i);
    expect(await readMedia(f.productId)).toEqual(before);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: f.productId } })).catalogGraphVersion).toBe(1);
  });

  it('rolls back the clear/set phase and scalar mutation after a late failure', async () => {
    const f = await graphGallery();
    const before = await readMedia(f.productId);
    await expect(graph.applyPatchWithProductMutation(f.productId, 1, f.swap, async tx => {
      await tx.product.update({ where: { id: f.productId }, data: { description: 'Must roll back' } });
      throw new Error('late product failure');
    })).rejects.toThrow('late product failure');
    expect(await readMedia(f.productId)).toEqual(before);
    expect(await prisma.product.findUniqueOrThrow({ where: { id: f.productId } }))
      .toMatchObject({ catalogGraphVersion: 1, description: null });
  });

  it('keeps unrelated gallery scenes during a scope-local swap', async () => {
    const f = await graphGallery();
    const other = await prisma.productImage.create({ data: {
      ...image, productId: f.productId, optionValueId: f.optionValueId,
    } });
    await graph.applyPatch(f.productId, 1, f.swap);
    expect(await prisma.productImage.findUniqueOrThrow({ where: { id: other.id } })).toMatchObject({ isScene: true });
    expect(await prisma.productImage.count({ where: { productId: f.productId, isScene: true } })).toBe(2);
  });

  it('preserves, clears and deletes legacy scene metadata through the real service', async () => {
    const product = await prisma.product.create({ data: {
      name: 'Local legacy scene', slug: `legacy-scene-${randomUUID()}`, categoryId,
    } });
    await prisma.productImage.create({ data: { ...image, productId: product.id } });
    await products.update(product.id, { images: [
      { url: '/uploads/plain.webp', type: 'IMAGE', sortOrder: 0 },
      { url: image.url, type: 'IMAGE', sortOrder: 1 },
    ] });
    expect((await readMedia(product.id)).map(row => row.isScene)).toEqual([false, true]);
    await products.update(product.id, { images: [
      { url: image.url, type: 'IMAGE', sortOrder: 1, isScene: false },
    ] });
    expect((await readMedia(product.id)).map(row => row.isScene)).toEqual([false]);
    await products.update(product.id, { images: [] });
    expect(await readMedia(product.id)).toEqual([]);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).catalogGraphVersion).toBe(0);
  });

  it('rejects a legacy request that read graph-v0 before another transaction materialized it', async () => {
    const product = await prisma.product.create({ data: {
      name: 'Local scene race', slug: `scene-race-${randomUUID()}`, categoryId,
    } });
    await prisma.productImage.create({ data: { ...image, productId: product.id } });
    let signalRead!: () => void;
    let releaseRead!: () => void;
    const readReady = new Promise<void>(resolve => { signalRead = resolve; });
    const readGate = new Promise<void>(resolve => { releaseRead = resolve; });
    let firstRead = true;
    const timedProduct = new Proxy(prisma.product, {
      get(delegate, key) {
        if (key !== 'findUnique') return Reflect.get(delegate, key);
        return async (args: Parameters<typeof prisma.product.findUnique>[0]) => {
          const row = await prisma.product.findUnique(args);
          if (firstRead) {
            firstRead = false;
            signalRead();
            await readGate;
          }
          return row;
        };
      },
    });
    const timedPrisma = new Proxy(prisma, {
      get(client, key) {
        if (key === 'product') return timedProduct;
        const value = Reflect.get(client, key);
        return typeof value === 'function' ? value.bind(client) : value;
      },
    });
    const racingProducts = new ProductsService(timedPrisma, new ReviewsService(prisma), new InventoryService(prisma, silentBackInStock as never), graph);
    const pending = racingProducts.update(product.id, { images: [] }).catch(error => error);
    await readReady;
    try {
      await graph.applyPatch(product.id, 0, catalogGraphPatchSchema.parse({
        options: [{ clientKey: 'color', kind: 'COLOR', name: 'Color', position: 0,
          presentation: 'SWATCH', isMediaDriver: true,
          values: [{ clientKey: 'blue', label: 'Blue', position: 0 }],
        }],
        media: [{ clientKey: 'blue-scene', url: '/uploads/blue-scene.webp', optionValueClientKey: 'blue', isScene: true }],
      }));
    } finally {
      releaseRead();
    }
    expect(await pending).toBeInstanceOf(CatalogGraphVersionRequiredError);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).catalogGraphVersion).toBe(1);
    expect((await readMedia(product.id)).map(row => row.isScene)).toEqual([true, true]);
  });
});
