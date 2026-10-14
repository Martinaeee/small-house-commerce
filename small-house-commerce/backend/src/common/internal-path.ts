import { z } from 'zod';

/**
 * A single-leading-slash site path.
 *
 * Shared by the homepage document and the storefront shell document: both let
 * an operator point a CTA at an in-app route (for example `/track-order`) and
 * both must refuse anything that could resolve off-origin. Protocol-relative
 * `//host`, backslashes, whitespace and control characters are rejected, and
 * the resolved origin is re-checked so no path can escape the site.
 */

const BASE_ORIGIN = 'https://luwag.invalid';

export const INTERNAL_PATH_MAX = 2048;

export function isSafeInternalPath(value: string): boolean {
  if (!value.startsWith('/')) return false;
  if (value.startsWith('//')) return false;
  if (value.includes('\\')) return false;
  // eslint-disable-next-line no-control-regex -- control characters are exactly what we reject here
  if (/[\u0000- \u007f]/.test(value)) return false;
  try {
    return new URL(value, BASE_ORIGIN).origin === BASE_ORIGIN;
  } catch {
    return false;
  }
}

export const internalPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(INTERNAL_PATH_MAX)
  .refine(isSafeInternalPath, {
    message: 'Internal paths must be site-relative and must not change the origin',
  });
