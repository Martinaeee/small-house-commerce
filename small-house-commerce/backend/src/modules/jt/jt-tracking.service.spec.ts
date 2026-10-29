import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LogisticsEventService } from '../orders/logistics-event.service.js';
import {
  JtTrackingService,
  isTrackingDue,
  trackingBackoffMs,
} from './jt-tracking.service.js';

const O1 = '00000000-0000-4000-8000-0000000000a1';
const O2 = '00000000-0000-4000-8000-0000000000a2';
const S1 = '00000000-0000-4000-8000-0000000000b1';
const S2 = '00000000-0000-4000-8000-0000000000b2';
const S3 = '00000000-0000-4000-8000-0000000000b3';

const NOW = Date.parse('2026-10-28T10:00:00.000Z');

const delivered = {
  scanTime: '2026-10-28 09:00:00',
  desc: 'Your package has been Delivered',
  scanTypeName: 'Delivered',
  scanTypeCode: '113',
  staffConcatPhone: '9684746842',
  scanNetworkCity: 'TAGUIG',
  sigPicUrl: 'https://example.test/sign.jpg',
};

const inTransit = {
  scanTime: '2026-10-28 08:00:00',
  desc: 'Arrival at sorting centre',
  scanTypeName: 'Arrival',
  scanTypeCode: '110',
};

function createHarness(details = [delivered, inTransit]) {
  const shipments = [
    {
      id: S1,
      orderId: O1,
      // Lowercase on purpose: the poll query must match case-insensitively.
      carrier: 'j&t express',
      status: 'SHIPPING',
      trackingNumber: 'JT1',
      shippedAt: new Date('2026-10-27T02:00:00.000Z'),
      trackingCheckedAt: null as Date | null,
      trackingFailures: 0,
      trackingError: null as string | null,
    },
    {
      id: S2,
      orderId: O2,
      carrier: 'LBC',
      status: 'SHIPPING',
      trackingNumber: 'LBC1',
      shippedAt: new Date('2026-10-27T02:00:00.000Z'),
      trackingCheckedAt: null as Date | null,
      trackingFailures: 0,
      trackingError: null as string | null,
    },
    {
      id: S3,
      orderId: O2,
      carrier: 'J&T Express',
      status: 'SIGNED',
      trackingNumber: 'JT3',
      shippedAt: new Date('2026-10-26T02:00:00.000Z'),
      trackingCheckedAt: null as Date | null,
      trackingFailures: 0,
      trackingError: null as string | null,
    },
  ];
  const orders = [
    { id: O1, orderStatus: 'SHIPPING' },
    { id: O2, orderStatus: 'SHIPPING' },
  ];
  const events: Array<Record<string, any>> = [];
  let seq = 0;

  const sameCarrier = (row: Record<string, any>, filter: Record<string, any>) => {
    const want = String(filter.equals);
    const have = String(row.carrier);
    return filter.mode === 'insensitive'
      ? have.toLowerCase() === want.toLowerCase()
      : have === want;
  };

  const matches = (row: Record<string, any>, where: Record<string, any>) => {
    if (where.status && row.status !== where.status) return false;
    if (where.trackingNumber?.not === null && row.trackingNumber == null) return false;
    // Mirror Prisma: `mode: 'insensitive'` is opt-in, a bare equals is exact.
    if (where.carrier?.equals && !sameCarrier(row, where.carrier)) return false;
    // Mirror Prisma: negation carries `mode`, so it has to be top-level `NOT`.
    if (where.NOT?.carrier?.equals && sameCarrier(row, where.NOT.carrier)) return false;
    return true;
  };

  const prisma = {
    shipment: {
      findMany: vi.fn(async ({ where }: any) =>
        shipments.filter((row) => matches(row, where)),
      ),
      findUnique: vi.fn(async ({ where }: any) =>
        shipments.find((row) => row.id === where.id) ?? null,
      ),
      update: vi.fn(async ({ where, data }: any) => {
        const row = shipments.find((s) => s.id === where.id)!;
        if (data.trackingFailures?.increment) {
          row.trackingFailures += data.trackingFailures.increment;
        } else if (typeof data.trackingFailures === 'number') {
          row.trackingFailures = data.trackingFailures;
        }
        for (const key of ['trackingCheckedAt', 'trackingError'] as const) {
          if (key in data) (row as any)[key] = data[key];
        }
        return row;
      }),
      count: vi.fn(async ({ where }: any) =>
        shipments.filter((row) => matches(row, where)).length,
      ),
    },
    logisticsEvent: {
      findMany: vi.fn(async ({ where }: any) =>
        events.filter((e) => e.shipmentId === where.shipmentId),
      ),
      findFirst: vi.fn(async ({ where }: any) => {
        const rows = events
          .filter(
            (e) =>
              e.shipmentId === where.shipmentId &&
              (where.externalEventId === undefined ||
                e.externalEventId === where.externalEventId) &&
              (!where.normalizedStatus || e.normalizedStatus === where.normalizedStatus) &&
              (!where.eventTime ||
                (e.eventTime as Date).getTime() === where.eventTime.getTime()),
          )
          .sort((a, b) => (b.eventTime as Date).getTime() - (a.eventTime as Date).getTime());
        return rows[0] ?? null;
      }),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `ev-${++seq}`, ...data };
        events.push(row);
        return row;
      }),
    },
    order: {
      findUnique: vi.fn(async ({ where }: any) =>
        orders.find((o) => o.id === where.id) ?? null,
      ),
    },
  };

  const client = {
    enabled: true,
    trace: vi.fn(async () => details),
  };
  const ordersService = { sign: vi.fn(async () => ({})) };
  const eventsService = new LogisticsEventService(prisma as never);
  const config = {
    get: (key: string) =>
      ({
        'jt.enabled': 'true',
        'jt.carrierName': 'J&T Express',
        'jt.pollMinutes': 30,
      })[key],
  } as never;

  const service = new JtTrackingService(
    prisma as never,
    client as never,
    eventsService,
    ordersService as never,
    config,
    { gapMs: 0 },
  );

  return { service, client, ordersService, prisma, shipments, events, orders };
}

