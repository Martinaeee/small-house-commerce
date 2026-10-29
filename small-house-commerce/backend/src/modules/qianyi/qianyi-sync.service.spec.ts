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

  it('adopts an order Qianyi already has instead of creating a duplicate', async () => {
    const prisma = prismaWith([job({ attempts: 1 })]);
    const client = {
      enabled: true,
      call: vi.fn(async (serviceType: string) =>
        serviceType === 'QUERY_SALES_ORDER_LIST' ? [{ orderNumber: 'S2610288955080' }] : null,
      ),
    };
    const service = new QianyiSyncService(prisma as never, client as never, CONFIG);

    await service.processPending(new Date('2026-10-28T01:00:00Z'));

    const calls = client.call.mock.calls.map((call) => call[0]);
    expect(calls).toEqual(['QUERY_SALES_ORDER_LIST']);
    const update = prisma.qianyiSyncJob.update.mock.calls[0][0];
    expect(update.data.status).toBe('SENT');
    expect(update.data.externalOrderNumber).toBe('S2610288955080');
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

describe('QianyiSyncService.enqueue', () => {
  function txWith(mapping: string | null) {
    return {
      order: {
        findUnique: vi.fn(async () => ({
          id: 'order-1',
          orderNumber: 'PH100012',
          currency: 'PHP',
          shippingTotal: '0.00',
          discountTotal: '0.00',
          grandTotal: '100.00',
          customerNote: null,
          createdAt: new Date('2026-10-28T02:30:00Z'),
          customer: { name: 'Maria', email: null },
          shippingAddress: null,
          items: [
            {
              skuCodeSnapshot: 'TB001-Wa',
              quantity: 1,
              unitPrice: '100.00',
              unitDiscount: '0.00',
              lineTotal: '100.00',
              sku: { skuCode: 'TB001-Wa', qianyiSkuCode: mapping },
            },
          ],
        })),
      },
      qianyiSyncJob: { upsert: vi.fn(async () => undefined) },
    };
  }

  it('queues a pending push when every line is mapped', async () => {
    const tx = txWith('YD003760CMHT');
    const service = new QianyiSyncService(
      {} as never,
      { enabled: true, call: vi.fn() } as never,
      CONFIG,
    );

    await service.enqueue(tx as never, 'PUSH_ORDER', 'order-1');

    const call = tx.qianyiSyncJob.upsert.mock.calls[0][0];
    expect(call.create.status).toBeUndefined(); // default PENDING
    expect(call.create.requestPayload).toMatchObject({ onlineOrderNumber: 'PH100012' });
  });

  it('records a SKIPPED job instead of failing the confirmation when a SKU has no mapping', async () => {
    const tx = txWith(null);
    const service = new QianyiSyncService(
      {} as never,
      { enabled: true, call: vi.fn() } as never,
      CONFIG,
    );

    // Confirming must never 500 because of a missing mapping.
    await expect(service.enqueue(tx as never, 'PUSH_ORDER', 'order-1')).resolves.toBeUndefined();

    const call = tx.qianyiSyncJob.upsert.mock.calls[0][0];
    expect(call.create.status).toBe('SKIPPED');
    expect(call.create.lastError).toContain('TB001-Wa');
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

  it('flags a Qianyi order that has no local counterpart', async () => {
    const prisma = {
      qianyiSyncJob: { findMany: vi.fn(), update: vi.fn(), count: vi.fn(async () => 0) },
      order: { update: vi.fn(), findUnique: vi.fn(async () => null) },
      orderNote: { create: vi.fn(async () => undefined) },
    };
    const client = {
      enabled: true,
      call: vi.fn(async () => [
        { onlineOrderNumber: 'PH999999', trackingNumber: 'TRACK1', status: 'WAIT_SHIP' },
      ]),
    };
    const service = new QianyiSyncService(prisma as never, client as never, CONFIG);

    const result = await service.reconcile(new Date('2026-10-28T03:00:00Z'));

    expect(result.unmatched).toBe(1);
    expect(prisma.orderNote.create).not.toHaveBeenCalled();
  });

  it('does nothing while disabled', async () => {
    const prisma = { qianyiSyncJob: { findMany: vi.fn(), update: vi.fn(), count: vi.fn() } };
    const client = { enabled: false, call: vi.fn() };
    const service = new QianyiSyncService(prisma as never, client as never, CONFIG);
    await expect(service.reconcile()).resolves.toEqual({
      checked: 0,
      repaired: 0,
      unmatched: 0,
    });
    expect(client.call).not.toHaveBeenCalled();
  });
});

describe('QianyiSyncService.requeueSkipped', () => {
  function orderWith(mapping: string | null) {
    return {
      id: 'order-1',
      orderNumber: 'PH100012',
      currency: 'PHP',
      shippingTotal: '0.00',
      discountTotal: '0.00',
      grandTotal: '100.00',
      customerNote: null,
      createdAt: new Date('2026-10-28T02:30:00Z'),
      customer: { name: 'Maria', email: null },
      shippingAddress: null,
      items: [
        {
          skuCodeSnapshot: 'TB001-Wa',
          quantity: 1,
          unitPrice: '100.00',
          unitDiscount: '0.00',
          lineTotal: '100.00',
          sku: { skuCode: 'TB001-Wa', qianyiSkuCode: mapping },
        },
      ],
    };
  }

  function prismaFor(order: ReturnType<typeof orderWith>, status = 'SKIPPED') {
    return {
      qianyiSyncJob: {
        findUnique: vi.fn(async () => ({
          id: 'job-1',
          orderId: 'order-1',
          kind: 'PUSH_ORDER',
          status,
          attempts: 0,
          lastError: 'No Qianyi code for TB001-Wa.',
          requestPayload: {},
        })),
        update: vi.fn(async () => undefined),
        findMany: vi.fn(async () => []),
        count: vi.fn(async () => 0),
      },
      order: { findUnique: vi.fn(async () => order), update: vi.fn(async () => undefined) },
      orderNote: { create: vi.fn(async () => undefined) },
    };
  }

  it('refuses while a line is still unmapped and says which one', async () => {
    const prisma = prismaFor(orderWith(null));
    const service = new QianyiSyncService(
      prisma as never,
      { enabled: true, call: vi.fn() } as never,
      CONFIG,
    );

    const result = await service.requeueSkipped('job-1', 'user-1');

    expect(result).toEqual({ ok: false, missing: ['TB001-Wa'] });
    expect(prisma.qianyiSyncJob.update).not.toHaveBeenCalled();
    expect(prisma.orderNote.create).not.toHaveBeenCalled();
  });

  it('requeues with the duplicate-check armed and keeps the original reason', async () => {
    const prisma = prismaFor(orderWith('YD003760CMHT'));
    const client = { enabled: true, call: vi.fn(async () => null) };
    const service = new QianyiSyncService(prisma as never, client as never, CONFIG);

    const result = await service.requeueSkipped('job-1', 'user-1');

    expect(result).toEqual({ ok: true });
    const update = prisma.qianyiSyncJob.update.mock.calls[0][0];
    expect(update.data.status).toBe('PENDING');
    // attempts = 1 makes the worker ask Qianyi before creating anything.
    expect(update.data.attempts).toBe(1);
    expect(update.data.lastError).toContain('requeued');
    expect(update.data.lastError).toContain('No Qianyi code for TB001-Wa');
    expect(prisma.orderNote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 'user-1', noteType: 'SYSTEM' }),
      }),
    );
  });

  it('refuses a job that is not skipped', async () => {
    const prisma = prismaFor(orderWith('YD003760CMHT'), 'SENT');
    const service = new QianyiSyncService(
      prisma as never,
      { enabled: true, call: vi.fn() } as never,
      CONFIG,
    );

    await expect(service.requeueSkipped('job-1', 'user-1')).resolves.toMatchObject({
      ok: false,
    });
    expect(prisma.qianyiSyncJob.update).not.toHaveBeenCalled();
  });
});

