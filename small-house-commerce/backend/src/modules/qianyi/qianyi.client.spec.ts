import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { QianyiClient, QianyiError, signQianyiRequest } from './qianyi.client.js';

const ENV = {
  qianyi: {
    enabled: 'true',
    baseUrl: 'https://www.qianyierp.com',
    appId: '1793-test',
    appSecret: 's3cr3t-value',
    shop: 'LUWAG- PH',
    warehouseId: 71537,
    warehouse: 'PH-DAVAO-01',
    logistics: 'SHIPDOC-STD',
  },
};

function clientWith(fetchImpl: typeof fetch) {
  return new QianyiClient(new ConfigService(ENV), fetchImpl);
}

describe('signQianyiRequest', () => {
  it('matches the vector verified against the live API', () => {
    expect(
      signQianyiRequest(
        {
          appId: '1793-test',
          bizParam: '{"page":1,"pageSize":50}',
          serviceType: 'QUERY_SHOP_LIST',
          timestamp: '1700000000000',
        },
        's3cr3t-value',
      ),
    ).toBe('bbbf0ed3fb32e295330140ef2903713b');
  });

  it('sees the whole secret, not a truncated prefix', () => {
    const a = signQianyiRequest(
      { appId: 'a', bizParam: '{}', serviceType: 'S', timestamp: '1' },
      'secret-1',
    );
    const b = signQianyiRequest(
      { appId: 'a', bizParam: '{}', serviceType: 'S', timestamp: '1' },
      'secret-2',
    );
    expect(a).not.toBe(b);
  });
});

describe('QianyiClient.call', () => {
  it('returns result when the business call succeeds', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ state: 'success', errorCode: '', result: [{ id: 1 }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;
    await expect(clientWith(fetchImpl).call('QUERY_SHOP_LIST', 'shop', { page: 1 })).resolves.toEqual([
      { id: 1 },
    ]);
  });

  it('treats HTTP 200 with state=failure as a business failure', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ state: 'failure', errorCode: 'AUTH_001', errorMsg: '签名验证失败' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;
    await expect(clientWith(fetchImpl).call('QUERY_SHOP_LIST', 'shop', { page: 1 })).rejects.toMatchObject(
      { errorCode: 'AUTH_001' },
    );
  });

  it('sends the signed multipart fields the API expects', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ state: 'success', errorCode: '', result: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;
    await clientWith(fetchImpl).call('QUERY_SHOP_LIST', 'shop', { page: 1, pageSize: 50 });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://www.qianyierp.com/api/v1/shop');
    const form = init.body as FormData;
    expect(form.get('appId')).toBe('1793-test');
    expect(form.get('serviceType')).toBe('QUERY_SHOP_LIST');
    expect(form.get('bizParam')).toBe('{"page":1,"pageSize":50}');
    expect(String(form.get('sign'))).toHaveLength(32);
  });

  it('rethrows transport failures as QianyiError', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(clientWith(fetchImpl).call('QUERY_SHOP_LIST', 'shop', {})).rejects.toBeInstanceOf(
      QianyiError,
    );
  });

  it('refuses to call while disabled', async () => {
    const client = new QianyiClient(new ConfigService({}), vi.fn() as unknown as typeof fetch);
    await expect(client.call('QUERY_SHOP_LIST', 'shop', {})).rejects.toMatchObject({
      errorCode: 'DISABLED',
    });
  });
});
