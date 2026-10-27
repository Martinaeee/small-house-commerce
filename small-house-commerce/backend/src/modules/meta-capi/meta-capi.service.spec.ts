import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { MetaCapiService } from './meta-capi.service.js';

function makeClient(enabled = true) {
  return { enabled, send: vi.fn().mockResolvedValue(undefined) };
}

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    metaConversionEvent: {
      create: vi.fn().mockResolvedValue({ id: 'row-1' }),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
      count: vi.fn().mockResolvedValue(0),
      findFirst: vi.fn().mockResolvedValue(null),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      ...overrides,
    },
  };
}

function pendingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'row-1',
    eventName: 'ViewContent',
    eventId: 'evt-1',
    eventTime: new Date('2026-10-27T10:00:00Z'),
    actionSource: 'website',
    eventSourceUrl: 'https://luwag.shop/products/chair',
    customData: {},
    fbp: null,
    fbc: null,
    clientIp: '1.2.3.4',
    clientUserAgent: 'UA',
    phoneHash: null,
    attempts: 0,
    status: 'PENDING',
    ...overrides,
  };
}

describe('MetaCapiService.enqueue', () => {
  it('stores nothing while the integration is disabled', async () => {
    const prisma = makePrisma();
    const service = new MetaCapiService(prisma as never, makeClient(false) as never);
    await service.enqueue({
      eventName: 'ViewContent',
      eventId: 'evt-1',
      eventSourceUrl: 'https://luwag.shop/products/chair',
      customData: {},
    });
    expect(prisma.metaConversionEvent.create).not.toHaveBeenCalled();
  });

  it('stores a pending event for the worker', async () => {
    const prisma = makePrisma();
    const service = new MetaCapiService(prisma as never, makeClient() as never);
    await service.enqueue({
      eventName: 'AddToCart',
      eventId: 'evt-2',
      eventSourceUrl: 'https://luwag.shop/products/chair',
      customData: { content_ids: ['sku-1'] },
      fbp: 'fb.1.1.abc',
      clientIp: '1.2.3.4',
      clientUserAgent: 'UA',
    });
    const data = prisma.metaConversionEvent.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      eventName: 'AddToCart',
      eventId: 'evt-2',
      status: 'PENDING',
      fbp: 'fb.1.1.abc',
    });
    expect(data.eventTime).toBeInstanceOf(Date);
  });

  it('ignores a duplicate event id instead of failing the request', async () => {
    const duplicate = Object.assign(new Error('duplicate'), { code: 'P2002' });
    const prisma = makePrisma({
      create: vi.fn().mockRejectedValue(duplicate),
    });
    const service = new MetaCapiService(prisma as never, makeClient() as never);
    await expect(
      service.enqueue({
        eventName: 'ViewContent',
        eventId: 'evt-dup',
        eventSourceUrl: 'https://luwag.shop/',
        customData: {},
      }),
    ).resolves.toBe(false);
  });
});

describe('MetaCapiService.enqueuePurchase', () => {
  const purchase = {
    orderNumber: 'PH100011',
    items: [
      { skuId: 'sku-1', quantity: 2, unitPrice: 1849.5 },
      { skuId: 'sku-2', quantity: 1, unitPrice: 300 },
    ],
    value: 3999,
    phone: '09171234567',
    consent: true,
    fbp: null,
    fbc: null,
    clientIp: '112.198.0.1',
    clientUserAgent: 'Mozilla/5.0',
    eventSourceUrl: 'https://luwag.shop/checkout/confirm',
  };

  it('enqueues a Purchase keyed by the order number with a hashed phone', async () => {
    const prisma = makePrisma();
    const service = new MetaCapiService(prisma as never, makeClient() as never);
    await service.enqueuePurchase(purchase);

    const data = prisma.metaConversionEvent.create.mock.calls[0][0].data;
    expect(data.eventName).toBe('Purchase');
    expect(data.eventId).toBe('purchase-PH100011');
    expect(data.phoneHash).toBe(
      createHash('sha256').update('639171234567').digest('hex'),
    );
    expect(data.customData).toMatchObject({
      order_id: 'PH100011',
      content_ids: ['sku-1', 'sku-2'],
      contents: [
        { id: 'sku-1', quantity: 2 },
        { id: 'sku-2', quantity: 1 },
      ],
      value: 3999,
      currency: 'PHP',
    });
  });

  it('never sends a purchase without ads consent', async () => {
    const prisma = makePrisma();
    const service = new MetaCapiService(prisma as never, makeClient() as never);
    await service.enqueuePurchase({ ...purchase, consent: false });
    expect(prisma.metaConversionEvent.create).not.toHaveBeenCalled();
  });

  it('skips orders entered from the admin, where no ad click can exist', async () => {
    const prisma = makePrisma();
    const service = new MetaCapiService(prisma as never, makeClient() as never);
    await service.enqueuePurchase({
      ...purchase,
      eventSourceUrl: 'https://luwag.shop/admin/orders',
    });
    expect(prisma.metaConversionEvent.create).not.toHaveBeenCalled();
  });
});

