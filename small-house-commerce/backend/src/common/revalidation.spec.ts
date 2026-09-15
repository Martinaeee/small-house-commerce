import { afterEach, describe, expect, it, vi } from 'vitest';
import { CACHE_TAGS, revalidateCache } from './revalidation.js';

describe('revalidateCache', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('is a no-op (no fetch) when REVALIDATE_URL or SECRET are unset', async () => {
    vi.stubEnv('REVALIDATE_URL', '');
    vi.stubEnv('REVALIDATE_SECRET', '');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await revalidateCache([CACHE_TAGS.STOREFRONT]);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('POSTs the tags with the secret header and strips the trailing slash', async () => {
    vi.stubEnv('REVALIDATE_URL', 'http://frontend:3000/');
    vi.stubEnv('REVALIDATE_SECRET', 's3cret');
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({ ok: true, status: 200 } as Response);

    await revalidateCache([CACHE_TAGS.STOREFRONT]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('http://frontend:3000/api/internal/revalidate');
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers['x-revalidate-secret']).toBe('s3cret');
    expect(JSON.parse(init?.body as string)).toEqual({ tags: ['storefront'] });
  });

  it('never throws on non-2xx or network failure', async () => {
    vi.stubEnv('REVALIDATE_URL', 'http://frontend:3000');
    vi.stubEnv('REVALIDATE_SECRET', 's3cret');
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: false, status: 500 } as Response)
      .mockRejectedValueOnce(new TypeError('network down'));

    await expect(revalidateCache(['storefront'])).resolves.toBeUndefined();
    await expect(revalidateCache(['storefront'])).resolves.toBeUndefined();
  });
});
