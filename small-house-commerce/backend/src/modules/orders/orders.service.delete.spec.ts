import { describe, expect, it, vi } from 'vitest';
import { OrdersService } from './orders.service.js';
import { bulkOrdersSchema } from './dto/order-workbench.dto.js';

const ID = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';

const order = () => ({
  id: ID,
  orderNumber: 'PH100001',
  orderStatus: 'SIGNED',
  customerId: 'cust-1',
  grandTotal: '199.00',
  items: [
    {
      skuCodeSnapshot: 'WB-1',
      productNameSnapshot: 'Chair',
      variantSnapshot: null,
      quantity: 2,
      unitPrice: '99.50',
      lineTotal: '199.00',
    },
  ],
});

function harness(qianyiAction: () => Promise<string> = async () => 'none') {
  const tx = {
    $queryRaw: vi.fn(async () => []),
    order: {
      findUnique: vi.fn(async () => order()),
      delete: vi.fn(async () => ({})),
    },
    orderMergeRecord: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    returnAcceptance: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    shipment: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    inventoryReservation: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    orderDeletionLog: { create: vi.fn(async () => ({})) },
  };
  const prisma = {
    $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const inventory = { releaseForOrder: vi.fn(async () => []) };
  const qianyi = { closeForDeleteWithin: vi.fn(qianyiAction) };
  const service = new OrdersService(
    prisma as never,
    inventory as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    undefined,
    qianyi as never,
  );
  return { service, tx, inventory, qianyi, prisma };
}

describe('bulk order deletion', () => {
  it('accepts the delete action and rejects extra fields', () => {
    expect(bulkOrdersSchema.parse({ action: 'delete', ids: [ID] })).toEqual({
      action: 'delete',
      ids: [ID],
    });
    expect(
      bulkOrdersSchema.safeParse({ action: 'delete', ids: [ID], reason: 'x' }).success,
    ).toBe(false);
  });

  it('releases active stock, removes restrict-linked rows and writes the audit snapshot', async () => {
    const { service, tx, inventory, qianyi } = harness();
    const result = await service.bulkOrders({ action: 'delete', ids: [ID] }, 'operator');

    expect(result.results).toEqual([{ id: ID, ok: true }]);
    expect(inventory.releaseForOrder).toHaveBeenCalledWith(tx, ID);
    expect(tx.orderMergeRecord.deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ primaryOrderId: ID }, { mergedOrderId: ID }] },
    });
    expect(tx.returnAcceptance.deleteMany).toHaveBeenCalledWith({ where: { orderId: ID } });
    expect(tx.shipment.deleteMany).toHaveBeenCalledWith({ where: { orderId: ID } });
    expect(tx.inventoryReservation.deleteMany).toHaveBeenCalledWith({ where: { orderId: ID } });
    expect(tx.orderDeletionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          orderId: ID,
          orderNumber: 'PH100001',
          orderStatus: 'SIGNED',
          operatorId: 'operator',
          qianyiAction: 'none',
          snapshot: expect.objectContaining({
            orderNumber: 'PH100001',
            items: [expect.objectContaining({ skuCodeSnapshot: 'WB-1' })],
          }),
        }),
      }),
    );
    expect(tx.order.delete).toHaveBeenCalledWith({ where: { id: ID } });
    expect(qianyi.closeForDeleteWithin).toHaveBeenCalledWith(tx, ID, 'operator');
  });

  it('records the external close when the order had reached Qianyi', async () => {
    const { service, tx } = harness(async () => 'closed');
    await service.bulkOrders({ action: 'delete', ids: [ID] }, 'operator');
    expect(tx.orderDeletionLog.create.mock.calls[0][0].data).toMatchObject({
      qianyiAction: 'closed',
    });
  });

  it('leaves the order untouched when the Qianyi close fails', async () => {
    const { service, tx } = harness(async () => {
      throw new Error('QIANYI_CLOSE_FAILED');
    });
    const result = await service.bulkOrders({ action: 'delete', ids: [ID] }, 'operator');
    expect(result.results).toEqual([
      { id: ID, ok: false, error: 'QIANYI_CLOSE_FAILED' },
    ]);
    expect(tx.order.delete).not.toHaveBeenCalled();
    expect(tx.orderDeletionLog.create).not.toHaveBeenCalled();
    expect(tx.inventoryReservation.deleteMany).not.toHaveBeenCalled();
  });

  it('keeps deleting the remaining rows after one order is blocked', async () => {
    let call = 0;
    const { service, tx } = harness(async () => {
      call += 1;
      if (call === 1) throw new Error('QIANYI_PUSH_IN_FLIGHT');
      return 'none';
    });
    tx.order.findUnique
      .mockResolvedValueOnce(order())
      .mockResolvedValueOnce({ ...order(), id: ID2, orderNumber: 'PH100002' });
    const result = await service.bulkOrders({ action: 'delete', ids: [ID, ID2] }, 'operator');
    expect(result.results).toEqual([
      { id: ID, ok: false, error: 'QIANYI_PUSH_IN_FLIGHT' },
      { id: ID2, ok: true },
    ]);
    expect(tx.order.delete).toHaveBeenCalledTimes(1);
    expect(tx.order.delete).toHaveBeenCalledWith({ where: { id: ID2 } });
  });
});
