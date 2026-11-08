/** First-party attribution cookies. The values are signed touch credentials. */
export const MARKETING_FIRST_COOKIE = 'luwag_mt_first';
export const MARKETING_LAST_COOKIE = 'luwag_mt_last';

/** Reads one cookie without adding cookie-parser to the application. */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (rawKey === name) {
      try { return decodeURIComponent(rawValue.join('=')); } catch { return null; }
    }
  }
  return null;
}

/** Behind Caddy the request protocol is the forwarded one. */
export function requestIsSecure(request: {
  secure?: boolean;
  protocol?: string;
  headers: Record<string, string | string[] | undefined>;
}): boolean {
  const forwarded = request.headers['x-forwarded-proto'];
  const proto = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return request.secure === true || request.protocol === 'https' || (typeof proto === 'string' && proto.split(',')[0]?.trim() === 'https');
}
