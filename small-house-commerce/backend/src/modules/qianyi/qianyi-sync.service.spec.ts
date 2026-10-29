import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { QianyiSyncService } from './qianyi-sync.service.js';

const CONFIG = new ConfigService({ qianyi: {
  enabled: 'true', appId: '1793-test', appSecret: 's3cr3t-value', shop: 'LUWAG- PH',
  warehouseId: 71537, warehouse: 'PH-DAVAO-01', logistics: 'SHIPDOC-STD',
} });
const client = { enabled: true, call: vi.fn() };

function orderWith(mapping: string | null) {
  return {
    id: 'order-1', orderNumber: 'PH100012', orderStatus: 'CONFIRMED', confirmationStatus: 'CONFIRMED',
    currency: 'PHP', shippingTotal: '0.00', discountTotal: '0.00', grandTotal: '100.00', customerNote: null,
    createdAt: new Date('2026-10-28T02:30:00Z'), customer: { name: 'Maria', email: null }, shippingAddress: null,
    items: [{ id: 'line-1', skuCodeSnapshot: 'TB001-Wa', quantity: 1, unitPrice: '100.00', unitDiscount: '0.00',
      lineTotal: '100.00', sku: { skuCode: 'TB001-Wa', qianyiSkuCode: mapping } }],
  };
}

function txFor(order: ReturnType<typeof orderWith>) {
  return {
    order: { findUnique: vi.fn(async () => order), update: vi.fn(async () => undefined) },
    qianyiSyncJob: { findUnique: vi.fn(async () => null), findUniqueOrThrow: vi.fn(async () => ({})),
      upsert: vi.fn(async () => undefined), update: vi.fn(async () => undefined), updateMany: vi.fn(async () => ({ count: 1 })) },
    orderNote: { create: vi.fn(async () => undefined) },
  };
}

function job(overrides: Record<string, unknown> = {}) {
  return { id: 'job-1', orderId: 'order-1', kind: 'PUSH_ORDER', status: 'SKIPPED', attempts: 0,
    autoCreateAttempts: 0, pendingReview: false, lastError: 'No Qianyi code for TB001-Wa.',
    requestPayload: { shop: 'LUWAG- PH', onlineOrderNumber: 'PH100012' }, ...overrides };
}

function serviceWith(tx: ReturnType<typeof txFor>, existing: ReturnType<typeof job> | null = job()) {
  tx.qianyiSyncJob.findUnique = vi.fn(async (args: { where: { orderId_kind?: { kind: string } } }) =>
    args.where.orderId_kind ? (existing?.kind === args.where.orderId_kind.kind ? existing : null) : existing) as never;
  const prisma = {
    ...tx,
    qianyiSyncJob: { ...tx.qianyiSyncJob, findUnique: vi.fn(async () => existing), findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0), update: vi.fn(async () => undefined) },
    $transaction: vi.fn(async (fn: (client: unknown) => unknown) => fn(tx)),
    $queryRaw: vi.fn(async () => []),
    qianyiWebhookEvent: { deleteMany: vi.fn(async () => ({ count: 0 })) },
  };
  return { service: new QianyiSyncService(prisma as never, client as never, CONFIG), prisma, tx };
}

beforeEach(() => client.call.mockReset());

describe('QianyiSyncService.enqueue', () => {
  it('queues a push and freezes the mapping used at send time', async () => {
    const tx = txFor(orderWith('YD003760CMHT'));
    const { service } = serviceWith(tx);
    await service.enqueue(tx as never, 'PUSH_ORDER', 'order-1');
    const payload = tx.qianyiSyncJob.upsert.mock.calls[0][0].create.requestPayload;
    expect(payload).toMatchObject({ onlineOrderNumber: 'PH100012', _skuMapping: { 'line-1': 'YD003760CMHT' } });
  });

  it('records SKIPPED instead of failing confirmation when a line has no mapping', async () => {
    const tx = txFor(orderWith(null));
    const { service } = serviceWith(tx);
    await expect(service.enqueue(tx as never, 'PUSH_ORDER', 'order-1')).resolves.toBeUndefined();
    expect(tx.qianyiSyncJob.upsert.mock.calls[0][0].create.status).toBe('SKIPPED');
  });

  it('never resets a job that was already sent or is awaiting review', async () => {
    const tx = txFor(orderWith('YD003760CMHT'));
    const { service } = serviceWith(tx, job({ status: 'SENT' }));
    await service.enqueue(tx as never, 'PUSH_ORDER', 'order-1');
    expect(tx.qianyiSyncJob.upsert).not.toHaveBeenCalled();
  });
});

