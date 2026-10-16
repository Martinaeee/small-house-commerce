import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CatalogGraphService } from './catalog-graph.service.js';
import { catalogGraphPatchSchema } from './dto/catalog-graph.dto.js';
import { ProductsService } from './products.service.js';

const database = process.env.BUNDLE_TEST_DATABASE_URL;
if (database) {
  const url = new URL(database);
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || !/^small_house_bundle_20261016_cspec[a-z0-9]+$/.test(url.pathname.slice(1))) {
    throw new Error('Bundle specification tests require their own local cspec database.');
  }
}

describe.skipIf(!database)('Bundle public specifications on PostgreSQL', () => {
  let prisma: PrismaService;
  let products: ProductsService;
  let categoryId: string;
  let customerId: string;
  let chair: Awaited<ReturnType<typeof createProduct>>;
  let table: Awaited<ReturnType<typeof createProduct>>;
  let bundle: Awaited<ReturnType<typeof createProduct>>;
  let orderId: string;

  async function createProduct(name: string, isBundle = false) {
    const product = await prisma.product.create({ data: {
      name, slug: `cspec-public-${randomUUID()}`, categoryId, status: 'ACTIVE', catalogGraphVersion: 1,
      width: isBundle ? 999 : 40, depth: 50, height: 80, materials: 'Wood',
    } });
    const variant = await prisma.productVariant.create({ data: {
      productId: product.id, name: 'Oak', combinationKey: '', position: 0,
      cardMedia: { cover: { type: 'IMAGE', url: '/uploads/cspec-public-cover.webp', altText: null }, hover: null },
    } });
    const sku = await prisma.sku.create({ data: {
      productId: product.id, variantId: variant.id, skuCode: `CSPUBLIC-${randomUUID()}`, price: 2499, isBundle,
      productWidth: isBundle ? 999 : 45, productHeight: 0,
    } });
    return { product, variant, sku };
  }

  beforeAll(async () => {
    prisma = new PrismaService(new ConfigService({ database: { url: database } }));
    await prisma.$connect();
    categoryId = (await prisma.category.create({ data: { name: 'Bundle public specifications', slug: `cspec-public-${randomUUID()}` } })).id;
    products = new ProductsService(prisma, { storefrontForProduct: async () => ({}) } as never, {} as never);
    chair = await createProduct('Chair');
    table = await createProduct('Table');
    bundle = await createProduct('Dining set', true);
    await prisma.skuBundleComponent.createMany({ data: [
      { bundleSkuId: bundle.sku.id, componentSkuId: table.sku.id, quantity: 1, position: 0 },
      { bundleSkuId: bundle.sku.id, componentSkuId: chair.sku.id, quantity: 4, position: 1 },
    ] });
    customerId = (await prisma.customer.create({ data: { normalizedPhone: `cspec-${randomUUID()}`, name: 'Local specification fixture' } })).id;
    orderId = (await prisma.order.create({ data: {
      orderNumber: `CSPUBLIC-${randomUUID()}`, customerId, subtotal: 2499, discountTotal: 0, shippingTotal: 0, grandTotal: 2499,
      items: { create: { productId: bundle.product.id, variantId: bundle.variant.id, skuId: bundle.sku.id,
        productNameSnapshot: 'Dining set', skuCodeSnapshot: bundle.sku.skuCode, variantSnapshot: 'Oak',
        quantity: 1, unitPrice: 2499, unitDiscount: 0, lineTotal: 2499,
        bundleSnapshot: { version: 1, bundleSkuId: bundle.sku.id, components: [{ componentSkuId: chair.sku.id, quantity: 4, totalQuantity: 4 }] },
      } },
    } })).id;
  });
  afterAll(async () => {
    if (!prisma) return;
    if (orderId) await prisma.order.delete({ where: { id: orderId } });
    if (customerId) await prisma.customer.delete({ where: { id: customerId } });
    const ids = (await prisma.product.findMany({ where: { categoryId }, select: { id: true } })).map(row => row.id);
    await prisma.skuBundleComponent.deleteMany({ where: { bundleSku: { productId: { in: ids } } } });
    await prisma.product.deleteMany({ where: { id: { in: ids } } });
    await prisma.category.delete({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it('returns component specifications even when all sellable inventory is zero', async () => {
    const result = await products.storefrontGetBySlug(bundle.product.slug);
    expect(result.variants[0].sku).toMatchObject({ availableInventory: 0, specificationSource: 'BUNDLE_COMPONENTS', bundleComponents: [
      { productName: 'Table', quantity: 1, width: 45, depth: 50, height: 0 },
      { productName: 'Chair', quantity: 4, width: 45, depth: 50, height: 0 },
    ] });
    expect(await prisma.inventory.count({ where: { skuId: bundle.sku.id } })).toBe(0);
  });

  it('reads updated component dimensions after a graph save without touching order totals or snapshots', async () => {
    const before = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
    await new CatalogGraphService(prisma).applyPatch(chair.product.id, 1, catalogGraphPatchSchema.parse({ variants: [{
      id: chair.variant.id, position: 0, optionValueRefs: [], sku: { skuCode: chair.sku.skuCode, status: 'ACTIVE', productWidth: 47 },
    }] }));
    const result = await products.storefrontGetBySlug(bundle.product.slug);
    expect(result.variants[0].sku).toHaveProperty('bundleComponents.1.width', 47);
    expect(result.variants[0].sku).toHaveProperty('bundleComponents.0.width', 45);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } })).toEqual(before);
  });

  it('hides all components if one product becomes unpublished, then restores the live public projection', async () => {
    const before = (await products.storefrontGetBySlug(bundle.product.slug)).variants[0].sku;
    await prisma.product.update({ where: { id: table.product.id }, data: { status: 'DRAFT' } });
    expect((await products.storefrontGetBySlug(bundle.product.slug)).variants[0].sku)
      .toMatchObject({ specificationSource: 'BUNDLE_COMPONENTS', bundleComponents: [] });
    await prisma.product.update({ where: { id: table.product.id }, data: { status: 'ACTIVE' } });
    expect((await products.storefrontGetBySlug(bundle.product.slug)).variants[0].sku).toEqual(before);
  });
});
