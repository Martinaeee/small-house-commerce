import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OrderHandoverService } from './handover.service.js';

const ORDER_ID = '00000000-0000-4000-8000-0000000000a1';
const OPERATOR = '00000000-0000-4000-8000-0000000000b1';
const LINE_1 = '00000000-0000-4000-8000-0000000000c1';
const LINE_2 = '00000000-0000-4000-8000-0000000000c2';

type Row = Record<string, any>;

function createHarness(lines: Row[] = [
  { id: LINE_1, skuCodeSnapshot: 'SKU-NG-180-TN', quantity: 1 },
  { id: LINE_2, skuCodeSnapshot: 'SKU-KC-GRN', quantity: 2 },
]) {
  let seq = 0;
  const db = {
    events: [] as Row[],
    order: { id: ORDER_ID, orderStatus: 'CONFIRMED', items: lines } as Row | null,
  };

  const tx: Record<string, any> = {
    $queryRaw: vi.fn(async () => []),
    order: { findUnique: vi.fn(async () => db.order) },
    orderHandoverEvent: {
      findMany: vi.fn(async ({ where }: { where: Row }) =>
        db.events.filter((e) => (where.orderId ? e.orderId === where.orderId : true)),
      ),
      create: vi.fn(async ({ data }: { data: Row }) => {
        const row = { id: `ho-${++seq}`, createdAt: new Date(), ...data };
        db.events.push(row);
        return row;
      }),
    },
  };
  const prisma = {
    ...tx,
    $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
  };
  const service = new OrderHandoverService(prisma as never);
  return { service, db, prisma, tx };
}

const handover = (overrides: Row = {}) => ({
  type: 'HANDED_OVER' as const,
  items: [{ orderItemId: LINE_1, quantity: 1 }],
  ...overrides,
});

describe('OrderHandoverService', () => {
  it('records the handover with the real operator, the lines and the quantities', async () => {
    const { service, db } = createHarness();
    const event = await service.record(ORDER_ID, OPERATOR, handover());

    expect(event).toMatchObject({
      orderId: ORDER_ID,
      type: 'HANDED_OVER',
      disposition: 'ACCEPTED',
      operatorId: OPERATOR,
    });
    expect(event.occurredAt).toBeInstanceOf(Date);
    expect(event.items).toEqual([
      { orderItemId: LINE_1, quantity: 1, skuCodeSnapshot: 'SKU-NG-180-TN' },
    ]);
    expect(db.events).toHaveLength(1);
  });

  it('refuses a line that is not part of the order', async () => {
    const { service } = createHarness();
    await expect(
      service.record(ORDER_ID, OPERATOR, handover({ items: [{ orderItemId: 'not-a-line', quantity: 1 }] })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses more than the ordered quantity', async () => {
    const { service } = createHarness();
    await expect(
      service.record(ORDER_ID, OPERATOR, handover({ items: [{ orderItemId: LINE_2, quantity: 3 }] })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('adds up partial handovers and refuses the overflow', async () => {
    const { service } = createHarness();
    await service.record(ORDER_ID, OPERATOR, handover({ items: [{ orderItemId: LINE_2, quantity: 1 }] }));
    const second = await service.record(ORDER_ID, OPERATOR, handover({ items: [{ orderItemId: LINE_2, quantity: 1 }] }));
    expect(second.items).toEqual([
      { orderItemId: LINE_2, quantity: 1, skuCodeSnapshot: 'SKU-KC-GRN' },
    ]);
    await expect(
      service.record(ORDER_ID, OPERATOR, handover({ items: [{ orderItemId: LINE_2, quantity: 1 }] })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires a reason when the warehouse refuses', async () => {
    const { service } = createHarness();
    await expect(
      service.record(ORDER_ID, OPERATOR, handover({ type: 'REJECTED' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    const event = await service.record(
      ORDER_ID,
      OPERATOR,
      handover({ type: 'REJECTED', reason: '外箱破损，缺 1 件' }),
    );
    expect(event).toMatchObject({ type: 'REJECTED', disposition: 'REJECTED', reason: '外箱破损，缺 1 件' });
  });

  it('requires a reason when the customer withdraws', async () => {
    const { service } = createHarness();
    await expect(
      service.record(ORDER_ID, OPERATOR, handover({ type: 'WITHDRAWN' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    const event = await service.record(
      ORDER_ID,
      OPERATOR,
      handover({ type: 'WITHDRAWN', reason: '客户行使撤回权' }),
    );
    expect(event).toMatchObject({ type: 'WITHDRAWN', disposition: 'WITHDRAWN' });
  });

  it('sums only the accepted handovers', async () => {
    const { service } = createHarness();
    await service.record(ORDER_ID, OPERATOR, handover({ items: [{ orderItemId: LINE_2, quantity: 1 }] }));
    await service.record(ORDER_ID, OPERATOR, handover({ type: 'REJECTED', reason: '缺件', items: [{ orderItemId: LINE_2, quantity: 1 }] }));
    const summary = await service.summary(ORDER_ID);
    expect(summary.handedOver).toEqual([{ orderItemId: LINE_2, quantity: 1, skuCodeSnapshot: 'SKU-KC-GRN' }]);
    // line 1 was never handed over, line 2 only half of it
    expect(summary.outstanding).toEqual([
      { orderItemId: LINE_1, quantity: 1, skuCodeSnapshot: 'SKU-NG-180-TN' },
      { orderItemId: LINE_2, quantity: 1, skuCodeSnapshot: 'SKU-KC-GRN' },
    ]);
    expect(summary.complete).toBe(false);
    expect(summary.rejected).toBe(1);
  });

  it('refuses an unknown order', async () => {
    const { service, db } = createHarness();
    db.order = null;
    await expect(service.record('missing', OPERATOR, handover())).rejects.toBeInstanceOf(NotFoundException);
  });
});
