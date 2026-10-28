import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { QianyiError } from './qianyi.client.js';
import { QianyiSyncService } from './qianyi-sync.service.js';

const CONFIG = new ConfigService({
  qianyi: {
    enabled: 'true',
    appId: '1793-test',
    appSecret: 's3cr3t-value',
    shop: 'LUWAG- PH',
    warehouseId: 71537,
    warehouse: 'PH-DAVAO-01',
    logistics: 'SHIPDOC-STD',
  },
});

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    orderId: 'order-1',
    kind: 'PUSH_ORDER',
    status: 'PENDING',
    attempts: 0,
    nextAttemptAt: new Date('2026-10-28T00:00:00Z'),
    lastError: null,
    requestPayload: { onlineOrderNumber: 'PH100012' },
    responsePayload: null,
    externalOrderNumber: null,
    ...overrides,
  };
}

function prismaWith(jobs: ReturnType<typeof job>[]) {
  return {
    qianyiSyncJob: {
      findMany: vi.fn(async () => jobs),
      update: vi.fn(async () => undefined),
      count: vi.fn(async () => 0),
      findUnique: vi.fn(async () => jobs[0]),
    },
    order: { update: vi.fn(async () => undefined) },
  };
}

describe('QianyiSyncService.processPending', () => {
  const client = {
    enabled: true,
    call: vi.fn(),
  };

  beforeEach(() => client.call.mockReset());

  it('marks a delivered job SENT and stores the Qianyi order number', async () => {
    const prisma = prismaWith([job()]);
    client.call.mockResolvedValue({ orderNumber: 'S2610288955080' });
    const service = new QianyiSyncService(prisma as never, client as never, CONFIG);

    await service.processPending(new Date('2026-10-28T01:00:00Z'));

    expect(client.call).toHaveBeenCalledWith(
      'CREATE_AND_AUDIT_SALES_ORDER',
      'salesOrder',
      expect.objectContaining({ onlineOrderNumber: 'PH100012' }),
    );
    const update = prisma.qianyiSyncJob.update.mock.calls[0][0];
    expect(update.data.status).toBe('SENT');
    expect(update.data.externalOrderNumber).toBe('S2610288955080');
  });

  it('keeps a business failure pending and backs off', async () => {
    const prisma = prismaWith([job()]);
    // A plain failing function rather than a throwing spy: vitest reports a
    // rejection raised inside a mock as an unhandled error even when the
    // caller catches it, which would fail a test whose code is correct.
    const failing = {
      enabled: true,
      call: async (): Promise<never> => {
        throw new QianyiError('权限不足', 'SERVICE_TYPE_NOT_ALLOW');
      },
    };
    const service = new QianyiSyncService(prisma as never, failing as never, CONFIG);

    await service.processPending(new Date('2026-10-28T01:00:00Z'));

    const update = prisma.qianyiSyncJob.update.mock.calls[0][0];
    expect(update.data.status).toBe('PENDING');
    expect(update.data.attempts).toEqual({ increment: 1 });
    expect(update.data.lastError).toContain('SERVICE_TYPE_NOT_ALLOW');
  });

  it('gives up after the fifth attempt', async () => {
    const prisma = prismaWith([job({ attempts: 4 })]);
    const failing = {
      enabled: true,
      call: async (): Promise<never> => {
        throw new QianyiError('boom', 'TRANSPORT');
      },
    };
    const service = new QianyiSyncService(prisma as never, failing as never, CONFIG);

    await service.processPending(new Date('2026-10-28T01:00:00Z'));

    expect(prisma.qianyiSyncJob.update.mock.calls[0][0].data.status).toBe('FAILED');
  });

  it('does nothing while the integration is disabled', async () => {
    const prisma = prismaWith([job()]);
    const service = new QianyiSyncService(
      prisma as never,
      { enabled: false, call: vi.fn() } as never,
      CONFIG,
    );
    expect(await service.processPending()).toBe(0);
    expect(prisma.qianyiSyncJob.findMany).not.toHaveBeenCalled();
  });
});

describe('QianyiSyncService.reconcile', () => {
  it('asks for the last three days, which satisfies the one-condition rule', async () => {
    const prisma = {
      qianyiSyncJob: { findMany: vi.fn(async () => []), update: vi.fn(), count: vi.fn(async () => 0) },
      order: { update: vi.fn(), findUnique: vi.fn(async () => null) },
      orderNote: { create: vi.fn(async () => undefined) },
    };
    const client = { enabled: true, call: vi.fn(async () => []) };
    const service = new QianyiSyncService(prisma as never, client as never, CONFIG);

    await service.reconcile(new Date('2026-10-28T03:00:00Z'));

    const [, , biz] = client.call.mock.calls[0];
    expect(client.call.mock.calls[0][0]).toBe('QUERY_SALES_ORDER_LIST');
    expect(biz).toEqual(
      expect.objectContaining({
        updateTimeFrom: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
        updateTimeTo: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
        page: 1,
      }),
    );
  });

  it('flags a tracking number the local order does not have', async () => {
    const prisma = {
      qianyiSyncJob: { findMany: vi.fn(), update: vi.fn(), count: vi.fn(async () => 0) },
      order: {
        update: vi.fn(),
        findUnique: vi.fn(async () => ({ id: 'order-1', shipments: [] })),
      },
      orderNote: { create: vi.fn(async () => undefined) },
    };
    const client = {
      enabled: true,
      call: vi.fn(async () => [
        { onlineOrderNumber: 'PH100012', trackingNumber: 'TRACK999', status: 'WAIT_SHIP' },
      ]),
    };
    const service = new QianyiSyncService(prisma as never, client as never, CONFIG);

    await service.reconcile(new Date('2026-10-28T03:00:00Z'));

    expect(prisma.orderNote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ content: expect.stringContaining('TRACK999') }),
      }),
    );
  });

  it('does nothing while disabled', async () => {
    const prisma = { qianyiSyncJob: { findMany: vi.fn(), update: vi.fn(), count: vi.fn() } };
    const client = { enabled: false, call: vi.fn() };
    const service = new QianyiSyncService(prisma as never, client as never, CONFIG);
    await expect(service.reconcile()).resolves.toEqual({ checked: 0, repaired: 0 });
    expect(client.call).not.toHaveBeenCalled();
  });
});
