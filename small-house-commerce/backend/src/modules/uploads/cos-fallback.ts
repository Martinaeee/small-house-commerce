import type { RequestHandler } from 'express';
import type { CosSettings } from './cos-storage.js';

/**
 * Serves /uploads/* from COS when the file is no longer on local disk.
 *
 * Runs after the static handler, which calls next() for missing files. Keeping
 * URLs relative is deliberate: the storefront image optimizer keeps working
 * exactly as before, and no database URL needs rewriting when media moves.
 */
export function cosUploadsFallback(
  settings: CosSettings | null,
  fetchImpl: typeof fetch = fetch,
): RequestHandler {
  if (!settings) {
    return (_req, _res, next) => next();
  }
  const base = settings.publicBaseUrl.replace(/\/+$/, '');
  return async (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let key: string;
    try {
      key = decodeURIComponent(req.path).replace(/^\/+/, '');
    } catch {
      return next();
    }
    if (!key || key.includes('..')) return next();

    try {
      const upstream = await fetchImpl(`${base}/${key}`);
      if (!upstream.ok) return next();
      const body = Buffer.from(await upstream.arrayBuffer());
      res.setHeader(
        'Content-Type',
        upstream.headers.get('content-type') ?? 'application/octet-stream',
      );
      res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
      res.status(upstream.status).end(req.method === 'HEAD' ? undefined : body);
    } catch {
      return next();
    }
  };
}
