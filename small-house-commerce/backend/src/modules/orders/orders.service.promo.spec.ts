import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../prisma/prisma.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { CustomerRiskService } from './customer-risk.service.js';
import { OrdersService } from './orders.service.js';
import { PromotionService } from '../newsletter/promotion.service.js';
import type { CheckoutInput } from './dto/order.dto.js';

const database = process.env.NEWSLETTER_TEST_DATABASE_URL;
if (database) {
  const url = new URL(database);
  if (
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.pathname !== '/small_house_variant_test'
  ) {
    throw new Error(
      'Promo checkout tests require the dedicated local variant test database.',
    );
  }
}

describe.skipIf(!database)('OrdersService promo checkout', () => {
  let prisma: PrismaService;
  let orders: OrdersService;
  let promotions: PromotionService;
  let inventory: InventoryService;
  let skuId: string;
  let categoryId: string;
  let warehouseId: string;
  let operatorId: string;
  let serial = 0;

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService({ database: { url: database } }),
    );
    await prisma.$connect();
    const backInStock = {
      snapshotForChangedSkusWithin: vi.fn(async () => new Map<string, number>()),
      claimTransitionsWithin: vi.fn(async () => []),
      deliverClaims: vi.fn(async () => undefined),
    };
    inventory = new InventoryService(prisma, backInStock as never);
    promotions = new PromotionService(prisma);
    orders = new OrdersService(
      prisma,
      inventory,
      new CustomerRiskService(prisma),
      { resolve: async () => null } as never,
      promotions,
      backInStock as never,
    );

    const category = await prisma.category.create({
      data: { name: 'Promo test', slug: `promo-test-${randomUUID()}` },
    });
    categoryId = category.id;
    const warehouse =
      (await prisma.warehouse.findFirst({
        where: { status: 'ACTIVE' },
        orderBy: { createdAt: 'asc' },
      })) ?? (await prisma.warehouse.create({ data: { name: 'Promo test warehouse' } }));
    warehouseId = warehouse.id;

    const product = await prisma.product.create({
      data: {
        name: 'Promo chair',
        slug: `promo-chair-${randomUUID()}`,
        categoryId,
        status: 'ACTIVE',
      },
    });
    const variant = await prisma.productVariant.create({
      data: { productId: product.id, name: 'Default', combinationKey: 'default' },
    });
    const sku = await prisma.sku.create({
      data: {
        productId: product.id,
        variantId: variant.id,
        skuCode: `PROMO-${randomUUID()}`,
        price: 250,
      },
    });
    skuId = sku.id;
    await prisma.inventory.create({
      data: { skuId, warehouseId, onHand: 100 },
    });

    const operator = await prisma.user.create({
      data: {
        name: 'Promo test operator',
        email: `promo-operator-${randomUUID()}@local.test`,
        passwordHash: 'not-a-login',
      },
    });
    operatorId = operator.id;
  });

  beforeEach(async () => {
    await prisma.promoCodeRedemption.deleteMany();
    await prisma.newsletterPromotion.deleteMany();
  });

  afterAll(async () => {
    if (!prisma) return;
    const phoneFilter = { normalizedPhone: { startsWith: '+63999' } };
    const created = await prisma.order.findMany({
      where: { customer: phoneFilter },
      select: { id: true },
    });
    const orderIds = created.map((row) => row.id);

    await prisma.promoCodeRedemption.deleteMany();
    await prisma.newsletterPromotion.deleteMany();
    if (orderIds.length > 0) {
      await prisma.orderMergeRecord.deleteMany({
        where: {
          OR: [
            { primaryOrderId: { in: orderIds } },
            { mergedOrderId: { in: orderIds } },
          ],
        },
      });
      // Inventory rows reference the order; they must go before it.
      await prisma.inventoryReservation.deleteMany({
        where: { orderId: { in: orderIds } },
      });
      await prisma.inventoryMovement.deleteMany({
        where: { referenceId: { in: orderIds } },
      });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    await prisma.customer.deleteMany({ where: phoneFilter });
    await prisma.inventory.deleteMany({ where: { skuId } });
    await prisma.sku.deleteMany({ where: { id: skuId } });
    await prisma.product.deleteMany({ where: { categoryId } });
    await prisma.category.delete({ where: { id: categoryId } });
    if (operatorId) await prisma.user.delete({ where: { id: operatorId } });
    await prisma.$disconnect();
  });

  const input = (promoCode: string | null = null): CheckoutInput => ({
    customer: {
      name: 'Promo shopper',
      // +63 9 99 XXXXXXX — 12 digits, valid PH mobile shape, distinctive
      // prefix so cleanup can find only this spec's rows.
      phone: `+63999${String((Date.now() % 9_000_000) + serial++)
        .padStart(7, '0')
        .slice(-7)}`,
      province: 'Metro Manila',
      city: 'Quezon City',
      streetAddress: '1 Promo St',
    },
    items: [{ skuId, quantity: 1 }],
    attribution: { sourceType: 'ORGANIC' },
    customerNote: null,
    promoCode,
  });

  const livePromotion = (overrides: Record<string, unknown> = {}) =>
    promotions.create({
      code: 'WELCOME10',
      discountType: 'PERCENT',
      discountValue: 10,
      minSpend: 0,
      maxUses: null,
      perCustomerLimit: null,
      validFrom: null,
      validUntil: null,
      ...overrides,
    } as never);

  it('applies no discount when no code is sent (regression)', async () => {
    const result = await orders.checkout(input());
    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: result.orderNumber },
    });

    expect(Number(order.discountTotal)).toBe(0);
    expect(order.promoCode).toBeNull();
    expect(Number(order.grandTotal)).toBe(250);
    expect(await prisma.promoCodeRedemption.count()).toBe(0);
  });

  it('applies a percentage discount and records the redemption', async () => {
    const promotion = await livePromotion();
    const result = await orders.checkout(input('welcome10'));
    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: result.orderNumber },
      include: { payments: true },
    });

    expect(Number(order.discountTotal)).toBe(25);
    expect(Number(order.grandTotal)).toBe(225);
    expect(order.promoCode).toBe('WELCOME10');
    expect(Number(order.payments[0].amount)).toBe(225);
    expect(await prisma.promoCodeRedemption.count({ where: { promotionId: promotion.id } })).toBe(1);
  });

  it('clamps a fixed discount larger than the subtotal', async () => {
    await livePromotion({ discountType: 'FIXED', discountValue: 999 });
    const result = await orders.checkout(input('WELCOME10'));
    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: result.orderNumber },
    });

    expect(Number(order.discountTotal)).toBe(250);
    expect(Number(order.grandTotal)).toBe(0);
  });

  it('rejects an unknown or archived code with a readable message', async () => {
    await expect(orders.checkout(input('NOPE'))).rejects.toThrow(
      /isn't valid/,
    );
  });

  it('rejects a code below its minimum spend', async () => {
    await livePromotion({ minSpend: 500 });
    await expect(orders.checkout(input('WELCOME10'))).rejects.toThrow(
      /minimum order/,
    );
    expect(await prisma.promoCodeRedemption.count()).toBe(0);
  });

  it('rejects when the total usage limit is reached', async () => {
    await livePromotion({ maxUses: 1 });
    await orders.checkout(input('WELCOME10'));
    await expect(orders.checkout(input('WELCOME10'))).rejects.toThrow(
      /usage limit/,
    );
    expect(await prisma.promoCodeRedemption.count()).toBe(1);
  });

  it('rejects a repeat use by the same normalized phone', async () => {
    await livePromotion({ perCustomerLimit: 1 });
    const first = input('WELCOME10');
    await orders.checkout(first);
    await expect(
      orders.checkout({ ...first, promoCode: 'WELCOME10' }),
    ).rejects.toThrow(/already used/);
  });

  it('lets exactly one of two concurrent checkouts claim the last slot', async () => {
    await livePromotion({ maxUses: 1 });

    const results = await Promise.allSettled([
      orders.checkout(input('WELCOME10')),
      orders.checkout(input('WELCOME10')),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String((rejected[0] as PromiseRejectedResult).reason)).toMatch(
      /usage limit/,
    );
    expect(await prisma.promoCodeRedemption.count()).toBe(1);
  });

  it('does not consume a slot when the checkout fails', async () => {
    const promotion = await livePromotion();
    await expect(
      orders.checkout({ ...input('WELCOME10'), items: [{ skuId, quantity: 99 }] }),
    ).rejects.toThrow();

    expect(
      await prisma.promoCodeRedemption.count({ where: { promotionId: promotion.id } }),
    ).toBe(0);
    await expect(promotions.usage(promotion.id)).resolves.toMatchObject({
      effective: 0,
    });
  });

  it('rolls back a claimed slot when a later reservation step fails', async () => {
    const promotion = await livePromotion();
    const orderCountBefore = await prisma.order.count();
    const reserve = vi
      .spyOn(inventory, 'reserveWithin')
      .mockRejectedValueOnce(new Error('forced post-redemption failure'));

    try {
      await expect(orders.checkout(input('WELCOME10'))).rejects.toThrow(
        'forced post-redemption failure',
      );
    } finally {
      reserve.mockRestore();
    }

    expect(
      await prisma.promoCodeRedemption.count({
        where: { promotionId: promotion.id },
      }),
    ).toBe(0);
    expect(await prisma.order.count()).toBe(orderCountBefore);
    await expect(promotions.usage(promotion.id)).resolves.toMatchObject({
      effective: 0,
    });
  });

  it('releases the slot when the order is cancelled before shipping', async () => {
    const promotion = await livePromotion({ maxUses: 1 });
    const result = await orders.checkout(input('WELCOME10'));
    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: result.orderNumber },
    });

    await orders.cancel(order.id, operatorId);

    const redemption = await prisma.promoCodeRedemption.findUniqueOrThrow({
      where: { orderId: order.id },
    });
    expect(redemption.releasedAt).not.toBeNull();
    await expect(promotions.usage(promotion.id)).resolves.toMatchObject({
      effective: 0,
      released: 1,
    });
    // The freed slot is usable again.
    await expect(orders.checkout(input('WELCOME10'))).resolves.toMatchObject({
      orderNumber: expect.any(String),
    });
  });

  it('is idempotent: a repeat cancel does not move the release timestamp', async () => {
    await livePromotion({ maxUses: 1 });
    const result = await orders.checkout(input('WELCOME10'));
    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: result.orderNumber },
    });

    await orders.cancel(order.id, operatorId);
    const first = await prisma.promoCodeRedemption.findUniqueOrThrow({
      where: { orderId: order.id },
    });
    await expect(orders.cancel(order.id, operatorId)).rejects.toThrow();
    const second = await prisma.promoCodeRedemption.findUniqueOrThrow({
      where: { orderId: order.id },
    });

    expect(second.releasedAt?.getTime()).toBe(first.releasedAt?.getTime());
  });

  it('releases the slot when the status endpoint cancels a pre-shipment order', async () => {
    const promotion = await livePromotion({ maxUses: 1 });
    const result = await orders.checkout(input('WELCOME10'));
    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: result.orderNumber },
    });

    await orders.updateStatus(
      order.id,
      'CANCELLED',
      'Customer cancelled before shipping',
      operatorId,
    );

    await expect(promotions.usage(promotion.id)).resolves.toMatchObject({
      effective: 0,
      released: 1,
    });
  });

  it('does not release the slot when a shipped order is marked cancelled', async () => {
    const promotion = await livePromotion({ maxUses: 1 });
    const result = await orders.checkout(input('WELCOME10'));
    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: result.orderNumber },
    });
    await prisma.order.update({
      where: { id: order.id },
      data: { orderStatus: 'SHIPPING' },
    });

    await orders.updateStatus(
      order.id,
      'CANCELLED',
      'Shipped cancellation must retain usage',
      operatorId,
    );

    await expect(promotions.usage(promotion.id)).resolves.toMatchObject({
      effective: 1,
      released: 0,
    });
  });

  it('releases the dropped order promo slot when pre-shipment orders merge', async () => {
    const promotion = await livePromotion({ maxUses: 1 });
    const shared = input();
    const keptResult = await orders.checkout(shared);
    const droppedResult = await orders.checkout({
      ...shared,
      promoCode: 'WELCOME10',
    });
    const [kept, dropped] = await Promise.all([
      prisma.order.findUniqueOrThrow({
        where: { orderNumber: keptResult.orderNumber },
      }),
      prisma.order.findUniqueOrThrow({
        where: { orderNumber: droppedResult.orderNumber },
      }),
    ]);

    await orders.merge(
      {
        primaryOrderId: kept.id,
        mergedOrderId: dropped.id,
        reason: 'Promo merge release regression',
      },
      operatorId,
    );

    const redemption = await prisma.promoCodeRedemption.findUniqueOrThrow({
      where: { orderId: dropped.id },
    });
    expect(redemption.releasedAt).not.toBeNull();
    await expect(promotions.usage(promotion.id)).resolves.toMatchObject({
      effective: 0,
      released: 1,
    });
  });
});
