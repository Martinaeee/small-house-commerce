import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { QianyiInboundService } from './qianyi-inbound.service.js';

function tx(overrides: Record<string, unknown> = {}) {
  return {
    $queryRaw: vi.fn(async () => []),
    order: {
      findUnique: vi.fn(async () => ({
        id: 'order-1',
        orderNumber: 'PH100012',
        orderStatus: 'CONFIRMED',
        confirmationStatus: 'CONFIRMED',
        items: [
          { id: 'line-1', skuCodeSnapshot: 'TB001-Wa', quantity: 1, skuId: 'sku-1', bundleSnapshot: null },
        ],
        shipments: [],
        riskFlags: [],
        customerId: 'cust-1',
      })),
      update: vi.fn(async () => undefined),
    },
    shipment: { create: vi.fn(async () => ({ id: 'ship-1' })), update: vi.fn(async () => undefined) },
    sku: { findMany: vi.fn(async () => [{ id: 'sku-1', qianyiSkuCode: 'YD003760CMHT' }]) },
    orderStatusHistory: { create: vi.fn(async () => undefined) },
    orderNote: { create: vi.fn(async () => undefined) },
    ...overrides,
  };
}

function serviceWith(client: ReturnType<typeof tx>, overrides: Record<string, unknown> = {}) {
  const prisma = { $transaction: vi.fn(async (fn: (t: typeof client) => unknown) => fn(client)) };
  const inventory = {
    defaultWarehouse: vi.fn(async () => ({ id: 'wh-1' })),
    consumeForOrder: vi.fn(async () => undefined),
  };
  const logistics = { record: vi.fn(async () => undefined) };
  const config = new ConfigService({
    qianyi: {
      enabled: 'true',
      appId: 'a',
      appSecret: 'b',
      shop: 'LUWAG- PH',
      warehouseId: 71537,
      warehouse: 'PH-DAVAO-01',
      logistics: 'SHIPDOC-STD',
      localWarehouseId: null,
      ...overrides,
    },
  });
  return {
    service: new QianyiInboundService(
      prisma as never,
      inventory as never,
      logistics as never,
      config,
    ),
    inventory,
    logistics,
  };
}

describe('QianyiInboundService', () => {
  it('turns a SHIPPED outbound into a shipment and moves the order', async () => {
    const client = tx();
    const { service, inventory, logistics } = serviceWith(client);

    await service.handle('PUSH_ODO_ORDER', {
      orderNumber: 'S2610288955080',
      onlineOrderNumber: 'PH100012',
      trackNumber: 'TRACK123',
      carrier: 'SHIPDOC',
      warehouseName: 'PH-DAVAO-01',
      status: 'SHIPPED',
      shippingTime: 1754014435000,
      skuList: [{ sku: 'YD003760CMHT', quantity: 1 }],
    });

    expect(client.shipment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ trackingNumber: 'TRACK123', carrier: 'SHIPDOC' }),
      }),
    );
    expect(inventory.consumeForOrder).toHaveBeenCalled();
    expect(client.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ orderStatus: 'SHIPPING' }) }),
    );
    expect(logistics.record).toHaveBeenCalledWith(
      'order-1',
      'ship-1',
      expect.objectContaining({ normalizedStatus: 'SHIPPED' }),
      // Must be the transaction client: the shipment is not committed yet.
      client,
    );
  });

  it('writes an order note when the shipped quantity differs', async () => {
    const client = tx();
    const { service } = serviceWith(client);

    await service.handle('PUSH_ODO_ORDER', {
      onlineOrderNumber: 'PH100012',
      trackNumber: 'TRACK123',
      carrier: 'SHIPDOC',
      status: 'SHIPPED',
      skuList: [{ sku: 'YD003760CMHT', quantity: 0 }],
    });

    expect(client.orderNote.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ noteType: 'WAREHOUSE' }) }),
    );
  });

  it('parks the tracking number when the outbound has not arrived yet', async () => {
    const client = tx();
    const { service } = serviceWith(client);

    await service.handle('PUSH_SALES_ORDER_SHIPPING_INFO', {
      onlineOrderNumber: 'PH100012',
      trackingNumber: 'TRACK999',
      carrier: 'SHIPDOC',
      status: 'WAIT_SHIP',
      shippingTime: 1754014435000,
    });

    expect(client.orderNote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ content: expect.stringContaining('TRACK999') }),
      }),
    );
  });

  it('ignores a callback for an unknown order without throwing', async () => {
    const client = tx();
    (client.order.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const { service } = serviceWith(client);

    await expect(
      service.handle('PUSH_ODO_ORDER', { onlineOrderNumber: 'NOPE', status: 'SHIPPED' }),
    ).resolves.toBeUndefined();
  });

  it('does not create a second shipment for a repeated outbound', async () => {
    const client = tx({
      order: {
        findUnique: vi.fn(async () => ({
          id: 'order-1',
          orderNumber: 'PH100012',
          orderStatus: 'SHIPPING',
          confirmationStatus: 'CONFIRMED',
          items: [
            { id: 'line-1', skuCodeSnapshot: 'TB001-Wa', quantity: 1, skuId: 'sku-1', bundleSnapshot: null },
          ],
          shipments: [{ id: 'ship-1' }],
          riskFlags: [],
          customerId: 'cust-1',
        })),
        update: vi.fn(async () => undefined),
      },
    });
    const { service, inventory } = serviceWith(client);

    await service.handle('PUSH_ODO_ORDER', {
      onlineOrderNumber: 'PH100012',
      trackNumber: 'TRACK123',
      status: 'SHIPPED',
      skuList: [{ sku: 'YD003760CMHT', quantity: 1 }],
    });

    expect(client.shipment.create).not.toHaveBeenCalled();
    expect(inventory.consumeForOrder).not.toHaveBeenCalled();
  });
});

