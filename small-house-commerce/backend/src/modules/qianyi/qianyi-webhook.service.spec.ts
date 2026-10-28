import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { signQianyiRequest } from './qianyi.client.js';
import { QianyiWebhookService } from './qianyi-webhook.service.js';

const ENV = {
  qianyi: {
    enabled: 'true',
    appId: '1793-test',
    appSecret: 's3cr3t-value',
    shop: 'LUWAG- PH',
    warehouseId: 71537,
    warehouse: 'PH-DAVAO-01',
    logistics: 'SHIPDOC-STD',
  },
};

const BIZ = JSON.stringify({
  orderNumber: 'S2610288955080',
  onlineOrderNumber: 'PH100012',
  trackingNumber: 'TRACK123',
  carrier: 'SHIPDOC',
  status: 'WAIT_SHIP',
  shippingTime: 1754014435000,
});

function signedFields(overrides: Record<string, string> = {}) {
  const fields = {
    appId: '1793-test',
    serviceType: 'PUSH_SALES_ORDER_SHIPPING_INFO',
    bizParam: BIZ,
    timestamp: String(Date.now()),
    ...overrides,
  };
  return {
    ...fields,
    sign: signQianyiRequest(fields, 's3cr3t-value'),
  };
}

function prismaWith() {
  return {
    qianyiWebhookEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
      findUnique: vi.fn(async () => null),
      update: vi.fn(async () => undefined),
    },
  };
}

describe('QianyiWebhookService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects a bad signature without touching business data', async () => {
    const prisma = prismaWith();
    const inbound = { handle: vi.fn() };
    const service = new QianyiWebhookService(
      new ConfigService(ENV),
      prisma as never,
      inbound as never,
    );

    // `signedFields` recomputes the sign, so corrupt it after the fact.
    const tampered = { ...signedFields(), sign: 'f'.repeat(32) };
    const result = await service.ingest(tampered as never);

    expect(result.ok).toBe(false);
    expect(inbound.handle).not.toHaveBeenCalled();
    expect(prisma.qianyiWebhookEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ signValid: false }),
      }),
    );
  });

  it('accepts a valid signature and dispatches once', async () => {
    const prisma = prismaWith();
    const inbound = { handle: vi.fn(async () => undefined) };
    const service = new QianyiWebhookService(
      new ConfigService(ENV),
      prisma as never,
      inbound as never,
    );

    const result = await service.ingest(signedFields() as never);

    expect(result).toEqual({ ok: true, duplicated: false });
    expect(inbound.handle).toHaveBeenCalledWith(
      'PUSH_SALES_ORDER_SHIPPING_INFO',
      expect.objectContaining({ trackingNumber: 'TRACK123' }),
    );
  });

  it('is idempotent on a repeated callback', async () => {
    const prisma = prismaWith();
    (prisma.qianyiWebhookEvent.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'seen',
    });
    const inbound = { handle: vi.fn() };
    const service = new QianyiWebhookService(
      new ConfigService(ENV),
      prisma as never,
      inbound as never,
    );

    const result = await service.ingest(signedFields() as never);

    expect(result).toEqual({ ok: true, duplicated: true });
    expect(inbound.handle).not.toHaveBeenCalled();
  });

  it('rejects a stale timestamp', async () => {
    const stale = signedFields({ timestamp: String(Date.now() - 60 * 60 * 1000) });
    const prisma = prismaWith();
    const service = new QianyiWebhookService(
      new ConfigService(ENV),
      prisma as never,
      { handle: vi.fn() } as never,
    );
    await expect(service.ingest(stale as never)).resolves.toEqual({
      ok: false,
      duplicated: false,
    });
  });

  it('archives an unknown service type instead of throwing', async () => {
    const prisma = prismaWith();
    const inbound = { handle: vi.fn() };
    const service = new QianyiWebhookService(
      new ConfigService(ENV),
      prisma as never,
      inbound as never,
    );
    const result = await service.ingest(
      signedFields({ serviceType: 'SOMETHING_NEW' }) as never,
    );
    expect(result.ok).toBe(true);
    expect(inbound.handle).not.toHaveBeenCalled();
    expect(prisma.qianyiWebhookEvent.create).toHaveBeenCalled();
  });
});
