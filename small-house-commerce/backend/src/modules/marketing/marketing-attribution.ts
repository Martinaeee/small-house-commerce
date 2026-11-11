/**
 * Marketing attribution primitives.
 *
 * An AID identifies which optimizer owns an order's attribution (DATABASE.md
 * §7). It is deliberately narrow: letters, digits and `. _ -`, at most 64
 * characters, and it can never start with punctuation. Ad IDs, post IDs and
 * campaign IDs are separate identifiers and are not interchangeable with it.
 */

export function manilaVisitDay(instant: Date): Date {
  return new Date(`${new Date(instant.getTime() + 8 * 3600_000).toISOString().slice(0, 10)}T00:00:00.000Z`);
}

export const AID_MAX_LENGTH = 64;

const AID_PATTERN = /^[A-Z0-9][A-Z0-9._-]*$/;

/** Canonical AID form, or null when the value is not a usable code. */
export function normaliseAid(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toUpperCase();
  if (value.length < 1 || value.length > AID_MAX_LENGTH) return null;
  return AID_PATTERN.test(value) ? value : null;
}

/**
 * Where an order's advertising number came from. The values are shared by
 * signed touch claims, `analytics_events.ad_id_source` and
 * `order_attributions.adid_source`; never introduce a parallel enum.
 */
export type AdidSource = 'LINK' | 'META_DYNAMIC' | 'META_DYNAMIC_FALLBACK' | 'LEGACY' | 'NONE';

export type AdIdMissingReason = 'MISSING_META_AD_ID' | 'INVALID_META_AD_ID' | 'ORGANIC_TOUCH';

export type LinkResolution = 'CL' | 'AID' | 'AID_FALLBACK' | 'PAGE';

const META_AD_ID = /^\d{6,20}$/;

/**
 * Effective Meta ad ID for one touch. A valid dynamic `{{ad.id}}` wins; a
 * static link ID is only a fallback. An invalid value is never stored as an
 * ad ID, but its presence is still reported as INVALID_META_AD_ID.
 */
export function adIdProvenance(
  rawAdId: string | null | undefined,
  staticAdId: string | null,
  paid: boolean,
): { adId: string | null; adIdSource: AdidSource; adIdMissingReason: AdIdMissingReason | null } {
  const raw = typeof rawAdId === 'string' ? rawAdId.trim() : null;
  if (raw && META_AD_ID.test(raw)) {
    return { adId: raw, adIdSource: 'META_DYNAMIC', adIdMissingReason: null };
  }
  const fallback = typeof staticAdId === 'string' ? staticAdId.trim() : '';
  if (fallback) return { adId: fallback, adIdSource: 'LINK', adIdMissingReason: null };
  return {
    adId: null,
    adIdSource: 'NONE',
    adIdMissingReason: raw ? 'INVALID_META_AD_ID' : paid ? 'MISSING_META_AD_ID' : 'ORGANIC_TOUCH',
  };
}
