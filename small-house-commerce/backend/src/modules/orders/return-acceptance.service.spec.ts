import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ReturnAcceptanceService } from './return-acceptance.service.js';

const ORDER_ID = '00000000-0000-4000-8000-0000000000a1';
const OPERATOR = '00000000-0000-4000-8000-0000000000b1';
const WAREHOUSE = '00000000-0000-4000-8000-0000000000c1';
const LINE_PLAIN = '00000000-0000-4000-8000-0000000000d1';
const LINE_BUNDLE = '00000000-0000-4000-8000-0000000000d2';
const SKU_PLAIN = '00000000-0000-4000-8000-0000000000e1';
const SKU_COMPONENT = '00000000-0000-4000-8000-0000000000e2';

type Row = Record<string, any>;

function bundleSnapshot() {
  return {
    version: 1,
    bundleSkuId: '00000000-0000-4000-8000-0000000000f1',
    bundleSkuCode: 'BUNDLE-1',
    components: [
      {
        componentSkuId: SKU_COMPONENT,
        skuCode: 'COMP-1',
        productName: 'Chair',
        variantName: 'Natural',
        quantity: 2,
        totalQuantity: 4,
        position: 0,
      },
    ],
  };
}

function createHarness(options: { status?: string; previous?: Row[] } = {}) {
  const db = {
    order: {
      id: ORDER_ID,
      orderStatus: options.status ?? 'SHIPPING',
      items: [
        { id: LINE_PLAIN, skuId: SKU_PLAIN, bundleSnapshot: null, quantity: 2 },
        { id: LINE_BUNDLE, skuId: 'bundle-sku', bundleSnapshot: bundleSnapshot(), quantity: 2 },
      ],
    } as Row | null,
    shipments: [
      {
        id: 'ship-1',
        warehouseId: WAREHOUSE,
        status: 'SHIPPING',
        items: [
          { orderItemId: LINE_PLAIN, quantity: 2 },
          { orderItemId: LINE_BUNDLE, quantity: 2 },
        ],
      },
    ],
    previous: options.previous ?? [],
  };
  let seq = 0;
  const tx: Record<string, any> = {
    $queryRaw: vi.fn(async () => []),
    order: {
      findUnique: vi.fn(async () =>
        db.order ? { ...db.order, shipments: db.shipments } : null,
      ),
      update: vi.fn(async ({ data }: { data: Row }) => Object.assign(db.order!, data)),
    },
    shipment: {
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) =>
        Object.assign(db.shipments.find((shipment) => shipment.id === where.id)!, data),
      ),
    },
    orderStatusHistory: { create: vi.fn(async () => ({})) },
    orderNote: { create: vi.fn(async () => ({})) },
    returnAcceptanceItem: { findMany: vi.fn(async () => db.previous) },
    returnAcceptance: {
      create: vi.fn(async ({ data }: { data: Row }) => {
        const row = {
          id: `ra-${++seq}`,
          receivedAt: new Date(),
          createdAt: new Date(),
          ...data,
          items: (data.items?.create ?? []).map((item: Row) => ({ id: `rai-${++seq}`, ...item })),
        };
        delete row.items?.create;
        return row;
      }),
    },
    inventory: { update: vi.fn(async () => ({})), upsert: vi.fn(async () => ({})) },
    inventoryMovement: { create: vi.fn(async () => ({})) },
  };
  const prisma = {
    $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
  };
  return { service: new ReturnAcceptanceService(prisma as never), tx, db };
}

