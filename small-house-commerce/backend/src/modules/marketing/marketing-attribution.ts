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
