import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { InventoryService } from '../src/modules/inventory/inventory.service.js';
import { LogisticsEventService } from '../src/modules/orders/logistics-event.service.js';
import { QianyiInboundService } from '../src/modules/qianyi/qianyi-inbound.service.js';
import { QianyiWebhookService } from '../src/modules/qianyi/qianyi-webhook.service.js';
import { QianyiSyncService } from '../src/modules/qianyi/qianyi-sync.service.js';
import { QianyiClient, signQianyiRequest } from '../src/modules/qianyi/qianyi.client.js';

const database = process.env.QIANYI_TEST_DATABASE_URL;
if (!database || process.env.QIANYI_TEST_DB_IS_DISPOSABLE !== '1') {
  throw new Error('Qianyi safety tests require an explicitly disposable database');
}
const url = new URL(database);
if (url.hostname !== '127.0.0.1' || url.port !== '55443' || url.pathname !== '/qianyi_safety_20261029') {
  throw new Error('Qianyi safety tests refuse every database except the dedicated loopback container');
}
const appId = 'isolated-qianyi-app';
const secret = 'isolated-qianyi-secret-00000000';
let warehousePin: string | null = null;
let operatorId = '';
const config = (enabled = true, overrides = {}) => new ConfigService({ qianyi: {
  enabled: String(enabled), appId, appSecret: secret, shop: 'LUWAG- PH', localWarehouseId: warehousePin,
  warehouseId: 71537, warehouse: 'PH-DAVAO-01', logistics: 'SHIPDOC-STD',
  ...overrides,
} });
const prisma = new PrismaService(new ConfigService({ database: { url: database } }));
const inventory = new InventoryService(prisma, {} as never);
const logistics = new LogisticsEventService(prisma);
const services = (enabled = true, overrides = {}) => {
  const settings = config(enabled, overrides);
  const inbound = new QianyiInboundService(prisma, inventory, logistics, settings);
  return new QianyiWebhookService(settings, prisma, inbound);
};
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}
async function until(check: () => Promise<boolean>) {
  const deadline = Date.now() + 5000;
  while (!await check()) {
    if (Date.now() > deadline) throw new Error('Database barrier did not reach the expected state');
    await delay(10);
  }
}
const fields = (serviceType: string, payload: Record<string, unknown>) => {
  const input = { appId, serviceType, bizParam: JSON.stringify(payload), timestamp: String(Date.now()) };
  return { ...input, sign: signQianyiRequest(input, secret) };
};

