import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MetaCapiClient, type MetaOutboxEvent } from './meta-capi.client.js';

function config(overrides: Record<string, string | null> = {}): ConfigService {
  return new ConfigService({
    meta: {
      pixelId: '1143788914761743',
      accessToken: 'EAAtoken',
      testEventCode: null,
      apiVersion: 'v23.0',
      ...overrides,
    },
  });
}

function row(overrides: Partial<MetaOutboxEvent> = {}): MetaOutboxEvent {
  return {
    eventName: 'Purchase',
    eventId: 'purchase-PH100011',
    eventTime: new Date('2026-10-27T10:00:00Z'),
    actionSource: 'website',
    eventSourceUrl: 'https://luwag.shop/checkout/confirm',
    customData: { value: 3699, currency: 'PHP' },
    fbp: 'fb.1.1753000000000.1098115397',
    fbc: 'fb.1.1753000001000.IwARclick',
    clientIp: '112.198.0.1',
    clientUserAgent: 'Mozilla/5.0',
    phoneHash: 'a'.repeat(64),
    ...overrides,
  };
}

describe('MetaCapiClient', () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });

  beforeEach(() => {
    fetchMock.mockClear();
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
  });

  it('reports itself disabled until both pixel id and token exist', () => {
    expect(new MetaCapiClient(config(), fetchMock).enabled).toBe(true);
    expect(
      new MetaCapiClient(config({ accessToken: null }), fetchMock).enabled,
    ).toBe(false);
    expect(
      new MetaCapiClient(config({ pixelId: null }), fetchMock).enabled,
    ).toBe(false);
  });

  it('sends one deduplicated event with hashed user data', async () => {
    const client = new MetaCapiClient(config(), fetchMock);
    await client.send(row());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://graph.facebook.com/v23.0/1143788914761743/events',
    );
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer EAAtoken',
    });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      data: [
        {
          event_name: 'Purchase',
          event_time: 1793095200,
          event_id: 'purchase-PH100011',
          action_source: 'website',
          event_source_url: 'https://luwag.shop/checkout/confirm',
          user_data: {
            ph: 'a'.repeat(64),
            fbp: 'fb.1.1753000000000.1098115397',
            fbc: 'fb.1.1753000001000.IwARclick',
            client_ip_address: '112.198.0.1',
            client_user_agent: 'Mozilla/5.0',
          },
          custom_data: { value: 3699, currency: 'PHP' },
        },
      ],
    });
  });

  it('attaches the test event code when configured', async () => {
    const client = new MetaCapiClient(
      config({ testEventCode: 'TEST12345' }),
      fetchMock,
    );
    await client.send(row());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.test_event_code).toBe('TEST12345');
  });

  it('omits user_data keys it does not have', async () => {
    const client = new MetaCapiClient(config(), fetchMock);
    await client.send(
      row({ phoneHash: null, fbp: null, fbc: null, clientIp: null, clientUserAgent: null }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.data[0].user_data).toEqual({});
  });

  it('throws with the response detail so the outbox can retry', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'Invalid parameter',
    });
    const client = new MetaCapiClient(config(), fetchMock);
    await expect(client.send(row())).rejects.toThrow(/400.*Invalid parameter/);
  });
});
