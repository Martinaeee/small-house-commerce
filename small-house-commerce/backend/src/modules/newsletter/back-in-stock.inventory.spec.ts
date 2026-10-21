import { ConfigService } from '@nestjs/config';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { EmailGateway } from '../email/email.gateway.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { BackInStockService } from './back-in-stock.service.js';

const database = process.env.NEWSLETTER_TEST_DATABASE_URL;
if (database) {
  const url = new URL(database);
  if (
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.pathname !== '/small_house_variant_test'
  ) {
    throw new Error(
      'Back-in-stock inventory tests require the dedicated local variant test database.',
    );
  }
}

const PREFIX = 'back-in-stock-inventory-';

describe.skipIf(!database)('InventoryService back-in-stock transitions', () => {
  let prisma: PrismaService;
  let gateway: EmailGateway;
  let inventory: InventoryService;
  let categoryId: string;
  let warehouseId: string;
  let serial = 0;

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService({ database: { url: database } }),
    );
    await prisma.$connect();
    const warehouse = await prisma.warehouse.findFirst({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });
    if (!warehouse) throw new Error('An active warehouse is required');
    warehouseId = warehouse.id;
  });

  async function cleanup() {
    await prisma.backInStockSubscription.deleteMany({
      where: { productSlug: { startsWith: PREFIX } },
    });
    await prisma.inventoryMovement.deleteMany({
      where: { sku: { product: { slug: { startsWith: PREFIX } } } },
    });
    await prisma.skuBundleComponent.deleteMany({
      where: {
        OR: [
          { bundleSku: { product: { slug: { startsWith: PREFIX } } } },
          { componentSku: { product: { slug: { startsWith: PREFIX } } } },
        ],
      },
    });
    await prisma.product.deleteMany({
      where: { slug: { startsWith: PREFIX } },
    });
    await prisma.category.deleteMany({
      where: { slug: { startsWith: PREFIX } },
    });
  }

  beforeEach(async () => {
    await cleanup();
    const suffix = `${Date.now()}-${serial++}`;
    const category = await prisma.category.create({
      data: {
        name: `Inventory notification ${suffix}`,
        slug: `${PREFIX}category-${suffix}`,
      },
    });
    categoryId = category.id;
    gateway = {
      sendWelcome: vi.fn().mockResolvedValue(undefined),
      sendBackInStock: vi.fn().mockResolvedValue(undefined),
    };
    const backInStock = new BackInStockService(
      prisma,
      gateway,
      new ConfigService({
        jwt: { secret: 'i'.repeat(32) },
        email: { storefrontBaseUrl: 'https://luwag.test' },
      }),
    );
    inventory = new InventoryService(prisma, backInStock);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  async function createSku(label: string, isBundle = false) {
    const suffix = `${Date.now()}-${serial++}`;
    const product = await prisma.product.create({
      data: {
        name: `${label} ${suffix}`,
        slug: `${PREFIX}${label}-${suffix}`,
        categoryId,
        status: 'ACTIVE',
      },
    });
    const variant = await prisma.productVariant.create({
      data: {
        productId: product.id,
        name: 'Default',
        combinationKey: 'default',
      },
    });
    const sku = await prisma.sku.create({
      data: {
        productId: product.id,
        variantId: variant.id,
        skuCode: `BISI-${label}-${suffix}`,
        price: 100,
        isBundle,
      },
    });
    return { product, variant, sku };
  }

  it('commits component stock and claims direct plus Bundle subscriptions once', async () => {
    const component = await createSku('component');
    await prisma.inventory.create({
      data: {
        skuId: component.sku.id,
        warehouseId,
        onHand: 0,
        reserved: 0,
      },
    });
    const bundle = await createSku('bundle', true);
    await prisma.skuBundleComponent.create({
      data: {
        bundleSkuId: bundle.sku.id,
        componentSkuId: component.sku.id,
        quantity: 2,
        position: 0,
      },
    });
    for (const [email, row] of [
      ['component@example.com', component],
      ['bundle@example.com', bundle],
    ] as const) {
      await prisma.backInStockSubscription.create({
        data: {
          email,
          skuId: row.sku.id,
          productName: row.product.name,
          productSlug: row.product.slug,
        },
      });
    }

    await expect(
      inventory.adjust(component.sku.id, 4, 'restock', undefined),
    ).resolves.toMatchObject({ onHand: 4, reserved: 0, available: 4 });

    expect(gateway.sendBackInStock).toHaveBeenCalledTimes(2);
    await expect(
      prisma.backInStockSubscription.count({
        where: { status: 'SENT', notifiedAt: { not: null } },
      }),
    ).resolves.toBe(2);
    await expect(
      prisma.inventoryMovement.findFirst({
        where: {
          skuId: component.sku.id,
          movementType: 'MANUAL_ADJUSTMENT',
          quantity: 4,
        },
      }),
    ).resolves.not.toBeNull();

    await inventory.adjust(component.sku.id, 1, 'more stock', undefined);
    expect(gateway.sendBackInStock).toHaveBeenCalledTimes(2);
  });
});
