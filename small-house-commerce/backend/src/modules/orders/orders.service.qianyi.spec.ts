import { describe, expect, it, vi } from 'vitest';
import { OrdersService } from './orders.service.js';

/**
 * The point of this spec is ordering, not payload shape: confirming an order
 * must leave a job row inside the SAME transaction, so a rollback cannot leave
 * a ghost push behind.
 */
function buildService(qianyi: { enqueue: ReturnType<typeof vi.fn> }) {
  const tx = {
    $queryRaw: vi.fn(async () => []),
    order: {
      findUnique: vi.fn(async () => ({
        id: 'order-1',
        orderNumber: 'PH100012',
        orderStatus: 'NEW',
        confirmationStatus: 'UNCONFIRMED',
        customerId: 'cust-1',
        customerClassification: 'NEW',
        riskFlags: [],
      })),
      update: vi.fn(async () => ({ id: 'order-1' })),
    },
    orderStatusHistory: { create: vi.fn(async () => undefined) },
    customerRiskLog: { create: vi.fn(async () => undefined) },
    customerNote: { create: vi.fn(async () => undefined) },
  };
  const prisma = {
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const service = new OrdersService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { deliverClaims: vi.fn(async () => undefined) } as never,
    undefined as never,
    qianyi as never,
  );
  return { service, prisma, tx };
}

describe('OrdersService Qianyi hook', () => {
  it('queues the push inside the confirm transaction', async () => {
    const enqueued: string[] = [];
    const qianyi = {
      enqueue: vi.fn(async (_tx: unknown, kind: string) => {
        enqueued.push(kind);
      }),
    };
    const { service, prisma, tx } = buildService(qianyi);

    await service.confirm('order-1', 'user-1');

    expect(enqueued).toEqual(['PUSH_ORDER']);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // The enqueue must see the transaction client, not the base prisma client.
    expect(qianyi.enqueue.mock.calls[0][0]).toBe(tx);
  });
});