describe('QianyiInboundService — partial shipments', () => {
  it('treats a line missing from the outbound list as not shipped', async () => {
    const client = tx();
    const { service, inventory } = serviceWith(client);

    await service.handle('PUSH_ODO_ORDER', {
      onlineOrderNumber: 'PH100012',
      trackNumber: 'TRACK123',
      carrier: 'SHIPDOC',
      status: 'SHIPPED',
      // The warehouse listed a different SKU: our line did not leave.
      skuList: [{ sku: 'SOMETHING-ELSE', quantity: 1 }],
    });

    expect(inventory.consumeForOrder).not.toHaveBeenCalled();
    expect(client.orderNote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ content: expect.stringContaining('not shipped') }),
      }),
    );
  });

  it('reads trackingNumber when the callback uses that name', async () => {
    const client = tx();
    const { service } = serviceWith(client);

    await service.handle('PUSH_ODO_ORDER', {
      onlineOrderNumber: 'PH100012',
      trackingNumber: 'TRACK777',
      carrier: 'SHIPDOC',
      status: 'SHIPPED',
      skuList: [{ sku: 'YD003760CMHT', quantity: 1 }],
    });

    expect(client.shipment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ trackingNumber: 'TRACK777' }),
      }),
    );
  });

  it('does not treat a manually shipped order as a duplicate outbound', async () => {
    const client = tx({
      order: {
        findUnique: vi.fn(async () => ({
          id: 'order-1',
          orderNumber: 'PH100012',
          orderStatus: 'SHIPPING',
          confirmationStatus: 'CONFIRMED',
          items: [
            { id: 'line-1', skuCodeSnapshot: 'TB001-Wa', quantity: 1, skuId: 'sku-1', bundleSnapshot: null },
          ],
          // Shipped from the admin workbench: no Qianyi outbound number yet.
          shipments: [{ id: 'ship-1', qianyiOutboundNumber: null }],
          riskFlags: [],
          customerId: 'cust-1',
        })),
        update: vi.fn(async () => undefined),
      },
    });
    const { service } = serviceWith(client);

    await service.handle('PUSH_ODO_ORDER', {
      orderNumber: 'A20220905',
      onlineOrderNumber: 'PH100012',
      trackNumber: 'TRACK123',
      status: 'SHIPPED',
      skuList: [{ sku: 'YD003760CMHT', quantity: 1 }],
    });

    expect(client.shipment.create).toHaveBeenCalled();
  });
});

