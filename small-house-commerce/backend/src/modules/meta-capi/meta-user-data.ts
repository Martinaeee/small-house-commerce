import { createHash } from 'node:crypto';
import { normalizePhilippinePhone } from '../../common/phone.util.js';

/**
 * Meta advanced matching wants SHA-256 of the E.164 number *without* the
 * leading plus, digits only. Anything that cannot be normalized to a real
 * Philippine mobile number returns null — a wrong hash is worse than none.
 */
export function hashMetaPhone(phone: string): string | null {
  const normalized = normalizePhilippinePhone(phone);
  if (!normalized) return null;
  const digits = normalized.replace(/\D/g, '');
  if (digits.length < 11 || digits.length > 15) return null;
  return createHash('sha256').update(digits).digest('hex');
}

/**
 * Orders typed into the admin (phone orders, test entries) are not ad
 * conversions and carry the operator's IP; they never become Meta events.
 */
export function isAdminSource(url: string | null | undefined): boolean {
  if (!url) return false;
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    // Bare paths are already what we need.
  }
  return path === '/admin' || path.startsWith('/admin/') ||
    path === '/preview' || path.startsWith('/preview/');
}
