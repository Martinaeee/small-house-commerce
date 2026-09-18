/**
 * PDP buy-box delivery estimates.
 *
 * Windows mirror the TrustBar copy exactly: Metro Manila 3–5 days,
 * provinces 5–7 days (business days — Sundays skipped — from the order
 * date). All calendar math is rendered in Asia/Manila so an UTC server
 * and a PH browser produce the same string — the Philippines has no
 * DST, so adding whole days in ms is safe.
 */

const TIME_ZONE = "Asia/Manila";

type DayParts = { month: string; day: number };

function manilaDayParts(date: Date): DayParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    month: "short",
    day: "numeric",
  }).formatToParts(date);
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const day = Number(parts.find((p) => p.type === "day")?.value ?? "0");
  return { month, day };
}

function addDays(now: Date, days: number): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

type ManilaWallDate = { year: number; month: number; day: number };

export function manilaWallDate(date: Date): ManilaWallDate {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);
  const value = (t: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === t)?.value ?? "0");
  return { year: value("year"), month: value("month"), day: value("day") };
}

/** Weekday (0=Sun..6=Sat) of a Manila wall date; Manila day (y,m,d) always
 *  contains UTC (y,m,d) 00:00 (UTC+8, no DST), so the UTC weekday equals it. */
function manilaWeekday(date: Date): number {
  const { year, month, day } = manilaWallDate(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** n 个工作日（跳过周日）后的 Date；n=0 返回同刻克隆。+24h 即 +1 Manila 日
 *  （菲律宾无夏令时），推进与星期判定均按 Manila 日历，运行时区无关。 */
export function addBusinessDays(date: Date, n: number): Date {
  const next = new Date(date.getTime());
  let remaining = n;
  while (remaining > 0) {
    next.setTime(next.getTime() + 24 * 60 * 60 * 1000);
    if (manilaWeekday(next) !== 0) remaining--; // Sunday is not a business day
  }
  return next;
}

/** Manila 日历日 → "yyyy-MM-dd"（供 <input type="date"> 的 min/max/value）。 */
export function toDateInputValue(date: Date): string {
  const { year, month, day } = manilaWallDate(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Default preferred-delivery date: the 7th business day from Manila-today
 * (provinces deliver in 5–7 business days, so this matches the stated window
 * and always skips Sundays). Pre-fills the checkout date field so it never
 * shows the blank year/month/day placeholder.
 */
export function defaultPreferredDeliveryDate(now: Date = new Date()): string {
  const { year, month, day } = manilaWallDate(now);
  const manilaToday = new Date(Date.UTC(year, month - 1, day));
  return toDateInputValue(addBusinessDays(manilaToday, 7));
}

/** "Sep 16–18" within one month; "Sep 28 – Oct 2" across a month boundary. */
export function formatDeliveryRange(now: Date, minDays: number, maxDays: number): string {
  const start = manilaDayParts(addDays(now, minDays));
  const end = manilaDayParts(addDays(now, maxDays));
  if (start.month === end.month) return `${start.month} ${start.day}–${end.day}`;
  return `${start.month} ${start.day} – ${end.month} ${end.day}`;
}

/** Range between the minDays-th and maxDays-th business day from `now`. */
function businessDayRange(now: Date, minDays: number, maxDays: number): string {
  const start = addBusinessDays(now, minDays);
  const end = addBusinessDays(now, maxDays);
  // Both endpoints keep `now`'s Manila wall time, so the ms span is a whole
  // number of days (the Philippines has no DST).
  const span = (end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
  return formatDeliveryRange(start, 0, span);
}

const METRO_MANILA_ALIASES = new Set([
  "metro manila",
  "ncr",
  "national capital region",
]);

export function isMetroManila(province: string): boolean {
  const normalized = province.trim().toLowerCase().replace(/\s+/g, " ");
  return METRO_MANILA_ALIASES.has(normalized);
}

export interface DeliveryWindows {
  metro: string;
  provincial: string;
}

export function deliveryWindows(now: Date = new Date()): DeliveryWindows {
  return {
    metro: businessDayRange(now, 3, 5),
    provincial: businessDayRange(now, 5, 7),
  };
}

/** Province-aware range: Metro Manila 3–5 business days, provinces 5–7. */
export function deliveryWindowFor(province: string, now: Date = new Date()): string {
  return isMetroManila(province)
    ? businessDayRange(now, 3, 5)
    : businessDayRange(now, 5, 7);
}