describe('MetaCapiService.processPending', () => {
  it('marks a delivered event as sent', async () => {
    const prisma = makePrisma({
      findMany: vi.fn().mockResolvedValue([pendingRow()]),
    });
    const client = makeClient();
    const service = new MetaCapiService(prisma as never, client as never);

    const processed = await service.processPending(new Date('2026-10-27T10:01:00Z'));

    expect(processed).toBe(1);
    expect(client.send).toHaveBeenCalledTimes(1);
    const update = prisma.metaConversionEvent.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: 'row-1' });
    expect(update.data).toMatchObject({ status: 'SENT', lastError: null });
    expect(update.data.sentAt).toBeInstanceOf(Date);
  });

  it('retries a failed event later and records the error', async () => {
    const prisma = makePrisma({
      findMany: vi.fn().mockResolvedValue([pendingRow({ attempts: 1 })]),
    });
    const client = makeClient();
    client.send.mockRejectedValueOnce(new Error('Meta CAPI responded 500'));
    const service = new MetaCapiService(prisma as never, client as never);
    const now = new Date('2026-10-27T10:02:00Z');

    await service.processPending(now);

    const update = prisma.metaConversionEvent.update.mock.calls[0][0];
    expect(update.data.status).toBe('PENDING');
    expect(update.data.attempts).toEqual({ increment: 1 });
    expect(update.data.nextAttemptAt.getTime()).toBeGreaterThan(now.getTime());
    expect(update.data.lastError).toContain('500');
  });

  it('gives up after the last attempt so the row stays visible as failed', async () => {
    const prisma = makePrisma({
      findMany: vi.fn().mockResolvedValue([pendingRow({ attempts: 7 })]),
    });
    const client = makeClient();
    client.send.mockRejectedValueOnce(new Error('still failing'));
    const service = new MetaCapiService(prisma as never, client as never);

    await service.processPending(new Date('2026-10-27T10:03:00Z'));

    const update = prisma.metaConversionEvent.update.mock.calls[0][0];
    expect(update.data.status).toBe('FAILED');
  });

  it('does nothing while disabled or when nothing is due', async () => {
    const prisma = makePrisma();
    const disabled = new MetaCapiService(prisma as never, makeClient(false) as never);
    expect(await disabled.processPending()).toBe(0);
    expect(prisma.metaConversionEvent.findMany).not.toHaveBeenCalled();

    const enabled = new MetaCapiService(prisma as never, makeClient() as never);
    expect(await enabled.processPending()).toBe(0);
  });
});

describe('MetaCapiService.health', () => {
  it('reports queue depth and the last failure', async () => {
    const prisma = makePrisma({
      count: vi
        .fn()
        .mockResolvedValueOnce(2) // pending
        .mockResolvedValueOnce(1) // failed
        .mockResolvedValueOnce(5), // sent in 24h
      findFirst: vi
        .fn()
        .mockResolvedValueOnce({ sentAt: new Date('2026-10-27T09:00:00Z') })
        .mockResolvedValueOnce({
          lastError: 'Meta CAPI responded 400',
          createdAt: new Date('2026-10-27T08:00:00Z'),
        }),
    });
    const service = new MetaCapiService(prisma as never, makeClient() as never);

    const health = await service.health();

    expect(health).toMatchObject({
      enabled: true,
      pending: 2,
      failed: 1,
      sent24h: 5,
      lastError: 'Meta CAPI responded 400',
    });
  });
});
