import { describe, expect, it, vi } from 'vitest';
import { OrdersService } from './orders.service.js';

const ID = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';

function orderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    orderNumber: 'PH100001',
    orderStatus: 'NEW',
    confirmationStatus: 'CONFIRMED',
    customerId: 'cust-1',
    grandTotal: '199.00',
    shippingAddress: {
      phone: '09171234567',
      streetAddress: '1 Main St',
      province: 'Metro Manila',
      city: 'Manila',
    },
    items: [],
    payments: [],
    ...overrides,
  };
}

function harness(
  options: {
    attempt?: { status: string } | null;
    payments?: { method: string; status: string }[];
    primary?: Record<string, unknown>;
    merged?: Record<string, unknown>;
  } = {},
) {
  const attempt = options.attempt === undefined ? null : options.attempt;
  const primary = orderRow({ id: ID, payments: options.payments ?? [] , ...(options.primary ?? {}) });
  const merged = orderRow({
    id: ID2,
    orderNumber: 'PH100002',
    createdAt: new Date('2026-11-01'),
    payments: [],
    ...(options.merged ?? {}),
  });
  const tx = {
    $queryRaw: vi.fn(async () => []),
    $executeRaw: vi.fn(async () => 0),
    order: {
      findUnique: vi.fn(async (args: { where: { id: string } }) =>
        args.where.id === ID2 ? merged : primary,
      ),
      update: vi.fn(async () => ({})),
      delete: vi.fn(async () => ({})),
    },
    sunratePaymentAttempt: {
      findFirst: vi.fn(async (args: { where: { status?: { in?: readonly string[] } } }) => {
        if (!attempt) return null;
        const allowed = args.where.status?.in;
        if (allowed && !allowed.includes(attempt.status)) return null;
        return attempt;
      }),
    },
    payment: { findFirst: vi.fn(async () => null) },
    orderMergeRecord: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    returnAcceptance: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    shipment: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    inventoryReservation: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    orderDeletionLog: { create: vi.fn(async () => ({})) },
    orderStatusHistory: { create: vi.fn(async () => ({})) },
    orderItem: {
      update: vi.fn(async () => ({})),
      create: vi.fn(async () => ({})),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    orderNote: { create: vi.fn(async () => ({})) },
    promoCodeRedemption: { deleteMany: vi.fn(async () => ({ count: 0 })) },
  };
  const prisma = {
    $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const inventory = { releaseForOrder: vi.fn(async () => []) };
  const qianyi = {
    closeForDeleteWithin: vi.fn(async () => 'none'),
    cancelWithin: vi.fn(async () => undefined),
  };
  const service = new OrdersService(
    prisma as never,
    inventory as never,
    {} as never,
    {} as never,
    {} as never,
    { deliverClaims: vi.fn(async () => undefined) } as never,
    undefined,
    qianyi as never,
  );
  return { service, tx, inventory, qianyi };
}

describe('online payment orders and order mutations', () => {
  it('refuses to cancel an order whose online payment is still open', async () => {
    const { service, tx } = harness({ attempt: { status: 'PENDING' } });

    await expect(service.cancel(ID, 'operator')).rejects.toMatchObject({
      status: 409,
      message: 'ONLINE_PAYMENT_ACTIVE_CONFIRM_VIA_QUERY',
    });
    expect(tx.order.update).not.toHaveBeenCalled();
  });

  it('refuses to cancel an order whose online payment was received', async () => {
    const { service } = harness({ attempt: { status: 'SUCCEEDED' } });

    await expect(service.cancel(ID, 'operator')).rejects.toMatchObject({
      status: 409,
      message: 'ONLINE_PAYMENT_ACTIVE_CONFIRM_VIA_QUERY',
    });
  });

  it('cancels an order whose online payment failed', async () => {
    const { service, tx } = harness({ attempt: { status: 'FAILED' } });

    await service.cancel(ID, 'operator');

    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: ID },
      data: { orderStatus: 'CANCELLED' },
    });
  });

  it('cancels a cash order as before', async () => {
    const { service, tx } = harness();

    await service.cancel(ID, 'operator');

    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: ID },
      data: { orderStatus: 'CANCELLED' },
    });
  });

  it('refuses to hard-delete an order that was paid online', async () => {
    const { service, tx, qianyi } = harness({ attempt: { status: 'SUCCEEDED' } });

    await expect(service.deleteOrder(ID, 'operator')).rejects.toMatchObject({
      status: 409,
      message: 'ONLINE_PAYMENT_ACTIVE_CONFIRM_VIA_QUERY',
    });
    expect(tx.order.delete).not.toHaveBeenCalled();
    // Nothing is closed anywhere before the refusal.
    expect(qianyi.closeForDeleteWithin).not.toHaveBeenCalled();
  });

  it('refuses to hard-delete an order whose online payment is still open', async () => {
    const { service, tx } = harness({ attempt: { status: 'CREATING' } });

    await expect(service.deleteOrder(ID, 'operator')).rejects.toMatchObject({
      status: 409,
      message: 'ONLINE_PAYMENT_ACTIVE_CONFIRM_VIA_QUERY',
    });
    expect(tx.order.delete).not.toHaveBeenCalled();
  });

  it('refuses to merge an order that carries an online payment', async () => {
    const { service, tx } = harness({
      payments: [{ method: 'SUNRATE', status: 'ONLINE_PENDING' }],
    });

    await expect(
      service.merge({ primaryOrderId: ID, mergedOrderId: ID2, reason: 'same customer' }, 'operator'),
    ).rejects.toMatchObject({
      status: 409,
      message: 'ONLINE_PAYMENT_ORDER_NOT_MERGEABLE',
    });
    expect(tx.orderItem.update).not.toHaveBeenCalled();
  });

  it('leaves a cash order mergeable', async () => {
    const { service } = harness({ payments: [{ method: 'COD', status: 'COD_PENDING' }] });

    // Only that the online guard does not fire for a cash order; the merge
    // itself needs the full order surface this harness does not carry.
    const error = await service
      .merge({ primaryOrderId: ID, mergedOrderId: ID2, reason: 'same customer' }, 'operator')
      .catch((thrown: unknown) => thrown);
    expect((error as Error)?.message).not.toBe('ONLINE_PAYMENT_ORDER_NOT_MERGEABLE');
  });
});
