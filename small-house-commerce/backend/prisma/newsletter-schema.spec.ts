import { ConfigService } from '@nestjs/config';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';

const database = process.env.NEWSLETTER_TEST_DATABASE_URL;
if (database) {
  const url = new URL(database);
  if (
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.pathname !== '/small_house_variant_test'
  ) {
    throw new Error(
      'Newsletter schema tests require the dedicated local variant test database.',
    );
  }
}

describe.skipIf(!database)('newsletter schema invariants', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService({ database: { url: database } }),
    );
    await prisma.$connect();
  });

  async function cleanup() {
    await prisma.backInStockSubscription.deleteMany();
    await prisma.promoCodeRedemption.deleteMany();
    await prisma.newsletterPromotion.deleteMany();
    await prisma.newsletterSubscriber.deleteMany();
    await prisma.product.deleteMany({
      where: { slug: { startsWith: 'back-in-stock-schema-' } },
    });
    await prisma.category.deleteMany({
      where: { slug: { startsWith: 'back-in-stock-schema-' } },
    });
    await prisma.siteSetting.deleteMany({
      where: { id: '00000000-0000-0000-0000-000000000099' },
    });
  }

  beforeEach(cleanup);
  afterEach(cleanup);

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  it('rejects a second ACTIVE promotion at the database level', async () => {
    await prisma.newsletterPromotion.create({
      data: {
        code: 'FIRST',
        discountType: 'PERCENT',
        discountValue: 10,
        status: 'ACTIVE',
      },
    });

    await expect(
      prisma.newsletterPromotion.create({
        data: {
          code: 'SECOND',
          discountType: 'PERCENT',
          discountValue: 5,
          status: 'ACTIVE',
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects duplicate email and SKU subscriptions and cascades with the SKU', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const category = await prisma.category.create({
      data: {
        name: `Back in stock schema ${suffix}`,
        slug: `back-in-stock-schema-category-${suffix}`,
      },
    });
    const product = await prisma.product.create({
      data: {
        name: `Back in stock schema ${suffix}`,
        slug: `back-in-stock-schema-product-${suffix}`,
        categoryId: category.id,
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
        skuCode: `BIS-${suffix}`,
      },
    });

    await prisma.backInStockSubscription.create({
      data: {
        email: 'shopper@example.com',
        skuId: sku.id,
        productName: product.name,
        productSlug: product.slug,
      },
    });

    await expect(
      prisma.backInStockSubscription.create({
        data: {
          email: 'shopper@example.com',
          skuId: sku.id,
          productName: product.name,
          productSlug: product.slug,
        },
      }),
    ).rejects.toThrow();

    await prisma.sku.delete({ where: { id: sku.id } });
    await expect(
      prisma.backInStockSubscription.count({ where: { skuId: sku.id } }),
    ).resolves.toBe(0);
  });

  it('defaults the support phone to hidden', async () => {
    const settings = await prisma.siteSetting.create({
      data: { id: '00000000-0000-0000-0000-000000000099' },
    });

    expect(settings.supportPhone).toBe('');
  });
});