describe('QianyiSyncService.retry', () => {
  it('arms the duplicate check and keeps the failure reason', async () => {
    const prisma = {
      qianyiSyncJob: {
        findUnique: vi.fn(async () => ({
          id: 'job-1',
          status: 'FAILED',
          lastError: 'TRANSPORT: timeout',
        })),
        update: vi.fn(async () => undefined),
        findMany: vi.fn(async () => []),
        count: vi.fn(async () => 0),
      },
    };
    const service = new QianyiSyncService(
      prisma as never,
      { enabled: true, call: vi.fn() } as never,
      CONFIG,
    );

    await service.retry('job-1');

    const data = prisma.qianyiSyncJob.update.mock.calls[0][0].data;
    expect(data.attempts).toBe(1);
    expect(data.lastError).toContain('TRANSPORT: timeout');
  });
});

describe('QianyiSyncService.reconcile — archive pruning', () => {
  it('deletes archived callbacks older than the retention window', async () => {
    const prisma = {
      qianyiSyncJob: { findMany: vi.fn(), update: vi.fn(), count: vi.fn(async () => 0) },
      qianyiWebhookEvent: { deleteMany: vi.fn(async () => ({ count: 3 })) },
      order: { update: vi.fn(), findUnique: vi.fn(async () => null) },
      orderNote: { create: vi.fn() },
    };
    const client = { enabled: true, call: vi.fn(async () => []) };
    const service = new QianyiSyncService(prisma as never, client as never, CONFIG);

    await service.reconcile(new Date('2026-10-29T03:00:00Z'));

    expect(prisma.qianyiWebhookEvent.deleteMany).toHaveBeenCalledWith({
      where: { receivedAt: { lt: new Date('2026-07-31T03:00:00Z') } },
    });
  });
});
