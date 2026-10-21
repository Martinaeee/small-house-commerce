import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { InventoryService } from '../src/modules/inventory/inventory.service.js';
import { BundlesService } from '../src/modules/catalog/bundles.service.js';
import { OrdersService } from '../src/modules/orders/orders.service.js';
import { PromotionService } from '../src/modules/newsletter/promotion.service.js';
import { MarketingTouchService } from '../src/modules/marketing/marketing-touch.service.js';
import { CampaignLinksService } from '../src/modules/marketing/campaign-links.service.js';
import { OptimizersService } from '../src/modules/marketing/optimizers.service.js';
import { CustomerRiskService } from '../src/modules/orders/customer-risk.service.js';
import { CartService } from '../src/modules/cart/cart.service.js';
import { ProductsService } from '../src/modules/catalog/products.service.js';
import { ReviewsService } from '../src/modules/catalog/reviews.service.js';
import { CatalogGraphService } from '../src/modules/catalog/catalog-graph.service.js';
import { catalogGraphPatchSchema } from '../src/modules/catalog/dto/catalog-graph.dto.js';
import { editOrderSchema, type CheckoutInput } from '../src/modules/orders/dto/order.dto.js';

const url = process.env.BUNDLE_TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test') || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
  throw new Error('BUNDLE_TEST_DATABASE_URL must point to an explicitly selected local _test database');
}
const prisma = new PrismaService(new ConfigService({ database: { url } }));
const silentBackInStock = {
  snapshotForChangedSkusWithin: async () => new Map<string, number>(),
  claimTransitionsWithin: async () => [],
  deliverClaims: async () => undefined,
};
const inventory = new InventoryService(prisma, silentBackInStock as never);
const bundles = new BundlesService(prisma);
const optimizers = new OptimizersService(prisma);
const marketingTouch = new MarketingTouchService(prisma, new CampaignLinksService(prisma, optimizers), optimizers, new ConfigService({ jwt: { secret: 'bundle-e2e-only-no-production-secret' } }));
const orders = new OrdersService(
  prisma,
  inventory,
  new CustomerRiskService(prisma),
  marketingTouch,
  new PromotionService(prisma),
  silentBackInStock as never,
);
const carts = new CartService(prisma);
let categoryId: string;
let warehouseId: string;
let operatorId: string;
let serial = 0;

async function checkout(input: CheckoutInput) {
  const result = await orders.checkout(input);
  const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: result.orderNumber } });
  return { ...result, orderId: order.id };
}

async function fixture(onHand = 20) {
  const key = randomUUID();
  const product = await prisma.product.create({ data: { name: `Bundle test ${key}`, slug: `bundle-test-${key}`, categoryId, status: 'ACTIVE' } });
  const makeSku = async (name: string, isBundle = false) => {
    const variant = await prisma.productVariant.create({ data: { productId: product.id, name, combinationKey: name } });
    return prisma.sku.create({ data: { productId: product.id, variantId: variant.id, skuCode: `${key}-${name}`, price: 100, isBundle } });
  };
  const chair = await makeSku('Chair');
  const table = await makeSku('Table');
  const bundle = await makeSku('Bundle', true);
  await prisma.inventory.createMany({ data: [chair, table].map(sku => ({ skuId: sku.id, warehouseId, onHand })) });
  await bundles.setComponents(product.id, bundle.id, { expectedVersion: 0, components: [
    { componentSkuId: chair.id, quantity: 2, position: 0 }, { componentSkuId: table.id, quantity: 1, position: 1 },
  ] });
  const phone = `+639${String(Date.now() % 1000000000 + serial++).padStart(9, '0')}`;
  const input = (items = [{ skuId: bundle.id, quantity: 2 }]): CheckoutInput => ({
    customer: { name: 'Local Bundle test', phone, province: 'Metro Manila', city: 'Quezon City', streetAddress: 'Local test address' },
    items, attribution: { sourceType: 'ORGANIC' }, customerNote: null, promoCode: null,
  });
  const stock = () => prisma.inventory.findMany({ where: { skuId: { in: [chair.id, table.id, bundle.id] } }, orderBy: { skuId: 'asc' } });
  return { product, chair, table, bundle, input, stock };
}

