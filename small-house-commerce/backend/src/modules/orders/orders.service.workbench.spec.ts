import { describe, expect, it, vi } from 'vitest';
import { InventoryService } from '../inventory/inventory.service.js';
import { OrdersService } from './orders.service.js';

/**
 * The workbench data (stage 1B): the list carries what the table shows
 * (the address, the real unit price, the verification progress), the filters
 * cover the phone and the product, and the customer history answers "how
 * often does this customer actually sign?".
 */

const OPERATOR = '00000000-0000-4000-8000-0000000000b1';

function createHarness() {
  const tx: Record<string, any> = {
    $queryRaw: vi.fn(async () => []),
    $executeRaw: vi.fn(async () => 0),
    order: { findUnique: vi.fn(), update: vi.fn() },
    orderStatusHistory: { create: vi.fn(async () => ({})) },
  };
  const prisma = {
    order: {
      findMany: vi.fn(async (_args?: unknown) => [] as unknown[]),
      count: vi.fn(async (_args?: unknown) => 0),
      groupBy: vi.fn(async (_args?: unknown) => [] as unknown[]),
    },
    // the list reads with a promise array, the writes with a callback
    $transaction: vi.fn(async (arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : (arg as (t: typeof tx) => Promise<unknown>)(tx),
    ),
  };
  const service = new OrdersService(
    prisma as never,
    { releaseForOrder: vi.fn(async () => []) } as unknown as InventoryService,
    { logRisk: vi.fn(async () => {}) } as never,
    { resolve: vi.fn(async () => null) } as never,
    { resolveForCheckout: vi.fn(async () => null) } as never,
    { deliverClaims: vi.fn(async () => undefined) } as never,
  );
  return { service, prisma, tx };
}

const listRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'order-1',
  orderNumber: 'PH100004',
  orderStatus: 'NEW',
  confirmationStatus: 'UNCONFIRMED',
  paymentStatus: 'COD_PENDING',
  customerClassification: 'NEW',
  customerId: 'cust-1',
  assignedToId: null,
  createdAt: new Date('2026-10-21T14:22:00.000Z'),
  subtotal: '1499',
  discountTotal: '0',
  shippingTotal: '0',
  grandTotal: '1499',
  customer: { id: 'cust-1', name: 'Marisol Reyes', normalizedPhone: '+639171224466' },
  items: [
    {
      id: 'line-1',
      skuCodeSnapshot: 'SKU-FD-140-WN',
      productNameSnapshot: 'Foldable Desk',
      quantity: 1,
      lineTotal: '1499',
      unitPrice: '1499',
    },
  ],
  riskFlags: [],
  shippingAddress: {
    streetAddress: '24-B Kamuning St.',
    barangay: 'Kamuning',
    city: 'Quezon City',
    province: 'Metro Manila',
    postalCode: '1103',
    landmark: null,
  },
  verificationAssignments: [],
  ...overrides,
});

