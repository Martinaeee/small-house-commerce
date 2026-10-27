import type { Request } from 'express';

export interface CheckoutRequestMeta {
  clientIp: string | null;
  clientUserAgent: string | null;
  /** Page the order was submitted from; null when it cannot be derived. */
  eventSourceUrl: string | null;
}

/**
 * Request facts the Meta Purchase event needs. Behind Caddy (`trust proxy`
 * 1) `request.ip` is the shopper's address, not the proxy's.
 */
export function checkoutRequestMeta(request: Request): CheckoutRequestMeta {
  const userAgent = request.headers['user-agent'];
  const referer = request.headers.referer;
  const forwardedHost = request.headers['x-forwarded-host'];
  const host =
    (typeof forwardedHost === 'string' ? forwardedHost.split(',')[0] : null) ??
    request.headers.host ??
    null;
  const source =
    typeof referer === 'string' && referer
      ? referer
      : host
        ? `${request.protocol}://${host}${request.originalUrl}`
        : null;
  return {
    clientIp: request.ip ?? null,
    clientUserAgent:
      typeof userAgent === 'string' ? userAgent.slice(0, 512) : null,
    eventSourceUrl: source ? source.slice(0, 1024) : null,
  };
}