async function fixture(quantity = 3) {
  const category = await prisma.category.create({ data: { name: 'Safety', slug: randomUUID() } });
  const product = await prisma.product.create({ data: { name: 'Safety chair', slug: randomUUID(), categoryId: category.id, status: 'ACTIVE' } });
  const variant = await prisma.productVariant.create({ data: { productId: product.id, name: 'Default', combinationKey: 'default' } });
  const sku = await prisma.sku.create({ data: { productId: product.id, variantId: variant.id, skuCode: randomUUID(), qianyiSkuCode: 'QY-' + randomUUID(), price: 100 } });
  const warehouse = await prisma.warehouse.create({ data: { name: 'Isolated PH warehouse' } });
  await prisma.inventory.create({ data: { skuId: sku.id, warehouseId: warehouse.id, onHand: 10 } });
  const customer = await prisma.customer.create({ data: { name: 'Isolated buyer', normalizedPhone: '+63917' + String(Date.now()).slice(-7) } });
  const order = await prisma.order.create({ data: {
    orderNumber: 'ISOLATED-' + randomUUID(), customerId: customer.id, orderStatus: 'CONFIRMED',
    confirmationStatus: 'CONFIRMED', handoverCompletedAt: new Date(), qianyiOrderNumber: 'S-' + randomUUID(),
    subtotal: quantity * 100, discountTotal: 0, shippingTotal: 0, grandTotal: quantity * 100,
    items: { create: { skuId: sku.id, productId: product.id, variantId: variant.id, productNameSnapshot: product.name,
      skuCodeSnapshot: sku.skuCode, variantSnapshot: variant.name, quantity, unitPrice: 100, unitDiscount: 0, lineTotal: quantity * 100 } },
  }, include: { items: true } });
  warehousePin = warehouse.id;
  await prisma.$transaction(tx => inventory.reserveWithin(tx, sku.id, warehouse.id, quantity, order.id));
  await prisma.qianyiSyncJob.create({ data: { orderId: order.id, kind: 'PUSH_ORDER', status: 'SENT', attempts: 1,
    externalOrderNumber: order.qianyiOrderNumber, requestPayload: { shop: 'LUWAG- PH', onlineOrderNumber: order.orderNumber,
      _skuMapping: { [order.items[0].id]: sku.qianyiSkuCode }, skuList: [{ sku: sku.qianyiSkuCode, quantity }] } } });
  return { order, sku, warehouse };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const outbound = (f: Fixture, suffix = 'one', quantity = 1, carrier: string | undefined = 'J&T Express') => ({
  onlineOrderNumber: f.order.orderNumber, orderNumber: 'OUT-' + suffix + '-' + f.order.id,
  trackingNumber: 'TRACK-' + suffix + '-' + f.order.id, status: 'SHIPPED', carrier,
  shippingTime: '2026-10-29T10:00:00+08:00', skuList: [{ sku: f.sku.qianyiSkuCode, quantity }],
});
const tracking = (f: Fixture, parcel: ReturnType<typeof outbound>, overrides = {}) => ({
  orderNumber: f.order.qianyiOrderNumber, onlineOrderNumber: f.order.orderNumber,
  trackingNumber: parcel.trackingNumber, carrier: 'J&T Express', status: 'IN_TRANSIT',
  eventTime: '2026-10-29T11:00:00+08:00', ...overrides,
});
const stock = (f: Fixture) => prisma.inventory.findUniqueOrThrow({ where: { skuId_warehouseId: { skuId: f.sku.id, warehouseId: f.warehouse.id } } });
async function businessSnapshot() {
  return {
    orders: await prisma.order.findMany({ orderBy: { id: 'asc' } }),
    inventory: await prisma.inventory.findMany({ orderBy: { id: 'asc' } }),
    reservations: await prisma.inventoryReservation.findMany({ orderBy: { id: 'asc' } }),
    shipments: await prisma.shipment.findMany({ orderBy: { id: 'asc' } }),
    events: await prisma.logisticsEvent.findMany({ orderBy: { id: 'asc' } }),
    movements: await prisma.inventoryMovement.findMany({ orderBy: { id: 'asc' } }),
    history: await prisma.orderStatusHistory.findMany({ orderBy: { id: 'asc' } }),
  };
}
async function failAt(table: 'inventory' | 'inventory_movements') {
  await prisma.$executeRawUnsafe(`CREATE FUNCTION qianyi_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'isolated injected failure'; END $$`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER qianyi_test_failure BEFORE ${table === 'inventory' ? 'UPDATE' : 'INSERT'} ON ${table} FOR EACH ROW EXECUTE FUNCTION qianyi_test_failure()`);
}
async function clearTriggers() {
  for (const table of ['shipments', 'inventory', 'inventory_movements']) {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS qianyi_test_gate ON ${table}`);
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS qianyi_test_failure ON ${table}`);
  }
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS qianyi_test_gate()');
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS qianyi_test_failure()');
}
async function overlap(first: () => Promise<unknown>, second: () => Promise<unknown>) {
  await prisma.$executeRawUnsafe(`CREATE FUNCTION qianyi_test_gate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(79261029); RETURN NEW; END $$`);
  await prisma.$executeRawUnsafe('CREATE TRIGGER qianyi_test_gate BEFORE INSERT ON shipments FOR EACH ROW EXECUTE FUNCTION qianyi_test_gate()');
  const ready = deferred();
  const release = deferred();
  const held = prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(79261029)::text`;
    ready.resolve();
    await release.promise;
  }, { timeout: 15000 });
  await ready.promise;
  const one = first();
  let two: Promise<unknown> | undefined;
  try {
    await until(async () => Number((await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'`)[0].count) >= 1);
    two = second();
    await until(async () => Number((await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'`)[0].count) >= 2);
  } finally {
    release.resolve();
    await held;
  }
  return Promise.all([one, two]);
}

describe('Qianyi safety on disposable PostgreSQL', { timeout: 20000 }, () => {
  beforeAll(async () => {
    await prisma.$connect();
    operatorId = (await prisma.user.create({ data: { email: `operator-${randomUUID()}@isolated.test`,
      name: 'Isolated operator', passwordHash: 'not-used' } })).id;
  });
  beforeEach(async () => {
    await clearTriggers();
    await prisma.$executeRawUnsafe('TRUNCATE customers, categories, warehouses, qianyi_webhook_events RESTART IDENTITY CASCADE');
  });
  afterAll(async () => { await clearTriggers(); await prisma.$disconnect(); });

  it('P0-01: concurrent identical first deliveries consume inventory only once', async () => {
    const f = await fixture(); const hooks = services(); const input = fields('PUSH_ODO_ORDER', outbound(f));
    await overlap(() => hooks.ingest(input), () => services().ingest(input));
    expect(await prisma.shipment.count()).toBe(1);
    expect((await stock(f))).toMatchObject({ onHand: 9, reserved: 2 });
    expect(await prisma.inventoryMovement.count({ where: { movementType: 'SHIPMENT' } })).toBe(1);
  });

  it('P0-02: different concurrent callback identities for one outbound still create one parcel', async () => {
    const f = await fixture(); const payload = outbound(f);
    await overlap(() => services().ingest(fields('PUSH_ODO_ORDER', { ...payload, city: 'Davao' })),
      () => services().ingest(fields('PUSH_ODO_ORDER', { ...payload, city: 'Manila' })));
    expect(await prisma.shipment.count()).toBe(1);
    expect((await stock(f))).toMatchObject({ onHand: 9, reserved: 2 });
  });

  it('P0-03: repeated delivery is idempotent after success', async () => {
    const f = await fixture(); const input = fields('PUSH_ODO_ORDER', outbound(f)); const hooks = services();
    expect(await hooks.ingest(input)).toMatchObject({ ok: true });
    const before = await businessSnapshot();
    expect(await hooks.ingest(input)).toMatchObject({ ok: true, duplicated: true });
    expect(await businessSnapshot()).toEqual(before);
  });

  it.each(['inventory', 'inventory_movements'] as const)('P0-04/%s: failure between shipment and stock writes rolls back and can retry', async table => {
    const f = await fixture(); const input = fields('PUSH_ODO_ORDER', outbound(f)); const hooks = services();
    const before = await businessSnapshot(); await failAt(table);
    expect(await hooks.ingest(input)).toMatchObject({ ok: false, retryable: true });
    expect(await businessSnapshot()).toEqual(before);
    expect((await prisma.qianyiWebhookEvent.findFirstOrThrow()).processedAt).toBeNull();
    await clearTriggers();
    expect(await hooks.ingest(input)).toMatchObject({ ok: true });
    expect(await prisma.shipment.count()).toBe(1);
    expect((await stock(f))).toMatchObject({ onHand: 9, reserved: 2 });
  });

  it('P0-05: concurrent retries of a failed archive do not repeat inventory consumption', async () => {
    const f = await fixture(); const input = fields('PUSH_ODO_ORDER', outbound(f));
    await failAt('inventory'); await services().ingest(input); await clearTriggers();
    await overlap(() => services().ingest(input), () => services().ingest(input));
    expect(await prisma.shipment.count()).toBe(1);
    expect((await stock(f))).toMatchObject({ onHand: 9, reserved: 2 });
  });

  it('P0-06: database rejects duplicate outbound identity even without the service precheck', async () => {
    const f = await fixture(); await services().ingest(fields('PUSH_ODO_ORDER', outbound(f)));
    const parcel = await prisma.shipment.findFirstOrThrow();
    await expect(prisma.shipment.create({ data: { orderId: f.order.id, warehouseId: f.warehouse.id,
      carrier: 'J&T Express', shippedAt: new Date(), qianyiOutboundNumber: parcel.qianyiOutboundNumber } })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('P0-07: signed callbacks while disabled are durably deferred without business changes', async () => {
    const f = await fixture(); const before = await businessSnapshot();
    const result = await services(false).ingest(fields('PUSH_ODO_ORDER', outbound(f)));
    expect(await businessSnapshot()).toEqual(before);
    expect(result).toMatchObject({ ok: true, deferred: true });
    expect(await prisma.qianyiWebhookEvent.findFirstOrThrow()).toMatchObject({ processedAt: null, error: 'INTEGRATION_DISABLED' });
  });

  it('P0-08: disabled does not accept invalid signatures or a different app id', async () => {
    const f = await fixture(); const input = fields('PUSH_ODO_ORDER', outbound(f));
    expect(await services(false).ingest({ ...input, sign: '0'.repeat(32) })).toMatchObject({ ok: false });
    const foreign = { ...input, appId: 'different-app' };
    expect(await services(false).ingest({ ...foreign, sign: signQianyiRequest(foreign, secret) })).toMatchObject({ ok: false });
    expect(await prisma.qianyiWebhookEvent.count()).toBe(0);
    expect(await prisma.shipment.count()).toBe(0);
  });

  it('P0-09: incomplete configuration cannot process a signed callback or start the client', async () => {
    const f = await fixture(); const before = await businessSnapshot();
    await services(true, { shop: '' }).ingest(fields('PUSH_ODO_ORDER', outbound(f)));
    expect(await businessSnapshot()).toEqual(before);
    const client = new QianyiClient(config(true, { appSecret: '' }));
    expect(client.enabled).toBe(false);
    await expect(client.call('CREATE_AND_AUDIT_SALES_ORDER', 'salesOrder', {})).rejects.toThrow();
  });

  it('P0-10: re-enable replays a deferred callback once', async () => {
    const f = await fixture(); const input = fields('PUSH_ODO_ORDER', outbound(f));
    await services(false).ingest(input);
    expect(await prisma.shipment.count()).toBe(0);
    const hooks = services();
    await (hooks as QianyiWebhookService & { processDeferred(): Promise<number> }).processDeferred();
    expect(await prisma.shipment.count()).toBe(1);
    await hooks.ingest(input);
    expect((await stock(f))).toMatchObject({ onHand: 9, reserved: 2 });
  });

  it('I-warehouse: a missing local warehouse pin blocks outbound instead of choosing a default', async () => {
    const f = await fixture(); const before = await businessSnapshot();
    expect(await services(true, { localWarehouseId: null }).ingest(fields('PUSH_ODO_ORDER', outbound(f)))).toMatchObject({ ok: false });
    expect(await businessSnapshot()).toEqual(before);
  });

  it('I-mapping: outbound uses the mapping frozen at send time, not an edited live code', async () => {
    const f = await fixture(); const payload = outbound(f);
    await prisma.sku.update({ where: { id: f.sku.id }, data: { qianyiSkuCode: 'EDITED-CODE' } });
    expect(await services().ingest(fields('PUSH_ODO_ORDER', payload))).toMatchObject({ ok: true });
    expect((await stock(f)).onHand).toBe(9);
    expect((await prisma.shipmentItem.findFirstOrThrow()).quantity).toBe(1);
  });

  it('I-bundle: virtual Bundle outbound consumes its frozen physical components', async () => {
    const f = await fixture(1);
    const variant = await prisma.productVariant.create({ data: { productId: f.sku.productId, name: 'Component', combinationKey: 'component' } });
    const component = await prisma.sku.create({ data: { productId: f.sku.productId, variantId: variant.id, skuCode: 'COMPONENT', price: 30 } });
    await prisma.inventoryReservation.deleteMany({ where: { orderId: f.order.id } });
    await prisma.inventory.deleteMany({ where: { skuId: f.sku.id } });
    await prisma.inventoryMovement.deleteMany({ where: { skuId: f.sku.id } });
    await prisma.sku.update({ where: { id: f.sku.id }, data: { isBundle: true } });
    await prisma.inventory.create({ data: { skuId: component.id, warehouseId: f.warehouse.id, onHand: 10 } });
    await prisma.$transaction(tx => inventory.reserveWithin(tx, component.id, f.warehouse.id, 2, f.order.id));
    await prisma.orderItem.update({ where: { id: f.order.items[0].id }, data: { bundleSnapshot: {
      version: 1, bundleSkuId: f.sku.id, bundleSkuCode: f.sku.skuCode,
      components: [{ componentSkuId: component.id, skuCode: 'COMPONENT', productName: 'Physical chair', variantName: 'Default', quantity: 2, totalQuantity: 2, position: 0 }],
    } } });
    expect(await services().ingest(fields('PUSH_ODO_ORDER', outbound(f)))).toMatchObject({ ok: true });
    expect(await prisma.inventory.findFirstOrThrow({ where: { skuId: component.id } })).toMatchObject({ onHand: 8, reserved: 0 });
    expect(await prisma.inventoryMovement.count({ where: { skuId: f.sku.id } })).toBe(0);
  });

  it('P1-01: same status/time at different places survives both archive and logistics', async () => {
    const f = await fixture(); const parcel = outbound(f); const hooks = services();
    await hooks.ingest(fields('PUSH_ODO_ORDER', parcel));
    for (const city of ['Davao', 'Manila']) await hooks.ingest(fields('PUSH_TRACKING_PACKAGE', tracking(f, parcel, { city })));
    const events = await prisma.logisticsEvent.findMany({ where: { normalizedStatus: 'IN_TRANSIT' }, orderBy: { city: 'asc' } });
    expect(events.map(e => e.city)).toEqual(['Davao', 'Manila']);
    expect(events.every(e => e.eventTime.toISOString() === '2026-10-29T03:00:00.000Z')).toBe(true);
  });

  it('P1-02: same status/place at different eventTime values remains two nodes', async () => {
    const f = await fixture(); const parcel = outbound(f); const hooks = services();
    await hooks.ingest(fields('PUSH_ODO_ORDER', parcel));
    for (const eventTime of ['2026-10-29T11:00:00+08:00', '2026-10-29T12:00:00+08:00']) {
      await hooks.ingest(fields('PUSH_TRACKING_PACKAGE', tracking(f, parcel, { city: 'Manila', eventTime })));
    }
    expect(await prisma.logisticsEvent.count({ where: { normalizedStatus: 'IN_TRANSIT' } })).toBe(2);
  });

  it('P1-03: stable vendor event id collapses a retried event with changed descriptive fields', async () => {
    const f = await fixture(); const parcel = outbound(f); const hooks = services();
    await hooks.ingest(fields('PUSH_ODO_ORDER', parcel));
    await hooks.ingest(fields('PUSH_TRACKING_PACKAGE', tracking(f, parcel, { eventId: 'vendor-scan-123', city: 'Davao' })));
    await hooks.ingest(fields('PUSH_TRACKING_PACKAGE', tracking(f, parcel, { eventId: 'vendor-scan-123', city: 'Davao City' })));
    expect(await prisma.logisticsEvent.count({ where: { normalizedStatus: 'IN_TRANSIT' } })).toBe(1);
    expect(await prisma.qianyiWebhookEvent.count({ where: { serviceType: 'PUSH_TRACKING_PACKAGE' } })).toBe(1);
  });

  it('P1-04: older placeholder and empty callbacks do not overwrite a real carrier', async () => {
    const f = await fixture(); const parcel = outbound(f); const hooks = services();
    await hooks.ingest(fields('PUSH_ODO_ORDER', parcel));
    for (const carrier of ['SHIPDOC', '', '   ']) await hooks.ingest(fields('PUSH_SALES_ORDER_SHIPPING_INFO', { ...parcel, carrier, shippingTime: '2026-10-29T09:00:00+08:00' }));
    expect((await prisma.shipment.findFirstOrThrow()).carrier).toBe('J&T Express');
  });

  it('P1-05: shipping-info arriving first supplies the carrier to outbound', async () => {
    const f = await fixture(); const parcel = outbound(f); const hooks = services();
    await hooks.ingest(fields('PUSH_SALES_ORDER_SHIPPING_INFO', parcel));
    await hooks.ingest(fields('PUSH_ODO_ORDER', { ...parcel, carrier: undefined }));
    expect((await prisma.shipment.findFirstOrThrow()).carrier).toBe('J&T Express');
  });

  it('P1-06: onlineOrderId and waybill associate tracking and real carrier with the second parcel', async () => {
    const f = await fixture(); const first = outbound(f, 'first', 1, ''); const second = outbound(f, 'second', 1, ''); const hooks = services();
    await hooks.ingest(fields('PUSH_ODO_ORDER', first)); await hooks.ingest(fields('PUSH_ODO_ORDER', second));
    const { onlineOrderNumber: _, ...scan } = tracking(f, second);
    await hooks.ingest(fields('PUSH_TRACKING_PACKAGE', { ...scan, onlineOrderId: f.order.orderNumber, city: 'Quezon' }));
    const event = await prisma.logisticsEvent.findFirst({ where: { normalizedStatus: 'IN_TRANSIT' }, include: { shipment: true } });
    expect(event?.shipment.trackingNumber).toBe(second.trackingNumber);
    expect(event?.shipment.carrier).toBe('J&T Express');
    expect((await prisma.shipment.findFirstOrThrow({ where: { trackingNumber: first.trackingNumber } })).carrier).toBe('SHIPDOC');
  });

  it('P1-07: only fully shipped and fully delivered orders reach SIGNED, without changing COD payment', async () => {    const f = await fixture(2); const first = outbound(f, 'first'); const second = outbound(f, 'second'); const hooks = services();
    await hooks.ingest(fields('PUSH_ODO_ORDER', first));
    await hooks.ingest(fields('PUSH_TRACKING_PACKAGE', tracking(f, first, { status: 'DELIVERED' })));
    expect((await prisma.shipment.findFirstOrThrow()).status).toBe('SIGNED');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: f.order.id } })).orderStatus).toBe('SHIPPING');
    await hooks.ingest(fields('PUSH_ODO_ORDER', second));
    await hooks.ingest(fields('PUSH_TRACKING_PACKAGE', tracking(f, second, { status: 'DELIVERED' })));
    expect(await prisma.shipment.count({ where: { status: 'SIGNED' } })).toBe(2);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: f.order.id } })).toMatchObject({ orderStatus: 'SIGNED', paymentStatus: 'COD_PENDING' });
    await hooks.ingest(fields('PUSH_TRACKING_PACKAGE', tracking(f, second, { status: 'IN_TRANSIT', eventTime: '2026-10-29T10:30:00+08:00' })));
    expect((await prisma.order.findUniqueOrThrow({ where: { id: f.order.id } })).orderStatus).toBe('SIGNED');
  });

  it('P1-08: a tracking callback that names no parcel is refused on a multi-parcel order', async () => {
    const f = await fixture(); const hooks = services();
    await hooks.ingest(fields('PUSH_ODO_ORDER', outbound(f, 'first')));
    await hooks.ingest(fields('PUSH_ODO_ORDER', outbound(f, 'second')));
    const before = await prisma.logisticsEvent.count();
    expect(await hooks.ingest(fields('PUSH_TRACKING_PACKAGE', {
      onlineOrderNumber: f.order.orderNumber, status: 'IN_TRANSIT', eventTime: '2026-10-29T11:00:00+08:00',
    }))).toMatchObject({ ok: false, retryable: true });
    expect(await prisma.logisticsEvent.count()).toBe(before);
    expect(await prisma.shipment.count()).toBe(2);
  });

  it('P0-16: an enqueued push, its delivery and the outbound form one closed chain', async () => {
    const f = await fixture();
    await prisma.qianyiSyncJob.deleteMany({ where: { orderId: f.order.id } });
    await prisma.$transaction(tx => syncWith(async () => []).enqueue(tx, 'PUSH_ORDER', f.order.id));
    const created = await jobOf(f);
    expect(created).toMatchObject({ status: 'PENDING', autoCreateAttempts: 0 });
    expect(created.requestPayload).toMatchObject({ onlineOrderNumber: f.order.orderNumber });
    expect((created.requestPayload as Record<string, unknown>)._skuMapping).toEqual({ [f.order.items[0].id]: f.sku.qianyiSkuCode });

    const calls: string[] = [];
    await syncWith(async type => { calls.push(type); return type === 'QUERY_SALES_ORDER_LIST' ? [] : { orderNumber: 'S-CHAIN' }; }).processPending();
    expect(calls).toEqual(['QUERY_SALES_ORDER_LIST', 'CREATE_AND_AUDIT_SALES_ORDER']);
    expect(await jobOf(f)).toMatchObject({ status: 'SENT', externalOrderNumber: 'S-CHAIN' });

    await services().ingest(fields('PUSH_ODO_ORDER', outbound(f, 'chain')));
    expect(await prisma.shipment.count()).toBe(1);
    expect(await stock(f)).toMatchObject({ onHand: 9, reserved: 2 });
  });

  const resetJob = (f: Fixture, data: Record<string, unknown>) =>
    prisma.qianyiSyncJob.update({ where: { orderId_kind: { orderId: f.order.id, kind: 'PUSH_ORDER' } }, data });
  const syncWith = (call: (type: string) => Promise<unknown>) =>
    new QianyiSyncService(prisma, { enabled: true, call } as never, config());
  const jobOf = (f: Fixture) => prisma.qianyiSyncJob.findUniqueOrThrow({ where: { orderId_kind: { orderId: f.order.id, kind: 'PUSH_ORDER' } } });

  it('P0-11: a worker delivers a queued push exactly once', async () => {
    const f = await fixture();
    await resetJob(f, { status: 'PENDING', attempts: 0, autoCreateAttempts: 0, nextAttemptAt: new Date(Date.now() - 1000) });
    const calls: string[] = [];
    await syncWith(async type => { calls.push(type); return type === 'QUERY_SALES_ORDER_LIST' ? [] : { orderNumber: 'S-FIRST' }; }).processPending();
    expect(calls).toEqual(['QUERY_SALES_ORDER_LIST', 'CREATE_AND_AUDIT_SALES_ORDER']);
    expect(await jobOf(f)).toMatchObject({ status: 'SENT', externalOrderNumber: 'S-FIRST', pendingReview: false });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: f.order.id } })).qianyiOrderNumber).toBe('S-FIRST');
  });

  it('P0-12: an unknown create outcome stops automatic resend and needs a manual authorization', async () => {
    const f = await fixture();
    await resetJob(f, { status: 'PENDING', attempts: 0, autoCreateAttempts: 0, nextAttemptAt: new Date(Date.now() - 1000) });
    let creates = 0;
    await syncWith(async type => {
      if (type === 'QUERY_SALES_ORDER_LIST') return [];
      creates += 1;
      throw new Error('socket hang up');
    }).processPending();
    expect(creates).toBe(1);
    expect(await jobOf(f)).toMatchObject({ status: 'FAILED', pendingReview: true, autoCreateAttempts: 1 });

    const later = syncWith(async type => { if (type === 'QUERY_SALES_ORDER_LIST') return []; creates += 1; return { orderNumber: 'S-LATE' }; });
    await later.processPending();
    expect(creates).toBe(1);
    expect((await later.retry((await jobOf(f)).id, operatorId)).ok).toBe(false);
    expect((await later.authorizeCreateRetry((await jobOf(f)).id, operatorId, false)).ok).toBe(false);
    expect((await later.authorizeCreateRetry((await jobOf(f)).id, operatorId, true)).ok).toBe(true);
    await until(async () => (await jobOf(f)).status === 'SENT');
    expect(creates).toBe(2);
    expect(await jobOf(f)).toMatchObject({ status: 'SENT', autoCreateAttempts: 1 });
  });

  it('P0-13: a worker that died mid-request is recovered as review, never resent', async () => {
    const f = await fixture();
    await resetJob(f, { status: 'SENDING', attempts: 1, autoCreateAttempts: 1,
      claimedAt: new Date(Date.now() - 60 * 60 * 1000), nextAttemptAt: new Date(Date.now() - 1000) });
    const calls: string[] = [];
    await syncWith(async type => { calls.push(type); return []; }).processPending();
    expect(calls).toEqual([]);
    expect(await jobOf(f)).toMatchObject({ status: 'FAILED', pendingReview: true });
  });

  it('P0-14: cancelling a queued push prevents any create', async () => {
    const f = await fixture();
    await resetJob(f, { status: 'PENDING', attempts: 0, autoCreateAttempts: 0 });
    const sync = syncWith(async type => { throw new Error(`unexpected ${type}`); });
    const outcome = await prisma.$transaction(tx => sync.cancelWithin(tx, f.order.id, operatorId));
    expect(outcome).toBe('cancelled');
    expect(await jobOf(f)).toMatchObject({ status: 'CANCELLED', lastAction: `cancelled by ${operatorId} from PENDING` });
  });

  it('P0-15: a cancelled order cannot be re-queued by a stale confirmation', async () => {
    const f = await fixture();
    await resetJob(f, { status: 'CANCELLED' });
    await prisma.$transaction(tx => syncWith(async () => []).enqueue(tx, 'PUSH_ORDER', f.order.id));
    expect(await jobOf(f)).toMatchObject({ status: 'CANCELLED' });
  });
});