beforeAll(async () => {
  await prisma.$connect();
  const category = await prisma.category.create({ data: { name: 'Bundle test', slug: `bundle-test-${randomUUID()}` } });
  categoryId = category.id;
  const warehouse = await prisma.warehouse.findFirst({ where: { status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } }) ?? await prisma.warehouse.create({ data: { name: 'Bundle test warehouse' } });
  warehouseId = warehouse.id;
  const user = await prisma.user.create({ data: { name: 'Bundle test operator', email: `${randomUUID()}@local.test`, passwordHash: 'not-a-login' } });
  operatorId = user.id;
});
afterAll(async () => { await prisma.$disconnect(); });

describe('Bundle real PostgreSQL lifecycle', () => {
  it('does not reduce physical component stock below existing Bundle reservations', async () => {
    const f = await fixture(5);
    await checkout(f.input());
    await expect(inventory.adjust(f.chair.id, -2, 'Local test adjustment', operatorId)).rejects.toThrow(/reserv/i);
    expect((await f.stock()).find(s => s.skuId === f.chair.id)).toMatchObject({ onHand: 5, reserved: 4 });
  });
  it('blocks publishing an enabled Bundle with no components', async () => {
    const f = await fixture();
    await prisma.skuBundleComponent.deleteMany({ where: { bundleSkuId: f.bundle.id } });
    await prisma.product.update({ where: { id: f.product.id }, data: { status: 'DRAFT' } });
    const products = new ProductsService(prisma, new ReviewsService(prisma), inventory);
    await expect(products.update(f.product.id, { status: 'ACTIVE' })).rejects.toThrow(/Bundle/);
    await expect(products.bulkSetStatus([f.product.id], 'ACTIVE')).rejects.toThrow(/Bundle/);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: f.product.id } })).status).toBe('DRAFT');
  });
  it('rolls back a graph save that activates an unconfigured virtual SKU', async () => {
    const product = await prisma.product.create({ data: { name: 'Local virtual graph', slug: `virtual-graph-${randomUUID()}`, categoryId } });
    const graph = new CatalogGraphService(prisma);
    await expect(graph.applyPatchWithProductMutation(product.id, 0, catalogGraphPatchSchema.parse({
      options: [{ clientKey: 'style', kind: 'STYLE', name: 'Style', position: 0, presentation: 'TEXT', isMediaDriver: false, isActive: true, values: [{ clientKey: 'only', label: 'Bundle', position: 0, isActive: true }] }],
      variants: [{ clientKey: 'virtual', optionValueRefs: [{ clientKey: 'only' }], position: 0, sku: { skuCode: `VIRTUAL-${randomUUID()}`, isBundle: true, status: 'ACTIVE', price: 100 } }],
      media: [],
    }), async tx => { await tx.product.update({ where: { id: product.id }, data: { status: 'ACTIVE' } }); })).rejects.toThrow(/Bundle/);
    expect(await prisma.sku.count({ where: { productId: product.id } })).toBe(0);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).catalogGraphVersion).toBe(0);
  });
  it('exposes derived stock and the virtual marker on the public PDP, not component internals', async () => {
    const f = await fixture();
    const products = new ProductsService(prisma, new ReviewsService(prisma), inventory);
    const product = await products.storefrontGetBySlug(f.product.slug);
    const sku = product.variants.find(v => v.sku?.id === f.bundle.id)?.sku;
    expect(sku).toMatchObject({ isBundle: true, availableInventory: 10 });
    expect(sku).not.toHaveProperty('bundleComponents');
  });
  it('keeps the cart as a Bundle row with derived availability', async () => {
    const f = await fixture();
    const cart = await carts.addItem({ skuId: f.bundle.id, quantity: 2 });
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]).toMatchObject({ skuId: f.bundle.id, availableInventory: 10, unavailable: false });
  });
  it('flags competing Bundle cart lines that exceed shared component stock', async () => {
    const f = await fixture(3);
    const variant = await prisma.productVariant.create({ data: { productId: f.product.id, name: 'Second Bundle', combinationKey: 'second-bundle' } });
    const second = await prisma.sku.create({ data: { productId: f.product.id, variantId: variant.id, skuCode: `SECOND-${randomUUID()}`, price: 100, isBundle: true } });
    await bundles.setComponents(f.product.id, second.id, { expectedVersion: 0, components: [{ componentSkuId: f.chair.id, quantity: 2, position: 0 }] });
    const first = await carts.addItem({ skuId: f.bundle.id, quantity: 1 });
    const cart = await carts.addItem({ cartId: first.cartId, skuId: second.id, quantity: 1 });
    expect(cart.items.map(item => item.availableInventory)).toEqual([1, 1]);
    expect(cart.items.every(item => item.unavailable)).toBe(true);
    const recovered = await carts.removeItem(cart.cartId, cart.items.find(item => item.skuId === second.id)!.itemId);
    expect(recovered.items[0]).toMatchObject({ skuId: f.bundle.id, unavailable: false });
  });
  it('flags shared component demand from Bundle and ordinary cart lines', async () => {
    const f = await fixture(3);
    const first = await carts.addItem({ skuId: f.bundle.id, quantity: 1 });
    const cart = await carts.addItem({ cartId: first.cartId, skuId: f.chair.id, quantity: 2 });
    expect(cart.items.every(item => item.unavailable)).toBe(true);
    const recovered = await carts.updateQuantity(cart.cartId, cart.items.find(item => item.skuId === f.chair.id)!.itemId, 1);
    expect(recovered.items.every(item => !item.unavailable)).toBe(true);
  });
  it('reserves exact components plus overlapping ordinary lines, then cancels once', async () => {
    const f = await fixture();
    const result = await checkout(f.input([{ skuId: f.bundle.id, quantity: 2 }, { skuId: f.chair.id, quantity: 1 }]));
    const detail = await orders.get(result.orderId);
    expect(detail.items).toHaveLength(2);
    expect(detail.items.find(i => i.skuId === f.bundle.id)?.bundleSnapshot).toMatchObject({ version: 1, components: [{ componentSkuId: f.chair.id, totalQuantity: 4 }, { componentSkuId: f.table.id, totalQuantity: 2 }] });
    expect((await f.stock()).find(s => s.skuId === f.chair.id)?.reserved).toBe(5);
    expect(await prisma.inventory.count({ where: { skuId: f.bundle.id } })).toBe(0);
    await orders.cancel(result.orderId, operatorId);
    expect((await f.stock()).every(s => s.reserved === 0 && s.onHand === 20)).toBe(true);
    await expect(orders.cancel(result.orderId, operatorId)).rejects.toThrow();
  });
  it('rejects aggregated shortfalls and rolls back all component reservations', async () => {
    const f = await fixture(4);
    const before = await prisma.order.count();
    await expect(orders.checkout(f.input([{ skuId: f.bundle.id, quantity: 2 }, { skuId: f.chair.id, quantity: 1 }]))).rejects.toThrow(/stock/i);
    expect(await prisma.order.count()).toBe(before);
    expect((await f.stock()).every(s => s.reserved === 0)).toBe(true);
  });
  it('ships the historical definition after the current Bundle definition changes', async () => {
    const f = await fixture();
    const result = await checkout(f.input());
    await bundles.setComponents(f.product.id, f.bundle.id, { expectedVersion: 1, components: [{ componentSkuId: f.table.id, quantity: 3, position: 0 }] });
    await prisma.order.update({ where: { id: result.orderId }, data: { orderStatus: 'CONFIRMED', confirmationStatus: 'CONFIRMED' } });
    const line = (await orders.get(result.orderId)).items[0]!;
    await orders.ship(result.orderId, { carrier: 'Local test', items: [{ orderItemId: line.id, quantity: 1 }] }, operatorId);
    const stock = await f.stock();
    expect(stock.find(s => s.skuId === f.chair.id)).toMatchObject({ onHand: 18, reserved: 2 });
    expect(stock.find(s => s.skuId === f.table.id)).toMatchObject({ onHand: 19, reserved: 1 });
    await orders.updateStatus(result.orderId, 'CANCELLED', 'Local test remainder', operatorId);
    expect((await f.stock()).every(s => s.reserved === 0)).toBe(true);
  });
  it('edits quantities using the saved definition and retains every remaining line reservation', async () => {
    const f = await fixture();
    const result = await checkout(f.input([{ skuId: f.bundle.id, quantity: 2 }, { skuId: f.chair.id, quantity: 2 }]));
    await bundles.setComponents(f.product.id, f.bundle.id, { expectedVersion: 1, components: [{ componentSkuId: f.table.id, quantity: 4, position: 0 }] });
    await orders.edit(result.orderId, { items: [{ skuId: f.bundle.id, quantity: 1 }, { skuId: f.chair.id, quantity: 2 }] }, operatorId);
    expect((await f.stock()).find(s => s.skuId === f.chair.id)?.reserved).toBe(4);
    expect((await f.stock()).find(s => s.skuId === f.table.id)?.reserved).toBe(1);
  });
  it('preserves component reservations when merging Bundle orders', async () => {
    const f = await fixture();
    const first = await checkout(f.input([{ skuId: f.bundle.id, quantity: 1 }]));
    const second = await checkout(f.input([{ skuId: f.bundle.id, quantity: 1 }]));
    await orders.merge({ primaryOrderId: first.orderId, mergedOrderId: second.orderId }, operatorId);
    const active = await prisma.inventoryReservation.findMany({ where: { orderId: first.orderId, status: 'ACTIVE' } });
    expect(active.filter(r => r.skuId === f.chair.id).reduce((sum, r) => sum + r.quantity, 0)).toBe(4);
    expect(active.filter(r => r.skuId === f.table.id).reduce((sum, r) => sum + r.quantity, 0)).toBe(2);
  });
  it('preserves separate historical definitions through merge and line-specific quantity edits', async () => {
    const f = await fixture();
    const first = await checkout(f.input([{ skuId: f.bundle.id, quantity: 1 }]));
    await bundles.setComponents(f.product.id, f.bundle.id, { expectedVersion: 1, components: [{ componentSkuId: f.table.id, quantity: 4, position: 0 }] });
    const second = await checkout(f.input([{ skuId: f.bundle.id, quantity: 1 }]));
    await orders.merge({ primaryOrderId: first.orderId, mergedOrderId: second.orderId }, operatorId);
    const before = await orders.get(first.orderId);
    expect(before.items).toHaveLength(2);
    const input = editOrderSchema.parse({ items: before.items.map((line, index) => ({ orderItemId: line.id, skuId: line.skuId, quantity: index === 0 ? 2 : 1 })) });
    expect(input.items?.[0]).toHaveProperty('orderItemId', before.items[0]!.id);
    const edited = await orders.edit(first.orderId, input, operatorId);
    expect(edited.items).toHaveLength(2);
    expect(edited.items.reduce((sum, line) => sum + line.quantity, 0)).toBe(3);
    const requirements = edited.items.flatMap(line => {
      const snapshot = line.bundleSnapshot as { components: { componentSkuId: string; quantityPerBundle: number }[] };
      return snapshot.components.map(c => ({ skuId: c.componentSkuId, quantity: c.quantityPerBundle * line.quantity }));
    });
    for (const row of await f.stock()) expect(row.reserved).toBe(requirements.filter(r => r.skuId === row.skuId).reduce((sum, r) => sum + r.quantity, 0));
  });
  it('rejects concurrent shipment of the same Bundle line even when other lines hold shared components', async () => {
    const f = await fixture();
    await bundles.setComponents(f.product.id, f.bundle.id, { expectedVersion: 1, components: [{ componentSkuId: f.chair.id, quantity: 2, position: 0 }] });
    const result = await checkout(f.input([{ skuId: f.bundle.id, quantity: 1 }, { skuId: f.chair.id, quantity: 4 }]));
    await prisma.order.update({ where: { id: result.orderId }, data: { orderStatus: 'CONFIRMED', confirmationStatus: 'CONFIRMED' } });
    const line = (await orders.get(result.orderId)).items.find(i => i.skuId === f.bundle.id)!;
    const input = { carrier: 'Local concurrent test', items: [{ orderItemId: line.id, quantity: 1 }] };
    const results = await Promise.allSettled([orders.ship(result.orderId, input, operatorId), orders.ship(result.orderId, input, operatorId)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect((await f.stock()).find(s => s.skuId === f.chair.id)).toMatchObject({ onHand: 18, reserved: 4 });
    await expect(orders.edit(result.orderId, { items: [{ skuId: f.bundle.id, quantity: 2 }] }, operatorId)).rejects.toThrow(/shipp/i);
  });
  it('never resurrects a cancelled Bundle order during simultaneous confirmation', async () => {
    const f = await fixture();
    const result = await checkout(f.input());
    await Promise.allSettled([orders.cancel(result.orderId, operatorId), orders.confirm(result.orderId, operatorId)]);
    expect((await orders.get(result.orderId)).orderStatus).toBe('CANCELLED');
    expect((await f.stock()).every(s => s.reserved === 0)).toBe(true);
  });
  it('retains all visible ordinary quantities and Bundle reservations across concurrent merges', async () => {
    const f = await fixture();
    const input = f.input([{ skuId: f.bundle.id, quantity: 1 }, { skuId: f.chair.id, quantity: 1 }]);
    const a = await checkout(input);
    const b = await checkout(input);
    const c = await checkout(input);
    await Promise.all([
      orders.merge({ primaryOrderId: a.orderId, mergedOrderId: b.orderId }, operatorId),
      orders.merge({ primaryOrderId: a.orderId, mergedOrderId: c.orderId }, operatorId),
    ]);
    const detail = await orders.get(a.orderId);
    expect(detail.items.filter(line => line.skuId === f.chair.id).reduce((sum, line) => sum + line.quantity, 0)).toBe(3);
    expect(detail.items.filter(line => line.skuId === f.bundle.id)).toHaveLength(3);
    expect((await f.stock()).find(s => s.skuId === f.chair.id)?.reserved).toBe(9);
  });
  it('rechecks generic status transitions after acquiring the order lock', async () => {
    const f = await fixture();
    const result = await checkout(f.input());
    await Promise.allSettled([orders.cancel(result.orderId, operatorId), orders.updateStatus(result.orderId, 'PENDING', undefined, operatorId)]);
    expect((await orders.get(result.orderId)).orderStatus).toBe('CANCELLED');
    expect((await f.stock()).every(s => s.reserved === 0)).toBe(true);
  });
  it('allows only one concurrent cancellation', async () => {
    const f = await fixture();
    const result = await checkout(f.input());
    const results = await Promise.allSettled([orders.cancel(result.orderId, operatorId), orders.cancel(result.orderId, operatorId)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect((await f.stock()).every(s => s.reserved === 0)).toBe(true);
  });
  it('atomically reserves the final ordinary stock under simultaneous transactions', async () => {
    const f = await fixture(1);
    const customer = await prisma.customer.create({ data: { name: 'Concurrent test', normalizedPhone: `+639${String(Date.now() % 1000000000 + serial++).padStart(9, '0')}` } });
    const pair = await Promise.all([1, 2].map(async n => prisma.order.create({ data: { orderNumber: `PH${Date.now()}${serial++}${n}`, customerId: customer.id, customerClassification: 'NEW', subtotal: 0, discountTotal: 0, shippingTotal: 0, grandTotal: 0 } })));
    let arrived = 0;
    let open!: () => void;
    const gate = new Promise<void>(resolve => { open = resolve; });
    const results = await Promise.allSettled(pair.map(order => prisma.$transaction(async tx => {
      await tx.inventory.findUnique({ where: { skuId_warehouseId: { skuId: f.chair.id, warehouseId } } });
      if (++arrived === 2) open();
      await gate;
      await inventory.reserveWithin(tx, f.chair.id, warehouseId, 1, order.id);
    })));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect((await f.stock()).find(s => s.skuId === f.chair.id)).toMatchObject({ reserved: 1, onHand: 1 });
  });
});
