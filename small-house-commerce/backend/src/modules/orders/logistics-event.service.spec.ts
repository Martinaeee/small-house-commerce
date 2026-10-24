import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { LogisticsEventService } from './logistics-event.service.js';

const ORDER_ID = '00000000-0000-4000-8000-0000000000a1';
const SHIPMENT_ID = '00000000-0000-4000-8000-0000000000b1';
const OTHER_SHIPMENT_ID = '00000000-0000-4000-8000-0000000000b2';

type Row = Record<string, any>;

function createHarness() {
  const db: { shipments: Row[]; events: Row[] } = {
    shipments: [
      { id: SHIPMENT_ID, orderId: ORDER_ID, carrier: 'LBC', status: 'SHIPPING' },
      { id: OTHER_SHIPMENT_ID, orderId: ORDER_ID, carrier: 'J&T', status: 'SHIPPING' },
      { id: 'shipment-of-another-order', orderId: 'another', carrier: 'LBC', status: 'SHIPPING' },
    ],
    events: [],
  };
  let seq = 0;
  const prisma = {
    shipment: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        db.shipments.find((s) => s.id === where.id) ?? null,
      ),
    },
    logisticsEvent: {
      findFirst: vi.fn(async ({ where }: { where: Row }) =>
        db.events.find(
          (event) =>
            event.shipmentId === where.shipmentId &&
            (where.externalEventId === undefined ||
              event.externalEventId === where.externalEventId) &&
            (!where.normalizedStatus ||
              event.normalizedStatus === where.normalizedStatus) &&
            (!where.eventTime || event.eventTime.getTime() === where.eventTime.getTime()),
        ) ?? null,
      ),
      create: vi.fn(async ({ data }: { data: Row }) => {
        const row = { id: `ev-${++seq}`, externalEventId: null, ...data };
        db.events.push(row);
        return row;
      }),
    },
  };
  return { service: new LogisticsEventService(prisma as never), prisma, db };
}

const event = (overrides: Row = {}) => ({
  normalizedStatus: 'IN_TRANSIT' as const,
  externalStatus: 'In transit to sorting facility',
  externalEventId: 'LBC-1',
  eventTime: new Date('2026-10-23T10:00:00.000Z'),
  ...overrides,
});

describe('LogisticsEventService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('records the carrier wording next to the normalized state', async () => {
    const { service } = createHarness();
    const saved = await service.record(ORDER_ID, SHIPMENT_ID, event({ city: 'Quezon City' }));

    expect(saved).toMatchObject({
      shipmentId: SHIPMENT_ID,
      carrier: 'LBC',
      externalEventId: 'LBC-1',
      externalStatus: 'In transit to sorting facility',
      normalizedStatus: 'IN_TRANSIT',
      city: 'Quezon City',
    });
    expect(saved.eventTime).toBeInstanceOf(Date);
  });

  it('returns the existing event when the same external event id arrives again', async () => {
    const { service, prisma, db } = createHarness();
    const first = await service.record(ORDER_ID, SHIPMENT_ID, event());
    const second = await service.record(ORDER_ID, SHIPMENT_ID, event());

    expect(second.id).toBe(first.id);
    expect(prisma.logisticsEvent.create).toHaveBeenCalledTimes(1);
    expect(db.events).toHaveLength(1);
  });

  it('does not merge the same external id across different shipments', async () => {
    const { service, db } = createHarness();
    await service.record(ORDER_ID, SHIPMENT_ID, event());
    await service.record(ORDER_ID, OTHER_SHIPMENT_ID, event());

    expect(db.events).toHaveLength(2);
  });

  it('deduplicates manual events by shipment, state and time', async () => {
    const { service, prisma, db } = createHarness();
    const manual = event({ externalEventId: null, externalStatus: 'manual: FAILED_DELIVERY' });
    await service.record(ORDER_ID, SHIPMENT_ID, manual);
    await service.record(ORDER_ID, SHIPMENT_ID, manual);

    expect(prisma.logisticsEvent.create).toHaveBeenCalledTimes(1);
    expect(db.events).toHaveLength(1);
  });

  it('keeps two real attempts on the same day when the time differs', async () => {
    const { service, db } = createHarness();
    await service.record(ORDER_ID, SHIPMENT_ID, event({ externalEventId: null }));
    await service.record(
      ORDER_ID,
      SHIPMENT_ID,
      event({
        externalEventId: null,
        normalizedStatus: 'FAILED_DELIVERY',
        eventTime: new Date('2026-10-23T15:00:00.000Z'),
      }),
    );

    expect(db.events).toHaveLength(2);
  });

  it('refuses a shipment that belongs to a different order', async () => {
    const { service } = createHarness();
    await expect(
      service.record(ORDER_ID, 'shipment-of-another-order', event()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('never moves the shipment or order state on its own', async () => {
    const { service, prisma } = createHarness();
    await service.record(ORDER_ID, SHIPMENT_ID, event({ normalizedStatus: 'FAILED_DELIVERY' }));

    expect((prisma as unknown as Row).shipment.update).toBeUndefined();
    expect((prisma as unknown as Row).order).toBeUndefined();
  });
});
