import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { signQianyiRequest } from './qianyi.client.js';
import { QianyiWebhookService, type QianyiWebhookFields } from './qianyi-webhook.service.js';

const appId = 'test-app-id-0001';
const secret = 'test-secret-value-000000000000';

function config(enabled: boolean) {
  return new ConfigService({ qianyi: {
    enabled: String(enabled), appId, appSecret: secret, shop: 'LUWAG- PH',
    warehouseId: 71537, warehouse: 'PH-DAVAO-01', logistics: 'SHIPDOC-STD',
  } });
}

function fields(serviceType: string, payload: unknown, overrides: Partial<QianyiWebhookFields> = {}): QianyiWebhookFields {
  const input = { appId, serviceType, bizParam: JSON.stringify(payload), timestamp: String(Date.now()) };
  return { ...input, sign: signQianyiRequest(input, secret), ...overrides };
}

/** Stateful in-memory stand-in for the archive table and its transaction. */
function prismaFake() {
  const rows = new Map<string, Record<string, unknown>>();
  const db = {
    qianyiWebhookEvent: {
      upsert: vi.fn(async (args: { where: { externalKey: string }; create: Record<string, unknown> }) => {
        const existing = rows.get(args.where.externalKey);
        if (existing) return existing;
        const row = { id: `ev-${rows.size + 1}`, processedAt: null, error: null, ...args.create };
        rows.set(args.where.externalKey, row);
        return row;
      }),
      updateMany: vi.fn(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const row = [...rows.values()].find(candidate => candidate.id === args.where.id && candidate.processedAt === null);
        if (!row) return { count: 0 };
        Object.assign(row, args.data);
        return { count: 1 };
      }),
      update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = [...rows.values()].find(candidate => candidate.id === args.where.id)!;
        Object.assign(row, args.data);
        return row;
      }),
      findUniqueOrThrow: vi.fn(async (args: { where: { id?: string; externalKey?: string } }) => {
        const row = args.where.id ? [...rows.values()].find(candidate => candidate.id === args.where.id)
          : rows.get(args.where.externalKey!);
        if (!row) throw new Error('not found');
        return row;
      }),
      findMany: vi.fn(async (args: { where: Record<string, unknown> }) =>
        [...rows.values()].filter(row => row.signValid === args.where.signValid && row.processedAt === null && row.error === args.where.error)),
    },
    $queryRaw: vi.fn(async () => []),
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
  };
  return { db, rows };
}

describe('QianyiWebhookService', () => {
  const inbound = { handle: vi.fn(async () => undefined) };

  beforeEach(() => inbound.handle.mockReset());

  it('rejects a bad signature without archiving it', async () => {
    const { db, rows } = prismaFake();
    const service = new QianyiWebhookService(config(true), db as never, inbound as never);
    expect(await service.ingest(fields('PUSH_ODO_ORDER', {}, { sign: '0'.repeat(32) })))
      .toMatchObject({ ok: false });
    expect(rows.size).toBe(0);
    expect(inbound.handle).not.toHaveBeenCalled();
  });

  it('rejects a signature made for a different app id', async () => {
    const { db, rows } = prismaFake();
    const service = new QianyiWebhookService(config(true), db as never, inbound as never);
    expect(await service.ingest(fields('PUSH_ODO_ORDER', {}, { appId: 'other-app' })))
      .toMatchObject({ ok: false });
    expect(rows.size).toBe(0);
  });

  it('rejects a signed payload that is not a JSON object', async () => {
    const { db, rows } = prismaFake();
    const service = new QianyiWebhookService(config(true), db as never, inbound as never);
    expect(await service.ingest(fields('PUSH_ODO_ORDER', [1, 2]))).toMatchObject({ ok: false });
    expect(rows.size).toBe(0);
  });

  it('defers a signed callback while the integration is disabled', async () => {
    const { db, rows } = prismaFake();
    const service = new QianyiWebhookService(config(false), db as never, inbound as never);
    expect(await service.ingest(fields('PUSH_ODO_ORDER', { onlineOrderNumber: 'PH1' })))
      .toMatchObject({ ok: true, deferred: true });
    expect([...rows.values()][0]).toMatchObject({ error: 'INTEGRATION_DISABLED', processedAt: null });
    expect(inbound.handle).not.toHaveBeenCalled();
  });

  it('dispatches a valid callback once and acknowledges its duplicate', async () => {
    const { db } = prismaFake();
    const service = new QianyiWebhookService(config(true), db as never, inbound as never);
    const input = fields('PUSH_TRACKING_PACKAGE', { onlineOrderNumber: 'PH1', status: 'IN_TRANSIT' });
    expect(await service.ingest(input)).toMatchObject({ ok: true, duplicated: false });
    expect(await service.ingest(input)).toMatchObject({ ok: true, duplicated: true });
    expect(inbound.handle).toHaveBeenCalledTimes(1);
  });

  it('keeps a failed dispatch retryable and finishes it on the retry', async () => {
    const { db } = prismaFake();
    inbound.handle.mockRejectedValueOnce(new Error('database went away'));
    const service = new QianyiWebhookService(config(true), db as never, inbound as never);
    const input = fields('PUSH_ODO_ORDER', { onlineOrderNumber: 'PH1' });
    expect(await service.ingest(input)).toMatchObject({ ok: false, retryable: true });
    expect(await service.ingest(input)).toMatchObject({ ok: true, duplicated: false });
    expect(inbound.handle).toHaveBeenCalledTimes(2);
  });

  it('archives an unknown service type without calling the inbound handlers', async () => {
    const { db, rows } = prismaFake();
    const service = new QianyiWebhookService(config(true), db as never, inbound as never);
    expect(await service.ingest(fields('SOMETHING_ELSE', { onlineOrderNumber: 'PH1' })))
      .toMatchObject({ ok: true });
    expect([...rows.values()][0].processedAt).toBeInstanceOf(Date);
    expect(inbound.handle).not.toHaveBeenCalled();
  });

  it('replays only deferred callbacks, and only after re-enabling', async () => {
    const { db } = prismaFake();
    const disabled = new QianyiWebhookService(config(false), db as never, inbound as never);
    await disabled.ingest(fields('PUSH_ODO_ORDER', { onlineOrderNumber: 'PH1' }));
    expect(await disabled.processDeferred()).toBe(0);
    const enabled = new QianyiWebhookService(config(true), db as never, inbound as never);
    expect(await enabled.processDeferred()).toBe(1);
    expect(await enabled.processDeferred()).toBe(0);
    expect(inbound.handle).toHaveBeenCalledTimes(1);
  });
});
