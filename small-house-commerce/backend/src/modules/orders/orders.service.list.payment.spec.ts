import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '../../generated/prisma/client.js';
import { orderQuerySchema } from './dto/order.dto.js';
import { OrdersService } from './orders.service.js';

/**
 * The payment column of the order workbench reads two separate facts:
 * the payment method (COD or the gateway) and, for an online order, the
 * channel it is paid through. Both come from the row the list returns.
 */
function harness(item: Record<string, unknown>) {
  const prisma = {
    order: {
      findMany: vi.fn(async () => [item]),
      count: vi.fn(async () => 1),
    },
    user: { findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
  };
  const service = new OrdersService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service };
}

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    orderNumber: 'PH100030',
    orderStatus: 'NEW',
    confirmationStatus: 'UNCONFIRMED',
    paymentStatus: 'ONLINE_PENDING',
    customerId: 'cust-1',
    assignedToId: null,
    grandTotal: new Prisma.Decimal('199'),
    createdAt: new Date('2026-11-20T02:00:00Z'),
    items: [],
    riskFlags: [],
    attribution: null,
    payments: [{ method: 'SUNRATE', status: 'ONLINE_PENDING' }],
    sunrateAttempts: [{ channel: 'gcash', status: 'PENDING' }],
    verificationAssignments: [],
    shippingAddress: null,
    customer: { name: 'Jane', normalizedPhone: '639171234567', currentRiskLevel: 'NONE' },
    ...overrides,
  };
}

describe('OrdersService.list payment facts', () => {
  it('returns the gateway channel of an online order beside its method', async () => {
    const { service } = harness(item());

    const result = await service.list(orderQuerySchema.parse({}));

    expect(result.items[0]).toMatchObject({
      paymentMethod: 'SUNRATE',
      paymentChannel: 'gcash',
      paymentAttemptStatus: 'PENDING',
    });
  });

  it('returns no channel for a cash order', async () => {
    const { service } = harness(
      item({
        paymentStatus: 'COD_PENDING',
        payments: [{ method: 'COD', status: 'COD_PENDING' }],
        sunrateAttempts: [],
      }),
    );

    const result = await service.list(orderQuerySchema.parse({}));

    expect(result.items[0]).toMatchObject({
      paymentMethod: 'COD',
      paymentChannel: null,
      paymentAttemptStatus: null,
    });
  });

  it('asks for the newest attempt and the first payment row', async () => {
    const findMany = vi.fn(async () => [item()]);
    const prisma = {
      order: { findMany, count: vi.fn(async () => 1) },
      user: { findMany: vi.fn(async () => []) },
      $transaction: vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
    };
    const service = new OrdersService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.list(orderQuerySchema.parse({}));

    const include = (findMany.mock.calls[0]![0] as { include: Record<string, any> }).include;
    expect(include.payments).toMatchObject({ take: 1, orderBy: { createdAt: 'asc' } });
    expect(include.sunrateAttempts).toMatchObject({ take: 1, orderBy: { createdAt: 'desc' } });
  });
});
