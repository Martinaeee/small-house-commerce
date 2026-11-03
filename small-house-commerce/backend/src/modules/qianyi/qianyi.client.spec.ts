import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { QianyiClient, QianyiError, qianyiRows, signQianyiRequest } from './qianyi.client.js';

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

  it('unwraps a JSON-string bizContent', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          state: 'success',
          errorCode: '',
          bizContent: JSON.stringify({ list: [{ sku: 'SC001' }] }),
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;
    await expect(clientWith(fetchImpl).call('QUERY_SIMPLE_LIST_SKU', 'sku', {})).resolves.toEqual({
      list: [{ sku: 'SC001' }],
    });
  });

  it('prefers bizContent over result when both are present', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          state: 'success',
          errorCode: '',
          bizContent: { orderNumber: 'S-1001' },
          result: { orderNumber: 'STALE' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;
    await expect(clientWith(fetchImpl).call('CREATE_AND_AUDIT_SALES_ORDER', 'salesOrder', {})).resolves.toEqual({
      orderNumber: 'S-1001',
    });
  });

  it('throws when bizContent reports a business failure after a protocol success', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          state: 'success',
          errorCode: '',
          bizContent: JSON.stringify({ success: false, code: 'SKU_NOT_FOUND', message: 'SKU 不存在' }),
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;
    await expect(clientWith(fetchImpl).call('CREATE_AND_AUDIT_SALES_ORDER', 'salesOrder', {})).rejects.toMatchObject({
      errorCode: 'BUSINESS_FAILURE',
    });
  });

  it('throws when bizContent carries a non-zero errorCode', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          state: 'success',
          errorCode: '',
          bizContent: { errorCode: 'WMS_002', errorMsg: '仓库库存不足' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;
    await expect(clientWith(fetchImpl).call('CREATE_AND_AUDIT_SALES_ORDER', 'salesOrder', {})).rejects.toMatchObject({
      errorCode: 'WMS_002',
    });
  });

  it('falls back to result when bizContent is absent', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ state: 'success', errorCode: '', result: { orderNumber: 'S-1' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;
    await expect(clientWith(fetchImpl).call('CREATE_AND_AUDIT_SALES_ORDER', 'salesOrder', {})).resolves.toEqual({
      orderNumber: 'S-1',
    });
  });

  it('returns null for an empty bizContent', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ state: 'success', errorCode: '', bizContent: '' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;
    await expect(clientWith(fetchImpl).call('CLOSE_SALES_ORDER', 'salesOrder', {})).resolves.toBeNull();
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

describe('qianyiRows', () => {
  it('accepts a bare array', () => {
    expect(qianyiRows([{ sku: 'A' }])).toEqual([{ sku: 'A' }]);
  });

  it('unwraps the list keys a bizContent wrapper uses', () => {
    expect(qianyiRows({ list: [{ sku: 'A' }] })).toEqual([{ sku: 'A' }]);
    expect(qianyiRows({ rows: [{ sku: 'B' }] })).toEqual([{ sku: 'B' }]);
    expect(qianyiRows({ data: [{ sku: 'C' }] })).toEqual([{ sku: 'C' }]);
    expect(qianyiRows({ result: [{ sku: 'D' }] })).toEqual([{ sku: 'D' }]);
  });

  it('returns an empty array for an unexpected shape', () => {
    expect(qianyiRows(null)).toEqual([]);
    expect(qianyiRows({ total: 0 })).toEqual([]);
    expect(qianyiRows('oops')).toEqual([]);
  });
});
