import { describe, expect, it, vi } from 'vitest';
import { QianyiWebhookController } from './qianyi-webhook.controller.js';

/** The controller only maps the parsed body onto the service's field shape. */
describe('QianyiWebhookController.receive', () => {
  it('forwards only the five documented fields', async () => {
    const ingest = vi.fn(async () => ({ ok: true, duplicated: false }));
    const controller = new QianyiWebhookController({ ingest, allow: () => true } as never);

    const result = await controller.receive({
      body: {
        appId: 'a',
        serviceType: 'PUSH_ODO_ORDER',
        bizParam: '{"status":"SHIPPED"}',
        timestamp: '1700000000000',
        sign: 'abc',
        unexpected: 'dropped',
      },
    } as never);

    expect(ingest).toHaveBeenCalledWith({
      appId: 'a',
      serviceType: 'PUSH_ODO_ORDER',
      bizParam: '{"status":"SHIPPED"}',
      timestamp: '1700000000000',
      sign: 'abc',
    });
    expect(result).toEqual({ ok: true });
  });

  it('answers ok=false for a rejected callback without throwing', async () => {
    const controller = new QianyiWebhookController({
      ingest: vi.fn(async () => ({ ok: false, duplicated: false })),
      allow: () => true,
    } as never);

    await expect(controller.receive({ body: {} } as never)).resolves.toEqual({ ok: false });
  });

  it('answers 500 when the dispatch failed so Qianyi resends', async () => {
    const controller = new QianyiWebhookController({
      ingest: vi.fn(async () => ({ ok: false, duplicated: false, retryable: true })),
      allow: () => true,
    } as never);

    await expect(controller.receive({ body: {} } as never)).rejects.toMatchObject({ status: 500 });
  });
});

describe('QianyiWebhookController throttling', () => {
  it('answers 429 when the caller is over budget', async () => {
    const controller = new QianyiWebhookController({
      allow: vi.fn(() => false),
      ingest: vi.fn(),
    } as never);

    await expect(controller.receive({ body: {}, ip: '1.2.3.4' } as never)).rejects.toMatchObject({
      status: 429,
    });
  });
});
