/**
 * Manila-day period presets for the observability workbench (P1.1).
 * Pure functions; the backend enforces the same 90-day maximum.
 */
export type PeriodPreset = "TODAY" | "YESTERDAY" | "LAST_7" | "LAST_14" | "LAST_30" | "CUSTOM";

export interface PeriodRange {
  from: string;
  to: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_PERIOD_DAYS = 90;

/** Manila calendar day (YYYY-MM-DD) for a UTC instant. */
export function manilaDay(now: Date = new Date()): string {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function shift(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}

/** Preset range, or null when a custom range is incomplete/invalid. */
export function presetRange(
  preset: PeriodPreset,
  custom: PeriodRange | null,
  now: Date = new Date(),
): PeriodRange | null {
  const today = manilaDay(now);
  switch (preset) {
    case "TODAY":
      return { from: today, to: today };
    case "YESTERDAY": {
      const d = shift(today, -1);
      return { from: d, to: d };
    }
    case "LAST_7":
      return { from: shift(today, -6), to: today };
    case "LAST_14":
      return { from: shift(today, -13), to: today };
    case "LAST_30":
      return { from: shift(today, -29), to: today };
    case "CUSTOM":
      if (!custom) return null;
      if (daysBetween(custom.from, custom.to) < 1) return null;
      if (daysBetween(custom.from, custom.to) > MAX_PERIOD_DAYS) return null;
      return custom;
  }
}

export function isCustomRangeValid(from: string, to: string): boolean {
  if (!from || !to) return false;
  const days = daysBetween(from, to);
  return days >= 1 && days <= MAX_PERIOD_DAYS;
}