describe('QianyiSyncService recovery gates', () => {
  it('refuses to requeue a skipped job while a line is unmapped', async () => {
    const tx = txFor(orderWith(null));
    const { service, prisma } = serviceWith(tx);
    expect(await service.requeueSkipped('job-1', 'user-1')).toEqual({ ok: false, missing: ['TB001-Wa'] });
    expect(prisma.qianyiSyncJob.update).not.toHaveBeenCalled();
  });

  it('refuses a plain retry when a create may have reached Qianyi', async () => {
    const tx = txFor(orderWith('YD003760CMHT'));
    const { service } = serviceWith(tx, job({ status: 'FAILED', pendingReview: true, autoCreateAttempts: 1, lastError: 'OUTCOME_UNKNOWN' }));
    const result = await service.retry('job-1', 'user-1');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('reconcile');
  });

  it('requeues a failure that never dispatched a create and records the operator', async () => {
    const tx = txFor(orderWith('YD003760CMHT'));
    const { service, prisma } = serviceWith(tx, job({ status: 'FAILED', autoCreateAttempts: 0, lastError: 'ORDER_NOT_PUSHABLE' }));
    expect(await service.retry('job-1', 'user-1')).toEqual({ ok: true });
    expect(tx.qianyiSyncJob.update.mock.calls[0][0].data).toMatchObject({ status: 'PENDING', attempts: 0, autoCreateAttempts: 0 });
    expect(tx.orderNote.create.mock.calls[0][0].data.userId).toBe('user-1');
  });

  it('requires an explicit confirmation before authorizing another create', async () => {
    const tx = txFor(orderWith('YD003760CMHT'));
    const { service, prisma } = serviceWith(tx, job({ status: 'FAILED', pendingReview: true, autoCreateAttempts: 1 }));
    expect((await service.authorizeCreateRetry('job-1', 'user-1', false)).ok).toBe(false);
    expect(prisma.qianyiSyncJob.update).not.toHaveBeenCalled();
    expect(await service.authorizeCreateRetry('job-1', 'user-1', true)).toEqual({ ok: true });
    expect(prisma.qianyiSyncJob.updateMany.mock.calls[0][0].data).toMatchObject({ autoCreateAttempts: 0, pendingReview: false });
  });
});

describe('QianyiSyncService.cancelWithin', () => {
  it('cancels a queued push so the worker cannot send it', async () => {
    const tx = txFor(orderWith('YD003760CMHT'));
    const { service, prisma } = serviceWith(tx, job({ status: 'PENDING' }));
    expect(await service.cancelWithin(tx as never, 'order-1', 'user-1')).toBe('cancelled');
    expect(tx.qianyiSyncJob.update.mock.calls[0][0].data.status).toBe('CANCELLED');
  });

  it('flags an in-flight create for reconciliation instead of pretending it was cancelled', async () => {
    const tx = txFor(orderWith('YD003760CMHT'));
    const { service, prisma } = serviceWith(tx, job({ status: 'SENDING', autoCreateAttempts: 1 }));
    expect(await service.cancelWithin(tx as never, 'order-1', 'user-1')).toBe('review');
    expect(tx.qianyiSyncJob.update.mock.calls[0][0].data).toMatchObject({ status: 'FAILED', pendingReview: true });
  });

  it('queues the close only for an order that reached Qianyi', async () => {
    const tx = txFor(orderWith('YD003760CMHT'));
    const { service } = serviceWith(tx, job({ status: 'SENT' }));
    expect(await service.cancelWithin(tx as never, 'order-1', 'user-1')).toBe('close');
    expect(tx.qianyiSyncJob.upsert.mock.calls[0][0].create).toMatchObject({ kind: 'CLOSE_ORDER' });
  });
});

describe('QianyiSyncService.reconcile', () => {
  it('scopes the inquiry to our shop and prunes only finished archives', async () => {
    const tx = txFor(orderWith('YD003760CMHT'));
    const { service, prisma } = serviceWith(tx);
    client.call.mockResolvedValue([]);
    await service.reconcile(new Date('2026-10-29T03:00:00Z'));
    expect(client.call.mock.calls[0][2]).toMatchObject({ shop: 'LUWAG- PH', page: 1, pageSize: 100 });
    expect(prisma.qianyiWebhookEvent.deleteMany).toHaveBeenCalledWith({
      where: { receivedAt: { lt: new Date('2026-07-31T03:00:00Z') }, processedAt: { not: null } },
    });
  });

  it('reads a list wrapper returned inside bizContent', async () => {
    const tx = txFor(orderWith('YD003760CMHT'));
    const { service, prisma } = serviceWith(tx);
    client.call.mockResolvedValue({ list: [{ onlineOrderNumber: 'PH100012', trackingNumber: 'TRK-1' }] });
    const fake = prisma as unknown as {
      order: { findUnique: (args: unknown) => Promise<unknown> };
      orderNote: { create: (args: unknown) => Promise<unknown> };
    };
    fake.order = { findUnique: vi.fn(async () => ({ id: 'order-1', shipments: [] })) };
    fake.orderNote = { create: vi.fn(async () => undefined) };
    const result = await service.reconcile(new Date('2026-10-29T03:00:00Z'));
    expect(result.checked).toBe(1);
    expect(fake.orderNote.create).toHaveBeenCalledTimes(1);
  });
});
