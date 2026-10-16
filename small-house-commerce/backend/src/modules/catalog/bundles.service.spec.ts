import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Sku } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { BundlesService } from './bundles.service.js';
import { validateBundlePublishReadiness } from './bundle-readiness.js';
import { getBundleAvailabilityForSkus } from '../inventory/bundle-inventory.js';

const database = process.env.BUNDLE_TEST_DATABASE_URL;
if (database) {
  const url = new URL(database);
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || !/^\/small_house_bundle_20261016_[a-z0-9]+$/.test(url.pathname)) {
    throw new Error('Bundle persistence tests require their owned local database.');
  }
}

describe.skipIf(!database)('BundlesService PostgreSQL persistence', () => {
  let prisma: PrismaService;
  let service: BundlesService;
  let owner: Sku;
  let component: Sku;
  let categoryId: string;
  let warehouseId: string;
  let productIds: string[];
  let skuIds: string[];
  let prefix: string;

  beforeAll(async () => {
    prisma = new PrismaService(new ConfigService({ database: { url: database } }));
    await prisma.$connect();
    service = new BundlesService(prisma);
  });

  beforeEach(async () => {
    prefix = `bundle-service-${randomUUID()}`;
    productIds = [];
    skuIds = [];
    const category = await prisma.category.create({ data: { name: 'Bundle persistence fixture', slug: prefix } });
    categoryId = category.id;
    const warehouse = await prisma.warehouse.create({ data: { name: prefix } });
    warehouseId = warehouse.id;
    const ownerProduct = await prisma.product.create({ data: { name: 'Bundle fixture furniture', slug: `${prefix}-owner`, categoryId, status: 'ACTIVE', solutions: [] } });
    productIds.push(ownerProduct.id);
    const ownerVariant = await prisma.productVariant.create({ data: { productId: ownerProduct.id, name: 'Set', combinationKey: 'legacy:set' } });
    owner = await prisma.sku.create({ data: { productId: ownerProduct.id, variantId: ownerVariant.id, skuCode: `${prefix}-SET`, isBundle: true, price: 2499 } });
    skuIds.push(owner.id);
    const componentProduct = await prisma.product.create({ data: { name: 'Component fixture furniture', slug: `${prefix}-component`, categoryId, status: 'ACTIVE', solutions: [] } });
    productIds.push(componentProduct.id);
    const variant = await prisma.productVariant.create({ data: { productId: componentProduct.id, name: 'Black', combinationKey: 'legacy:black' } });
    component = await prisma.sku.create({ data: { productId: componentProduct.id, variantId: variant.id, skuCode: `${prefix}-CHAIR`, price: 1099, supplierCost: 99 } });
    skuIds.push(component.id);
    await prisma.inventory.createMany({ data: [
      { skuId: component.id, warehouseId, onHand: 9, reserved: 1 },
      { skuId: component.id, warehouseId: '00000000-0000-4000-8000-000000000007', onHand: 5, reserved: 2 },
    ] });
  });

  afterEach(async () => {
    await prisma.skuBundleComponent.deleteMany({ where: { bundleSkuId: { in: skuIds } } });
    await prisma.inventory.deleteMany({ where: { skuId: { in: skuIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    if (warehouseId) await prisma.warehouse.delete({ where: { id: warehouseId } });
    if (categoryId) await prisma.category.delete({ where: { id: categoryId } });
  });
  afterAll(async () => { if (prisma) await prisma.$disconnect(); });

  const input = (componentSkuId: string, expectedVersion = 0, quantity = 2) => ({ expectedVersion, components: [{ componentSkuId, quantity, position: 0 }] });

  async function state() {
    return {
      owner: await prisma.sku.findUniqueOrThrow({ where: { id: owner.id } }),
      bindings: await prisma.skuBundleComponent.findMany({ where: { bundleSkuId: owner.id }, orderBy: { position: 'asc' } }),
      inventory: await prisma.inventory.findMany({ where: { skuId: { in: skuIds } }, orderBy: [{ skuId: 'asc' }, { warehouseId: 'asc' }] }),
    };
  }

  it('saves exact cross-product ordinary components and derives stock from both warehouses', async () => {
    const result = await service.setComponents(owner.productId, owner.id, input(component.id));
    expect(result).toMatchObject({ version: 1, availableInventory: 5, components: [{ componentSkuId: component.id, quantity: 2, position: 0, componentSkuCode: `${prefix}-CHAIR`, componentProductName: 'Component fixture furniture', componentVariantName: 'Black', availableInventory: 11 }] });
    expect(await prisma.inventory.count({ where: { skuId: owner.id } })).toBe(0);
    expect((await prisma.sku.findUniqueOrThrow({ where: { id: owner.id } })).price?.toString()).toBe('2499');
    expect(await prisma.inventory.findMany({ where: { skuId: component.id }, select: { onHand: true, reserved: true }, orderBy: { onHand: 'asc' } })).toEqual([{ onHand: 5, reserved: 2 }, { onHand: 9, reserved: 1 }]);
  });

  it('returns an empty initial definition with zero availability', async () => {
    expect(await service.getComponents(owner.productId, owner.id)).toEqual({ version: 0, availableInventory: 0, components: [] });
  });

  it('does not advertise availability for a disabled virtual owner', async () => {
    await service.setComponents(owner.productId, owner.id, input(component.id));
    await prisma.sku.update({ where: { id: owner.id }, data: { status: 'DISABLED' } });
    expect((await service.getComponents(owner.productId, owner.id)).availableInventory).toBe(0);
  });

  it('rejects a stale edit without replacing or deleting current rows', async () => {
    await service.setComponents(owner.productId, owner.id, input(component.id));
    const before = await state();
    await expect(service.setComponents(owner.productId, owner.id, input(component.id, 0, 7))).rejects.toBeInstanceOf(ConflictException);
    expect(await state()).toEqual(before);
  });

  it('validates components only after acquiring the shared definition-owner lock', async () => {
    const before = await state();
    let release!: () => void;
    let locked!: (pid: number) => void;
    const released = new Promise<void>(resolve => { release = resolve; });
    const lockReady = new Promise<number>(resolve => { locked = resolve; });
    const holder = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM skus WHERE id = ${owner.id}::uuid FOR UPDATE`;
      const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      locked(pid);
      await released;
      await tx.sku.update({ where: { id: component.id }, data: { status: 'DISABLED' } });
    }, { timeout: 10000 });
    const pid = await lockReady;
    const saving = service.setComponents(owner.productId, owner.id, input(component.id)).then(
      value => ({ status: 'fulfilled' as const, value }),
      reason => ({ status: 'rejected' as const, reason }),
    );
    let outcome: Awaited<typeof saving>;
    try {
      await expect.poll(async () => {
        const [{ blocked }] = await prisma.$queryRaw<{ blocked: boolean }[]>`
          SELECT EXISTS (
            SELECT 1 FROM pg_stat_activity
            WHERE ${pid}::integer = ANY(pg_blocking_pids(pid))
          ) AS blocked
        `;
        return blocked;
      }, { timeout: 3000, interval: 10 }).toBe(true);
    } finally {
      release();
      await holder;
      outcome = await saving;
    }
    expect(outcome.status).toBe('rejected');
    expect(outcome.status === 'rejected' ? outcome.reason : undefined).toBeInstanceOf(BadRequestException);
    expect(await state()).toEqual(before);
  });

  it('allows only one concurrent compare-and-swap to win', async () => {
    const results = await Promise.allSettled([
      service.setComponents(owner.productId, owner.id, input(component.id, 0, 2)),
      service.setComponents(owner.productId, owner.id, input(component.id, 0, 3)),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find(result => result.status === 'rejected');
    expect(failure?.status === 'rejected' ? failure.reason : undefined).toBeInstanceOf(ConflictException);
    const current = await service.getComponents(owner.productId, owner.id);
    expect(current.version).toBe(1);
    expect(current.components).toHaveLength(1);
    expect([2, 3]).toContain(current.components[0].quantity);
    expect(await prisma.inventory.count({ where: { skuId: owner.id } })).toBe(0);
  });

  it.each(['sku-disabled', 'product-disabled', 'product-draft', 'nested'] as const)('rejects %s without changing version,definition or stock', async kind => {
    await service.setComponents(owner.productId, owner.id, input(component.id));
    if (kind === 'sku-disabled') await prisma.sku.update({ where: { id: component.id }, data: { status: 'DISABLED' } });
    if (kind === 'product-disabled') await prisma.product.update({ where: { id: component.productId }, data: { status: 'DISABLED' } });
    if (kind === 'product-draft') await prisma.product.update({ where: { id: component.productId }, data: { status: 'DRAFT' } });
    if (kind === 'nested') await prisma.sku.update({ where: { id: component.id }, data: { isBundle: true } });
    const before = await state();
    await expect(service.setComponents(owner.productId, owner.id, input(component.id, 1, 3))).rejects.toBeInstanceOf(BadRequestException);
    expect(await state()).toEqual(before);
    expect((await service.getComponents(owner.productId, owner.id)).availableInventory).toBe(0);
  });

  it('rejects self-reference before any persistent change', async () => {
    const before = await state();
    await expect(service.setComponents(owner.productId, owner.id, input(owner.id))).rejects.toBeInstanceOf(BadRequestException);
    expect(await state()).toEqual(before);
  });

  it('validates all component identities before replacing a saved definition', async () => {
    await service.setComponents(owner.productId, owner.id, input(component.id));
    const before = await state();
    await expect(service.setComponents(owner.productId, owner.id, { expectedVersion: 1, components: [
      { componentSkuId: component.id, quantity: 1, position: 0 },
      { componentSkuId: randomUUID(), quantity: 1, position: 1 },
    ] })).rejects.toBeInstanceOf(BadRequestException);
    expect(await state()).toEqual(before);
  });

  it('rejects the wrong owner product for reads and writes', async () => {
    const before = await state();
    await expect(service.getComponents(component.productId, owner.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.setComponents(component.productId, owner.id, input(component.id))).rejects.toBeInstanceOf(NotFoundException);
    expect(await state()).toEqual(before);
  });

  it('does not convert an ordinary SKU through the Bundle endpoint', async () => {
    await expect(service.getComponents(component.productId, component.id)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.setComponents(component.productId, component.id, input(owner.id))).rejects.toBeInstanceOf(BadRequestException);
    expect((await prisma.sku.findUniqueOrThrow({ where: { id: component.id } })).isBundle).toBe(false);
    expect(await prisma.skuBundleComponent.count({ where: { bundleSkuId: component.id } })).toBe(0);
  });

  it('returns only ordinary active search candidates and no private supplier or price fields', async () => {
    expect(await service.search(prefix)).toEqual([{ id: component.id, skuCode: `${prefix}-CHAIR`, productId: component.productId, productName: 'Component fixture furniture', variantName: 'Black', availableInventory: 11 }]);
    await prisma.sku.update({ where: { id: component.id }, data: { status: 'DISABLED' } });
    expect(await service.search(prefix)).toEqual([]);
    await prisma.sku.update({ where: { id: component.id }, data: { status: 'ACTIVE' } });
    await prisma.product.update({ where: { id: component.productId }, data: { status: 'DRAFT' } });
    expect(await service.search(prefix)).toEqual([]);
  });

  it('requires a saved valid definition before the active virtual owner can be published', async () => {
    await expect(validateBundlePublishReadiness(prisma, [owner.productId])).rejects.toMatchObject({ response: {
      code: 'PRODUCT_BUNDLE_DEFINITION_INCOMPLETE',
      products: [{ productId: owner.productId, productName: 'Bundle fixture furniture', skus: [{ skuId: owner.id, skuCode: `${prefix}-SET` }] }],
    } });
    await service.setComponents(owner.productId, owner.id, input(component.id));
    await expect(validateBundlePublishReadiness(prisma, [owner.productId])).resolves.toBeUndefined();
  });

  it.each(['component-disabled', 'component-product-draft', 'nested-component'] as const)('blocks publication while the saved definition has a %s', async kind => {
    await service.setComponents(owner.productId, owner.id, input(component.id));
    if (kind === 'component-disabled') await prisma.sku.update({ where: { id: component.id }, data: { status: 'DISABLED' } });
    if (kind === 'component-product-draft') await prisma.product.update({ where: { id: component.productId }, data: { status: 'DRAFT' } });
    if (kind === 'nested-component') await prisma.sku.update({ where: { id: component.id }, data: { isBundle: true } });
    await expect(validateBundlePublishReadiness(prisma, [owner.productId])).rejects.toMatchObject({ response: { code: 'PRODUCT_BUNDLE_DEFINITION_INCOMPLETE' } });
  });

  it('ignores disabled virtual owners and products without virtual SKUs', async () => {
    await prisma.sku.update({ where: { id: owner.id }, data: { status: 'DISABLED' } });
    await expect(validateBundlePublishReadiness(prisma, [owner.productId])).resolves.toBeUndefined();
    await expect(validateBundlePublishReadiness(prisma, [component.productId])).resolves.toBeUndefined();
    await expect(validateBundlePublishReadiness(prisma, [])).resolves.toBeUndefined();
  });

  it('derives availability only for virtual SKUs and ignores their own inventory rows', async () => {
    await service.setComponents(owner.productId, owner.id, input(component.id));
    const derived = await getBundleAvailabilityForSkus(prisma, [owner.id, component.id]);
    expect(derived.get(owner.id)).toBe(5);
    expect(derived.has(component.id)).toBe(false);
    await prisma.sku.update({ where: { id: owner.id }, data: { status: 'DISABLED' } });
    expect((await getBundleAvailabilityForSkus(prisma, [owner.id])).get(owner.id)).toBe(0);
    expect((await getBundleAvailabilityForSkus(prisma, [])).size).toBe(0);
  });

  it('reports zero derived availability for empty and unusable definitions', async () => {
    expect((await getBundleAvailabilityForSkus(prisma, [owner.id])).get(owner.id)).toBe(0);
    await service.setComponents(owner.productId, owner.id, input(component.id));
    await prisma.sku.update({ where: { id: component.id }, data: { status: 'DISABLED' } });
    expect((await getBundleAvailabilityForSkus(prisma, [owner.id])).get(owner.id)).toBe(0);
  });
});
