import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest';
import { PrismaService } from '../../prisma/prisma.service.js';
import { BackInStockService } from '../newsletter/back-in-stock.service.js';
import { canonicalCombinationKey } from './catalog-graph.js';
import { CatalogGraphService } from './catalog-graph.service.js';
import { catalogGraphPatchSchema } from './dto/catalog-graph.dto.js';

const database = process.env.BUNDLE_TEST_DATABASE_URL;
if (database) {
  const url = new URL(database);
  if (
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    !/^small_house_bundle_20261016_[a-z0-9]+$/.test(url.pathname.slice(1))
  ) {
    throw new Error(
      'Bundle reference tests require the dedicated local Bundle test database.',
    );
  }
}

describe.skipIf(!database)('Bundle reference protection on PostgreSQL', () => {
  let prisma: PrismaService;
  let graph: CatalogGraphService;
  let backInStock: BackInStockService;
  let categoryId: string;
  let warehouseId: string;

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService({ database: { url: database } }),
    );
    await prisma.$connect();
    graph = new CatalogGraphService(prisma);
    backInStock = new BackInStockService(
      prisma,
      {
        sendWelcome: async () => undefined,
        sendBackInStock: async () => undefined,
      } as never,
      new ConfigService({
        jwt: { secret: 'r'.repeat(32) },
        email: { storefrontBaseUrl: 'https://luwag.test' },
      }),
    );
    const category = await prisma.category.create({
      data: { name: 'Bundle reference tests', slug: `bundle-reference-${randomUUID()}` },
    });
    categoryId = category.id;
    const warehouse =
      (await prisma.warehouse.findFirst({
        where: { status: 'ACTIVE' },
        orderBy: { createdAt: 'asc' },
      })) ??
      (await prisma.warehouse.create({ data: { name: 'Bundle reference warehouse' } }));
    warehouseId = warehouse.id;
  });

  async function cleanup() {
    const products = await prisma.product.findMany({
      where: { categoryId },
      select: { id: true, skus: { select: { id: true } } },
    });
    const productIds = products.map((product) => product.id);
    const skuIds = products.flatMap((product) => product.skus.map((sku) => sku.id));
    if (skuIds.length > 0) {
      await prisma.skuBundleComponent.deleteMany({
        where: {
          OR: [
            { bundleSkuId: { in: skuIds } },
            { componentSkuId: { in: skuIds } },
          ],
        },
      });
      await prisma.inventoryMovement.deleteMany({ where: { skuId: { in: skuIds } } });
      await prisma.inventory.deleteMany({ where: { skuId: { in: skuIds } } });
      await prisma.backInStockSubscription.deleteMany({ where: { skuId: { in: skuIds } } });
    }
    if (productIds.length > 0) {
      await prisma.product.updateMany({
        where: { id: { in: productIds } },
        data: { defaultDisplayVariantId: null },
      });
      await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    }
  }

  afterEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    if (!prisma) return;
    await cleanup();
    await prisma.category.delete({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  /**
   * A graph-shaped product (one Color option, Red and Blue variants) plus a
   * virtual Bundle whose definition references the Blue SKU.
   */
  async function createReferencedFixture() {
    const key = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const product = await prisma.product.create({
      data: {
        name: 'Referenced chair',
        slug: `bundle-reference-product-${key}`,
        categoryId,
        status: 'DRAFT',
        catalogGraphVersion: 1,
      },
    });
    const option = await prisma.productOption.create({
      data: {
        productId: product.id,
        kind: 'COLOR',
        name: 'Color',
        position: 0,
        presentation: 'SWATCH',
      },
    });
    const redValue = await prisma.productOptionValue.create({
      data: { productId: product.id, optionId: option.id, label: 'Red', position: 0 },
    });
    const blueValue = await prisma.productOptionValue.create({
      data: { productId: product.id, optionId: option.id, label: 'Blue', position: 1 },
    });
    const redVariant = await prisma.productVariant.create({
      data: {
        productId: product.id,
        name: 'Red',
        position: 0,
        combinationKey: canonicalCombinationKey([
          { optionId: option.id, valueId: redValue.id },
        ]),
      },
    });
    const blueVariant = await prisma.productVariant.create({
      data: {
        productId: product.id,
        name: 'Blue',
        position: 1,
        combinationKey: canonicalCombinationKey([
          { optionId: option.id, valueId: blueValue.id },
        ]),
      },
    });
    for (const [variant, value] of [
      [redVariant, redValue],
      [blueVariant, blueValue],
    ] as const) {
      await prisma.productVariantOptionValue.create({
        data: {
          variantId: variant.id,
          productId: product.id,
          optionId: option.id,
          optionValueId: value.id,
        },
      });
    }
    await prisma.product.update({
      where: { id: product.id },
      data: { defaultDisplayVariantId: redVariant.id },
    });

    const redSku = await prisma.sku.create({
      data: {
        productId: product.id,
        variantId: redVariant.id,
        skuCode: `REF-RED-${key}`,
        price: 250,
      },
    });
    const blueSku = await prisma.sku.create({
      data: {
        productId: product.id,
        variantId: blueVariant.id,
        skuCode: `REF-BLUE-${key}`,
        price: 250,
      },
    });
    await prisma.inventory.create({
      data: { skuId: redSku.id, warehouseId, onHand: 4 },
    });

    const bundleProduct = await prisma.product.create({
      data: {
        name: 'Reference bundle',
        slug: `bundle-reference-owner-${key}`,
        categoryId,
        status: 'DRAFT',
      },
    });
    const bundleVariant = await prisma.productVariant.create({
      data: {
        productId: bundleProduct.id,
        name: 'Default',
        position: 0,
        combinationKey: 'default',
      },
    });
    const bundleSku = await prisma.sku.create({
      data: {
        productId: bundleProduct.id,
        variantId: bundleVariant.id,
        skuCode: `REF-SET-${key}`,
        price: 449,
        isBundle: true,
      },
    });
    await prisma.skuBundleComponent.create({
      data: {
        bundleSkuId: bundleSku.id,
        componentSkuId: blueSku.id,
        quantity: 1,
        position: 0,
      },
    });

    return {
      productId: product.id,
      optionId: option.id,
      blueValueId: blueValue.id,
      redVariantId: redVariant.id,
      blueVariantId: blueVariant.id,
      redSkuId: redSku.id,
      blueSkuId: blueSku.id,
      bundleSkuId: bundleSku.id,
    };
  }

  it('reports a Bundle component reference in the SKU reference counts', async () => {
    const fixture = await createReferencedFixture();

    const snapshot = await graph.adminSnapshot(fixture.productId);
    expect(snapshot).not.toBeNull();
    const byVariant = new Map(
      snapshot!.variants.map((variant) => [variant.id, variant.sku]),
    );
    expect(byVariant.get(fixture.blueVariantId)!._count.componentOfBundles).toBe(1);
    expect(byVariant.get(fixture.redVariantId)!._count.componentOfBundles).toBe(0);
    // The owner side is a definition, not a reference: it must not block the
    // Bundle's own SKU from being replaced or removed.
    expect(byVariant.get(fixture.blueVariantId)!._count.orderItems).toBe(0);
  });

  it('disables the referenced variant instead of deleting it when the graph retires it', async () => {
    const fixture = await createReferencedFixture();

    const patch = catalogGraphPatchSchema.parse({
      retirements: { optionValueIds: [fixture.blueValueId] },
    });
    await graph.applyPatch(fixture.productId, 1, patch);

    const variant = await prisma.productVariant.findUnique({
      where: { id: fixture.blueVariantId },
      include: { sku: true },
    });
    expect(variant).not.toBeNull();
    expect(variant!.name).toBe('Blue');
    expect(variant!.sku!.status).toBe('DISABLED');
    // The Bundle keeps its component binding; availability fails closed
    // instead of the reference disappearing under it.
    expect(
      await prisma.skuBundleComponent.count({
        where: { componentSkuId: fixture.blueSkuId },
      }),
    ).toBe(1);
    expect(
      await prisma.productVariant.findUnique({ where: { id: fixture.redVariantId } }),
    ).not.toBeNull();
  });

  it('rejects direct deletion of a referenced component without mutating the binding', async () => {
    const fixture = await createReferencedFixture();

    await expect(prisma.sku.delete({ where: { id: fixture.blueSkuId } }))
      .rejects.toMatchObject({ code: 'P2003' });
    expect(await prisma.skuBundleComponent.count({
      where: { bundleSkuId: fixture.bundleSkuId, componentSkuId: fixture.blueSkuId },
    })).toBe(1);
  });

  it('cascades only the definition when an unreferenced Bundle owner is deleted', async () => {
    const fixture = await createReferencedFixture();

    await prisma.sku.delete({ where: { id: fixture.bundleSkuId } });

    expect(await prisma.skuBundleComponent.count({ where: { bundleSkuId: fixture.bundleSkuId } })).toBe(0);
    expect(await prisma.sku.findUnique({ where: { id: fixture.blueSkuId } })).not.toBeNull();
    expect(await prisma.sku.findUnique({ where: { id: fixture.redSkuId } })).not.toBeNull();
  });

  it('excludes a stray virtual inventory row from the stock-notification snapshot', async () => {
    const fixture = await createReferencedFixture();
    // Legacy or foreign data can leave a row on a virtual SKU; availability
    // is derived from the components, so notifications must ignore it.
    await prisma.inventory.create({
      data: { skuId: fixture.bundleSkuId, warehouseId, onHand: 9 },
    });

    const snapshot = await prisma.$transaction((tx) =>
      backInStock.snapshotForChangedSkusWithin(tx, [
        fixture.bundleSkuId,
        fixture.redSkuId,
      ]),
    );

    expect(snapshot.get(fixture.bundleSkuId)).toBe(0);
    expect(snapshot.get(fixture.redSkuId)).toBe(4);
  });
});
