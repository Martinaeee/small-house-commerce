import { describe, expect, it, vi } from 'vitest';
import {
  JtClient,
  JtError,
  jtBodyDigest,
  jtHeaderDigest,
  jtPasswordCipher,
} from './jt.client.js';

const values = {
  'jt.enabled': 'true',
  'jt.baseUrl': 'https://demoopenapi.jtexpress.ph/webopenplatformapi/api',
  'jt.apiAccount': '640826271705595946',
  'jt.privateKey': 'test-private-key',
  'jt.customerCode': 'J0086474299',
  'jt.customerPassword': 's3cret',
  'jt.pollMinutes': 30,
  'jt.carrierName': 'J&T Express',
};

const configOf = (overrides: Record<string, unknown> = {}) =>
  ({ get: (key: string) => ({ ...values, ...overrides })[key] }) as never;

const okBody = {
  code: '1',
  msg: 'success',
  data: {
    billCode: 'JT0000008101561',
    details: [
      {
        scanTime: '2026-05-09 09:57:32',
        desc: 'Your package has been Delivered',
        scanTypeName: 'Delivered',
        scanTypeCode: '113',
        staffConcatPhone: null,
        scanNetworkProvince: 'METRO-MANILA',
        scanNetworkCity: 'TAGUIG',
        sigPicUrl: null,
        timeZone: 'UTC+8',
      },
    ],
  },
  requestId: 'req-1',
};

function clientWith(response: Response | Error) {
  const request = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  return { client: new JtClient(configOf(), request as never), request };
}

describe('J&T signatures', () => {
  // Fixed vectors computed with node:crypto; they lock the algorithm.
  it('derives the password cipher', () => {
    expect(jtPasswordCipher('s3cret')).toBe('A91EFD85DD3C9E9D8689A420A2A7A9DE');
  });

  it('derives the body digest', () => {
    expect(jtBodyDigest('J0086474299', 's3cret', 'test-private-key')).toBe(
      'kkaZl0cj8DAH4wkeJ5DDaw==',
    );
  });

  it('derives the header digest', () => {
    const bizContent =
      '{"customerCode":"J0086474299","digest":"kkaZl0cj8DAH4wkeJ5DDaw==","billCode":"JT0000008101561"}';
    expect(jtHeaderDigest(bizContent, 'test-private-key')).toBe(
      '2aDY86tkxV7uboypIkYhSw==',
    );
  });
});

describe('JtClient.trace', () => {
  it('posts a form body whose bizContent is exactly the signed string', async () => {
    const { client, request } = clientWith(
      new Response(JSON.stringify(okBody), { status: 200 }),
    );

    const details = await client.trace('JT0000008101561');

    expect(details).toHaveLength(1);
    expect(details[0].scanTypeCode).toBe('113');

    const [url, init] = request.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://demoopenapi.jtexpress.ph/webopenplatformapi/api/logistics/trace',
    );
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.apiAccount).toBe('640826271705595946');
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');

    const sent = new URLSearchParams(init.body as string).get('bizContent');
    expect(jtHeaderDigest(sent as string, 'test-private-key')).toBe(headers.digest);
    expect(JSON.parse(sent as string)).toEqual({
      customerCode: 'J0086474299',
      digest: 'kkaZl0cj8DAH4wkeJ5DDaw==',
      billCode: 'JT0000008101561',
    });
  });

  it('returns an empty list when the carrier has no scans yet', async () => {
    const { client } = clientWith(
      new Response(JSON.stringify({ code: '1', msg: 'success', data: null }), {
        status: 200,
      }),
    );
    await expect(client.trace('JT1')).resolves.toEqual([]);
  });

  it('surfaces a business rejection with its request id', async () => {
    const { client } = clientWith(
      new Response(
        JSON.stringify({ code: '0', msg: 'billCode not found', requestId: 'req-9' }),
        { status: 200 },
      ),
    );
    await expect(client.trace('JT1')).rejects.toMatchObject({
      kind: 'BUSINESS',
      message: 'billCode not found',
      requestId: 'req-9',
    });
  });

  it('marks a signing complaint as SIGNATURE', async () => {
    const { client } = clientWith(
      new Response(JSON.stringify({ code: '0', msg: 'sign error' }), { status: 200 }),
    );
    await expect(client.trace('JT1')).rejects.toMatchObject({ kind: 'SIGNATURE' });
  });

  it('rejects a non-JSON body', async () => {
    const { client } = clientWith(new Response('<html>502</html>', { status: 502 }));
    await expect(client.trace('JT1')).rejects.toMatchObject({ kind: 'NON_JSON' });
  });

  it('wraps a transport failure', async () => {
    const { client } = clientWith(new Error('socket hang up'));
    await expect(client.trace('JT1')).rejects.toMatchObject({ kind: 'TRANSPORT' });
  });

  it('refuses to call out when disabled', async () => {
    const request = vi.fn();
    const client = new JtClient(configOf({ 'jt.enabled': 'false' }), request as never);
    await expect(client.trace('JT1')).rejects.toBeInstanceOf(JtError);
    expect(request).not.toHaveBeenCalled();
  });
});
