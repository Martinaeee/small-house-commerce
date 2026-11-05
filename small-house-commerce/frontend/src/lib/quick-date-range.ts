/**
 * The four ranges operators switch between most often. Dates are Manila
 * calendar days, formatted with `en-CA` so they land directly in `<input
 * type="date">` values.
 */
export type QuickRangePreset = "TODAY" | "YESTERDAY" | "TODAY_AND_YESTERDAY" | "LAST_7_DAYS";

export const quickRangePresets: QuickRangePreset[] = [
  "TODAY",
  "YESTERDAY",
  "TODAY_AND_YESTERDAY",
  "LAST_7_DAYS",
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

export function quickDateRange(preset: QuickRangePreset, now: Date = new Date()): QuickDateRangeValue {
  const day = (offset: number) => dayFormat.format(new Date(now.getTime() + offset * DAY_MS));
  const today = day(0);
  switch (preset) {
    case "TODAY":
      return { from: today, to: today };
    case "YESTERDAY":
      return { from: day(-1), to: day(-1) };
    case "TODAY_AND_YESTERDAY":
      return { from: day(-1), to: today };
    case "LAST_7_DAYS":
      return { from: day(-6), to: today };
  }
}

export function quickRangeButtonClass(active: boolean): string {
  return `rounded-full border px-3 py-1 text-xs ${active ? "border-cta bg-cta text-cta-foreground" : "border-admin-border bg-white text-ink hover:border-cta"}`;
}
