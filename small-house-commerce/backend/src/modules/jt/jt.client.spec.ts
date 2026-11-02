import { describe, expect, it, vi } from 'vitest';
import {
  JT_REQUEST_TIMEOUT_MS,
  JtClient,
  JtError,
  jtDataDigest,
} from './jt.client.js';

const values = {
  'jt.enabled': 'true',
  'jt.baseUrl': 'https://jtapi.jtexpress.ph',
  'jt.eccompanyid': 'LUWAG-EC',
  'jt.key': 'test-key',
  'jt.pollMinutes': 30,
  'jt.carrierName': 'J&T Express',
};

const configOf = (overrides: Record<string, unknown> = {}) =>
  ({ get: (key: string) => ({ ...values, ...overrides })[key] }) as never;

const okBody = {
  responseitems: [
    {
      details: [
        {
          scantime: '2026-05-09 09:57:32',
          scantype: 'Delivered',
          desc: 'Your package has been Delivered',
          code: '113',
        },
        {
          scantime: '2026-05-08 18:20:00',
          scantype: 'In transit',
          desc: 'Package arrived at the sorting centre',
          code: '110',
        },
      ],
    },
  ],
  responseFlag: '1',
  reason: '',
};

function clientWith(response: Response | Error) {
  const request = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  return { client: new JtClient(configOf(), request as never), request };
}

describe('J&T TRACKQUERY signature', () => {
  // Fixed vector computed with node:crypto; it locks the algorithm.
  it('base64s the hex MD5 of the exact payload plus the key', () => {
    expect(jtDataDigest('{"billcode":"JT0000008101561","lang":"en"}', 'test-key')).toBe(
      'MTQ0ZGFhMGJkMDE4OWQ0OGEyYTZmZjQwMmU4MTMwOTE=',
    );
  });
});

describe('JtClient.trace', () => {
  it('posts the four TRACKQUERY form fields to the namespaced gateway path', async () => {
    const { client, request } = clientWith(
      new Response(JSON.stringify(okBody), { status: 200 }),
    );

    const details = await client.trace('JT0000008101561');

    expect(details).toHaveLength(2);
    expect(details[0]).toEqual({
      scanTime: '2026-05-09 09:57:32',
      scanTypeName: 'Delivered',
      scanTypeCode: '113',
      desc: 'Your package has been Delivered',
    });

    const [url, init] = request.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://jtapi.jtexpress.ph/jts-phl-order-api/api/track/trackForJson',
    );
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/x-www-form-urlencoded',
    );

    const form = new URLSearchParams(init.body as string);
    expect(form.get('msg_type')).toBe('TRACKQUERY');
    expect(form.get('eccompanyid')).toBe('LUWAG-EC');
    const payload = form.get('logistics_interface') as string;
    expect(JSON.parse(payload)).toEqual({ billcode: 'JT0000008101561', lang: 'en' });
    expect(jtDataDigest(payload, 'test-key')).toBe(form.get('data_digest'));
  });

  it('titles the gateway path rather than trusting the base url', async () => {
    const { client, request } = clientWith(
      new Response(JSON.stringify(okBody), { status: 200 }),
    );
    await client.trace('JT1');
    const [url] = request.mock.calls[0] as unknown as [string];
    expect(url.endsWith('/jts-phl-order-api/api/track/trackForJson')).toBe(true);
  });

  it('returns an empty list when the carrier has no scans yet', async () => {
    const { client } = clientWith(
      new Response(JSON.stringify({ responseitems: [], responseFlag: '1' }), {
        status: 200,
      }),
    );
    await expect(client.trace('JT1')).resolves.toEqual([]);
  });

  it('surfaces a rejection that comes back with no items', async () => {
    const { client } = clientWith(
      new Response(JSON.stringify({ responseFlag: '0', reason: 'billCode not found' }), {
        status: 200,
      }),
    );
    await expect(client.trace('JT1')).rejects.toMatchObject({
      kind: 'BUSINESS',
      message: 'billCode not found',
    });
  });

  it('marks a signing complaint as SIGNATURE', async () => {
    const { client } = clientWith(
      new Response(JSON.stringify({ responseFlag: '0', reason: 'data_digest error' }), {
        status: 200,
      }),
    );
    await expect(client.trace('JT1')).rejects.toMatchObject({ kind: 'SIGNATURE' });
  });

  it('rejects a non-JSON body', async () => {
    const { client } = clientWith(new Response('<html>404</html>', { status: 404 }));
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

  it('gives every request the 15 second abort signal', async () => {
    expect(JT_REQUEST_TIMEOUT_MS).toBe(15_000);
    const { client, request } = clientWith(
      new Response(JSON.stringify(okBody), { status: 200 }),
    );

    await client.trace('JT1');

    const [, init] = request.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('maps an aborted request to TRANSPORT', async () => {
    const request = vi.fn(async () => {
      throw new DOMException('This operation was aborted', 'AbortError');
    });
    const client = new JtClient(configOf(), request as never);

    await expect(client.trace('JT1')).rejects.toMatchObject({ kind: 'TRANSPORT' });
  });

  it('maps a body read failure to TRANSPORT', async () => {
    const broken = new Response(null, { status: 200 });
    vi.spyOn(broken, 'text').mockRejectedValue(
      new DOMException('This operation was aborted', 'AbortError'),
    );
    const request = vi.fn(async () => broken);
    const client = new JtClient(configOf(), request as never);

    await expect(client.trace('JT1')).rejects.toMatchObject({ kind: 'TRANSPORT' });
  });
});
