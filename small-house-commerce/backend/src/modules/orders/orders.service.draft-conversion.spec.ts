import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { createRequire } from 'node:module';
import { idempotencyFingerprint } from './order-idempotency.js';
import { checkoutSchema } from './dto/order.dto.js';
import { OrdersService } from './orders.service.js';

const OPERATOR = '00000000-0000-4000-8000-0000000000b1';
const SKU = '11111111-1111-4111-8111-111111111111';
const snapshot = {
  customer: {
    name: 'Marisol Reyes',
    phone: '09171224466',
    province: 'Bulacan',
    city: 'Malolos',
    barangay: 'San Juan',
    postalCode: '3000',
    streetAddress: '12 Mabini St',
    landmark: '',
  },
  items: [{ skuId: SKU, quantity: 2 }],
  preferredDeliveryDate: '2026-11-20',
  promoCodeApplied: null,
  customerNote: 'Call before delivery',
};

function harness() {
  const draft = {
    id: 'draft-1',
    tokenHash: 'hash-1',
    clientRevision: 4,
    status: 'OPEN',
    orderId: null as string | null,
    createdAt: new Date('2026-11-06T02:00:00Z'),
    expiresAt: new Date('2026-12-06T02:00:00Z'),
    snapshot: structuredClone(snapshot),
  };
  const created = {
    id: 'order-1',
    orderNumber: 'PH100001',
    orderStatus: 'NEW',
    confirmationStatus: 'UNCONFIRMED',
    customerClassification: 'NEW',
    customerId: 'cust-1',
    riskFlags: [],
    grandTotal: new Prisma.Decimal(398),
  };
  const tx = {
    $queryRaw: vi.fn(async (s: TemplateStringsArray) =>
      s.join('').includes('nextval') ? [{ nextval: 1n }] : [],
    ),
    $executeRaw: vi.fn(async (_strings: TemplateStringsArray, ..._values: unknown[]) => 1),
    checkoutDraft: {
      findUnique: vi.fn(async () => draft),
      update: vi.fn(async () => draft),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    customer: { upsert: vi.fn(async () => ({ id: 'cust-1' })) },
    sku: {
      findUnique: vi.fn(async () => ({
        id: SKU,
        skuCode: 'CHAIR-1',
        status: 'ACTIVE',
        price: new Prisma.Decimal(199),
        landedCost: null,
        isBundle: false,
        bundleComponents: [],
        variant: {
          id: 'variant-1',
          name: 'Single',
          productId: 'product-1',
          product: { id: 'product-1', name: 'Chair', status: 'ACTIVE' },
        },
      })),
    },
    order: {
      create: vi.fn(async (_args: unknown) => created),
      update: vi.fn(async (_args: unknown) => created),
      findMany: vi.fn(async () => [] as unknown[]),
      findUnique: vi.fn(async () => created),
    },
    orderStatusHistory: { create: vi.fn(async (_args: unknown) => ({})) },
    customerRiskLog: { create: vi.fn(async () => ({})) },
    customerNote: { create: vi.fn(async () => ({})) },
  };
  const prisma = {
    checkoutDraft: tx.checkoutDraft,
    order: tx.order,
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
  };
  const inventory = {
    defaultWarehouse: vi.fn(async () => ({ id: 'wh-1' })),
    availableBySku: vi.fn(async () => new Map([[SKU, 10]])),
    reserveWithin: vi.fn(async () => undefined),
  };
  const risk = {
    classifyForNewOrder: vi.fn(async () => ({
      classification: 'NEW',
      reason: 'No prior orders',
      previousOrderId: null,
    })),
    logRisk: vi.fn(async () => undefined),
    markDuplicates: vi.fn(async () => undefined),
  };
  const qianyi = { enqueue: vi.fn(async () => undefined) };
  const meta = { enqueuePurchase: vi.fn(async () => true) };
  const service = new OrdersService(
    prisma as never,
    inventory as never,
    risk as never,
    { resolve: vi.fn(async () => null) } as never,
    { resolveForCheckout: vi.fn(async () => null) } as never,
    { deliverClaims: vi.fn(async () => undefined) } as never,
    meta as never,
    qianyi as never,
  );
  service.get = vi.fn(async () => ({
    ...created,
    orderStatus: 'CONFIRMED',
  })) as never;
  return { service, prisma, tx, inventory, risk, qianyi, meta, draft };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-07T12:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('manual draft conversion', () => {
  it('acquires the draft lock without decoding the PostgreSQL void result', async () => {
    const { service, tx } = harness();
    // Keep the real production adapter: its result decoder rejects OID 2278.
    // Only the network boundary is replaced with PostgreSQL's wire result.
    const { Pool } = createRequire(import.meta.resolve('@prisma/adapter-pg'))('pg');
    const pool = new Pool();
    vi.spyOn(pool, 'query').mockResolvedValue({
      fields: [{ name: 'pg_advisory_xact_lock', dataTypeID: 2278 }],
      rows: [['']], rowCount: 1,
    } as never);
    const adapter = await new PrismaPg(pool).connect();
    const originalQuery = tx.$queryRaw.getMockImplementation()!;
    tx.$queryRaw.mockImplementation(async (strings) =>
      strings.join('').includes('pg_advisory_xact_lock')
        ? adapter.queryRaw({ sql: strings.join('$1'), args: [], argTypes: [] }) as never
        : originalQuery(strings),
    );
    tx.$executeRaw.mockImplementation(async (...args: unknown[]) => {
      const strings = args[0] as TemplateStringsArray;
      if (strings.join('').includes('pg_advisory_xact_lock')) {
        return adapter.executeRaw({ sql: strings.join('$1'), args: [], argTypes: [] });
      }
      return 1;
    });
    try {
      await expect(service.convertDraftToOrder('draft-1', OPERATOR))
        .resolves.toMatchObject({ orderStatus: 'CONFIRMED' });
    } finally {
      await adapter.dispose();
      await pool.end();
    }
  });

  it('locks, reserves, creates CONFIRMED, links the draft and queues ERP inside one transaction', async () => {
    const { service, prisma, tx, qianyi, inventory, meta } = harness();
    await service.convertDraftToOrder('draft-1', OPERATOR);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(
      tx.$executeRaw.mock.calls.some((c) =>
        (c[0] as TemplateStringsArray).join('').includes('pg_advisory_xact_lock'),
      ),
    ).toBe(true);
    expect(tx.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          orderStatus: 'CONFIRMED',
          confirmationStatus: 'CONFIRMED',
          confirmedBy: OPERATOR,
          draftStartedAt: new Date('2026-11-06T02:00:00Z'),
          workbenchStartedAt: new Date('2026-11-06T02:00:00Z'),
          draftConvertedManually: true,
        }),
      }),
    );
    expect(inventory.reserveWithin).toHaveBeenCalledWith(
      tx,
      SKU,
      'wh-1',
      2,
      'order-1',
    );
    expect(tx.checkoutDraft.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'CONVERTED',
          orderId: 'order-1',
        }),
      }),
    );
    expect(qianyi.enqueue).toHaveBeenCalledWith(tx, 'PUSH_ORDER', 'order-1');
    expect(meta.enqueuePurchase).not.toHaveBeenCalled();
    const domains = tx.orderStatusHistory.create.mock.calls.map(
      (c) => (c[0] as { data: { statusDomain: string } }).data.statusDomain,
    );
    expect(domains).toContain('CHECKOUT_DRAFT');
  });

  it('rejects a stale revision before stock or order creation', async () => {
    const { service, tx } = harness();
    await expect(
      service.convertDraftToOrder('draft-1', OPERATOR, { expectedRevision: 3 }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.order.create).not.toHaveBeenCalled();
  });

  it('rechecks the locked row rather than trusting a pre-read OPEN draft', async () => {
    const { service, tx, draft } = harness();
    tx.checkoutDraft.findUnique
      .mockResolvedValueOnce(draft)
      .mockResolvedValueOnce({
        ...draft,
        status: 'CONVERTED',
        orderId: 'order-1',
      });
    await expect(
      service.convertDraftToOrder('draft-1', OPERATOR),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.order.create).not.toHaveBeenCalled();
  });

  it('requires the operator to acknowledge live RPT/RECHECK risk before creating an order', async () => {
    const { service, tx, risk } = harness();
    risk.classifyForNewOrder.mockResolvedValue({
      classification: 'RPT',
      reason: 'Active previous order',
      previousOrderId: null,
    });
    await expect(
      service.convertDraftToOrder('draft-1', OPERATOR),
    ).rejects.toThrow('DRAFT_RISK_REVIEW_REQUIRED');
    expect(tx.order.create).not.toHaveBeenCalled();
    await service.convertDraftToOrder('draft-1', OPERATOR, {
      riskReviewed: true,
    });
    expect(tx.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          confirmationStatus: 'CONFIRMED',
          customerClassification: 'RPT',
        }),
      }),
    );
  });

  it('requires review for a duplicate SKU in the last 24h even when classification is AGAIN', async () => {
    const { service, tx } = harness();
    tx.order.findMany.mockResolvedValue([
      { id: 'old-order', orderNumber: 'PH100000', riskFlags: [] },
    ]);
    await expect(
      service.convertDraftToOrder('draft-1', OPERATOR),
    ).rejects.toThrow('DRAFT_RISK_REVIEW_REQUIRED');
    expect(tx.order.create).not.toHaveBeenCalled();
  });

  it('propagates ERP queue failure from the same transaction rather than leaving a linked unconfirmed order', async () => {
    const { service, prisma, qianyi } = harness();
    qianyi.enqueue.mockRejectedValue(new Error('outbox unavailable'));
    await expect(
      service.convertDraftToOrder('draft-1', OPERATOR),
    ).rejects.toThrow('outbox unavailable');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('refuses expired and converted drafts', async () => {
    const { service, draft, tx } = harness();
    draft.status = 'CONVERTED';
    await expect(
      service.convertDraftToOrder('draft-1', OPERATOR),
    ).rejects.toBeInstanceOf(ConflictException);
    draft.status = 'OPEN';
    draft.expiresAt = new Date('2026-11-01');
    await expect(
      service.convertDraftToOrder('draft-1', OPERATOR),
    ).rejects.toThrow('expired');
    expect(tx.order.create).not.toHaveBeenCalled();
  });

  it('keeps shopper conversion unconfirmed while persisting the same start time and provenance', async () => {
    const { service, tx, qianyi } = harness();
    const token = `${Date.now().toString(36)}.${Buffer.alloc(32, 1).toString('base64url')}`;
    await service.checkout(
      checkoutSchema.parse({
        customer: snapshot.customer,
        items: snapshot.items,
        attribution: { sourceType: 'ORGANIC' },
        checkoutDraftToken: token,
      }),
    );
    expect(tx.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          draftStartedAt: new Date('2026-11-06T02:00:00Z'),
          workbenchStartedAt: new Date('2026-11-06T02:00:00Z'),
        }),
      }),
    );
    const data = (
      tx.order.create.mock.calls[0][0] as { data: Record<string, unknown> }
    ).data;
    expect(data.orderStatus).toBeUndefined();
    expect(data.confirmationStatus).toBeUndefined();
    // The list badge is for operator conversions only; a shopper finishing
    // from their own draft keeps the flag at its false default.
    expect(data.draftConvertedManually).toBeUndefined();
    expect(qianyi.enqueue).not.toHaveBeenCalled();
    expect(tx.checkoutDraft.updateMany).toHaveBeenCalled();
  });

  it('replays the winning shopper order when the same request passed the precheck before the draft lock', async () => {
    const { service, draft, tx, inventory, meta } = harness();
    const token = `${Date.now().toString(36)}.${Buffer.alloc(32, 1).toString('base64url')}`;
    const input = checkoutSchema.parse({
      customer: snapshot.customer, items: snapshot.items, attribution: {},
      checkoutDraftToken: token, idempotencyKey: '11111111-1111-4111-8111-111111111111',
    });
    draft.status = 'CONVERTED';
    draft.orderId = 'order-1';
    tx.order.findUnique.mockResolvedValueOnce(null as never).mockResolvedValueOnce({
      orderNumber: 'PH100001', orderStatus: 'NEW', confirmationStatus: 'UNCONFIRMED',
      customerClassification: 'NEW', grandTotal: new Prisma.Decimal(398),
      idempotencyHash: idempotencyFingerprint(input),
    } as never);
    await expect(service.checkout(input)).resolves.toMatchObject({
      orderNumber: 'PH100001', grandTotal: 398, confirmationStatus: 'UNCONFIRMED',
    });
    expect(tx.order.create).not.toHaveBeenCalled();
    expect(inventory.reserveWithin).not.toHaveBeenCalled();
    expect(meta.enqueuePurchase).not.toHaveBeenCalled();
  });

  it.each(['different-key', 'different-details'])('does not replay a converted draft for a %s competitor', async (competitor) => {
    const { service, draft, tx } = harness();
    const token = `${Date.now().toString(36)}.${Buffer.alloc(32, 1).toString('base64url')}`;
    const input = checkoutSchema.parse({
      customer: snapshot.customer, items: snapshot.items, attribution: {},
      checkoutDraftToken: token, idempotencyKey: '11111111-1111-4111-8111-111111111111',
    });
    draft.status = 'CONVERTED';
    tx.order.findUnique.mockResolvedValueOnce(null as never).mockResolvedValueOnce(
      competitor === 'different-key' ? null as never : {
        orderNumber: 'PH100001', idempotencyHash: 'another-fingerprint',
      } as never,
    );
    await expect(service.checkout(input)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.order.create).not.toHaveBeenCalled();
  });

  it('prevents shopper conversion from racing an already converted manual draft', async () => {
    const { service, draft, tx } = harness();
    draft.status = 'CONVERTED';
    const token = `${Date.now().toString(36)}.${Buffer.alloc(32, 1).toString('base64url')}`;
    await expect(
      service.checkout(
        checkoutSchema.parse({
          customer: snapshot.customer,
          items: snapshot.items,
          attribution: {},
          checkoutDraftToken: token,
        }),
      ),
    ).rejects.toThrow('DRAFT_ALREADY_CONVERTED');
    expect(tx.order.create).not.toHaveBeenCalled();
  });

  it('refuses missing drafts and incomplete snapshots', async () => {
    const { service, tx, draft } = harness();
    tx.checkoutDraft.findUnique.mockResolvedValueOnce(null as never);
    await expect(
      service.convertDraftToOrder('missing', OPERATOR),
    ).rejects.toBeInstanceOf(NotFoundException);
    draft.snapshot.customer.phone = '';
    await expect(
      service.convertDraftToOrder('draft-1', OPERATOR),
    ).rejects.toThrow();
    expect(tx.order.create).not.toHaveBeenCalled();
  });
});
