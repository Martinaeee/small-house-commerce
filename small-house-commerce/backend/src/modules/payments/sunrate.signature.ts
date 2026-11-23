import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * SUNRATE v5 signing rule (docs.acq.sunrate.com/v5 README):
 *
 * 1. Exclude `signature`; sort every other field name by ASCII dictionary
 *    order; join as `k1=v1&k2=v2...` (raw values — no URL encoding).
 * 2. Append the signing key DIRECTLY at the end (no `&`).
 * 3. SHA256 hex (signType is always "SHA256").
 */
export function signFields(fields: Record<string, string>, key: string): string {
  if (!key) throw new Error('SUNRATE signing key is not configured');
  const base = Object.keys(fields)
    .filter((name) => name !== 'signature')
    .sort()
    .map((name) => `${name}=${fields[name] ?? ''}`)
    .join('&');
  return createHash('sha256').update(`${base}${key}`, 'utf8').digest('hex');
}

/** Constant-time verification of an inbound signed field set. */
export function verifySignature(fields: Record<string, string>, key: string): boolean {
  const given = fields['signature'];
  if (typeof given !== 'string' || !/^[0-9a-f]{64}$/.test(given)) return false;
  const expected = Buffer.from(signFields(fields, key), 'utf8');
  const actual = Buffer.from(given, 'utf8');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