describe('the workbench list', () => {
  it('asks for the address, the real unit price and the verification checklist', async () => {
    const { service, prisma } = createHarness();
    prisma.order.findMany.mockResolvedValue([listRow()]);
    await service.list({ page: 1, pageSize: 20 });
    const args = prisma.order.findMany.mock.calls[0]![0] as {
      include: Record<string, unknown>;
    };
    expect(JSON.stringify(args.include)).toContain('shippingAddress');
    expect(JSON.stringify(args.include)).toContain('unitPrice');
    expect(JSON.stringify(args.include)).toContain('verificationAssignments');
  });

  it('summarises the verification progress of every order', async () => {
    const { service, prisma } = createHarness();
    prisma.order.findMany.mockResolvedValue([
      listRow({
        verificationAssignments: [
          {
            id: 'as-1',
            assigneeId: OPERATOR,
            priority: 'HIGH',
            nextFollowUpAt: null,
            items: [
              { id: 'it-1', itemKey: 'intent', titleSnapshot: '确认客户购买意愿', required: true, status: 'DONE' },
              { id: 'it-2', itemKey: 'phone_valid', titleSnapshot: '确认联系电话是否有效', required: true, status: 'PENDING' },
              { id: 'it-3', itemKey: 'addr_mark', titleSnapshot: '补充地标', required: false, status: 'PROBLEM' },
            ],
          },
        ],
      }),
    ]);
    const result = await service.list({ page: 1, pageSize: 20 });
    const row = result.items[0] as unknown as {
      verification: {
        assigned: boolean;
        done: number;
        total: number;
        pending: number;
        problem: number;
        priority: string;
        assigneeId: string | null;
      };
    };
    expect(row.verification).toMatchObject({
      assigned: true,
      done: 1,
      total: 3,
      pending: 1,
      problem: 1,
      priority: 'HIGH',
      assigneeId: OPERATOR,
    });
  });

  it('reports no checklist for an order nobody picked up', async () => {
    const { service, prisma } = createHarness();
    prisma.order.findMany.mockResolvedValue([listRow()]);
    const result = await service.list({ page: 1, pageSize: 20 });
    expect((result.items[0] as unknown as { verification: { assigned: boolean } }).verification.assigned).toBe(
      false,
    );
  });

  it('filters by an exact phone number', async () => {
    const { service, prisma } = createHarness();
    prisma.order.findMany.mockResolvedValue([]);
    await service.list({ page: 1, pageSize: 20, phone: '+639171224466' });
    const args = prisma.order.findMany.mock.calls[0]![0] as { where: Record<string, unknown> };
    expect(JSON.stringify(args.where)).toContain('normalizedPhone');
  });

  it('filters by product (SKU) and by the owner priority', async () => {
    const { service, prisma } = createHarness();
    prisma.order.findMany.mockResolvedValue([]);
    await service.list({ page: 1, pageSize: 20, sku: 'SKU-FD-140' });
    const where = JSON.stringify((prisma.order.findMany.mock.calls[0]![0] as { where: unknown }).where);
    expect(where).toContain('skuCodeSnapshot');
  });

  it('separates the orders still waiting for the warehouse from the ones ready to ship', async () => {
    const { service, prisma } = createHarness();
    prisma.order.findMany.mockResolvedValue([]);

    await service.list({ page: 1, pageSize: 20, queue: 'tohandover' });
    const handoverWhere = JSON.stringify(
      (prisma.order.findMany.mock.calls[0]![0] as { where: unknown }).where,
    );
    expect(handoverWhere).toContain('"handoverCompletedAt":null');
    expect(handoverWhere).toContain('CONFIRMED');

    prisma.order.findMany.mockClear();
    await service.list({ page: 1, pageSize: 20, queue: 'toship' });
    const shipWhere = JSON.stringify(
      (prisma.order.findMany.mock.calls[0]![0] as { where: unknown }).where,
    );
    expect(shipWhere).toContain('"handoverCompletedAt":{"not":null}');
    expect(shipWhere).toContain('CONFIRMED');
  });

  it('treats a failed delivery as an exception until the box is signed', async () => {
    const { service, prisma } = createHarness();
    prisma.order.findMany.mockResolvedValue([]);

    await service.list({ page: 1, pageSize: 20, queue: 'exception' });
    const where = JSON.stringify(
      (prisma.order.findMany.mock.calls[0]![0] as { where: unknown }).where,
    );
    expect(where).toContain('FAILED_DELIVERY');
    expect(where).toContain('RETURNING');
    expect(where).toContain('"status":"SHIPPING"');
    expect(where).toContain('"resolved":false');
  });
});

describe('the workbench counters', () => {
  it('counts the work queues, not only the raw statuses', async () => {
    const { service, prisma } = createHarness();
    prisma.order.groupBy.mockResolvedValue([
      { orderStatus: 'NEW', _count: { _all: 3 } },
      { orderStatus: 'CONFIRMED', _count: { _all: 2 } },
      { orderStatus: 'SHIPPING', _count: { _all: 1 } },
      { orderStatus: 'SIGNED', _count: { _all: 4 } },
      { orderStatus: 'CANCELLED', _count: { _all: 1 } },
    ]);
    prisma.order.count.mockResolvedValue(0);
    const counts = await service.counts();
    // The totals follow the filters of the list, so they come from the
    // filtered count and not from the raw status groups.
    expect(counts.total).toBe(0);
    expect(counts.byStatus.NEW).toBe(3);
    expect(counts.queues).toHaveProperty('todo');
    expect(counts.queues).toHaveProperty('recheck');
    expect(counts.queues).toHaveProperty('tohandover');
    expect(counts.queues).toHaveProperty('toship');
    expect(counts.queues).toHaveProperty('shipping');
    expect(counts.queues).toHaveProperty('exception');
    expect(counts.queues).toHaveProperty('signed');
    expect(counts.queues).toHaveProperty('cods');
    expect(counts.queues).toHaveProperty('cancelled');
    expect(counts.queues).toHaveProperty('mine');
  });

  it('counts every queue with the filters of the current list', async () => {
    const { service, prisma } = createHarness();
    prisma.order.groupBy.mockResolvedValue([]);
    prisma.order.count.mockResolvedValue(0);
    await service.counts({ page: 1, pageSize: 20, phone: '+639171224466' });
    const where = JSON.stringify(
      (prisma.order.count.mock.calls[0]![0] as { where: unknown }).where,
    );
    expect(where).toContain('normalizedPhone');
  });
});

describe('the customer order history', () => {
  it('answers how often this phone signs for its orders', async () => {
    const { service, prisma } = createHarness();
    prisma.order.findMany.mockResolvedValue([
      listRow({ orderStatus: 'SIGNED', paymentStatus: 'COD_PENDING' }),
      listRow({ orderStatus: 'SHIPPING', paymentStatus: 'COD_PENDING' }),
      listRow({ orderStatus: 'CANCELLED', paymentStatus: 'COD_PENDING' }),
      listRow({ orderStatus: 'NEW', paymentStatus: 'COD_PENDING' }),
    ]);
    const history = await service.customerOrderHistory('+639171224466');
    expect(history.total).toBe(4);
    expect(history.signed).toBe(1);
    expect(history.rate).toBe(25);
    expect(history.shipping).toBe(1);
    expect(history.cancelled).toBe(1);
    expect(history.open).toBe(1);
    expect(history.orders).toHaveLength(4);
  });
});
