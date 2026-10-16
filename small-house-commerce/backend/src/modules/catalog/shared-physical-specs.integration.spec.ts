import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { ProductVariant, Sku } from '../../generated/prisma/client.js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../prisma/prisma.service.js';
import { canonicalCombinationKey } from './catalog-graph.js';
import { CatalogGraphService } from './catalog-graph.service.js';
import { catalogGraphPatchSchema } from './dto/catalog-graph.dto.js';

const database = process.env.BUNDLE_TEST_DATABASE_URL;
if (database) {
  const url = new URL(database);
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || !/^small_house_bundle_20261016_cspec[a-z0-9]+$/.test(url.pathname.slice(1))) {
    throw new Error('Shared physical specification tests require their own local cspec database.');
  }
}

describe.skipIf(!database)('shared physical specifications on PostgreSQL', () => {
  let prisma: PrismaService;
  let graph: CatalogGraphService;
  let categoryId: string;
  let warehouseId: string;

  beforeAll(async () => {
    prisma = new PrismaService(new ConfigService({ database: { url: database } }));
    await prisma.$connect();
    graph = new CatalogGraphService(prisma);
    categoryId = (await prisma.category.create({ data: { name: 'Shared specifications', slug: `cspec-${randomUUID()}` } })).id;
    warehouseId = (await prisma.warehouse.create({ data: { name: `cspec-${randomUUID()}` } })).id;
  });

  async function cleanup() {
    const products = await prisma.product.findMany({ where: { categoryId }, select: { id: true, skus: { select: { id: true } } } });
    const ids = products.map(p => p.id);
    const skuIds = products.flatMap(p => p.skus.map(s => s.id));
    await prisma.inventory.deleteMany({ where: { skuId: { in: skuIds } } });
    await prisma.product.updateMany({ where: { id: { in: ids } }, data: { defaultDisplayVariantId: null } });
    await prisma.product.deleteMany({ where: { id: { in: ids } } });
  }
  afterEach(cleanup);
  afterAll(async () => {
    if (!prisma) return;
    await cleanup();
    await prisma.category.delete({ where: { id: categoryId } });
    await prisma.warehouse.delete({ where: { id: warehouseId } });
    await prisma.$disconnect();
  });

  async function fixture(kind?: 'SIZE' | 'STYLE' | 'MATERIAL') {
    const key = randomUUID();
    const product = await prisma.product.create({ data: { name: 'Physical fixture', slug: `cspec-product-${key}`, categoryId, status: 'DRAFT', catalogGraphVersion: 1, width: 80, depth: 50, height: 70 } });
    const color = await prisma.productOption.create({ data: { productId: product.id, kind: 'COLOR', name: 'Color', position: 0, presentation: 'SWATCH', isMediaDriver: true } });
    const values = await Promise.all(['Red', 'Blue'].map((label, position) => prisma.productOptionValue.create({ data: { productId: product.id, optionId: color.id, label, position } })));
    const physical = kind ? await prisma.productOption.create({ data: { productId: product.id, kind, name: kind, position: 1, presentation: 'TEXT' } }) : null;
    const physicalValues = physical ? await Promise.all(['Small', 'Large'].map((label, position) => prisma.productOptionValue.create({ data: { productId: product.id, optionId: physical.id, label, position } }))) : [null];
    const rows: { variant: ProductVariant; sku: Sku; refs: { id: string }[] }[] = [];
    for (const physicalValue of physicalValues) for (const value of values) {
      const pairs = [{ optionId: color.id, valueId: value.id }, ...(physical && physicalValue ? [{ optionId: physical.id, valueId: physicalValue.id }] : [])];
      const variant = await prisma.productVariant.create({ data: { productId: product.id, name: `${value.label}${physicalValue ? ` / ${physicalValue.label}` : ''}`, position: rows.length, combinationKey: canonicalCombinationKey(pairs) } });
      await prisma.productVariantOptionValue.createMany({ data: pairs.map(p => ({ productId: product.id, variantId: variant.id, optionId: p.optionId, optionValueId: p.valueId })) });
      const sku = await prisma.sku.create({ data: { productId: product.id, variantId: variant.id, skuCode: `CSPEC-${key}-${rows.length}`, price: 100 + rows.length, productWidth: 100, packageWidth: 110, packageWeight: 5 } });
      await prisma.inventory.create({ data: { skuId: sku.id, warehouseId, onHand: 10 + rows.length } });
      rows.push({ variant, sku, refs: pairs.map(p => ({ id: p.valueId })) });
    }
    await prisma.product.update({ where: { id: product.id }, data: { defaultDisplayVariantId: rows[0].variant.id } });
    return { product, color, rows };
  }

  function write(row: Awaited<ReturnType<typeof fixture>>['rows'][number], fields: Record<string, unknown>) {
    return { id: row.variant.id, position: row.variant.position, optionValueRefs: row.refs, sku: { skuCode: row.sku.skuCode, status: 'ACTIVE', ...fields } };
  }
  async function sku(id: string) { return prisma.sku.findUniqueOrThrow({ where: { id } }); }

  it('fans out only physical fields and keeps price, inventory and identities independent', async () => {
    const f = await fixture();
    const inventory = await prisma.inventory.findMany({ where: { skuId: { in: f.rows.map(r => r.sku.id) } }, orderBy: { skuId: 'asc' } });
    await graph.applyPatch(f.product.id, 1, catalogGraphPatchSchema.parse({ variants: [write(f.rows[0], { packageWidth: 120 })] }));
    expect(await sku(f.rows[0].sku.id)).toMatchObject({ packageWidth: 120, price: f.rows[0].sku.price });
    expect(await sku(f.rows[1].sku.id)).toMatchObject({ packageWidth: 120, price: f.rows[1].sku.price });
    expect(await prisma.inventory.findMany({ where: { skuId: { in: f.rows.map(r => r.sku.id) } }, orderBy: { skuId: 'asc' } })).toEqual(inventory);
  });

  it.each(['SIZE', 'STYLE', 'MATERIAL'] as const)('does not cross another %s value', async kind => {
    const f = await fixture(kind);
    await graph.applyPatch(f.product.id, 1, catalogGraphPatchSchema.parse({ variants: [write(f.rows[0], { packageWidth: 120 })] }));
    expect((await Promise.all(f.rows.map(r => sku(r.sku.id)))).map(s => s.packageWidth)).toEqual([120, 120, 110, 110]);
  });

  it('rolls back product mutation, graph version and all physical writes on conflict', async () => {
    const f = await fixture();
    await expect(graph.applyPatchWithProductMutation(f.product.id, 1, catalogGraphPatchSchema.parse({ variants: [write(f.rows[0], { packageWidth: 120 }), write(f.rows[1], { packageWidth: 140 })] }), async tx => {
      await tx.product.update({ where: { id: f.product.id }, data: { name: 'Must roll back' } });
    })).rejects.toMatchObject({ response: { code: 'PRODUCT_PHYSICAL_SPEC_CONFLICT' } });
    expect(await prisma.product.findUniqueOrThrow({ where: { id: f.product.id } })).toMatchObject({ name: 'Physical fixture', catalogGraphVersion: 1 });
    expect((await Promise.all(f.rows.map(r => sku(r.sku.id)))).map(s => s.packageWidth)).toEqual([110, 110]);
  });

  it('preserves conflicting old physical data when price alone changes in a full payload', async () => {
    const f = await fixture();
    await prisma.sku.update({ where: { id: f.rows[1].sku.id }, data: { packageWidth: 90 } });
    await graph.applyPatch(f.product.id, 1, catalogGraphPatchSchema.parse({ variants: [write(f.rows[0], { productWidth: 100, packageWidth: 110, packageWeight: 5, price: 250 })] }));
    const updated = await sku(f.rows[0].sku.id);
    expect(Number(updated.price)).toBe(250);
    expect(updated.packageWidth).toBe(110);
    expect(await sku(f.rows[1].sku.id)).toMatchObject({ price: f.rows[1].sku.price, packageWidth: 90 });
  });

  it('clears an override to null across colors without replacing Product defaults', async () => {
    const f = await fixture();
    await graph.applyPatch(f.product.id, 1, catalogGraphPatchSchema.parse({ variants: [write(f.rows[0], { productWidth: null })] }));
    expect((await Promise.all(f.rows.map(r => sku(r.sku.id)))).map(s => s.productWidth)).toEqual([null, null]);
    expect(await prisma.product.findUniqueOrThrow({ where: { id: f.product.id } })).toMatchObject({ width: 80, depth: 50, height: 70 });
  });

  it('retains zero when synchronizing colors', async () => {
    const f = await fixture();
    await graph.applyPatch(f.product.id, 1, catalogGraphPatchSchema.parse({ variants: [write(f.rows[0], { productWidth: 0 })] }));
    expect((await Promise.all(f.rows.map(r => sku(r.sku.id)))).map(s => s.productWidth)).toEqual([0, 0]);
  });

  it('does not update disabled retained SKU rows', async () => {
    const f = await fixture();
    await prisma.sku.update({ where: { id: f.rows[1].sku.id }, data: { status: 'DISABLED' } });
    await graph.applyPatch(f.product.id, 1, catalogGraphPatchSchema.parse({ variants: [write(f.rows[0], { packageWidth: 120 })] }));
    expect(await sku(f.rows[1].sku.id)).toMatchObject({ packageWidth: 110, status: 'DISABLED' });
  });

  it('requires explicit resolution before reactivating conflicting retained specifications', async () => {
    const f = await fixture();
    await prisma.sku.update({ where: { id: f.rows[1].sku.id }, data: { status: 'DISABLED', packageWidth: 90 } });
    await expect(graph.applyPatch(f.product.id, 1, catalogGraphPatchSchema.parse({ variants: [write(f.rows[1], { packageWidth: 90 })] }))).rejects.toMatchObject({ response: { code: 'PRODUCT_PHYSICAL_SPEC_CONFLICT' } });
    expect(await sku(f.rows[1].sku.id)).toMatchObject({ status: 'DISABLED', packageWidth: 90 });
  });

  function greenPatch(f: Awaited<ReturnType<typeof fixture>>, withSku = true) {
    return catalogGraphPatchSchema.parse({
      options: [{ id: f.color.id, kind: 'COLOR', name: 'Color', position: 0, presentation: 'SWATCH', isMediaDriver: true, isActive: true, values: [{ clientKey: 'green', label: 'Green', position: 2, isActive: true }] }],
      ...(withSku ? { variants: [{ clientKey: 'green-row', position: 2, optionValueRefs: [{ clientKey: 'green' }], sku: { skuCode: `CSPEC-NEW-${randomUUID()}`, status: 'ACTIVE' } }] } : {}),
    });
  }

  it('inherits new color specifications from the consistent group', async () => {
    const f = await fixture();
    const saved = await graph.applyPatch(f.product.id, 1, greenPatch(f));
    const added = saved.variants.find(v => v.name === 'Green');
    expect(added?.sku).toMatchObject({ productWidth: 100, packageWidth: 110, packageWeight: 5 });
    expect(await prisma.inventory.count({ where: { skuId: added!.sku!.id } })).toBe(0);
  });

  it('does not create a SKU for a merely added candidate', async () => {
    const f = await fixture();
    const saved = await graph.applyPatch(f.product.id, 1, greenPatch(f, false));
    expect(saved.variants.find(v => v.name === 'Green')?.sku).toBeNull();
    expect(await prisma.sku.count({ where: { productId: f.product.id } })).toBe(2);
  });

  it('rejects a new color when the group has unresolved old conflicts', async () => {
    const f = await fixture();
    await prisma.sku.update({ where: { id: f.rows[1].sku.id }, data: { packageWidth: 90 } });
    await expect(graph.applyPatch(f.product.id, 1, greenPatch(f))).rejects.toMatchObject({ response: { code: 'PRODUCT_PHYSICAL_SPEC_CONFLICT' } });
    expect(await prisma.productOptionValue.count({ where: { productId: f.product.id } })).toBe(2);
    expect(await prisma.sku.count({ where: { productId: f.product.id } })).toBe(2);
  });

  it('rejects stale graph versions without fanout', async () => {
    const f = await fixture();
    await expect(graph.applyPatch(f.product.id, 0, catalogGraphPatchSchema.parse({ variants: [write(f.rows[0], { packageWidth: 120 })] }))).rejects.toBeDefined();
    expect((await Promise.all(f.rows.map(r => sku(r.sku.id)))).map(s => s.packageWidth)).toEqual([110, 110]);
  });

  it('allows exactly one concurrent version writer and leaves the group consistent', async () => {
    const f = await fixture();
    const results = await Promise.allSettled([
      graph.applyPatch(f.product.id, 1, catalogGraphPatchSchema.parse({ variants: [write(f.rows[0], { packageWidth: 120 })] })),
      graph.applyPatch(f.product.id, 1, catalogGraphPatchSchema.parse({ variants: [write(f.rows[1], { packageWidth: 140 })] })),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
    const widths = (await Promise.all(f.rows.map(r => sku(r.sku.id)))).map(s => s.packageWidth);
    expect([[120, 120], [140, 140]]).toContainEqual(widths);
    expect(await prisma.product.findUniqueOrThrow({ where: { id: f.product.id } })).toMatchObject({ catalogGraphVersion: 2 });
  });
});
