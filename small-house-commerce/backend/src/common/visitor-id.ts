import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';

/**
 * Anonymous shopper identity for review helpful votes / reports.
 *
 * The browser keeps a random 32-byte cookie; the database stores only a
 * salted SHA-256 hash, which is enough to dedupe one vote/report per shopper
 * but cannot be reversed back to a cookie or shared across services.
 */
export const VISITOR_COOKIE = 'rv_vid';

const COOKIE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;
const MIN_ID_LENGTH = 16;

function parseCookies(header: string | undefined): Record<string, string> {
  const jar: Record<string, string> = {};
  if (!header) return jar;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key) jar[key] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return jar;
}

/**
 * Returns a stable salted hash for the current shopper, minting and setting
 * the cookie on first contact. `secret` is the app JWT secret used as pepper.
 */
export function ensureVisitorHash(
  req: Request,
  res: Response,
  secret: string,
): string {
  const jar = parseCookies(req.headers.cookie);
  let visitorId = jar[VISITOR_COOKIE] ?? '';
  if (visitorId.length < MIN_ID_LENGTH || /[^\w-]/.test(visitorId)) {
    visitorId = randomBytes(32).toString('hex');
    res.cookie(VISITOR_COOKIE, visitorId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
      path: '/',
      maxAge: COOKIE_MAX_AGE_MS,
    });
  }
  return createHash('sha256').update(`visitor:${visitorId}:${secret}`).digest('hex');
}