describe('backoff', () => {
  it('escalates and caps', () => {
    expect(trackingBackoffMs(0)).toBe(0);
    expect(trackingBackoffMs(1)).toBe(60 * 60 * 1000);
    expect(trackingBackoffMs(2)).toBe(6 * 60 * 60 * 1000);
    expect(trackingBackoffMs(5)).toBe(24 * 60 * 60 * 1000);
  });

  it('treats a never-checked shipment as due', () => {
    expect(
      isTrackingDue(
        { trackingCheckedAt: null, trackingFailures: 0, shippedAt: new Date(NOW) },
        NOW,
      ),
    ).toBe(true);
  });

  it('holds a recently failed shipment until its backoff passes', () => {
    expect(
      isTrackingDue(
        {
          trackingCheckedAt: new Date(NOW - 10 * 60 * 1000),
          trackingFailures: 1,
          shippedAt: new Date(NOW - 24 * 60 * 60 * 1000),
        },
        NOW,
      ),
    ).toBe(false);
  });
});

describe('JtTrackingService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('polls only SHIPPING J&T boxes, case-insensitively on the carrier', async () => {
    const { service, client } = createHarness();
    await service.tick(NOW);

    expect(client.trace).toHaveBeenCalledTimes(1);
    expect(client.trace).toHaveBeenCalledWith('JT1');
  });

  it('records every mapped scan and signs the delivery once', async () => {
    const { service, events, ordersService, shipments } = createHarness();
    const result = await service.tick(NOW);

    expect(result).toMatchObject({ checked: 1, appended: 2, failed: 0 });
    expect(events.map((e) => e.normalizedStatus).sort()).toEqual([
      'IN_TRANSIT',
      'SIGNED',
    ]);
    expect(ordersService.sign).toHaveBeenCalledWith(O1, S1, null, {
      source: 'CARRIER',
    });
    expect(shipments[0].trackingCheckedAt).toBeInstanceOf(Date);
    expect(shipments[0].trackingFailures).toBe(0);
  });

  it('does not duplicate events when the same waybill is polled twice', async () => {
    const { service, events, shipments } = createHarness();
    await service.tick(NOW);
    shipments[0].trackingCheckedAt = null; // force a second poll now
    await service.tick(NOW + 1000);

    expect(events).toHaveLength(2);
  });

  it('records a delivery without failing the poll when the carrier-driven sign is refused', async () => {
    const { service, ordersService, shipments } = createHarness();
    ordersService.sign.mockRejectedValueOnce(new Error('Order is CANCELLED'));

    const result = await service.tick(NOW);

    expect(result.failed).toBe(0);
    expect(shipments[0].trackingError).toBeNull();
  });

  it('increments failures and stores the error when the carrier rejects', async () => {
    const { service, client, shipments } = createHarness();
    client.trace.mockRejectedValueOnce(new Error('billCode not found'));

    const result = await service.tick(NOW);

    expect(result.failed).toBe(1);
    expect(shipments[0].trackingFailures).toBe(1);
    expect(shipments[0].trackingError).toBe('billCode not found');
  });

  it('resets the failure counter after a successful poll', async () => {
    const { service, shipments } = createHarness();
    shipments[0].trackingFailures = 2;

    await service.refreshShipment(O1, S1);

    expect(shipments[0].trackingFailures).toBe(0);
    expect(shipments[0].trackingError).toBeNull();
  });

  it('never changes status for a return scan', async () => {
    const { service, ordersService, events } = createHarness([
      {
        scanTime: '2026-10-28 09:00:00',
        desc: 'Return delivered',
        scanTypeName: 'Return Delivered',
        scanTypeCode: '117',
      },
    ]);

    await service.tick(NOW);

    expect(events[0].normalizedStatus).toBe('RETURNED');
    expect(ordersService.sign).not.toHaveBeenCalled();
  });

  it('reports health without touching the carrier', async () => {
    const { service, client } = createHarness();
    const health = await service.health();

    expect(health.enabled).toBe(true);
    expect(health.pendingShipments).toBe(1);
    expect(health.carrierMismatch).toBe(1);
    expect(client.trace).not.toHaveBeenCalled();
  });

  it('refuses to refresh a non-J&T shipment without calling the carrier', async () => {
    const { service, client, shipments } = createHarness();

    await expect(service.refreshShipment(O2, S2)).rejects.toThrow(/not handled by/i);

    expect(client.trace).not.toHaveBeenCalled();
    expect(shipments[1].trackingCheckedAt).toBeNull();
    expect(shipments[1].trackingFailures).toBe(0);
    expect(shipments[1].trackingError).toBeNull();
  });

  it('clears the stale worker error once a tick succeeds', async () => {
    const { service, client, shipments } = createHarness();
    client.trace.mockRejectedValueOnce(new Error('billCode not found'));

    await service.tick(NOW);
    expect((await service.health()).lastError).toBe('billCode not found');

    shipments[0].trackingCheckedAt = null; // force the next tick now
    await service.tick(NOW + 1000);

    expect((await service.health()).lastError).toBeNull();
  });

  it('records a tick-level failure in health instead of swallowing it', async () => {
    const { service, prisma } = createHarness();
    prisma.shipment.findMany.mockRejectedValueOnce(new Error('db down'));

    await expect(service.tick(NOW)).rejects.toThrow('db down');

    const health = await service.health();
    expect(health.lastError).toBe('db down');
    expect(health.lastTickAt).not.toBeNull();
  });

  it.each(['CANCELLED', 'AFTER_SALES'])(
    'records a delivery without advancing an order that is %s',
    async (status) => {
      const { service, events, ordersService, orders } = createHarness();
      orders[0].orderStatus = status;

      const result = await service.tick(NOW);

      expect(result.failed).toBe(0);
      expect(events.some((e) => e.normalizedStatus === 'SIGNED')).toBe(true);
      expect(ordersService.sign).not.toHaveBeenCalled();
    },
  );
});
