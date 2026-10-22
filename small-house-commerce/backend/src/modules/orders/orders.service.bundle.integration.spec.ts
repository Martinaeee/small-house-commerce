import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../generated/prisma/client.js';
import { readBundleSnapshot } from './order-item-snapshot.js';
import { randomUUID } from 'node:crypto';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { InventoryService } from '../inventory/inventory.service.js';
import { BackInStockService } from '../newsletter/back-in-stock.service.js';
import { PromotionService } from '../newsletter/promotion.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { editOrderSchema, type CheckoutInput } from './dto/order.dto.js';
import { CustomerRiskService } from './customer-risk.service.js';
import { OrdersService } from './orders.service.js';

const database = process.env.BUNDLE_TEST_DATABASE_URL;
if (database) {
  const url = new URL(database);
  if (
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    !/^small_house_bundle_20261016_[a-z0-9]+$/.test(url.pathname.slice(1))
  ) {
    throw new Error(
      'Bundle order tests require the dedicated local Bundle test database.',
    );
  }
}

const PREFIX = 'bundle-order-';
const PHONE_PREFIX = '+63996';

describe.skipIf(!database)('OrdersService Bundle lifecycle on PostgreSQL', () => {
  let prisma: PrismaService;
  let inventory: InventoryService;
  let backInStock: BackInStockService;
  let orders: OrdersService;
  let categoryId: string;
  let warehouseId: string;
  let operatorId: string;
  let serial = 0;

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService({ database: { url: database } }),
    );
    await prisma.$connect();
    backInStock = new BackInStockService(
      prisma,
      {
        sendWelcome: async () => undefined,
        sendBackInStock: async () => undefined,
      } as never,
      new ConfigService({
        jwt: { secret: 'b'.repeat(32) },
        email: { storefrontBaseUrl: 'https://luwag.test' },
      }),
    );
    inventory = new InventoryService(prisma, backInStock);
    orders = new OrdersService(
      prisma,
      inventory,
      new CustomerRiskService(prisma),
      { resolve: async () => null } as never,
      new PromotionService(prisma),
      backInStock,
    );

    const category = await prisma.category.create({
      data: { name: 'Bundle order tests', slug: `${PREFIX}category-${randomUUID()}` },
    });
    categoryId = category.id;
    const warehouse =
      (await prisma.warehouse.findFirst({
        where: { status: 'ACTIVE' },
        orderBy: { createdAt: 'asc' },
      })) ??
      (await prisma.warehouse.create({ data: { name: 'Bundle order warehouse' } }));
    warehouseId = warehouse.id;
    const operator = await prisma.user.create({
      data: {
        name: 'Bundle order operator',
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
    const skuIds = products.flatMap((product) => product.skus.map((sku) => sku.id));
    const createdOrders = await prisma.order.findMany({
      where: { customer: { normalizedPhone: { startsWith: PHONE_PREFIX } } },
      select: { id: true },
    });
    const orderIds = createdOrders.map((order) => order.id);

    if (orderIds.length > 0) {
      // Shipment items restrict their order lines and shipments restrict
      // their order, so boxes are unwound before the orders themselves.
      const items = await prisma.orderItem.findMany({
        where: { orderId: { in: orderIds } },
        select: { id: true },
      });
      const itemIds = items.map((item) => item.id);
      if (itemIds.length > 0) {
        await prisma.shipmentItem.deleteMany({ where: { orderItemId: { in: itemIds } } });
      }
      await prisma.shipment.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.orderMergeRecord.deleteMany({
        where: {
          OR: [
            { primaryOrderId: { in: orderIds } },
            { mergedOrderId: { in: orderIds } },
          ],
        },
      });
      await prisma.inventoryReservation.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.inventoryMovement.deleteMany({ where: { referenceId: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    await prisma.customer.deleteMany({
      where: { normalizedPhone: { startsWith: PHONE_PREFIX } },
    });
    if (skuIds.length > 0) {
      await prisma.skuBundleComponent.deleteMany({
        where: {
          OR: [
            { bundleSkuId: { in: skuIds } },
            { componentSkuId: { in: skuIds } },
          ],
        },
      });
      await prisma.backInStockSubscription.deleteMany({ where: { skuId: { in: skuIds } } });
      await prisma.inventoryMovement.deleteMany({ where: { skuId: { in: skuIds } } });
      await prisma.inventory.deleteMany({ where: { skuId: { in: skuIds } } });
    }
    await prisma.product.deleteMany({ where: { categoryId } });
  }

  beforeEach(async () => {
    await cleanup();
  });

  afterEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    if (!prisma) return;
    await cleanup();
    await prisma.category.delete({ where: { id: categoryId } });
    await prisma.user.delete({ where: { id: operatorId } });
    await prisma.$disconnect();
  });

  /** An ordinary SKU with an inventory row, or a virtual Bundle SKU without one. */
  async function createSku(label: string, onHand: number | null) {
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
      data: { productId: product.id, name: 'Default', combinationKey: 'default' },
    });
    const sku = await prisma.sku.create({
      data: {
        productId: product.id,
        variantId: variant.id,
        skuCode: `BO-${label}-${key}`,
        price: 250,
        ...(onHand === null ? { isBundle: true } : {}),
      },
    });
    if (onHand !== null) {
      await prisma.inventory.create({ data: { skuId: sku.id, warehouseId, onHand } });
    }
    return { product, variant, sku };
  }

  async function createBundle(label: string, components: [string, number][]) {
    const bundle = await createSku(label, null);
    for (const [position, [componentSkuId, quantity]] of components.entries()) {
      await prisma.skuBundleComponent.create({
        data: { bundleSkuId: bundle.sku.id, componentSkuId, quantity, position },
      });
    }
    return bundle;
  }

  function input(items: CheckoutInput['items']): CheckoutInput {
    const phone = `${PHONE_PREFIX}${String(
      (Date.now() % 9_000_000) + serial++,
    )
      .padStart(7, '0')
      .slice(-7)}`;
    return {
      customer: {
        name: 'Bundle shopper',
        phone,
        province: 'Metro Manila',
        city: 'Quezon City',
        streetAddress: '1 Bundle St',
      },
      items,
      attribution: { sourceType: 'ORGANIC' },
      customerNote: null,
      promoCode: null,
    };
  }

  async function checkoutWith(items: CheckoutInput['items']) {
    const result = await orders.checkout(input(items));
    return prisma.order.findUniqueOrThrow({
      where: { orderNumber: result.orderNumber },
      include: { items: true },
    });
  }

  async function inventoryRow(skuId: string) {
    return prisma.inventory.findUniqueOrThrow({
      where: { skuId_warehouseId: { skuId, warehouseId } },
    });
  }

  async function confirmedOrder(items: CheckoutInput['items']) {
    const order = await checkoutWith(items);
    await orders.confirm(order.id, operatorId);
    return order;
  }

  it('reserves, freezes and ships the components of a Bundle line', async () => {
    const chair = await createSku('chair', 10);
    const table = await createSku('table', 10);
    const bundle = await createBundle('set', [
      [chair.sku.id, 2],
      [table.sku.id, 1],
    ]);

    const order = await confirmedOrder([{ skuId: bundle.sku.id, quantity: 2 }]);

    // One customer-visible line, priced as the Bundle, with the physical
    // components frozen in definition order.
    expect(order.items).toHaveLength(1);
    expect(Number(order.items[0]!.unitPrice)).toBe(250);
    expect(order.items[0]!.quantity).toBe(2);
    const snapshot = order.items[0]!.bundleSnapshot as {
      version: number;
      components: { skuCode: string; quantity: number; totalQuantity: number; position: number }[];
    };
    expect(snapshot.version).toBe(1);
    expect(
      snapshot.components.map((component) => [
        component.skuCode,
        component.quantity,
        component.totalQuantity,
        component.position,
      ]),
    ).toEqual([
      [chair.sku.skuCode, 2, 4, 0],
      [table.sku.skuCode, 1, 2, 1],
    ]);

    // The virtual SKU holds no stock, reservation or movement of its own.
    expect(
      await prisma.inventory.findUnique({
        where: { skuId_warehouseId: { skuId: bundle.sku.id, warehouseId } },
      }),
    ).toBeNull();
    expect(
      await prisma.inventoryReservation.count({
        where: { orderId: order.id, skuId: bundle.sku.id },
      }),
    ).toBe(0);
    expect(
      await prisma.inventoryMovement.count({
        where: { referenceId: order.id, skuId: bundle.sku.id },
      }),
    ).toBe(0);

    // The components hold the aggregate reservation of the ordered sets.
    const reservations = new Map(
      (
        await prisma.inventoryReservation.findMany({
          where: { orderId: order.id },
        })
      ).map((reservation) => [reservation.skuId, reservation.quantity]),
    );
    expect(reservations.get(chair.sku.id)).toBe(4);
    expect(reservations.get(table.sku.id)).toBe(2);

    await orders.ship(
      order.id,
      { carrier: 'LBC', items: [{ orderItemId: order.items[0]!.id, quantity: 1 }] },
      operatorId,
    );

    // Shipping one set leaves stock through the snapshot's components only.
    const chairRow = await inventoryRow(chair.sku.id);
    expect([chairRow.onHand, chairRow.reserved]).toEqual([8, 2]);
    const tableRow = await inventoryRow(table.sku.id);
    expect([tableRow.onHand, tableRow.reserved]).toEqual([9, 1]);
  });

  it('lets exactly one of two concurrent checkouts take the final set', async () => {
    const chair = await createSku('last-chair', 1);
    const bundle = await createBundle('last-set', [[chair.sku.id, 1]]);

    const results = await Promise.allSettled([
      orders.checkout(input([{ skuId: bundle.sku.id, quantity: 1 }])),
      orders.checkout(input([{ skuId: bundle.sku.id, quantity: 1 }])),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);

    const chairRow = await inventoryRow(chair.sku.id);
    expect([chairRow.onHand, chairRow.reserved]).toEqual([1, 1]);

    // The loser left no partial order, reservation or movement behind.
    const surviving = await prisma.order.findMany({
      where: { customer: { normalizedPhone: { startsWith: PHONE_PREFIX } } },
      select: { id: true },
    });
    expect(surviving).toHaveLength(1);
    expect(
      await prisma.inventoryReservation.count({
        where: { skuId: chair.sku.id, status: 'ACTIVE' },
      }),
    ).toBe(1);
    expect(
      await prisma.inventoryMovement.count({
        where: { skuId: chair.sku.id, movementType: 'ORDER_RESERVED' },
      }),
    ).toBe(1);
    expect(
      await prisma.inventoryReservation.count({ where: { skuId: bundle.sku.id } }),
    ).toBe(0);
  });

  it('keeps the ordered components after the definition changes', async () => {
    const chair = await createSku('snap-chair', 10);
    const table = await createSku('snap-table', 10);
    const bundle = await createBundle('snap-set', [
      [chair.sku.id, 2],
      [table.sku.id, 1],
    ]);
    const order = await confirmedOrder([{ skuId: bundle.sku.id, quantity: 1 }]);

    // The definition now owes five chairs and no table at all.
    await prisma.skuBundleComponent.deleteMany({ where: { bundleSkuId: bundle.sku.id } });
    await prisma.skuBundleComponent.create({
      data: { bundleSkuId: bundle.sku.id, componentSkuId: chair.sku.id, quantity: 5, position: 0 },
    });

    await orders.ship(
      order.id,
      { carrier: 'LBC', items: [{ orderItemId: order.items[0]!.id, quantity: 1 }] },
      operatorId,
    );

    const chairRow = await inventoryRow(chair.sku.id);
    expect([chairRow.onHand, chairRow.reserved]).toEqual([8, 0]);
    const tableRow = await inventoryRow(table.sku.id);
    expect([tableRow.onHand, tableRow.reserved]).toEqual([9, 0]);
  });

  it('releases every component reservation when a Bundle order is cancelled', async () => {
    const chair = await createSku('cancel-chair', 3);
    const bundle = await createBundle('cancel-set', [[chair.sku.id, 2]]);
    const order = await checkoutWith([{ skuId: bundle.sku.id, quantity: 1 }]);

    expect((await inventoryRow(chair.sku.id)).reserved).toBe(2);

    await orders.cancel(order.id, operatorId);

    const chairRow = await inventoryRow(chair.sku.id);
    expect([chairRow.onHand, chairRow.reserved]).toEqual([3, 0]);
    const reservations = await prisma.inventoryReservation.findMany({
      where: { orderId: order.id },
    });
    expect(reservations.map((reservation) => reservation.status)).toEqual(['RELEASED']);
  });

  it('refuses an order whose Bundle and ordinary lines exceed a shared component', async () => {
    const chair = await createSku('shared-chair', 5);
    const bundle = await createBundle('shared-set', [[chair.sku.id, 2]]);

    await expect(
      orders.checkout(
        input([
          { skuId: bundle.sku.id, quantity: 1 },
          { skuId: chair.sku.id, quantity: 4 },
        ]),
      ),
    ).rejects.toThrow(/Insufficient stock/);

    expect(
      await prisma.order.count({
        where: { customer: { normalizedPhone: { startsWith: PHONE_PREFIX } } },
      }),
    ).toBe(0);
    const chairRow = await inventoryRow(chair.sku.id);
    expect([chairRow.onHand, chairRow.reserved]).toEqual([5, 0]);
  });

  it('preserves every mixed-line reservation when a Bundle line shrinks or is removed', async () => {
    const chair = await createSku('edit-shared-chair', 20);
    const bundle = await createBundle('edit-shared-set', [[chair.sku.id, 2]]);
    const order = await checkoutWith([
      { skuId: bundle.sku.id, quantity: 3 },
      { skuId: chair.sku.id, quantity: 1 },
    ]);
    const frozen = order.items.find(item => item.skuId === bundle.sku.id)!.bundleSnapshot;
    await prisma.skuBundleComponent.updateMany({ where: { bundleSkuId: bundle.sku.id }, data: { quantity: 5 } });

    const response = await orders.edit(order.id, { items: [
      { skuId: bundle.sku.id, quantity: 1 },
      { skuId: chair.sku.id, quantity: 1 },
    ] }, operatorId);

    expect(response.items.find(item => item.skuId === bundle.sku.id)!.quantity).toBe(1);
    expect(Number(response.grandTotal)).toBe(500);
    expect((await inventoryRow(chair.sku.id)).reserved).toBe(3);
    const resized = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id, skuId: bundle.sku.id } });
    expect(Number(resized.lineTotal)).toBe(250);
    expect(resized.bundleSnapshot).toMatchObject({
      components: [{ quantity: 2, totalQuantity: 2 }],
    });
    expect(resized.bundleSnapshot).toMatchObject({
      bundleSkuId: bundle.sku.id,
      components: [expect.objectContaining({ componentSkuId: chair.sku.id })],
    });
    expect(frozen).toMatchObject({ components: [expect.objectContaining({ quantity: 2, totalQuantity: 6 })] });

    await orders.edit(order.id, { items: [{ skuId: chair.sku.id, quantity: 1 }] }, operatorId);

    expect((await inventoryRow(chair.sku.id)).reserved).toBe(1);
    expect(await prisma.orderItem.count({ where: { orderId: order.id } })).toBe(1);
    const saved = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(Number(saved.grandTotal)).toBe(250);
    const active = await prisma.inventoryReservation.findMany({ where: { orderId: order.id, status: 'ACTIVE' } });
    expect(active.reduce((sum, row) => sum + row.quantity, 0)).toBe(1);
  });

  it('carries mixed-line reservation ownership into a merged Bundle order without releasing stock', async () => {
    const chair = await createSku('merge-chair', 20);
    const bundle = await createBundle('merge-set', [[chair.sku.id, 2]]);
    const request = input([{ skuId: bundle.sku.id, quantity: 1 }]);
    const first = await orders.checkout(request);
    const second = await orders.checkout({ ...request, items: [
      { skuId: bundle.sku.id, quantity: 2 },
      { skuId: chair.sku.id, quantity: 1 },
    ] });
    const primary = await prisma.order.findUniqueOrThrow({ where: { orderNumber: first.orderNumber } });
    const dropped = await prisma.order.findUniqueOrThrow({ where: { orderNumber: second.orderNumber } });
    const releaseCount = await prisma.inventoryMovement.count({ where: { skuId: chair.sku.id, movementType: 'RESERVATION_RELEASED' } });

    await orders.merge({ primaryOrderId: primary.id, mergedOrderId: dropped.id }, operatorId);

    expect((await inventoryRow(chair.sku.id)).reserved).toBe(7);
    const keptReservations = await prisma.inventoryReservation.findMany({ where: { orderId: primary.id, status: 'ACTIVE' } });
    expect(keptReservations.reduce((sum, row) => sum + row.quantity, 0)).toBe(7);
    expect(await prisma.inventoryReservation.count({ where: { orderId: dropped.id, status: 'ACTIVE' } })).toBe(0);
    expect(await prisma.inventoryMovement.count({ where: { skuId: chair.sku.id, movementType: 'RESERVATION_RELEASED' } })).toBe(releaseCount);
    const items = await prisma.orderItem.findMany({ where: { orderId: primary.id } });
    expect(items).toHaveLength(2);
    expect(items.find(item => item.skuId === bundle.sku.id)).toMatchObject({ quantity: 3 });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: dropped.id } })).orderStatus).toBe('CANCELLED');

    await orders.cancel(primary.id, operatorId);
    expect((await inventoryRow(chair.sku.id)).reserved).toBe(0);
  });

  async function historicalLines() {
    const chair = await createSku('history-chair', 50);
    const table = await createSku('history-table', 50);
    const bundle = await createBundle('history-set', [[chair.sku.id, 2]]);
    const request = input([
      { skuId: bundle.sku.id, quantity: 2 },
      { skuId: chair.sku.id, quantity: 1 },
    ]);
    const first = await orders.checkout(request);
    const primary = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: first.orderNumber }, include: { items: true },
    });
    await prisma.skuBundleComponent.updateMany({
      where: { bundleSkuId: bundle.sku.id },
      data: { componentSkuId: table.sku.id, quantity: 3 },
    });
    const second = await orders.checkout({ ...request, items: [{ skuId: bundle.sku.id, quantity: 1 }] });
    const dropped = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: second.orderNumber }, include: { items: true },
    });
    const merged = await orders.merge({ primaryOrderId: primary.id, mergedOrderId: dropped.id }, operatorId);
    expect(merged.items).toHaveLength(3);
    return {
      chair, table, bundle, orderId: merged.id,
      oldLineId: primary.items.find(item => item.skuId === bundle.sku.id)!.id,
      newLineId: dropped.items[0]!.id,
      ordinaryLineId: primary.items.find(item => item.skuId === chair.sku.id)!.id,
    };
  }

  it('edits and removes historical lines independently when a Bundle SKU has two saved definitions', async () => {
    const h = await historicalLines();
    const edited = await orders.edit(h.orderId, editOrderSchema.parse({ items: [
      { orderItemId: h.oldLineId, skuId: h.bundle.sku.id, quantity: 3 },
      { orderItemId: h.newLineId, skuId: h.bundle.sku.id, quantity: 2 },
      { orderItemId: h.ordinaryLineId, skuId: h.chair.sku.id, quantity: 1 },
    ] }), operatorId);

    expect(edited.items.find(item => item.id === h.oldLineId)).toMatchObject({
      quantity: 3, bundleSnapshot: { components: [{ componentSkuId: h.chair.sku.id, quantity: 2, totalQuantity: 6 }] },
    });
    expect(edited.items.find(item => item.id === h.newLineId)).toMatchObject({
      quantity: 2, bundleSnapshot: { components: [{ componentSkuId: h.table.sku.id, quantity: 3, totalQuantity: 6 }] },
    });
    expect(Number(edited.grandTotal)).toBe(1500);
    expect((await inventoryRow(h.chair.sku.id)).reserved).toBe(7);
    expect((await inventoryRow(h.table.sku.id)).reserved).toBe(6);

    const reduced = await orders.edit(h.orderId, editOrderSchema.parse({ items: [
      { orderItemId: h.oldLineId, skuId: h.bundle.sku.id, quantity: 1 },
      { orderItemId: h.newLineId, skuId: h.bundle.sku.id, quantity: 2 },
      { orderItemId: h.ordinaryLineId, skuId: h.chair.sku.id, quantity: 1 },
    ] }), operatorId);
    expect(reduced.items.find(item => item.id === h.oldLineId)).toMatchObject({
      quantity: 1, bundleSnapshot: { components: [{ componentSkuId: h.chair.sku.id, totalQuantity: 2 }] },
    });
    expect((await inventoryRow(h.chair.sku.id)).reserved).toBe(3);
    expect((await inventoryRow(h.table.sku.id)).reserved).toBe(6);

    const remaining = await orders.edit(h.orderId, editOrderSchema.parse({ items: [
      { orderItemId: h.oldLineId, skuId: h.bundle.sku.id, quantity: 1 },
      { orderItemId: h.ordinaryLineId, skuId: h.chair.sku.id, quantity: 1 },
    ] }), operatorId);
    expect(remaining.items.map(item => item.id).sort()).toEqual([h.oldLineId, h.ordinaryLineId].sort());
    expect(Number(remaining.grandTotal)).toBe(500);
    expect((await inventoryRow(h.chair.sku.id)).reserved).toBe(3);
    expect((await inventoryRow(h.table.sku.id)).reserved).toBe(0);
    expect(await prisma.inventoryReservation.count({ where: { orderId: h.orderId, skuId: h.bundle.sku.id } })).toBe(0);
  });

  it('ships multiple historical definitions independently after a merge', async () => {
    const h = await historicalLines();
    const flags = await prisma.orderRiskFlag.findMany({ where: { orderId: h.orderId, resolved: false } });
    for (const flag of flags) await orders.resolveRiskFlag(flag.id, operatorId);
    await orders.confirm(h.orderId, operatorId, { decision: 'CONFIRM', note: 'Reviewed fixture order' });

    await orders.ship(h.orderId, { carrier: 'LBC', items: [{ orderItemId: h.oldLineId, quantity: 1 }] }, operatorId);
    expect((await inventoryRow(h.chair.sku.id)).reserved).toBe(3);
    expect((await inventoryRow(h.table.sku.id)).reserved).toBe(3);
    await orders.ship(h.orderId, { carrier: 'LBC', items: [{ orderItemId: h.newLineId, quantity: 1 }] }, operatorId);
    expect((await inventoryRow(h.table.sku.id)).onHand).toBe(47);
    expect((await inventoryRow(h.table.sku.id)).reserved).toBe(0);
    await orders.ship(h.orderId, { carrier: 'LBC', items: [
      { orderItemId: h.oldLineId, quantity: 1 },
      { orderItemId: h.ordinaryLineId, quantity: 1 },
    ] }, operatorId);

    const stock = await inventoryRow(h.chair.sku.id);
    expect([stock.onHand, stock.reserved]).toEqual([45, 0]);
    const order = await orders.get(h.orderId);
    expect(order.items).toHaveLength(3);
    expect(Number(order.grandTotal)).toBe(1000);
    expect(order.items.find(item => item.id === h.oldLineId)).toMatchObject({ bundleSnapshot: { components: [{ componentSkuId: h.chair.sku.id, quantity: 2, totalQuantity: 4 }] } });
    expect(order.items.find(item => item.id === h.newLineId)).toMatchObject({ bundleSnapshot: { components: [{ componentSkuId: h.table.sku.id, quantity: 3, totalQuantity: 3 }] } });
    expect(await prisma.inventoryReservation.count({ where: { orderId: h.orderId, status: 'ACTIVE' } })).toBe(0);
  });

  it.each(['ambiguous', 'unknown-id', 'mismatched-sku', 'duplicate-id', 'duplicate-alias'])('rejects %s historical line identities without any edits', async (mode) => {
    const h = await historicalLines();
    const items: { orderItemId?: string; skuId: string; quantity: number }[] = [
      { orderItemId: h.oldLineId, skuId: h.bundle.sku.id, quantity: 2 },
      { orderItemId: h.newLineId, skuId: h.bundle.sku.id, quantity: 1 },
      { orderItemId: h.ordinaryLineId, skuId: h.chair.sku.id, quantity: 1 },
    ];
    if (mode === 'ambiguous') items[0] = { ...items[0]!, orderItemId: undefined };
    if (mode === 'unknown-id') items[0]!.orderItemId = randomUUID();
    if (mode === 'mismatched-sku') items[0]!.skuId = h.chair.sku.id;
    if (mode === 'duplicate-id') items.push({ ...items[0]! });
    if (mode === 'duplicate-alias') items.push({ skuId: h.chair.sku.id, quantity: 2, orderItemId: undefined });
    const before = await orders.get(h.orderId);
    const movements = await prisma.inventoryMovement.count({ where: { referenceId: h.orderId } });
    const edits = await prisma.orderStatusHistory.count({ where: { orderId: h.orderId, statusDomain: 'EDIT' } });

    await expect(orders.edit(h.orderId, editOrderSchema.parse({ items }), operatorId)).rejects.toThrow(/order item|ambiguous|duplicate/i);

    expect((await orders.get(h.orderId)).items).toEqual(before.items);
    expect((await inventoryRow(h.chair.sku.id)).reserved).toBe(5);
    expect((await inventoryRow(h.table.sku.id)).reserved).toBe(3);
    expect(await prisma.inventoryMovement.count({ where: { referenceId: h.orderId } })).toBe(movements);
    expect(await prisma.orderStatusHistory.count({ where: { orderId: h.orderId, statusDomain: 'EDIT' } })).toBe(edits);
  });

  it('does not add the same Bundle quantity delta twice when two edits race', async () => {
    const chair = await createSku('edit-race-chair', 20);
    const bundle = await createBundle('edit-race-set', [[chair.sku.id, 2]]);
    const order = await checkoutWith([{ skuId: bundle.sku.id, quantity: 1 }]);

    const results = await Promise.allSettled([
      orders.edit(order.id, { items: [{ skuId: bundle.sku.id, quantity: 2 }] }, operatorId),
      orders.edit(order.id, { items: [{ skuId: bundle.sku.id, quantity: 2 }] }, operatorId),
    ]);

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(2);
    expect((await inventoryRow(chair.sku.id)).reserved).toBe(4);
    expect((await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } })).quantity).toBe(2);
  });

  it('records one merge when two callers race with the same Bundle orders', async () => {
    const chair = await createSku('merge-race-chair', 20);
    const bundle = await createBundle('merge-race-set', [[chair.sku.id, 2]]);
    const request = input([{ skuId: bundle.sku.id, quantity: 1 }]);
    const first = await orders.checkout(request);
    const second = await orders.checkout(request);
    const primary = await prisma.order.findUniqueOrThrow({ where: { orderNumber: first.orderNumber } });
    const dropped = await prisma.order.findUniqueOrThrow({ where: { orderNumber: second.orderNumber } });
    const args = { primaryOrderId: primary.id, mergedOrderId: dropped.id };

    const results = await Promise.allSettled([
      orders.merge(args, operatorId),
      orders.merge(args, operatorId),
    ]);

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(await prisma.orderMergeRecord.count({ where: args })).toBe(1);
    expect((await inventoryRow(chair.sku.id)).reserved).toBe(4);
    expect(await prisma.orderStatusHistory.count({ where: { orderId: primary.id, statusDomain: 'MERGE' } })).toBe(1);
  });

  it('rereads shipped quantities under the order lock when an ordinary line shares its component', async () => {
    const chair = await createSku('ship-overlap-chair', 20);
    const bundle = await createBundle('ship-overlap-set', [[chair.sku.id, 2]]);
    const order = await confirmedOrder([
      { skuId: bundle.sku.id, quantity: 1 },
      { skuId: chair.sku.id, quantity: 2 },
    ]);
    const line = order.items.find(item => item.skuId === bundle.sku.id)!;

    const results = await Promise.allSettled([
      orders.ship(order.id, { carrier: 'LBC', items: [{ orderItemId: line.id, quantity: 1 }] }, operatorId),
      orders.ship(order.id, { carrier: 'LBC', items: [{ orderItemId: line.id, quantity: 1 }] }, operatorId),
    ]);

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(await prisma.shipment.count({ where: { orderId: order.id } })).toBe(1);
    const stock = await inventoryRow(chair.sku.id);
    expect([stock.onHand, stock.reserved]).toEqual([18, 2]);
  });

  it('cannot revive a cancelled Bundle order when confirmation races cancellation', async () => {
    const chair = await createSku('confirm-race-chair', 20);
    const bundle = await createBundle('confirm-race-set', [[chair.sku.id, 2]]);
    const order = await checkoutWith([{ skuId: bundle.sku.id, quantity: 1 }]);

    await Promise.allSettled([
      orders.cancel(order.id, operatorId),
      orders.confirm(order.id, operatorId),
    ]);

    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).orderStatus).toBe('CANCELLED');
    expect((await inventoryRow(chair.sku.id)).reserved).toBe(0);
    const history = await prisma.orderStatusHistory.findMany({ where: { orderId: order.id, statusDomain: 'ORDER_STATUS' }, orderBy: { createdAt: 'asc' } });
    expect(history.at(-1)!.newStatus).toBe('CANCELLED');
  });

  it('validates checkout components only after taking the shared definition-owner lock', async () => {
    const chair = await createSku('checkout-lock-chair', 20);
    const bundle = await createBundle('checkout-lock-set', [[chair.sku.id, 2]]);
    let release!: () => void;
    let ready!: (pid: number) => void;
    const released = new Promise<void>(resolve => { release = resolve; });
    const lockReady = new Promise<number>(resolve => { ready = resolve; });
    const holder = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM skus WHERE id = ${bundle.sku.id}::uuid FOR UPDATE`;
      const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      ready(pid);
      await released;
      await tx.sku.update({ where: { id: chair.sku.id }, data: { status: 'DISABLED' } });
    }, { timeout: 10000 });
    const pid = await lockReady;
    const checkingOut = orders.checkout(input([{ skuId: bundle.sku.id, quantity: 1 }])).then(
      value => ({ status: 'fulfilled' as const, value }),
      reason => ({ status: 'rejected' as const, reason }),
    );
    let outcome: Awaited<typeof checkingOut>;
    try {
      await expect.poll(async () => {
        const [{ blocked }] = await prisma.$queryRaw<{ blocked: boolean }[]>`
          SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ${pid}::integer = ANY(pg_blocking_pids(pid))) AS blocked
        `;
        return blocked;
      }, { timeout: 3000, interval: 10 }).toBe(true);
    } finally {
      release();
      await holder;
      outcome = await checkingOut;
    }
    expect(outcome.status).toBe('rejected');
    expect((await inventoryRow(chair.sku.id)).reserved).toBe(0);
    expect(await prisma.order.count({ where: { items: { some: { skuId: bundle.sku.id } } } })).toBe(0);
  });

  it('validates newly added Bundle lines after the definition-owner lock is released', async () => {
    const chair = await createSku('edit-lock-chair', 20);
    const bundle = await createBundle('edit-lock-set', [[chair.sku.id, 2]]);
    const order = await checkoutWith([{ skuId: chair.sku.id, quantity: 1 }]);
    let release!: () => void;
    let ready!: (pid: number) => void;
    const released = new Promise<void>(resolve => { release = resolve; });
    const lockReady = new Promise<number>(resolve => { ready = resolve; });
    const holder = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM skus WHERE id = ${bundle.sku.id}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM inventory WHERE sku_id = ${chair.sku.id}::uuid FOR UPDATE`;
      const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      ready(pid);
      await released;
      await tx.sku.update({ where: { id: chair.sku.id }, data: { status: 'DISABLED' } });
    }, { timeout: 10000 });
    const pid = await lockReady;
    const editing = orders.edit(order.id, { items: [
      { skuId: chair.sku.id, quantity: 1 },
      { skuId: bundle.sku.id, quantity: 1 },
    ] }, operatorId).then(
      value => ({ status: 'fulfilled' as const, value }),
      reason => ({ status: 'rejected' as const, reason }),
    );
    let outcome: Awaited<typeof editing>;
    try {
      await expect.poll(async () => {
        const [{ blocked }] = await prisma.$queryRaw<{ blocked: boolean }[]>`
          SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ${pid}::integer = ANY(pg_blocking_pids(pid))) AS blocked
        `;
        return blocked;
      }, { timeout: 3000, interval: 10 }).toBe(true);
    } finally {
      release();
      await holder;
      outcome = await editing;
    }
    expect(outcome.status).toBe('rejected');
    expect((await inventoryRow(chair.sku.id)).reserved).toBe(1);
    expect(await prisma.orderItem.count({ where: { orderId: order.id } })).toBe(1);
    expect(await prisma.orderStatusHistory.count({ where: { orderId: order.id, statusDomain: 'EDIT' } })).toBe(0);
  });

  it('accumulates every matching dropped Bundle line during one merge', async () => {
    const chair = await createSku('merge-multiple-chair', 20);
    const bundle = await createBundle('merge-multiple-set', [[chair.sku.id, 2]]);
    const request = input([{ skuId: bundle.sku.id, quantity: 1 }]);
    const first = await orders.checkout(request);
    const second = await orders.checkout({ ...request, items: [
      { skuId: bundle.sku.id, quantity: 1 },
      { skuId: bundle.sku.id, quantity: 2 },
    ] });
    const primary = await prisma.order.findUniqueOrThrow({ where: { orderNumber: first.orderNumber } });
    const dropped = await prisma.order.findUniqueOrThrow({ where: { orderNumber: second.orderNumber } });

    const merged = await orders.merge({ primaryOrderId: primary.id, mergedOrderId: dropped.id }, operatorId);

    expect(merged.items).toHaveLength(1);
    expect(merged.items[0]).toMatchObject({ quantity: 4, bundleSnapshot: { components: [{ quantity: 2, totalQuantity: 8 }] } });
    expect(Number(merged.items[0]!.lineTotal)).toBe(1000);
    expect(Number(merged.grandTotal)).toBe(1000);
    expect((await inventoryRow(chair.sku.id)).reserved).toBe(8);
  });

  it.each(['missing', 'wrong-owner', 'wrong-total', 'virtual-component'].flatMap(mode =>
    ['edit', 'ship', 'merge'].map(action => ({ mode, action })),
  ))('rejects $action with a $mode stored Bundle snapshot even if virtual stock exists', async ({ mode, action }) => {
    const chair = await createSku('corrupt-chair', 20);
    const bundle = await createBundle('corrupt-set', [[chair.sku.id, 2]]);
    const order = await confirmedOrder([{ skuId: bundle.sku.id, quantity: 1 }]);
    const line = order.items[0]!;
    const snapshot = readBundleSnapshot(line.bundleSnapshot)!;
    let virtualId = bundle.sku.id;
    if (mode === 'wrong-owner') snapshot.bundleSkuId = randomUUID();
    if (mode === 'wrong-total') snapshot.components[0]!.totalQuantity = 4;
    if (mode === 'virtual-component') {
      const nested = await createBundle('corrupt-nested', [[chair.sku.id, 1]]);
      virtualId = nested.sku.id;
      snapshot.components[0]!.componentSkuId = nested.sku.id;
      snapshot.components[0]!.quantity = 1;
      snapshot.components[0]!.totalQuantity = 1;
    }
    await prisma.orderItem.update({ where: { id: line.id }, data: {
      bundleSnapshot: mode === 'missing' ? Prisma.DbNull : snapshot,
    } });
    await prisma.inventory.create({ data: { skuId: virtualId, warehouseId, onHand: 20, reserved: 1 } });
    await prisma.inventoryReservation.create({ data: { orderId: order.id, skuId: virtualId, warehouseId, quantity: 1 } });
    const movements = await prisma.inventoryMovement.count({ where: { referenceId: order.id } });
    let otherOrderId = '';
    if (action === 'merge') {
      const customer = await prisma.customer.findUniqueOrThrow({ where: { id: order.customerId } });
      const request = input([{ skuId: chair.sku.id, quantity: 1 }]);
      request.customer.phone = customer.normalizedPhone;
      const other = await orders.checkout(request);
      otherOrderId = (await prisma.order.findUniqueOrThrow({ where: { orderNumber: other.orderNumber } })).id;
    }

    const operation = action === 'edit'
      ? orders.edit(order.id, { items: [{ skuId: bundle.sku.id, quantity: 2 }] }, operatorId)
      : action === 'merge'
        ? orders.merge({ primaryOrderId: order.id, mergedOrderId: otherOrderId }, operatorId)
        : orders.ship(order.id, { carrier: 'LBC', items: [{ orderItemId: line.id, quantity: 1 }] }, operatorId);
    await expect(operation).rejects.toThrow(/snapshot is unreadable/);

    expect((await inventoryRow(chair.sku.id)).reserved).toBe(action === 'merge' ? 3 : 2);
    const virtual = await inventoryRow(virtualId);
    expect([virtual.onHand, virtual.reserved]).toEqual([20, 1]);
    expect(await prisma.inventoryMovement.count({ where: { referenceId: order.id } })).toBe(movements);
    expect(await prisma.shipment.count({ where: { orderId: order.id } })).toBe(0);
    expect((await prisma.orderItem.findUniqueOrThrow({ where: { id: line.id } })).quantity).toBe(1);
  });

  it('does not expose internal Bundle snapshots in the customer order lookup', async () => {
    const chair = await createSku('private-chair', 10);
    const bundle = await createBundle('private-set', [[chair.sku.id, 2]]);
    const request = input([{ skuId: bundle.sku.id, quantity: 1 }]);
    const result = await orders.checkout(request);

    const visible = await orders.lookup(result.orderNumber, request.customer.phone);
    const order = visible.orders[0]!;

    expect(order.items).toHaveLength(1);
    expect(order.items[0]).not.toHaveProperty('bundleSnapshot');
    expect(order.items[0]).toMatchObject({ skuId: bundle.sku.id, quantity: 1 });
    expect(Number(order.grandTotal)).toBe(250);
    expect(JSON.stringify(order.items)).not.toContain(chair.sku.id);
    const stored = await prisma.orderItem.findFirstOrThrow({ where: { order: { orderNumber: result.orderNumber } } });
    expect(stored.bundleSnapshot).toMatchObject({ components: [{ componentSkuId: chair.sku.id, quantity: 2 }] });
  });

  it('reserves only unshipped quantities when a partially shipped Bundle line is reduced', async () => {
    const chair = await createSku('partial-edit-chair', 20);
    const bundle = await createBundle('partial-edit-set', [[chair.sku.id, 2]]);
    const order = await confirmedOrder([
      { skuId: bundle.sku.id, quantity: 2 },
      { skuId: chair.sku.id, quantity: 2 },
    ]);
    const line = order.items.find(item => item.skuId === bundle.sku.id)!;
    const ordinary = order.items.find(item => item.skuId === chair.sku.id)!;
    await orders.ship(order.id, { carrier: 'LBC', items: [{ orderItemId: line.id, quantity: 1 }] }, operatorId);

    const edited = await orders.edit(order.id, { items: [
      { skuId: bundle.sku.id, quantity: 1 },
      { skuId: chair.sku.id, quantity: 2 },
    ] }, operatorId);

    expect((await inventoryRow(chair.sku.id)).reserved).toBe(2);
    expect(edited.items.find(item => item.id === line.id)).toMatchObject({
      quantity: 1, bundleSnapshot: { components: [{ quantity: 2, totalQuantity: 2 }] },
    });
    expect(Number(edited.grandTotal)).toBe(750);
    await orders.ship(order.id, { carrier: 'LBC', items: [{ orderItemId: ordinary.id, quantity: 2 }] }, operatorId);
    const stock = await inventoryRow(chair.sku.id);
    expect([stock.onHand, stock.reserved]).toEqual([16, 0]);
    expect(await prisma.shipmentItem.count({ where: { orderItemId: line.id } })).toBe(1);
    expect(await prisma.inventoryReservation.count({ where: { orderId: order.id, status: 'ACTIVE' } })).toBe(0);
  });

  it.each([1, 0])('rejects reducing a shipped Bundle line to %i without changing stock', async (quantity) => {
    const chair = await createSku('below-shipped-chair', 20);
    const bundle = await createBundle('below-shipped-set', [[chair.sku.id, 2]]);
    const order = await confirmedOrder([{ skuId: bundle.sku.id, quantity: 3 }]);
    const line = order.items[0]!;
    await orders.ship(order.id, { carrier: 'LBC', items: [{ orderItemId: line.id, quantity: 2 }] }, operatorId);
    const movements = await prisma.inventoryMovement.count({ where: { referenceId: order.id } });

    await expect(orders.edit(order.id, { items: quantity === 0 ? [] : [{ skuId: bundle.sku.id, quantity }] }, operatorId)).rejects.toThrow(/already shipped/);

    expect((await prisma.orderItem.findUniqueOrThrow({ where: { id: line.id } })).quantity).toBe(3);
    const stock = await inventoryRow(chair.sku.id);
    expect([stock.onHand, stock.reserved]).toEqual([16, 2]);
    expect(await prisma.inventoryMovement.count({ where: { referenceId: order.id } })).toBe(movements);
  });

  it('rejects repeated shipment line IDs before they can consume another line reservation', async () => {
    const chair = await createSku('duplicate-box-chair', 20);
    const bundle = await createBundle('duplicate-box-set', [[chair.sku.id, 2]]);
    const order = await confirmedOrder([
      { skuId: bundle.sku.id, quantity: 1 },
      { skuId: chair.sku.id, quantity: 2 },
    ]);
    const line = order.items.find(item => item.skuId === bundle.sku.id)!;

    await expect(orders.ship(order.id, { carrier: 'LBC', items: [
      { orderItemId: line.id, quantity: 1 },
      { orderItemId: line.id, quantity: 1 },
    ] }, operatorId)).rejects.toThrow(/duplicate|only 1 remains/i);

    const stock = await inventoryRow(chair.sku.id);
    expect([stock.onHand, stock.reserved]).toEqual([20, 4]);
    expect(await prisma.shipment.count({ where: { orderId: order.id } })).toBe(0);
  });

  it('releases components once when two cancellations race', async () => {
    const chair = await createSku('cancel-twice-chair', 20);
    const bundle = await createBundle('cancel-twice-set', [[chair.sku.id, 2]]);
    const order = await checkoutWith([{ skuId: bundle.sku.id, quantity: 3 }]);

    await Promise.allSettled([
      orders.cancel(order.id, operatorId),
      orders.cancel(order.id, operatorId),
    ]);

    expect((await inventoryRow(chair.sku.id)).reserved).toBe(0);
    expect(await prisma.inventoryMovement.findMany({ where: { referenceId: order.id, movementType: 'RESERVATION_RELEASED' }, select: { quantity: true } })).toEqual([{ quantity: 6 }]);
    expect(await prisma.orderStatusHistory.count({ where: { orderId: order.id, newStatus: 'CANCELLED' } })).toBe(1);
    expect(await prisma.inventoryReservation.count({ where: { orderId: order.id, status: 'ACTIVE' } })).toBe(0);
  });

  it('does not reserve a cancelled Bundle when an edit races cancellation', async () => {
    const chair = await createSku('edit-cancel-chair', 20);
    const bundle = await createBundle('edit-cancel-set', [[chair.sku.id, 2]]);
    const order = await checkoutWith([{ skuId: bundle.sku.id, quantity: 1 }]);

    await Promise.allSettled([
      orders.edit(order.id, { items: [{ skuId: bundle.sku.id, quantity: 2 }] }, operatorId),
      orders.cancel(order.id, operatorId),
    ]);

    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).orderStatus).toBe('CANCELLED');
    expect((await inventoryRow(chair.sku.id)).reserved).toBe(0);
    expect(await prisma.inventoryReservation.count({ where: { orderId: order.id, status: 'ACTIVE' } })).toBe(0);
    expect(await prisma.orderStatusHistory.count({ where: { orderId: order.id, newStatus: 'CANCELLED' } })).toBe(1);
  });

  it('rolls back the first component reservation when a later locked component becomes unavailable', async () => {
    const chair = await createSku('rollback-chair', 1);
    const table = await createSku('rollback-table', 1);
    const components = [chair.sku.id, table.sku.id].sort();
    const bundle = await createBundle('rollback-set', [[components[0]!, 1], [components[1]!, 1]]);
    let release!: () => void;
    let ready!: (pid: number) => void;
    const released = new Promise<void>(resolve => { release = resolve; });
    const lockReady = new Promise<number>(resolve => { ready = resolve; });
    const holder = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM inventory WHERE sku_id = ${components[1]}::uuid FOR UPDATE`;
      const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      ready(pid);
      await released;
      await tx.inventory.update({ where: { skuId_warehouseId: { skuId: components[1]!, warehouseId } }, data: { onHand: 0 } });
    }, { timeout: 10000 });
    const pid = await lockReady;
    const checkout = orders.checkout(input([{ skuId: bundle.sku.id, quantity: 1 }])).then(
      value => ({ status: 'fulfilled' as const, value }),
      reason => ({ status: 'rejected' as const, reason }),
    );
    let outcome: Awaited<typeof checkout>;
    try {
      await expect.poll(async () => {
        const [{ blocked }] = await prisma.$queryRaw<{ blocked: boolean }[]>`
          SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ${pid}::integer = ANY(pg_blocking_pids(pid))) AS blocked
        `;
        return blocked;
      }, { timeout: 3000, interval: 10 }).toBe(true);
    } finally {
      release();
      await holder;
      outcome = await checkout;
    }
    expect(outcome.status).toBe('rejected');
    const first = await inventoryRow(components[0]!);
    const last = await inventoryRow(components[1]!);
    expect([first.onHand, first.reserved, last.onHand, last.reserved]).toEqual([1, 0, 0, 0]);
    expect(await prisma.order.count({ where: { items: { some: { skuId: bundle.sku.id } } } })).toBe(0);
    expect(await prisma.inventoryReservation.count({ where: { skuId: { in: components } } })).toBe(0);
    expect(await prisma.inventoryMovement.count({ where: { skuId: { in: components } } })).toBe(0);
  });

  it.each(['edit', 'ship'])('locks the complete physical inventory set in SKU order for %s', async (action) => {
    const first = await createSku('lock-order-first', 20);
    const second = await createSku('lock-order-second', 20);
    const [lower, higher] = [first.sku.id, second.sku.id].sort();
    const bundle = await createBundle('lock-order-set', [[higher!, 1]]);
    const otherBundle = action === 'ship' ? await createBundle('lock-order-other', [[lower!, 1]]) : null;
    const order = await confirmedOrder([
      { skuId: bundle.sku.id, quantity: action === 'edit' ? 2 : 1 },
      ...(otherBundle ? [{ skuId: otherBundle.sku.id, quantity: 1 }] : []),
    ]);
    let release!: () => void;
    let ready!: (pid: number) => void;
    const released = new Promise<void>(resolve => { release = resolve; });
    const lockReady = new Promise<number>(resolve => { ready = resolve; });
    const holder = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM inventory WHERE sku_id = ${lower}::uuid FOR UPDATE`;
      const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      ready(pid);
      await released;
    }, { timeout: 10000 });
    const pid = await lockReady;
    const operation = (action === 'edit'
      ? orders.edit(order.id, { items: [{ skuId: bundle.sku.id, quantity: 1 }, { skuId: lower!, quantity: 1 }] }, operatorId)
      : orders.ship(order.id, { carrier: 'LBC', items: [
        { orderItemId: order.items.find(item => item.skuId === bundle.sku.id)!.id, quantity: 1 },
        { orderItemId: order.items.find(item => item.skuId === otherBundle!.sku.id)!.id, quantity: 1 },
      ] }, operatorId)
    ).then(value => ({ status: 'fulfilled' as const, value }), reason => ({ status: 'rejected' as const, reason }));
    let higherStillUnlocked = false;
    let outcome: Awaited<typeof operation>;
    try {
      await expect.poll(async () => {
        const [{ blocked }] = await prisma.$queryRaw<{ blocked: boolean }[]>`
          SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ${pid}::integer = ANY(pg_blocking_pids(pid))) AS blocked
        `;
        return blocked;
      }, { timeout: 3000, interval: 10 }).toBe(true);
      higherStillUnlocked = await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM inventory WHERE sku_id = ${higher}::uuid FOR UPDATE NOWAIT`;
        return true;
      }).catch(() => false);
    } finally {
      release();
      await holder;
      outcome = await operation;
    }
    expect(higherStillUnlocked).toBe(true);
    expect(outcome.status).toBe('fulfilled');
    const lowStock = await inventoryRow(lower!);
    const highStock = await inventoryRow(higher!);
    expect([lowStock.onHand, lowStock.reserved, highStock.onHand, highStock.reserved]).toEqual(action === 'ship' ? [19, 0, 19, 0] : [20, 1, 20, 1]);
  });

  it('serializes shipment and cancellation so only one can transition a confirmed Bundle order', async () => {
    const chair = await createSku('ship-cancel-chair', 20);
    const bundle = await createBundle('ship-cancel-set', [[chair.sku.id, 2]]);
    const order = await confirmedOrder([{ skuId: bundle.sku.id, quantity: 1 }]);

    const results = await Promise.allSettled([
      orders.ship(order.id, { carrier: 'LBC', items: [{ orderItemId: order.items[0]!.id, quantity: 1 }] }, operatorId),
      orders.cancel(order.id, operatorId),
    ]);

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const saved = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(['SHIPPING', 'CANCELLED']).toContain(saved.orderStatus);
    const shipped = saved.orderStatus === 'SHIPPING';
    const stock = await inventoryRow(chair.sku.id);
    expect([stock.onHand, stock.reserved]).toEqual(shipped ? [18, 0] : [20, 0]);
    expect(await prisma.shipment.count({ where: { orderId: order.id } })).toBe(shipped ? 1 : 0);
    expect(await prisma.inventoryMovement.count({ where: { referenceId: order.id, movementType: 'SHIPMENT' } })).toBe(shipped ? 1 : 0);
    expect(await prisma.inventoryReservation.count({ where: { orderId: order.id, status: 'ACTIVE' } })).toBe(0);
  });

  it('keeps reservation ownership consistent when merge races cancellation of the dropped order', async () => {
    const chair = await createSku('merge-cancel-chair', 20);
    const bundle = await createBundle('merge-cancel-set', [[chair.sku.id, 2]]);
    const request = input([{ skuId: bundle.sku.id, quantity: 1 }]);
    const first = await orders.checkout(request);
    const second = await orders.checkout(request);
    const primary = await prisma.order.findUniqueOrThrow({ where: { orderNumber: first.orderNumber } });
    const dropped = await prisma.order.findUniqueOrThrow({ where: { orderNumber: second.orderNumber } });

    const [merge] = await Promise.allSettled([
      orders.merge({ primaryOrderId: primary.id, mergedOrderId: dropped.id }, operatorId),
      orders.cancel(dropped.id, operatorId),
    ]);

    const merged = merge.status === 'fulfilled';
    expect((await prisma.order.findUniqueOrThrow({ where: { id: dropped.id } })).orderStatus).toBe('CANCELLED');
    const keptLine = await prisma.orderItem.findFirstOrThrow({ where: { orderId: primary.id } });
    expect(keptLine.quantity).toBe(merged ? 2 : 1);
    expect((await inventoryRow(chair.sku.id)).reserved).toBe(merged ? 4 : 2);
    expect(await prisma.inventoryReservation.count({ where: { orderId: dropped.id, status: 'ACTIVE' } })).toBe(0);
    const keptReservations = await prisma.inventoryReservation.findMany({ where: { orderId: primary.id, status: 'ACTIVE' } });
    expect(keptReservations.reduce((sum, row) => sum + row.quantity, 0)).toBe(merged ? 4 : 2);
    expect(await prisma.orderMergeRecord.count({ where: { primaryOrderId: primary.id, mergedOrderId: dropped.id } })).toBe(merged ? 1 : 0);
  });

  it.each(['checkout', 'edit', 'ship'])('completes %s without borrowing another pool connection inside its transaction', async (action) => {
    const chair = await createSku('pool-chair', 20);
    const bundle = await createBundle('pool-set', [[chair.sku.id, 2]]);
    const existing = action === 'checkout' ? null : await confirmedOrder([{ skuId: bundle.sku.id, quantity: 1 }]);
    let release!: () => void;
    let ready!: () => void;
    let waiting = 0;
    const released = new Promise<void>(resolve => { release = resolve; });
    const allReady = new Promise<void>(resolve => { ready = resolve; });
    const holders = Array.from({ length: 9 }, () => prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_backend_pid()`;
      if (++waiting === 9) ready();
      await released;
    }, { timeout: 10000 }));
    let completed = false;
    let operation: Promise<{ status: 'fulfilled' | 'rejected'; reason?: unknown }> | undefined;
    let outcome: Awaited<typeof operation>;
    try {
      await Promise.race([allReady, Promise.all(holders)]);
      const request = action === 'checkout'
        ? orders.checkout(input([{ skuId: bundle.sku.id, quantity: 1 }]))
        : action === 'edit'
          ? orders.edit(existing!.id, { items: [{ skuId: bundle.sku.id, quantity: 2 }] }, operatorId)
          : orders.ship(existing!.id, { carrier: 'LBC', items: [{ orderItemId: existing!.items[0]!.id, quantity: 1 }] }, operatorId);
      operation = request.then(
        () => { completed = true; return { status: 'fulfilled' as const }; },
        reason => { completed = true; return { status: 'rejected' as const, reason }; },
      );
      await expect.poll(() => completed, { timeout: 2500, interval: 10 }).toBe(true);
    } finally {
      release();
      await Promise.allSettled(holders);
      outcome = await operation;
    }
    expect(outcome?.status).toBe('fulfilled');
    expect((await inventoryRow(chair.sku.id)).reserved).toBe(action === 'ship' ? 0 : action === 'edit' ? 4 : 2);
  });

  it('aggregates overlapping physical demand before reserving a mixed cart', async () => {
    const chair = await createSku('aggregate-chair', 20);
    const table = await createSku('aggregate-table', 20);
    const bundle = await createBundle('aggregate-set', [[chair.sku.id, 2], [table.sku.id, 1]]);

    const order = await checkoutWith([
      { skuId: bundle.sku.id, quantity: 2 },
      { skuId: chair.sku.id, quantity: 1 },
    ]);

    const reservations = await prisma.inventoryReservation.findMany({ where: { orderId: order.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    expect(reservations.map(row => [row.skuId, row.quantity])).toEqual([
      [chair.sku.id, 5], [table.sku.id, 2],
    ].sort(([left], [right]) => String(left).localeCompare(String(right))));
    expect(order.items).toHaveLength(2);
    expect(Number(order.grandTotal)).toBe(750);
  });

  it('cannot over-reserve when an ordinary checkout waits behind a Bundle for the final component', async () => {
    const chair = await createSku('ordinary-race-chair', 1);
    const bundle = await createBundle('ordinary-race-set', [[chair.sku.id, 1]]);
    let release!: () => void;
    let ready!: (pid: number) => void;
    const released = new Promise<void>(resolve => { release = resolve; });
    const lockReady = new Promise<number>(resolve => { ready = resolve; });
    const holder = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM inventory WHERE sku_id = ${chair.sku.id}::uuid FOR UPDATE`;
      const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      ready(pid);
      await released;
    }, { timeout: 15000 });
    const pid = await lockReady;
    const settle = (items: CheckoutInput['items']) => orders.checkout(input(items)).then(
      value => ({ status: 'fulfilled' as const, value }),
      reason => ({ status: 'rejected' as const, reason }),
    );
    const blockedCount = async () => {
      const [{ count }] = await prisma.$queryRaw<{ count: number }[]>`
        WITH RECURSIVE waiting AS (
          SELECT pid, pg_blocking_pids(pid) AS blockers FROM pg_stat_activity
        ), descendants AS (
          SELECT pid FROM waiting WHERE ${pid}::integer = ANY(blockers)
          UNION
          SELECT waiting.pid FROM waiting JOIN descendants ON descendants.pid = ANY(waiting.blockers)
        )
        SELECT count(*)::integer AS count FROM descendants
      `;
      return count;
    };
    const bundleCheckout = settle([{ skuId: bundle.sku.id, quantity: 1 }]);
    let ordinaryCheckout: ReturnType<typeof settle> | undefined;
    let outcomes: Awaited<ReturnType<typeof settle>>[] = [];
    try {
      await expect.poll(blockedCount, { timeout: 3000, interval: 10 }).toBe(1);
      ordinaryCheckout = settle([{ skuId: chair.sku.id, quantity: 1 }]);
      await expect.poll(blockedCount, { timeout: 3000, interval: 10 }).toBe(2);
    } finally {
      release();
      await holder;
      outcomes = await Promise.all(ordinaryCheckout ? [bundleCheckout, ordinaryCheckout] : [bundleCheckout]);
    }

    expect(outcomes.map(outcome => outcome.status)).toEqual(['fulfilled', 'rejected']);
    const stock = await inventoryRow(chair.sku.id);
    expect([stock.onHand, stock.reserved]).toEqual([1, 1]);
    expect(await prisma.inventoryReservation.count({ where: { skuId: chair.sku.id } })).toBe(1);
  });

  it('consumes the components once when two shipments race for the same line', async () => {
    const chair = await createSku('ship-race-chair', 4);
    const bundle = await createBundle('ship-race-set', [[chair.sku.id, 2]]);
    const order = await confirmedOrder([{ skuId: bundle.sku.id, quantity: 1 }]);

    const results = await Promise.allSettled([
      orders.ship(
        order.id,
        { carrier: 'LBC', items: [{ orderItemId: order.items[0]!.id, quantity: 1 }] },
        operatorId,
      ),
      orders.ship(
        order.id,
        { carrier: 'LBC', items: [{ orderItemId: order.items[0]!.id, quantity: 1 }] },
        operatorId,
      ),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await prisma.shipment.count({ where: { orderId: order.id } })).toBe(1);

    const chairRow = await inventoryRow(chair.sku.id);
    expect([chairRow.onHand, chairRow.reserved]).toEqual([2, 0]);
  });
});
