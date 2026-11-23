import { describe, expect, it, vi } from 'vitest';
import { OrdersService } from './orders.service.js';
import { CustomerRiskService } from './customer-risk.service.js';
import { bulkOrdersSchema } from './dto/order-workbench.dto.js';

const ID = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const service = () =>
  new OrdersService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

describe('bulk orders', () => {
  it.each([
    ['CONFIRMED', 'RPT'], ['SHIPPING', 'RPT'], ['DENIED', 'RECHECK'],
    ['SIGNED', null], ['CANCELLED', null],
  ])('rechecks live %s history before bulk confirmation (expected %s)', async (priorStatus, expectedRisk) => {
    const order = {
      id: ID, customerId: 'cust-1', orderNumber: 'PH100001', orderStatus: 'NEW',
      confirmationStatus: 'UNCONFIRMED', customerClassification: 'NEW', riskFlags: [],
    };
    const tx = {
      $queryRaw: vi.fn(async () => []),
      order: {
        findUnique: vi.fn(async () => order),
        update: vi.fn(async () => ({ ...order, orderStatus: 'CONFIRMED' })),
      },
      customer: { findUnique: vi.fn(async () => ({
        id: 'cust-1', normalizedPhone: '+639171224466',
        // Excluding the current order matters even if it is PENDING itself.
        orders: [{ id: ID, orderStatus: 'PENDING' }, { id: ID2, orderStatus: priorStatus }],
      })) },
      orderStatusHistory: { create: vi.fn(async () => ({})) },
    };
    const prisma = { $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
    const qianyi = { enqueue: vi.fn(async () => undefined) };
    const s = new OrdersService(
      prisma as never, {} as never, new CustomerRiskService({} as never),
      {} as never, {} as never, { deliverClaims: vi.fn() } as never, undefined, qianyi as never,
    );
    const result = await s.bulkOrders({ action: 'confirm', ids: [ID] }, 'operator');
    expect(result.results[0].ok).toBe(expectedRisk === null);
    if (expectedRisk) {
      expect(result.results[0].error).toContain(expectedRisk);
      expect(tx.order.update).not.toHaveBeenCalled();
      expect(qianyi.enqueue).not.toHaveBeenCalled();
    } else {
      expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ orderStatus: 'CONFIRMED' }),
      }));
      expect(qianyi.enqueue).toHaveBeenCalledWith(tx, 'PUSH_ORDER', ID);
    }
    expect(order.customerClassification).toBe('NEW');
  });

  it('reports mixed successes and errors without aborting the remaining rows', async () => {
    const s = service();
    vi.spyOn(s, 'cancel')
      .mockRejectedValueOnce(new Error('Already shipped'))
      .mockResolvedValueOnce({ id: ID2 } as never);
    const result = await s.bulkOrders(
      { action: 'cancel', ids: [ID, ID2] },
      'operator',
    );
    expect(result.results).toEqual([
      { id: ID, ok: false, error: 'Already shipped' },
      { id: ID2, ok: true },
    ]);
  });
  it('bulk confirmation does not supply a review decision, so live risk orders are skipped by the ordinary guard', async () => {
    const s = service();
    const confirm = vi
      .spyOn(s, 'confirm')
      .mockResolvedValue({ id: ID } as never);
    await s.bulkOrders({ action: 'confirm', ids: [ID] }, 'operator');
    expect(confirm).toHaveBeenCalledWith(ID, 'operator', undefined, { checkCurrentRisk: true });
  });
  it('assigns each selected row through the existing assignment validation', async () => {
    const s = service();
    const assign = vi.spyOn(s, 'assign').mockResolvedValue({ id: ID } as never);
    await s.bulkOrders(
      { action: 'assign', ids: [ID, ID2], assignedToId: 'staff' },
      'operator',
    );
    expect(assign.mock.calls).toEqual([
      [ID, 'staff', 'operator'],
      [ID2, 'staff', 'operator'],
    ]);
  });
  it('applies status changes through the existing status transition rules', async () => {
    const s = service();
    const status = vi
      .spyOn(s, 'updateStatus')
      .mockResolvedValue({ id: ID } as never);
    await s.bulkOrders(
      { action: 'status', ids: [ID], status: 'QUESTION', comment: 'Call back' },
      'operator',
    );
    expect(status).toHaveBeenCalledWith(
      ID,
      'QUESTION',
      'Call back',
      'operator',
    );
  });
  it('rejects duplicate IDs, oversized batches and unsupported state changes at the boundary', () => {
    expect(
      bulkOrdersSchema.safeParse({ action: 'cancel', ids: [ID, ID] }).success,
    ).toBe(false);
    expect(
      bulkOrdersSchema.safeParse({ action: 'cancel', ids: Array(101).fill(ID) })
        .success,
    ).toBe(false);
    expect(
      bulkOrdersSchema.safeParse({
        action: 'status',
        ids: [ID],
        status: 'CONFIRMED',
      }).success,
    ).toBe(false);
    expect(
      bulkOrdersSchema.safeParse({ action: 'assign', ids: [ID] }).success,
    ).toBe(false);
  });
});
