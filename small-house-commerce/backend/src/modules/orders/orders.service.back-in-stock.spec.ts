import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
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
import { CampaignLinksService } from '../marketing/campaign-links.service.js';
import { MarketingTouchService } from '../marketing/marketing-touch.service.js';
import { OptimizersService } from '../marketing/optimizers.service.js';
import { BackInStockService } from '../newsletter/back-in-stock.service.js';
import { PromotionService } from '../newsletter/promotion.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { CheckoutInput } from './dto/order.dto.js';
import { CustomerRiskService } from './customer-risk.service.js';
import { OrdersService } from './orders.service.js';

const database = process.env.NEWSLETTER_TEST_DATABASE_URL;
if (database) {
  const url = new URL(database);
  if (
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.pathname !== '/small_house_variant_test'
  ) {
    throw new Error(
      'Order back-in-stock tests require the dedicated local variant test database.',
    );
  }
}

const PREFIX = 'back-in-stock-order-';
const PHONE_PREFIX = '+63997';

describe.skipIf(!database)('OrdersService back-in-stock release', () => {
  let prisma: PrismaService;
  let inventory: InventoryService;
  let backInStock: BackInStockService;
  let orders: OrdersService;
  let gateway: EmailGateway;
  let categoryId: string;
  let warehouseId: string;
  let operatorId: string;
  let serial = 0;

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService({ database: { url: database } }),
    );
    await prisma.$connect();
    gateway = {
      sendWelcome: vi.fn().mockResolvedValue(undefined),
      sendBackInStock: vi.fn().mockResolvedValue(undefined),
    };
    backInStock = new BackInStockService(
      prisma,
      gateway,
      new ConfigService({
        jwt: { secret: 'o'.repeat(32) },
        email: { storefrontBaseUrl: 'https://luwag.test' },
      }),
    );
    inventory = new InventoryService(prisma, backInStock);
    const optimizers = new OptimizersService(prisma);
    const marketingTouch = new MarketingTouchService(
      prisma,
      new CampaignLinksService(prisma, optimizers),
      optimizers,
      new ConfigService({
        jwt: { secret: 'order-stock-only-test-secret-32ch' },
      }),
    );
    orders = new OrdersService(
      prisma,
      inventory,
      new CustomerRiskService(prisma),
      marketingTouch,
      new PromotionService(prisma),
      backInStock,
    );

    const category = await prisma.category.create({
      data: {
        name: 'Order stock notification tests',
        slug: `${PREFIX}category-${randomUUID()}`,
      },
    });
    categoryId = category.id;
    const warehouse =
      (await prisma.warehouse.findFirst({
        where: { status: 'ACTIVE' },
        orderBy: { createdAt: 'asc' },
      })) ??
      (await prisma.warehouse.create({
        data: { name: 'Order stock notification warehouse' },
      }));
    warehouseId = warehouse.id;
    const operator = await prisma.user.create({
      data: {
        name: 'Order stock notification operator',
        email: `${PREFIX}${randomUUID()}@local.test`,
        passwordHash: 'not-a-login',
      },
    });
    operatorId = operator.id;
  });

  async function cleanup() {
    const products = await prisma.product.findMany({
      where: { categoryId },
      select: { id: true, skus: { select: { id: true } } },
    });
    const skuIds = products.flatMap((product) =>
      product.skus.map((sku) => sku.id),
    );
    const createdOrders = await prisma.order.findMany({
      where: {
        customer: { normalizedPhone: { startsWith: PHONE_PREFIX } },
      },
      select: { id: true },
    });
    const orderIds = createdOrders.map((order) => order.id);

    if (orderIds.length > 0) {
      await prisma.orderMergeRecord.deleteMany({
        where: {
          OR: [
            { primaryOrderId: { in: orderIds } },
            { mergedOrderId: { in: orderIds } },
          ],
        },
      });
      await prisma.inventoryReservation.deleteMany({
        where: { orderId: { in: orderIds } },
      });
      await prisma.inventoryMovement.deleteMany({
        where: { referenceId: { in: orderIds } },
      });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    await prisma.customer.deleteMany({
      where: { normalizedPhone: { startsWith: PHONE_PREFIX } },
    });
    if (skuIds.length > 0) {
      await prisma.backInStockSubscription.deleteMany({
        where: { skuId: { in: skuIds } },
      });
      await prisma.inventoryMovement.deleteMany({
        where: { skuId: { in: skuIds } },
      });
      await prisma.inventory.deleteMany({ where: { skuId: { in: skuIds } } });
      await prisma.skuBundleComponent.deleteMany({
        where: {
          OR: [
            { bundleSkuId: { in: skuIds } },
            { componentSkuId: { in: skuIds } },
          ],
        },
      });
    }
    await prisma.product.deleteMany({ where: { categoryId } });
  }

  beforeEach(async () => {
    await cleanup();
    vi.mocked(gateway.sendBackInStock).mockReset();
    vi.mocked(gateway.sendBackInStock).mockResolvedValue(undefined);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanup();
  });

  afterAll(async () => {
    if (!prisma) return;
    await cleanup();
    await prisma.category.delete({ where: { id: categoryId } });
    await prisma.user.delete({ where: { id: operatorId } });
    await prisma.$disconnect();
  });

  async function createSku(label: string, onHand: number, isBundle = false) {
    const key = `${Date.now()}-${serial++}-${randomUUID().slice(0, 8)}`;
    const product = await prisma.product.create({
      data: {
        name: `${label} ${key}`,
        slug: `${PREFIX}${label}-${key}`,
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
        skuCode: `BISO-${label}-${key}`,
        price: 250,
        isBundle,
      },
    });
    if (!isBundle) {
      await prisma.inventory.create({
        data: { skuId: sku.id, warehouseId, onHand },
      });
    }
    return { product, variant, sku };
  }

  function checkoutInput(skuId: string, quantity = 1): CheckoutInput {
    const phone = `${PHONE_PREFIX}${String(
      (Date.now() % 9_000_000) + serial++,
    )
      .padStart(7, '0')
      .slice(-7)}`;
    return {
      customer: {
        name: 'Order stock shopper',
        phone,
        province: 'Metro Manila',
        city: 'Quezon City',
        streetAddress: '1 Notification St',
      },
      items: [{ skuId, quantity }],
      attribution: { sourceType: 'ORGANIC' },
      customerNote: null,
      promoCode: null,
    };
  }

  async function checkout(skuId: string, quantity = 1) {
    const result = await orders.checkout(checkoutInput(skuId, quantity));
    return prisma.order.findUniqueOrThrow({
      where: { orderNumber: result.orderNumber },
      include: { items: true },
    });
  }

  async function subscribe(skuId: string, email: string) {
    await backInStock.subscribe({ email, skuId });
  }

  it('delivers only after a cancellation and its reservation commit', async () => {
    const fixture = await createSku('cancel', 1);
    const order = await checkout(fixture.sku.id);
    await subscribe(fixture.sku.id, 'cancelled@example.com');
    let observedCommittedRelease = false;
    vi.mocked(gateway.sendBackInStock).mockImplementationOnce(async () => {
      const [storedOrder, reservation] = await Promise.all([
        prisma.order.findUniqueOrThrow({ where: { id: order.id } }),
        prisma.inventoryReservation.findFirstOrThrow({
          where: { orderId: order.id },
        }),
      ]);
      observedCommittedRelease =
        storedOrder.orderStatus === 'CANCELLED' &&
        reservation.status === 'RELEASED';
    });

    await orders.cancel(order.id, operatorId);

    expect(observedCommittedRelease).toBe(true);
    expect(gateway.sendBackInStock).toHaveBeenCalledTimes(1);
    await expect(
      prisma.backInStockSubscription.findUniqueOrThrow({
        where: {
          email_skuId: {
            email: 'cancelled@example.com',
            skuId: fixture.sku.id,
          },
        },
      }),
    ).resolves.toMatchObject({ status: 'SENT', notifiedAt: expect.any(Date) });
  });

  it('notifies when DENIED releases the final reservation', async () => {
    const fixture = await createSku('denied', 1);
    const order = await checkout(fixture.sku.id);
    await subscribe(fixture.sku.id, 'denied@example.com');

    await orders.updateStatus(
      order.id,
      'DENIED',
      'Customer refused confirmation',
      operatorId,
    );

    expect(gateway.sendBackInStock).toHaveBeenCalledTimes(1);
    await expect(
      prisma.backInStockSubscription.findFirstOrThrow({
        where: { skuId: fixture.sku.id },
      }),
    ).resolves.toMatchObject({ status: 'SENT', notifiedAt: expect.any(Date) });
  });

  it('does not notify a dependent Bundle that remains unavailable', async () => {
    const component = await createSku('component-ready', 1);
    const missing = await createSku('component-missing', 0);
    const bundle = await createSku('bundle-still-oos', 0, true);
    await prisma.skuBundleComponent.createMany({
      data: [
        {
          bundleSkuId: bundle.sku.id,
          componentSkuId: component.sku.id,
          quantity: 1,
          position: 0,
        },
        {
          bundleSkuId: bundle.sku.id,
          componentSkuId: missing.sku.id,
          quantity: 1,
          position: 1,
        },
      ],
    });
    const order = await checkout(component.sku.id);
    await subscribe(bundle.sku.id, 'bundle-still-oos@example.com');

    await orders.cancel(order.id, operatorId);

    expect(gateway.sendBackInStock).not.toHaveBeenCalled();
    await expect(
      prisma.backInStockSubscription.findFirstOrThrow({
        where: { skuId: bundle.sku.id },
      }),
    ).resolves.toMatchObject({ status: 'PENDING', notifiedAt: null });
  });

  it('does not duplicate delivery when a terminal cancellation is repeated', async () => {
    const fixture = await createSku('repeat-cancel', 1);
    const order = await checkout(fixture.sku.id);
    await subscribe(fixture.sku.id, 'repeat-cancel@example.com');

    await orders.cancel(order.id, operatorId);
    await expect(orders.cancel(order.id, operatorId)).rejects.toThrow(
      /cannot be cancelled/i,
    );

    expect(gateway.sendBackInStock).toHaveBeenCalledTimes(1);
  });

  it('rejects the dedicated cancel path after shipping without delivery', async () => {
    const fixture = await createSku('shipping', 1);
    const order = await checkout(fixture.sku.id);
    await subscribe(fixture.sku.id, 'shipping@example.com');
    await prisma.order.update({
      where: { id: order.id },
      data: { orderStatus: 'SHIPPING' },
    });

    await expect(orders.cancel(order.id, operatorId)).rejects.toThrow(
      /shipped orders cannot be cancelled/i,
    );

    expect(gateway.sendBackInStock).not.toHaveBeenCalled();
  });

  it('does not claim during an edit release and re-reserve cycle', async () => {
    const fixture = await createSku('edit', 1);
    const order = await checkout(fixture.sku.id);
    await subscribe(fixture.sku.id, 'edit@example.com');

    await orders.edit(
      order.id,
      {
        items: [
          {
            orderItemId: order.items[0]!.id,
            skuId: fixture.sku.id,
            quantity: 1,
          },
        ],
      },
      operatorId,
    );

    expect(gateway.sendBackInStock).not.toHaveBeenCalled();
    await expect(
      prisma.backInStockSubscription.findFirstOrThrow({
        where: { skuId: fixture.sku.id },
      }),
    ).resolves.toMatchObject({ status: 'PENDING', notifiedAt: null });
  });

  it('rolls back a claimed release and never delivers when the order transaction fails', async () => {
    const fixture = await createSku('rollback', 1);
    const order = await checkout(fixture.sku.id);
    await subscribe(fixture.sku.id, 'rollback@example.com');
    const release = inventory.releaseForOrder.bind(inventory);
    vi.spyOn(inventory, 'releaseForOrder').mockImplementationOnce(
      async (...args) => {
        await release(...args);
        throw new Error('forced rollback after release');
      },
    );

    await expect(orders.cancel(order.id, operatorId)).rejects.toThrow(
      'forced rollback after release',
    );

    expect(gateway.sendBackInStock).not.toHaveBeenCalled();
    await expect(
      prisma.backInStockSubscription.findFirstOrThrow({
        where: { skuId: fixture.sku.id },
      }),
    ).resolves.toMatchObject({ status: 'PENDING', notifiedAt: null });
    await expect(
      prisma.order.findUniqueOrThrow({ where: { id: order.id } }),
    ).resolves.toMatchObject({ orderStatus: 'NEW' });
    await expect(
      prisma.inventoryReservation.findFirstOrThrow({
        where: { orderId: order.id },
      }),
    ).resolves.toMatchObject({ status: 'ACTIVE' });
  });

  it('does not deliver when a terminal order has no active reservation', async () => {
    const fixture = await createSku('no-reservation', 1);
    const order = await checkout(fixture.sku.id);
    await prisma.$transaction(async (tx) => {
      await tx.inventory.update({
        where: {
          skuId_warehouseId: { skuId: fixture.sku.id, warehouseId },
        },
        data: { reserved: 0, onHand: 0 },
      });
      await tx.inventoryReservation.updateMany({
        where: { orderId: order.id },
        data: { status: 'RELEASED' },
      });
    });
    await subscribe(fixture.sku.id, 'no-reservation@example.com');

    await orders.cancel(order.id, operatorId);

    expect(gateway.sendBackInStock).not.toHaveBeenCalled();
    await expect(
      prisma.backInStockSubscription.findFirstOrThrow({
        where: { skuId: fixture.sku.id },
      }),
    ).resolves.toMatchObject({ status: 'PENDING', notifiedAt: null });
  });
});
