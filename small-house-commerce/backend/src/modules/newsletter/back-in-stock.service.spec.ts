import { BadRequestException } from '@nestjs/common';
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
import { PrismaService } from '../../prisma/prisma.service.js';
import { BackInStockService } from './back-in-stock.service.js';
import { signBackInStockUnsubscribeToken } from './back-in-stock-token.js';

const database = process.env.NEWSLETTER_TEST_DATABASE_URL;
if (database) {
  const url = new URL(database);
  if (
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.pathname !== '/small_house_variant_test'
  ) {
    throw new Error(
      'Back-in-stock tests require the dedicated local variant test database.',
    );
  }
}

const SECRET = 'b'.repeat(32);
const PREFIX = 'back-in-stock-test-';

interface FixtureSku {
  productId: string;
  productName: string;
  productSlug: string;
  variantId: string;
  skuId: string;
  skuCode: string;
}

describe.skipIf(!database)('BackInStockService PostgreSQL behavior', () => {
  let prisma: PrismaService;
  let gateway: EmailGateway;
  let service: BackInStockService;
  let warehouseId: string;
  let categoryId: string;
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
    if (!warehouse) throw new Error('Back-in-stock tests need an active warehouse');
    warehouseId = warehouse.id;
  });

  async function cleanup() {
    await prisma.backInStockSubscription.deleteMany({
      where: { productSlug: { startsWith: PREFIX } },
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
        name: `Back in stock ${suffix}`,
        slug: `${PREFIX}category-${suffix}`,
      },
    });
    categoryId = category.id;
    gateway = {
      sendWelcome: vi.fn().mockResolvedValue(undefined),
      sendBackInStock: vi.fn().mockResolvedValue(undefined),
    };
    service = new BackInStockService(
      prisma,
      gateway,
      new ConfigService({
        jwt: { secret: SECRET },
        email: { storefrontBaseUrl: 'https://luwag.test' },
      }),
    );
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  async function createPhysicalSku(
    onHand = 0,
    reserved = 0,
    label = 'physical',
  ): Promise<FixtureSku> {
    const suffix = `${Date.now()}-${serial++}`;
    const productName = `Back in stock ${label} ${suffix}`;
    const productSlug = `${PREFIX}${label}-${suffix}`;
    const product = await prisma.product.create({
      data: {
        name: productName,
        slug: productSlug,
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
    const skuCode = `BIS-${label}-${suffix}`;
    const sku = await prisma.sku.create({
      data: {
        productId: product.id,
        variantId: variant.id,
        skuCode,
        price: 100,
      },
    });
    await prisma.inventory.create({
      data: {
        skuId: sku.id,
        warehouseId,
        onHand,
        reserved,
      },
    });
    return {
      productId: product.id,
      productName,
      productSlug,
      variantId: variant.id,
      skuId: sku.id,
      skuCode,
    };
  }

  async function createBundleSku(
    componentSkuId: string,
    quantity: number,
  ): Promise<FixtureSku> {
    const suffix = `${Date.now()}-${serial++}`;
    const productName = `Back in stock bundle ${suffix}`;
    const productSlug = `${PREFIX}bundle-${suffix}`;
    const product = await prisma.product.create({
      data: {
        name: productName,
        slug: productSlug,
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
    const skuCode = `BIS-bundle-${suffix}`;
    const sku = await prisma.sku.create({
      data: {
        productId: product.id,
        variantId: variant.id,
        skuCode,
        price: 200,
        isBundle: true,
        bundleComponents: {
          create: {
            componentSkuId,
            quantity,
            position: 0,
          },
        },
      },
    });
    return {
      productId: product.id,
      productName,
      productSlug,
      variantId: variant.id,
      skuId: sku.id,
      skuCode,
    };
  }

  it('normalizes and idempotently resets one OOS SKU subscription without joining the newsletter', async () => {
    const fixture = await createPhysicalSku(0);

    await service.subscribe({
      email: '  Shopper@Example.COM ',
      skuId: fixture.skuId,
    });
    const first = await prisma.backInStockSubscription.findUniqueOrThrow({
      where: {
        email_skuId: {
          email: 'shopper@example.com',
          skuId: fixture.skuId,
        },
      },
    });
    await prisma.backInStockSubscription.update({
      where: { id: first.id },
      data: {
        status: 'SENT',
        notifiedAt: new Date(),
        lastError: 'old error',
      },
    });

    await service.subscribe({
      email: 'SHOPPER@example.com',
      skuId: fixture.skuId,
    });

    await expect(
      prisma.backInStockSubscription.findMany({
        where: { skuId: fixture.skuId },
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: first.id,
        email: 'shopper@example.com',
        status: 'PENDING',
        productName: fixture.productName,
        productSlug: fixture.productSlug,
        notifiedAt: null,
        lastError: null,
      }),
    ]);
    await expect(
      prisma.newsletterSubscriber.findUnique({
        where: { email: 'shopper@example.com' },
      }),
    ).resolves.toBeNull();
  });

  it('rejects an SKU that is already available', async () => {
    const fixture = await createPhysicalSku(1);

    await expect(
      service.subscribe({ email: 'shopper@example.com', skuId: fixture.skuId }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      prisma.backInStockSubscription.count({
        where: { skuId: fixture.skuId },
      }),
    ).resolves.toBe(0);
  });

  it('claims both a restored component and its dependent virtual Bundle exactly once', async () => {
    const component = await createPhysicalSku(0, 0, 'component');
    const bundle = await createBundleSku(component.skuId, 2);
    for (const [email, fixture] of [
      ['component@example.com', component],
      ['bundle@example.com', bundle],
    ] as const) {
      await prisma.backInStockSubscription.create({
        data: {
          email,
          skuId: fixture.skuId,
          productName: fixture.productName,
          productSlug: fixture.productSlug,
        },
      });
    }

    const claims = await prisma.$transaction(async (tx) => {
      const before = await service.snapshotForChangedSkusWithin(tx, [
        component.skuId,
      ]);
      await tx.inventory.update({
        where: {
          skuId_warehouseId: {
            skuId: component.skuId,
            warehouseId,
          },
        },
        data: { onHand: 4 },
      });
      const after = await service.snapshotForChangedSkusWithin(tx, [
        component.skuId,
      ]);
      return service.claimTransitionsWithin(tx, before, after);
    });

    expect(new Set(claims.map((row) => row.skuId))).toEqual(
      new Set([component.skuId, bundle.skuId]),
    );
    await expect(
      prisma.backInStockSubscription.count({ where: { status: 'SENT' } }),
    ).resolves.toBe(2);
    await expect(
      prisma.$transaction(async (tx) =>
        service.claimTransitionsWithin(
          tx,
          new Map([
            [component.skuId, 1],
            [bundle.skuId, 1],
          ]),
          new Map([
            [component.skuId, 2],
            [bundle.skuId, 2],
          ]),
        ),
      ),
    ).resolves.toEqual([]);
  });

  it('records successful delivery and conditionally rolls a provider failure back to PENDING', async () => {
    const fixture = await createPhysicalSku(0);
    const row = await prisma.backInStockSubscription.create({
      data: {
        email: 'shopper@example.com',
        skuId: fixture.skuId,
        productName: fixture.productName,
        productSlug: fixture.productSlug,
        status: 'SENT',
      },
    });

    await service.deliverClaims([row]);
    expect(gateway.sendBackInStock).toHaveBeenCalledWith(
      'shopper@example.com',
      expect.objectContaining({
        productName: fixture.productName,
        productUrl: `https://luwag.test/products/${fixture.productSlug}`,
        unsubscribeUrl: expect.stringContaining(
          '/api/v1/storefront/back-in-stock/unsubscribe?token=',
        ),
      }),
    );
    await expect(
      prisma.backInStockSubscription.findUniqueOrThrow({ where: { id: row.id } }),
    ).resolves.toMatchObject({ status: 'SENT', lastError: null });
    expect(
      (
        await prisma.backInStockSubscription.findUniqueOrThrow({
          where: { id: row.id },
        })
      ).notifiedAt,
    ).not.toBeNull();

    await prisma.backInStockSubscription.update({
      where: { id: row.id },
      data: { status: 'SENT', notifiedAt: null },
    });
    vi.mocked(gateway.sendBackInStock).mockRejectedValueOnce(
      new Error('provider unavailable'),
    );
    await service.deliverClaims([row]);
    await expect(
      prisma.backInStockSubscription.findUniqueOrThrow({ where: { id: row.id } }),
    ).resolves.toMatchObject({
      status: 'PENDING',
      notifiedAt: null,
      lastError: 'provider unavailable',
    });
  });

  it('does not let a stale delivery overwrite a newer PENDING cycle', async () => {
    const fixture = await createPhysicalSku(0);
    const claim = await prisma.backInStockSubscription.create({
      data: {
        email: 'shopper@example.com',
        skuId: fixture.skuId,
        productName: fixture.productName,
        productSlug: fixture.productSlug,
        status: 'SENT',
      },
    });
    await prisma.backInStockSubscription.update({
      where: { id: claim.id },
      data: { status: 'PENDING', notifiedAt: null, lastError: null },
    });

    await service.deliverClaims([claim]);

    await expect(
      prisma.backInStockSubscription.findUniqueOrThrow({
        where: { id: claim.id },
      }),
    ).resolves.toMatchObject({ status: 'PENDING', notifiedAt: null });
  });

  it('lists rows with SKU context, resends PENDING, and cancels only through a valid token', async () => {
    const fixture = await createPhysicalSku(0);
    const pending = await prisma.backInStockSubscription.create({
      data: {
        email: 'shopper@example.com',
        skuId: fixture.skuId,
        productName: fixture.productName,
        productSlug: fixture.productSlug,
      },
    });

    const listed = await service.list({
      page: 1,
      pageSize: 20,
      status: 'PENDING',
    });
    expect(listed).toMatchObject({
      total: 1,
      items: [
        expect.objectContaining({
          id: pending.id,
          skuCode: fixture.skuCode,
          variantName: 'Default',
        }),
      ],
    });

    await expect(service.resend(pending.id)).resolves.toMatchObject({
      id: pending.id,
      status: 'SENT',
    });
    const token = signBackInStockUnsubscribeToken(pending.id, SECRET);
    await expect(service.cancelByToken(`${token}x`)).resolves.toBe(false);
    await expect(service.cancelByToken(token)).resolves.toBe(true);
    await expect(
      prisma.backInStockSubscription.findUniqueOrThrow({
        where: { id: pending.id },
      }),
    ).resolves.toMatchObject({ status: 'CANCELLED' });
  });

  it('serializes stock-first subscribe races so no PENDING row is stranded', async () => {
    const fixture = await createPhysicalSku(0);
    let releaseStock!: () => void;
    const stockCanCommit = new Promise<void>((resolve) => {
      releaseStock = resolve;
    });
    let stockLocked!: () => void;
    const lockTaken = new Promise<void>((resolve) => {
      stockLocked = resolve;
    });

    const stock = prisma.$transaction(async (tx) => {
      const before = await service.snapshotForChangedSkusWithin(tx, [
        fixture.skuId,
      ]);
      stockLocked();
      await stockCanCommit;
      await tx.inventory.update({
        where: {
          skuId_warehouseId: { skuId: fixture.skuId, warehouseId },
        },
        data: { onHand: 1 },
      });
      const after = await service.snapshotForChangedSkusWithin(tx, [
        fixture.skuId,
      ]);
      return service.claimTransitionsWithin(tx, before, after);
    });
    await lockTaken;
    const subscribe = service.subscribe({
      email: 'race@example.com',
      skuId: fixture.skuId,
    });
    releaseStock();

    await expect(stock).resolves.toEqual([]);
    await expect(subscribe).rejects.toThrow(/already in stock/i);
    await expect(
      prisma.backInStockSubscription.count({
        where: { email: 'race@example.com', skuId: fixture.skuId },
      }),
    ).resolves.toBe(0);
  });
});
