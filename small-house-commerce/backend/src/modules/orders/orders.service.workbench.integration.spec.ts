import { ConfigService } from '@nestjs/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../prisma/prisma.service.js';
import { hashCheckoutDraftToken } from '../checkout-drafts/checkout-draft-token.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { BackInStockService } from '../newsletter/back-in-stock.service.js';
import { PromotionService } from '../newsletter/promotion.service.js';
import { QianyiSyncService } from '../qianyi/qianyi-sync.service.js';
import { CustomerRiskService } from './customer-risk.service.js';
import { checkoutSchema, type CheckoutInput } from './dto/order.dto.js';
import { OrdersService } from './orders.service.js';

const database = process.env.ORDER_WORKBENCH_TEST_DATABASE_URL;
if (database) {
  const url = new URL(database);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) ||
      !/^small_house_order_workbench_[a-z0-9_]+$/.test(url.pathname.slice(1)) ||
      url.username !== 'workbench_test') {
    throw new Error('Workbench tests require an explicitly owned local workbench_test database.');
  }
}

// This suite owns a disposable database. No application workers are started;
// real ERP outbox writes are tested, but no delivery or external call is made.
describe.skipIf(!database)('order workbench on PostgreSQL', () => {
  let prisma: PrismaService;
  let orders: OrdersService;
  let qianyi: QianyiSyncService;
  let skuId: string;
  let operatorId: string;
  let warehouseId: string;
  let categoryId: string;

  beforeAll(async () => {
    prisma = new PrismaService(new ConfigService({ database: { url: database } }));
    await prisma.$connect();
    const backInStock = new BackInStockService(prisma, {
      sendWelcome: async () => undefined, sendBackInStock: async () => undefined,
    } as never, new ConfigService({ jwt: { secret: 'test-only-not-a-login'.repeat(2) } }));
    qianyi = new QianyiSyncService(prisma, { enabled: true } as never, new ConfigService({
      qianyi: { shop: 'workbench-test', warehouseId: 1, warehouse: 'Local test', logistics: 'TEST' },
    }));
    orders = new OrdersService(prisma, new InventoryService(prisma, backInStock),
      new CustomerRiskService(prisma), { resolve: async () => null } as never,
      new PromotionService(prisma), backInStock, undefined, qianyi);
  });

  beforeEach(async () => {
    // The URL guard above is mandatory: these are only our disposable fixtures.
    await prisma.$executeRawUnsafe('TRUNCATE customers, products, categories, warehouses, users CASCADE');
    const category = await prisma.category.create({ data: { name: 'Workbench test', slug: 'workbench-test' } });
    categoryId = category.id;
    const product = await prisma.product.create({ data: {
      name: 'Workbench chair', slug: 'workbench-chair', categoryId: category.id, status: 'ACTIVE',
    } });
    const variant = await prisma.productVariant.create({ data: {
      productId: product.id, name: 'Default', combinationKey: 'default',
    } });
    const sku = await prisma.sku.create({ data: {
      productId: product.id, variantId: variant.id, skuCode: 'WB-CHAIR', price: 250,
      qianyiSkuCode: 'WB-CHAIR',
    } });
    skuId = sku.id;
    const warehouse = await prisma.warehouse.create({ data: { name: 'Workbench warehouse' } });
    warehouseId = warehouse.id;
    await prisma.inventory.create({ data: { skuId, warehouseId, onHand: 100 } });
    const operator = await prisma.user.create({ data: {
      name: 'Workbench operator', email: 'workbench@example.invalid', passwordHash: 'not-a-login',
    } });
    operatorId = operator.id;
  });

  afterAll(async () => { await prisma?.$disconnect(); });

  function input(extra: Partial<CheckoutInput> = {}) {
    return checkoutSchema.parse({
      customer: { name: 'Test shopper', phone: '09961234567', province: 'Bulacan',
        city: 'Malolos', barangay: 'San Juan', postalCode: '3000', streetAddress: '1 Test Street' },
      items: [{ skuId, quantity: 2 }], attribution: { sourceType: 'ORGANIC' },
      metaConsent: false, ...extra,
    });
  }

  async function draft() {
    const started = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const token = `${started.getTime().toString(36)}.${randomBytes(32).toString('base64url')}`;
    const checkout = input({ checkoutDraftToken: token, idempotencyKey: randomUUID() });
    const row = await prisma.checkoutDraft.create({ data: {
      tokenHash: hashCheckoutDraftToken(token).hash, tokenIssuedAt: started, createdAt: started,
      clientRevision: 4, hasUserInput: true, expiresAt: new Date(Date.now() + 27 * 86400000),
      snapshot: { customer: checkout.customer, items: checkout.items, customerNote: null,
        preferredDeliveryDate: null, promoCodeApplied: null },
    } });
    return { row, checkout };
  }

  async function reserved() {
    return (await prisma.inventory.findUniqueOrThrow({ where: { skuId_warehouseId: { skuId, warehouseId } } })).reserved;
  }

  // Hold the exact production advisory key until both contenders have finished
  // their optimistic precheck and reached PostgreSQL's lock wait queue.
  async function race(hash: string, contenders: (() => Promise<unknown>)[]) {
    let unlock!: () => void;
    let acquired!: () => void;
    const released = new Promise<void>((resolve) => { unlock = resolve; });
    const ready = new Promise<void>((resolve) => { acquired = resolve; });
    const holder = prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hash}, 0))`;
      acquired();
      await released;
    }, { timeout: 15000 });
    await ready;
    const results = Promise.allSettled(contenders.map((fn) => fn()));
    try {
      const deadline = Date.now() + 5000;
      while (true) {
        const [locks] = await prisma.$queryRaw<{ waiting: number }[]>`
          SELECT count(*)::int AS waiting FROM pg_locks
          WHERE locktype = 'advisory' AND NOT granted AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`;
        if (locks.waiting >= contenders.length) break;
        if (Date.now() > deadline) throw new Error('Contenders did not reach the draft lock');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    } finally {
      unlock();
      await holder;
    }
    return results;
  }

  it('converts manually as CONFIRMED with one stock reservation, provenance and a real ERP outbox row', async () => {
    const { row } = await draft();
    await prisma.checkoutDraft.update({ where: { id: row.id }, data: {
      followUpStatus: 'FOLLOW_UP_LATER', followUpNote: 'Keep this note', assigneeId: operatorId,
    } });
    const created = await orders.convertDraftToOrder(row.id, operatorId, { expectedRevision: 4 });
    expect(await prisma.checkoutDraft.findUniqueOrThrow({ where: { id: row.id } }))
      .toMatchObject({ status: 'CONVERTED', followUpStatus: 'WANTS_TO_BUY',
        followUpNote: 'Keep this note', assigneeId: operatorId, lastContactedAt: expect.any(Date) });
    expect(created).toMatchObject({ orderStatus: 'CONFIRMED', confirmationStatus: 'CONFIRMED',
      confirmedBy: operatorId, draftStartedAt: row.createdAt, workbenchStartedAt: row.createdAt,
      draftConvertedManually: true });
    expect(created.createdAt.getTime()).toBeGreaterThan(row.createdAt.getTime());
    expect(await reserved()).toBe(2);
    expect(await prisma.qianyiSyncJob.count({ where: { orderId: created.id, status: 'PENDING' } })).toBe(1);
    expect(await prisma.orderStatusHistory.count({ where: { orderId: created.id, statusDomain: 'CHECKOUT_DRAFT' } })).toBe(1);
    await prisma.checkoutDraft.delete({ where: { id: row.id } });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: created.id } })).draftStartedAt).toEqual(row.createdAt);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: created.id } })).draftConvertedManually).toBe(true);
  });

  it('returns the same order for two concurrent same-key shopper retries', async () => {
    const { row, checkout } = await draft();
    const results = await race(row.tokenHash, [() => orders.checkout(checkout), () => orders.checkout(checkout)]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    const values = results.map((r) => (r as PromiseFulfilledResult<{ orderNumber: string }>).value.orderNumber);
    expect(new Set(values).size).toBe(1);
    expect(await prisma.order.count()).toBe(1);
    expect(await reserved()).toBe(2);
    expect((await prisma.order.findFirstOrThrow()).draftConvertedManually).toBe(false);
  });

  it.each(['different-key', 'different-details', 'two-operators', 'shopper-operator'])('allows only one conversion for %s contenders', async (kind) => {
    const { row, checkout } = await draft();
    const manual = () => orders.convertDraftToOrder(row.id, operatorId, { expectedRevision: 4 });
    const first = kind === 'two-operators' ? manual : () => orders.checkout(checkout);
    const second = kind === 'different-key' ? () => orders.checkout({ ...checkout, idempotencyKey: randomUUID() })
      : kind === 'different-details' ? () => orders.checkout({ ...checkout, customerNote: 'Different request' }) : manual;
    const results = await race(row.tokenHash, [first, second]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(await prisma.order.count()).toBe(1);
    expect(await reserved()).toBe(2);
    expect((await prisma.checkoutDraft.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('CONVERTED');
  });

  it('rolls back stock, customer, order, draft link, audits and ERP job when enqueue fails after inserting its row', async () => {
    const { row } = await draft();
    const enqueue = qianyi.enqueue.bind(qianyi);
    const failure = vi.spyOn(qianyi, 'enqueue').mockImplementation(async (...args) => {
      await enqueue(...args);
      throw new Error('Injected outbox failure after insert');
    });
    try {
      await expect(orders.convertDraftToOrder(row.id, operatorId, { expectedRevision: 4 })).rejects.toThrow('Injected outbox failure');
      expect(await prisma.order.count()).toBe(0);
      expect(await prisma.customer.count()).toBe(0);
      expect(await prisma.orderStatusHistory.count()).toBe(0);
      expect(await prisma.customerRiskLog.count()).toBe(0);
      expect(await prisma.qianyiSyncJob.count()).toBe(0);
      expect(await reserved()).toBe(0);
      expect(await prisma.checkoutDraft.findUniqueOrThrow({ where: { id: row.id } }))
        .toMatchObject({ status: 'OPEN', orderId: null, clientRevision: 4 });
    } finally { failure.mockRestore(); }
    await expect(orders.convertDraftToOrder(row.id, operatorId, { expectedRevision: 4 }))
      .resolves.toMatchObject({ orderStatus: 'CONFIRMED' });
  });

  it('checks live customer history between rows of the same bulk confirmation', async () => {
    // Use different products so duplicate-item flags do not mask the live gate.
    const first = await orders.checkout(input());
    const otherProduct = await prisma.product.create({ data: {
      name: 'Other chair', slug: 'other-chair', status: 'ACTIVE', categoryId,
    } });
    const variant = await prisma.productVariant.create({ data: {
      productId: otherProduct.id, name: 'Default', combinationKey: 'default',
    } });
    const otherSku = await prisma.sku.create({ data: {
      productId: otherProduct.id, variantId: variant.id, skuCode: 'OTHER', price: 100, qianyiSkuCode: 'OTHER',
    } });
    await prisma.inventory.create({ data: { skuId: otherSku.id, warehouseId, onHand: 100 } });
    const second = await orders.checkout(input({ items: [{ skuId: otherSku.id, quantity: 1 }] }));
    const a = await prisma.order.findUniqueOrThrow({ where: { orderNumber: first.orderNumber } });
    const b = await prisma.order.findUniqueOrThrow({ where: { orderNumber: second.orderNumber } });
    const result = await orders.bulkOrders({ action: 'confirm', ids: [a.id, b.id] }, operatorId);
    expect(result.results[0]).toMatchObject({ id: a.id, ok: true });
    expect(result.results[1]).toMatchObject({ id: b.id, ok: false, error: expect.stringContaining('LIVE_RISK_REVIEW_REQUIRED: RPT') });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: b.id } })).confirmationStatus).toBe('UNCONFIRMED');
    expect(await prisma.qianyiSyncJob.count()).toBe(1);
  });

  it('pages mixed draft and ordinary orders by start time in both directions without changing the real creation filter', async () => {
    const { row, checkout } = await draft();
    const draftOrder = await orders.checkout(checkout);
    const ordinary = await orders.checkout(input({ customer: { ...checkout.customer, phone: '09969876543' } }));
    const waiting1 = await orders.list({ page: 1, pageSize: 1, sort: 'waiting' });
    const waiting2 = await orders.list({ page: 2, pageSize: 1, sort: 'waiting' });
    expect(waiting1.items[0].orderNumber).toBe(draftOrder.orderNumber);
    expect(waiting2.items[0].orderNumber).toBe(ordinary.orderNumber);
    const newest = await orders.list({ page: 1, pageSize: 1, sort: 'newest' });
    expect(newest.items[0].orderNumber).toBe(ordinary.orderNumber);
    const nonDraft = await prisma.order.findUniqueOrThrow({ where: { orderNumber: ordinary.orderNumber } });
    expect(nonDraft.workbenchStartedAt).toEqual(nonDraft.createdAt);
    expect(waiting1.items[0].draftStartedAt).toEqual(row.createdAt);
    const startedDate = row.createdAt.toISOString().slice(0, 10);
    expect((await orders.list({ page: 1, pageSize: 20, dateFrom: startedDate, dateTo: startedDate })).total).toBe(0);
  });

  it('backfills only converted provenance and materializes COALESCE without altering original order creation dates', async () => {
    const sql = readFileSync(new URL('../../../prisma/migrations/20261106120000_add_order_draft_started_at/migration.sql', import.meta.url), 'utf8');
    await prisma.$transaction(async (tx) => {
      // Raw timestamp decoding in adapter-pg expects the server's usual UTC zone.
      await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'UTC'");
      await tx.$executeRawUnsafe('CREATE TEMP TABLE orders (id int, created_at timestamptz(3)) ON COMMIT DROP');
      await tx.$executeRawUnsafe('CREATE TEMP TABLE checkout_drafts (order_id int, created_at timestamptz(3), status text) ON COMMIT DROP');
      await tx.$executeRawUnsafe("INSERT INTO orders VALUES (1, '2026-11-09T00:00:00Z'), (2, '2026-11-08T00:00:00Z'), (3, '2026-11-09T00:00:00Z')");
      await tx.$executeRawUnsafe("INSERT INTO checkout_drafts VALUES (1, '2026-11-06T00:00:00Z', 'CONVERTED'), (3, '2026-11-05T00:00:00Z', 'OPEN')");
      for (const statement of sql.split(';').filter((s) => s.trim())) await tx.$executeRawUnsafe(statement);
      const rows = await tx.$queryRaw<{ id: number; created_at: Date; draft_started_at: Date | null; workbench_started_at: Date }[]>`SELECT * FROM orders ORDER BY workbench_started_at, id`;
      expect(rows.map((r) => r.id)).toEqual([1, 2, 3]);
      expect(rows[0].created_at.toISOString()).toBe('2026-11-09T00:00:00.000Z');
      expect(rows[0].draft_started_at?.toISOString()).toBe('2026-11-06T00:00:00.000Z');
      expect(rows[2].draft_started_at).toBeNull();
      expect(rows[2].workbench_started_at).toEqual(rows[2].created_at);
    });
  });
});
