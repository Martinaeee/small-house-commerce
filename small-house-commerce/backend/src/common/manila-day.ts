/**
 * Manila calendar days.
 *
 * The store runs on Asia/Manila days, so every date input in the admin
 * ("From", "To", dashboard periods) is a Manila day. Converting one to UTC
 * gives a half-open interval `[start, end)`, so midnight belongs to exactly
 * one day and a range never counts an order twice.
 */

const MANILA_OFFSET_MS = 8 * 3600_000;
const DAY_MS = 86_400_000;

/** UTC instant of 00:00 on the given Manila day (`YYYY-MM-DD`). */
export function manilaDayStart(day: string): Date {
  return new Date(new Date(`${day}T00:00:00.000Z`).getTime() - MANILA_OFFSET_MS);
}

/** Exclusive end of the given Manila day: the next day's 00:00. */
export function manilaDayEndExclusive(day: string): Date {
  return new Date(
    new Date(`${day}T00:00:00.000Z`).getTime() + DAY_MS - MANILA_OFFSET_MS,
  );
}