describe('ReturnAcceptanceService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('restocks the good units of a plain line with a RETURN_RESTOCK movement', async () => {
    const { service, tx } = createHarness();
    const accepted = await service.accept(ORDER_ID, OPERATOR, {
        shipmentId: 'ship-1',
      reason: 'RTO from carrier',
      items: [{ orderItemId: LINE_PLAIN, quantityGood: 1, quantityDamaged: 1 }],
    });

    expect(accepted.receivedBy).toBe(OPERATOR);
    expect(accepted.reason).toBe('RTO from carrier');
    expect(tx.inventory.update).toHaveBeenCalledWith({
      where: { skuId_warehouseId: { skuId: SKU_PLAIN, warehouseId: WAREHOUSE } },
      data: { onHand: { increment: 1 } },
    });
    expect(tx.inventoryMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        skuId: SKU_PLAIN,
        warehouseId: WAREHOUSE,
        movementType: 'RETURN_RESTOCK',
        quantity: 1,
        referenceType: 'RETURN_ACCEPTANCE',
        referenceId: accepted.id,
        operatorId: OPERATOR,
      }),
    });
  });

  it('restocks the Bundle components recorded on the line, not the bundle SKU', async () => {
    const { service, tx } = createHarness();
    await service.accept(ORDER_ID, OPERATOR, {
        shipmentId: 'ship-1',
      items: [{ orderItemId: LINE_BUNDLE, quantityGood: 2, quantityDamaged: 0 }],
    });

    expect(tx.inventory.update).toHaveBeenCalledWith({
      where: { skuId_warehouseId: { skuId: SKU_COMPONENT, warehouseId: WAREHOUSE } },
      data: { onHand: { increment: 4 } },
    });
    expect(tx.inventory.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: { skuId_warehouseId: { skuId: 'bundle-sku', warehouseId: WAREHOUSE } },
      }),
    );
  });

  it('records damaged units without putting them back on sale', async () => {
    const { service, tx } = createHarness();
    await service.accept(ORDER_ID, OPERATOR, {
        shipmentId: 'ship-1',
      items: [{ orderItemId: LINE_PLAIN, quantityGood: 0, quantityDamaged: 2, conditionNote: 'Cracked frame' }],
    });

    expect(tx.inventory.update).not.toHaveBeenCalled();
    expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
  });

  it('counts earlier acceptances and refuses returning more than was shipped', async () => {
    const { service } = createHarness({
      previous: [{ orderItemId: LINE_PLAIN, quantityGood: 1, quantityDamaged: 0, acceptance: { shipmentId: 'ship-1' } }],
    });
    await expect(
      service.accept(ORDER_ID, OPERATOR, {
        shipmentId: 'ship-1',
        items: [{ orderItemId: LINE_PLAIN, quantityGood: 2, quantityDamaged: 0 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a line that is not part of the order or has no units at all', async () => {
    const { service } = createHarness();
    await expect(
      service.accept(ORDER_ID, OPERATOR, {
        shipmentId: 'ship-1',
        items: [{ orderItemId: 'not-a-line', quantityGood: 1, quantityDamaged: 0 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.accept(ORDER_ID, OPERATOR, {
        shipmentId: 'ship-1',
        items: [{ orderItemId: LINE_PLAIN, quantityGood: 0, quantityDamaged: 0 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('only accepts RTOs while the order is SHIPPING', async () => {
    const { service } = createHarness({ status: 'SIGNED' });
    await expect(
      service.accept(ORDER_ID, OPERATOR, {
        shipmentId: 'ship-1',
        items: [{ orderItemId: LINE_PLAIN, quantityGood: 1, quantityDamaged: 0 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses an unknown order', async () => {
    const { service, db } = createHarness();
    db.order = null;
    await expect(
      service.accept(ORDER_ID, OPERATOR, {
        shipmentId: 'ship-1',
        items: [{ orderItemId: LINE_PLAIN, quantityGood: 1, quantityDamaged: 0 }],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('closes a fully returned order without recording a delivery or changing payment', async () => {
    const { service, db, tx } = createHarness();
    const accepted = await service.accept(ORDER_ID, OPERATOR, {
      shipmentId: 'ship-1',
      items: [
        { orderItemId: LINE_PLAIN, quantityGood: 1, quantityDamaged: 1 },
        { orderItemId: LINE_BUNDLE, quantityGood: 2, quantityDamaged: 0 },
      ],
    });
    expect(accepted.shipmentId).toBe('ship-1');
    expect(db.shipments[0].status).toBe('RETURNED');
    expect(db.order?.orderStatus).toBe('RETURNED');
    expect(tx.orderStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ oldStatus: 'SHIPPING', newStatus: 'RETURNED' }),
    });
    expect(tx.order.update.mock.calls[0][0].data).not.toHaveProperty('paymentStatus');
  });

  it('leaves a partially returned shipment open for its remaining goods', async () => {
    const { service, db } = createHarness();
    await service.accept(ORDER_ID, OPERATOR, {
      shipmentId: 'ship-1',
      items: [{ orderItemId: LINE_PLAIN, quantityGood: 1, quantityDamaged: 0 }],
    });
    expect(db.shipments[0].status).toBe('SHIPPING');
    expect(db.order?.orderStatus).toBe('SHIPPING');
  });

  it('closes a mixed delivered and returned order as PARTIALLY_RETURNED', async () => {
    const { service, db } = createHarness();
    db.shipments[0].items = [{ orderItemId: LINE_PLAIN, quantity: 2 }];
    db.shipments.push({
      id: 'ship-2', warehouseId: WAREHOUSE, status: 'SIGNED',
      items: [{ orderItemId: LINE_BUNDLE, quantity: 2 }],
    });
    await service.accept(ORDER_ID, OPERATOR, {
      shipmentId: 'ship-1',
      items: [{ orderItemId: LINE_PLAIN, quantityGood: 2, quantityDamaged: 0 }],
    });
    expect(db.order?.orderStatus).toBe('PARTIALLY_RETURNED');
  });

  it('does not close an order that still has unshipped goods', async () => {
    const { service, db } = createHarness();
    db.shipments[0].items = [{ orderItemId: LINE_PLAIN, quantity: 2 }];
    await service.accept(ORDER_ID, OPERATOR, {
      shipmentId: 'ship-1',
      items: [{ orderItemId: LINE_PLAIN, quantityGood: 2, quantityDamaged: 0 }],
    });
    expect(db.shipments[0].status).toBe('RETURNED');
    expect(db.order?.orderStatus).toBe('SHIPPING');
  });

  it('refuses a returned or signed box even while another box is SHIPPING', async () => {
    for (const status of ['SIGNED', 'RETURNED', 'PARTIALLY_RETURNED']) {
      const { service, db, tx } = createHarness();
      db.shipments[0].status = status;
      await expect(service.accept(ORDER_ID, OPERATOR, {
        shipmentId: 'ship-1',
        items: [{ orderItemId: LINE_PLAIN, quantityGood: 1, quantityDamaged: 0 }],
      })).rejects.toThrow(/shipment|发货单/i);
      expect(tx.returnAcceptance.create).not.toHaveBeenCalled();
    }
  });

  it('caps the return at the selected box, not all boxes containing the same line', async () => {
    const { service, db, tx } = createHarness();
    db.shipments[0].items = [{ orderItemId: LINE_PLAIN, quantity: 1 }];
    db.shipments.push({
      id: 'ship-2', warehouseId: WAREHOUSE, status: 'SHIPPING',
      items: [{ orderItemId: LINE_PLAIN, quantity: 1 }],
    });
    await expect(service.accept(ORDER_ID, OPERATOR, {
      shipmentId: 'ship-1',
      items: [{ orderItemId: LINE_PLAIN, quantityGood: 2, quantityDamaged: 0 }],
    })).rejects.toThrow(/超出/);
    expect(tx.returnAcceptance.create).not.toHaveBeenCalled();
  });

  it('refuses a box from another order and duplicate line entries', async () => {
    const { service, tx } = createHarness();
    await expect(service.accept(ORDER_ID, OPERATOR, {
      shipmentId: 'unrelated-box',
      items: [{ orderItemId: LINE_PLAIN, quantityGood: 1, quantityDamaged: 0 }],
    })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.accept(ORDER_ID, OPERATOR, {
      shipmentId: 'ship-1',
      items: [
        { orderItemId: LINE_PLAIN, quantityGood: 2, quantityDamaged: 0 },
        { orderItemId: LINE_PLAIN, quantityGood: 2, quantityDamaged: 0 },
      ],
    })).rejects.toThrow(/重复/);
    expect(tx.returnAcceptance.create).not.toHaveBeenCalled();
  });

  it('lists the accepted returns of an order', async () => {
    const rows = [{ id: 'ra-1', items: [] }];
    const prisma = {
      returnAcceptance: { findMany: vi.fn(async () => rows) },
    };
    const service = new ReturnAcceptanceService(prisma as never);
    await expect(service.list(ORDER_ID)).resolves.toBe(rows);
    expect(prisma.returnAcceptance.findMany).toHaveBeenCalledWith({
      where: { orderId: ORDER_ID },
      include: { items: true },
      orderBy: { receivedAt: 'desc' },
    });
  });
});
