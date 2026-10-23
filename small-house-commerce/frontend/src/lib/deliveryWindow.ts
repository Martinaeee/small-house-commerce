/**
 * Storefront delivery estimate.
 *
 * The shop quotes one nationwide window — 7 business days from the order
 * date (Sundays skipped). All calendar math is rendered in Asia/Manila so an
 * UTC server and a PH browser produce the same date — the Philippines has no
 * DST, so adding whole days in ms is safe.
 */

const TIME_ZONE = "Asia/Manila";
const DELIVERY_DAYS = 7;

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
 * Default preferred-delivery date: the 7th business day from Manila-today.
 * Pre-fills the checkout date field so it never shows the blank
 * year/month/day placeholder.
 */
export function defaultPreferredDeliveryDate(now: Date = new Date()): string {
  const { year, month, day } = manilaWallDate(now);
  const manilaToday = new Date(Date.UTC(year, month - 1, day));
  return toDateInputValue(addBusinessDays(manilaToday, DELIVERY_DAYS));
}

export interface DeliveryWindows {
  metro: string;
  provincial: string;
}

/** One nationwide window; the province no longer changes the estimate. */
export function deliveryWindows(): DeliveryWindows {
  const label = `${DELIVERY_DAYS} days`;
  return { metro: label, provincial: label };
}

export function deliveryWindowFor(_province: string): string {
  return `${DELIVERY_DAYS} days`;
}
