import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { QianyiSyncService } from './qianyi-sync.service.js';

const client = { enabled: true, call: vi.fn() };

const config = (prepaidVerified: boolean) =>
  new ConfigService({
    qianyi: {
      enabled: 'true',
      appId: '1793-test',
      appSecret: 's3cr3t-value',
      shop: 'LUWAG- PH',
      warehouseId: 71537,
      warehouse: 'PH-DAVAO-01',
      logistics: 'SHIPDOC-STD',
      prepaidVerified: prepaidVerified ? 'true' : 'false',
    },
  });

function orderWith(paymentStatus: string, method = 'SUNRATE') {
  return {
    id: 'order-1',
    orderNumber: 'PH100012',
    orderStatus: 'CONFIRMED',
    confirmationStatus: 'CONFIRMED',
    paymentStatus,
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
        id: 'line-1',
        skuCodeSnapshot: 'TB001-Wa',
        quantity: 1,
        unitPrice: '100.00',
        unitDiscount: '0.00',
        lineTotal: '100.00',
        sku: { skuCode: 'TB001-Wa', qianyiSkuCode: 'YD003760CMHT' },
      },
    ],
    payments: [{ id: 'pay-1', method, status: paymentStatus }],
  };
}

function txFor(order: ReturnType<typeof orderWith>) {
  return {
    $queryRaw: vi.fn(async () => []),
    order: { findUnique: vi.fn(async () => order), update: vi.fn(async () => undefined) },
    qianyiSyncJob: {
      findUnique: vi.fn(async () => null),
      findUniqueOrThrow: vi.fn(async () => job()),
      upsert: vi.fn(async (_args: { create: { status: string } }) => undefined),
      update: vi.fn(async (_args: { data: { status: string; lastError: string } }) => undefined),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    orderNote: { create: vi.fn(async () => undefined) },
  };
}

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    orderId: 'order-1',
    kind: 'PUSH_ORDER',
    status: 'PENDING',
    attempts: 1,
    autoCreateAttempts: 0,
    pendingReview: false,
    lastError: null,
    nextAttemptAt: new Date(),
    requestPayload: { shop: 'LUWAG- PH', onlineOrderNumber: 'PH100012' },
    ...overrides,
  };
}

function serviceWith(tx: ReturnType<typeof txFor>, prepaidVerified: boolean) {
  const prisma = {
    ...tx,
    qianyiSyncJob: {
      ...tx.qianyiSyncJob,
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
    },
    $transaction: vi.fn(async (fn: (client: unknown) => unknown) => fn(tx)),
    $queryRaw: vi.fn(async () => [{ id: 'job-1' }]),
    qianyiWebhookEvent: { deleteMany: vi.fn(async () => ({ count: 0 })), count: vi.fn(async () => 0) },
  };
  return { service: new QianyiSyncService(prisma as never, client as never, config(prepaidVerified)), prisma, tx };
}

beforeEach(() => client.call.mockReset());

describe('Qianyi and online payments', () => {
  it('queues nothing for an online order that is not paid yet', async () => {
    const tx = txFor(orderWith('ONLINE_PENDING'));
    const { service } = serviceWith(tx, true);

    await service.enqueue(tx as never, 'PUSH_ORDER', 'order-1');

    expect(tx.qianyiSyncJob.upsert).not.toHaveBeenCalled();
  });

  it('queues a push for an online order that is paid', async () => {
    const tx = txFor(orderWith('PAID'));
    const { service } = serviceWith(tx, true);

    await service.enqueue(tx as never, 'PUSH_ORDER', 'order-1');

    expect(tx.qianyiSyncJob.upsert).toHaveBeenCalled();
    expect(tx.qianyiSyncJob.upsert.mock.calls[0]![0].create.status).toBe('PENDING');
  });

  it('leaves a cash order alone', async () => {
    const tx = txFor({ ...orderWith('COD_PENDING', 'COD') });
    const { service } = serviceWith(tx, true);

    await service.enqueue(tx as never, 'PUSH_ORDER', 'order-1');

    expect(tx.qianyiSyncJob.upsert).toHaveBeenCalled();
  });

  it('fails the job when the order is not paid at send time', async () => {
    const tx = txFor(orderWith('ONLINE_PENDING'));
    const { service, prisma } = serviceWith(tx, true);
    client.call.mockResolvedValue([]);

    await service.processPending(new Date('2026-11-20T08:00:00Z'));

    const update = prisma.qianyiSyncJob.update.mock.calls.at(-1)![0];
    expect(update.data.status).toBe('FAILED');
    expect(update.data.lastError).toContain('ONLINE_ORDER_NOT_PAID');
    expect(client.call).not.toHaveBeenCalled();
  });

  it('fails the job when the prepaid mapping is not verified yet', async () => {
    const tx = txFor(orderWith('PAID'));
    const { service, prisma } = serviceWith(tx, false);
    client.call.mockResolvedValue([]);

    await service.processPending(new Date('2026-11-20T08:00:00Z'));

    const update = prisma.qianyiSyncJob.update.mock.calls.at(-1)![0];
    expect(update.data.status).toBe('FAILED');
    expect(update.data.lastError).toContain('QIANYI_PREPAID_MAPPING_UNVERIFIED');
    expect(client.call).not.toHaveBeenCalled();
  });

  it('sends the order when the payment is paid and the prepaid mapping is verified', async () => {
    const tx = txFor(orderWith('PAID'));
    const { service } = serviceWith(tx, true);
    client.call.mockImplementation(async (action: string) => {
      if (action === 'QUERY_SALES_ORDER_LIST') return [];
      return { orderNumber: 'QY-1' };
    });

    await service.processPending(new Date('2026-11-20T08:00:00Z'));

    expect(client.call).toHaveBeenCalledWith(
      'CREATE_AND_AUDIT_SALES_ORDER',
      'salesOrder',
      expect.objectContaining({ onlineOrderNumber: 'PH100012' }),
    );
  });

  it('never holds back a close order', async () => {
    const tx = txFor(orderWith('ONLINE_PENDING'));
    const { service } = serviceWith(tx, false);

    await service.enqueue(tx as never, 'CLOSE_ORDER', 'order-1');

    expect(tx.qianyiSyncJob.upsert).toHaveBeenCalled();
  });
});
