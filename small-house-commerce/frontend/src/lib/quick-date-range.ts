/**
 * The four ranges operators switch between most often. Dates are Manila
 * calendar days, formatted with `en-CA` so they land directly in `<input
 * type="date">` values.
 */
export type QuickRangePreset =
  | "TODAY"
  | "YESTERDAY"
  | "TODAY_AND_YESTERDAY"
  | "LAST_7_DAYS"
  | "LAST_14_DAYS"
  | "LAST_28_DAYS"
  | "LAST_30_DAYS"
  | "THIS_WEEK"
  | "LAST_WEEK"
  | "THIS_MONTH"
  | "LAST_MONTH";

/** Every range the date picker offers, in the order it lists them. */
export const rangePresets: QuickRangePreset[] = [
  "TODAY",
  "YESTERDAY",
  "TODAY_AND_YESTERDAY",
  "LAST_7_DAYS",
  "LAST_14_DAYS",
  "LAST_28_DAYS",
  "LAST_30_DAYS",
  "THIS_WEEK",
  "LAST_WEEK",
  "THIS_MONTH",
  "LAST_MONTH",
];


const DAY_MS = 86_400_000;
const dayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export interface QuickDateRangeValue {
  from: string;
  to: string;
}

export function marketingDay(now: Date = new Date()): string {
  return dayFormat.format(now);
}

export function shiftDay(day: string, offset: number): string {
  return dayFormat.format(new Date(Date.parse(`${day}T00:00:00Z`) + offset * DAY_MS));
}

const weekdayOf = (day: string): number => new Date(`${day}T00:00:00Z`).getUTCDay();
const mondayOf = (day: string): string => shiftDay(day, -((weekdayOf(day) + 6) % 7));
export const monthStart = (day: string): string => `${day.slice(0, 7)}-01`;

export function shiftMonth(day: string, offset: number): string {
  const date = new Date(`${monthStart(day)}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 10);
}

export const monthEnd = (day: string): string => shiftDay(shiftMonth(day, 1), -1);

export function quickDateRange(preset: QuickRangePreset, now: Date = new Date()): QuickDateRangeValue {
  const today = marketingDay(now);
  switch (preset) {
    case "TODAY":
      return { from: today, to: today };
    case "YESTERDAY":
      return { from: shiftDay(today, -1), to: shiftDay(today, -1) };
    case "TODAY_AND_YESTERDAY":
      return { from: shiftDay(today, -1), to: today };
    case "LAST_7_DAYS":
      return { from: shiftDay(today, -6), to: today };
    case "LAST_14_DAYS":
      return { from: shiftDay(today, -13), to: today };
    case "LAST_28_DAYS":
      return { from: shiftDay(today, -27), to: today };
    case "LAST_30_DAYS":
      return { from: shiftDay(today, -29), to: today };
    case "THIS_WEEK":
      return { from: mondayOf(today), to: today };
    case "LAST_WEEK": {
      const to = shiftDay(mondayOf(today), -1);
      return { from: shiftDay(to, -6), to };
    }
    case "THIS_MONTH":
      return { from: monthStart(today), to: today };
    case "LAST_MONTH": {
      const lastMonth = shiftMonth(today, -1);
      return { from: monthStart(lastMonth), to: monthEnd(lastMonth) };
    }
  }
}

/** The preset a concrete range equals, so the picker can highlight it. */
export function presetForRange(range: QuickDateRangeValue, now: Date = new Date()): QuickRangePreset | null {
  return rangePresets.find(preset => {
    const candidate = quickDateRange(preset, now);
    return candidate.from === range.from && candidate.to === range.to;
  }) ?? null;
}

/** Days of one calendar month, grouped Monday-first into weeks. */
export function monthGrid(day: string): Array<Array<string | null>> {
  const first = monthStart(day);
  const last = monthEnd(first);
  const lead = (weekdayOf(first) + 6) % 7;
  const cells: Array<string | null> = Array.from({ length: lead }, () => null);
  for (let current = first; current <= last; current = shiftDay(current, 1)) cells.push(current);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: Array<Array<string | null>> = [];
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));
  return weeks;
}

export function quickRangeButtonClass(active: boolean): string {
  return `rounded-full border px-3 py-1 text-xs ${active ? "border-cta bg-cta text-cta-foreground" : "border-admin-border bg-white text-ink hover:border-cta"}`;
}