describe('QianyiInboundService — tracking arriving first', () => {
  it('adopts the tracking number archived from an earlier SHIPPING_INFO', async () => {
    const client = tx({
      qianyiWebhookEvent: {
        findMany: vi.fn(async () => [
          { payload: { onlineOrderNumber: 'PH100012', trackingNumber: 'TRACK999' } },
        ]),
      },
    });
    const { service } = serviceWith(client);

    await service.handle('PUSH_ODO_ORDER', {
      orderNumber: 'S2610288955080',
      onlineOrderNumber: 'PH100012',
      carrier: 'SHIPDOC',
      status: 'SHIPPED',
      skuList: [{ sku: 'YD003760CMHT', quantity: 1 }],
    });

    expect(client.shipment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ trackingNumber: 'TRACK999' }),
      }),
    );
  });
});

describe('QianyiInboundService — out-of-order tracking', () => {
  it('backfills tracking events that arrived before the shipment existed', async () => {
    const client = tx({
      qianyiWebhookEvent: {
        findMany: vi.fn(async () => [
          {
            payload: {
              onlineOrderId: 'PH100012',
              trackingNumber: 'TRACK123',
              status: 'IN_TRANSIT',
              shippingTime: 1754014435000,
            },
          },
        ]),
      },
    });
    const { service, logistics } = serviceWith(client);

    await service.handle('PUSH_ODO_ORDER', {
      orderNumber: 'S2610288955080',
      onlineOrderNumber: 'PH100012',
      trackNumber: 'TRACK123',
      carrier: 'SHIPDOC',
      status: 'SHIPPED',
      skuList: [{ sku: 'YD003760CMHT', quantity: 1 }],
    });

    const statuses = logistics.record.mock.calls.map(
      (call) => (call[2] as { normalizedStatus: string }).normalizedStatus,
    );
    expect(statuses).toContain('SHIPPED');
    expect(statuses).toContain('IN_TRANSIT');
  });
});

describe('QianyiInboundService — warehouse and multiple parcels', () => {
  it('books the shipment on the pinned local warehouse', async () => {
    const client = tx({
      warehouse: { findUnique: vi.fn(async () => ({ id: 'wh-pinned' })) },
    });
    const { service, inventory } = serviceWith(client, { localWarehouseId: 'wh-pinned' });

    await service.handle('PUSH_ODO_ORDER', {
      orderNumber: 'S2610288955080',
      onlineOrderNumber: 'PH100012',
      trackNumber: 'TRACK123',
      carrier: 'SHIPDOC',
      status: 'SHIPPED',
      skuList: [{ sku: 'YD003760CMHT', quantity: 1 }],
    });

    expect(client.shipment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ warehouseId: 'wh-pinned' }),
      }),
    );
    expect(inventory.defaultWarehouse).not.toHaveBeenCalled();
  });

  it('never books more units than were ordered across two parcels', async () => {
    const client = tx({
      order: {
        findUnique: vi.fn(async () => ({
          id: 'order-1',
          orderNumber: 'PH100012',
          orderStatus: 'SHIPPING',
          confirmationStatus: 'CONFIRMED',
          items: [
            { id: 'line-1', skuCodeSnapshot: 'TB001-Wa', quantity: 1, skuId: 'sku-1', bundleSnapshot: null },
          ],
          // Parcel one already boxed the only unit.
          shipments: [
            { id: 'ship-1', qianyiOutboundNumber: 'A1', items: [{ orderItemId: 'line-1', quantity: 1 }] },
          ],
          riskFlags: [],
          customerId: 'cust-1',
        })),
        update: vi.fn(async () => undefined),
      },
    });
    const { service, inventory } = serviceWith(client);

    await service.handle('PUSH_ODO_ORDER', {
      orderNumber: 'A2',
      onlineOrderNumber: 'PH100012',
      trackNumber: 'TRACK2',
      status: 'SHIPPED',
      skuList: [{ sku: 'YD003760CMHT', quantity: 1 }],
    });

    expect(inventory.consumeForOrder).not.toHaveBeenCalled();
    expect(client.orderNote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: expect.stringContaining('already fully shipped'),
        }),
      }),
    );
  });
});
