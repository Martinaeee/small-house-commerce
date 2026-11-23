import { describe, expect, it, vi } from 'vitest';
import { cosUploadsFallback } from './cos-fallback.js';

const settings = {
  secretId: 'id',
  secretKey: 'secret',
  bucket: 'luwagshop-1257828062',
  region: 'ap-singapore',
  publicBaseUrl: 'https://luwagshop-1257828062.cos.ap-singapore.myqcloud.com',
};

function res() {
  return {
    setHeader: vi.fn(),
    status: vi.fn().mockReturnThis(),
    end: vi.fn(),
  };
}

describe('cosUploadsFallback', () => {
  it('streams a missing local file from COS with long-lived cache headers', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/png' }),
      arrayBuffer: async () => new TextEncoder().encode('bytes').buffer,
    }));
    const handler = cosUploadsFallback(settings, fetchMock as unknown as typeof fetch);
    const r = res();
    const next = vi.fn();
    await handler({ method: 'GET', path: '/catalog/2026/a.png' } as never, r as never, next);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://luwagshop-1257828062.cos.ap-singapore.myqcloud.com/catalog/2026/a.png',
    );
    expect(r.setHeader).toHaveBeenCalledWith('Content-Type', 'image/png');
    expect(r.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'public, max-age=2592000, immutable',
    );
    expect(r.status).toHaveBeenCalledWith(200);
    expect(r.end).toHaveBeenCalledOnce();
    expect(next).not.toHaveBeenCalled();
  });

  it('falls through when COS has no such object', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 404 }));
    const handler = cosUploadsFallback(settings, fetchMock as unknown as typeof fetch);
    const next = vi.fn();
    await handler(
      { method: 'GET', path: '/catalog/2026/missing.png' } as never,
      res() as never,
      next,
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it('does nothing when COS is not configured', async () => {
    const fetchMock = vi.fn();
    const handler = cosUploadsFallback(null, fetchMock as unknown as typeof fetch);
    const next = vi.fn();
    await handler({ method: 'GET', path: '/catalog/2026/a.png' } as never, res() as never, next);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it('refuses traversal and non-GET requests without touching COS', async () => {
    const fetchMock = vi.fn();
    const handler = cosUploadsFallback(settings, fetchMock as unknown as typeof fetch);
    const next = vi.fn();
    await handler({ method: 'GET', path: '/../secret' } as never, res() as never, next);
    await handler({ method: 'POST', path: '/catalog/2026/a.png' } as never, res() as never, next);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(2);
  });
});
