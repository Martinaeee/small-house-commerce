import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { signQianyiRequest } from './qianyi.client.js';
import { QianyiWebhookService } from './qianyi-webhook.service.js';
import { QianyiInboundService } from './qianyi-inbound.service.js';

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

/**
 * In-memory stand-in for `qianyi_webhook_events` so the duplicate check is
 * actually exercised (the plain mock always returns null and would let every
 * callback through).
 */
function statefulPrisma() {
  const rows = new Map<string, Record<string, unknown>>();
  return {
    qianyiWebhookEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const key = String(data.externalKey);
        if (rows.has(key)) {
          throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
        }
        rows.set(key, { ...data, processedAt: null });
        return data;
      }),
      findUnique: vi.fn(
        async ({ where }: { where: { externalKey: string } }) =>
          rows.get(where.externalKey) ?? null,
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { externalKey: string };
          data: Record<string, unknown>;
        }) => {
          const row = rows.get(where.externalKey);
          if (row) Object.assign(row, data);
          return row;
        },
      ),
    },
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
    // An unauthenticated request must not be able to write a row: that would
    // turn the public endpoint into an unbounded insert surface.
    expect(prisma.qianyiWebhookEvent.create).not.toHaveBeenCalled();
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
      processedAt: new Date('2026-10-28T00:00:00Z'),
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

  it('re-dispatches a callback whose previous dispatch failed', async () => {
    const prisma = prismaWith();
    (prisma.qianyiWebhookEvent.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'seen',
      processedAt: null,
    });
    const inbound = { handle: vi.fn(async () => undefined) };
    const service = new QianyiWebhookService(
      new ConfigService(ENV),
      prisma as never,
      inbound as never,
    );

    const result = await service.ingest(signedFields() as never);

    expect(inbound.handle).toHaveBeenCalledTimes(1);
    expect(result.duplicated).toBe(false);
  });

  it('reports a failed dispatch as retryable instead of acknowledging it', async () => {
    const prisma = prismaWith();
    const inbound = {
      handle: vi.fn(async () => {
        throw new Error('insufficient reservation');
      }),
    };
    const service = new QianyiWebhookService(
      new ConfigService(ENV),
      prisma as never,
      inbound as never,
    );

    const result = await service.ingest(signedFields() as never);

    expect(result).toEqual({ ok: false, duplicated: false, retryable: true });
    expect(prisma.qianyiWebhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ error: expect.stringContaining('insufficient') }),
      }),
    );
  });

  it('keeps two shipments on one order apart when only the tracking number differs', async () => {
    const prisma = statefulPrisma();
    const inbound = { handle: vi.fn(async () => undefined) };
    const service = new QianyiWebhookService(
      new ConfigService(ENV),
      prisma as never,
      inbound as never,
    );

    const base = { onlineOrderNumber: 'PH100012', status: 'IN_TRANSIT' };
    await service.ingest(
      signedFields({
        serviceType: 'PUSH_SALES_ORDER_SHIPPING_INFO',
        bizParam: JSON.stringify({ ...base, trackingNumber: 'TRACK-A' }),
      }) as never,
    );
    await service.ingest(
      signedFields({
        serviceType: 'PUSH_SALES_ORDER_SHIPPING_INFO',
        bizParam: JSON.stringify({ ...base, trackingNumber: 'TRACK-B' }),
      }) as never,
    );

    expect(inbound.handle).toHaveBeenCalledTimes(2);
  });

  it('collapses an identical duplicate onto one archived fingerprint', async () => {
    const prisma = statefulPrisma();
    const inbound = { handle: vi.fn(async () => undefined) };
    const service = new QianyiWebhookService(
      new ConfigService(ENV),
      prisma as never,
      inbound as never,
    );
    const payload = JSON.stringify({
      onlineOrderNumber: 'PH100012',
      trackingNumber: 'TRACK-A',
      status: 'IN_TRANSIT',
      shippingTime: 1754014435000,
      city: 'Quezon City',
    });

    await service.ingest(
      signedFields({ serviceType: 'PUSH_TRACKING_PACKAGE', bizParam: payload }) as never,
    );
    const second = await service.ingest(
      signedFields({ serviceType: 'PUSH_TRACKING_PACKAGE', bizParam: payload }) as never,
    );

    expect(second).toEqual({ ok: true, duplicated: true });
    expect(inbound.handle).toHaveBeenCalledTimes(1);
  });

  it('does not collapse two same-status events at different times or places', async () => {
    const prisma = statefulPrisma();
    const inbound = { handle: vi.fn(async () => undefined) };
    const service = new QianyiWebhookService(
      new ConfigService(ENV),
      prisma as never,
      inbound as never,
    );

    const first = signedFields({
      serviceType: 'PUSH_TRACKING_PACKAGE',
      bizParam: JSON.stringify({
        onlineOrderId: 'PH100012',
        trackingNumber: 'TRACK123',
        status: 'IN_TRANSIT',
        shippingTime: 1754014435000,
        city: 'Quezon City',
      }),
    });
    const second = signedFields({
      serviceType: 'PUSH_TRACKING_PACKAGE',
      bizParam: JSON.stringify({
        onlineOrderId: 'PH100012',
        trackingNumber: 'TRACK123',
        status: 'IN_TRANSIT',
        shippingTime: 1754100835000,
        city: 'Cebu City',
      }),
    });

    await service.ingest(first as never);
    await service.ingest(second as never);

    expect(inbound.handle).toHaveBeenCalledTimes(2);
  });

  it('treats a concurrent duplicate (unique violation) as already handled', async () => {
    const prisma = prismaWith();
    (prisma.qianyiWebhookEvent.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    );
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

  it('still rejects a callback whose signature does not match, however old', async () => {
    const prisma = prismaWith();
    const service = new QianyiWebhookService(
      new ConfigService(ENV),
      prisma as never,
      { handle: vi.fn() } as never,
    );
    const tampered = {
      ...signedFields({ timestamp: String(Date.now() - 3 * 24 * 60 * 60 * 1000) }),
      sign: 'f'.repeat(32),
    };

    await expect(service.ingest(tampered as never)).resolves.toMatchObject({ ok: false });
  });

  it('accepts a delayed but correctly signed callback inside the extended window', async () => {
    const prisma = prismaWith();
    const inbound = { handle: vi.fn(async () => undefined) };
    const service = new QianyiWebhookService(
      new ConfigService(ENV),
      prisma as never,
      inbound as never,
    );
    // 千易 retries land hours later; a 15-minute window would drop them.
    const delayed = signedFields({ timestamp: String(Date.now() - 6 * 60 * 60 * 1000) });

    const result = await service.ingest(delayed as never);

    expect(result.ok).toBe(true);
    expect(inbound.handle).toHaveBeenCalled();
  });

  it('refuses a callback older than the replay window', async () => {
    const stale = signedFields({ timestamp: String(Date.now() - 48 * 60 * 60 * 1000) });
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

describe('QianyiWebhookService.allow', () => {
  it('throttles one caller after the per-minute budget', () => {
    const service = new QianyiWebhookService(
      new ConfigService(ENV),
      prismaWith() as never,
      { handle: vi.fn() } as never,
    );
    let allowed = 0;
    for (let i = 0; i < 300; i += 1) {
      if (service.allow('1.2.3.4')) allowed += 1;
    }
    expect(allowed).toBe(240);
    // Another caller keeps its own budget.
    expect(service.allow('5.6.7.8')).toBe(true);
  });
});

describe('QianyiWebhookService wiring', () => {
  it('declares QianyiInboundService as a real dependency for Nest DI', () => {
    // A `import type` here erases the runtime metadata and Nest resolves the
    // parameter as `Function`, which fails at boot — invisible to unit tests
    // that construct the service by hand.
    const types = Reflect.getMetadata('design:paramtypes', QianyiWebhookService) as unknown[];
    expect(types?.[2]).toBe(QianyiInboundService);
  });
});
