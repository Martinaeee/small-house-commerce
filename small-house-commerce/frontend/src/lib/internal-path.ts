/**
 * A single-leading-slash site path.
 *
 * Shared by the homepage document, the storefront shell document and the
 * admin link picker, mirroring `backend/src/common/internal-path.ts`. Both
 * documents let an operator point a CTA at an in-app route (for example
 * `/track-order`) and both must refuse anything that could resolve off-origin:
 * protocol-relative `//host`, backslashes, whitespace and control characters
 * are rejected, and the resolved origin is re-checked.
 */

const BASE_ORIGIN = "https://luwag.invalid";

export const INTERNAL_PATH_MAX = 2048;

export function isSafeInternalPath(value: string): boolean {
  if (!value.startsWith("/")) return false;
  if (value.startsWith("//")) return false;
  if (value.includes("\\")) return false;
  if (/[\u0000- \u007f]/.test(value)) return false;
  try {
    return new URL(value, BASE_ORIGIN).origin === BASE_ORIGIN;
  } catch {
    return false;
  }
}
