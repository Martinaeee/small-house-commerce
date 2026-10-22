import { BadRequestException } from '@nestjs/common';

/**
 * Date windows for the dashboard (dashboard §2).
 *
 * Every boundary is a *Manila calendar day*, because that is the day the
 * operators reading the page experience. Dates travel as `YYYY-MM-DD`
 * strings and are converted to half-open UTC instants exactly like the
 * marketing report does, so `[start, end)` never double-counts midnight.
 */

export const DASHBOARD_RANGE_PRESETS = [
  'TODAY',
  'YESTERDAY',
  'LAST_7_DAYS',
  'LAST_30_DAYS',
  'THIS_MONTH',
  'LAST_MONTH',
  'CUSTOM',
] as const;

export type DashboardRangePreset = (typeof DASHBOARD_RANGE_PRESETS)[number];

export interface DashboardWindow {
  preset: DashboardRangePreset;
  /** Inclusive first Manila day, `YYYY-MM-DD`. */
  fromDate: string;
  /** Inclusive last Manila day, `YYYY-MM-DD`. */
  toDate: string;
  /** Inclusive UTC instant of `fromDate` 00:00 Manila. */
  start: Date;
  /** Exclusive UTC instant after `toDate` 23:59:59 Manila. */
  end: Date;
  previousStart: Date;
  previousEnd: Date;
  /** Manila day strings of the previous period (for display). */
  previousFromDate: string;
  previousToDate: string;
  /** Number of calendar days covered (>= 1). */
  days: number;
}

const MANILA_OFFSET_MS = 8 * 3600_000;

/** Asia/Manila calendar day of an instant, `YYYY-MM-DD`. */
export function manilaDay(instant: Date): string {
  return new Date(instant.getTime() + MANILA_OFFSET_MS).toISOString().slice(0, 10);
}

function dayToUtc(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

function addDays(day: string, delta: number): string {
  return new Date(dayToUtc(day).getTime() + delta * 86_400_000).toISOString().slice(0, 10);
}

function diffDays(from: string, to: string): number {
  return Math.round((dayToUtc(to).getTime() - dayToUtc(from).getTime()) / 86_400_000);
}

/** Start of the Manila day expressed as a UTC instant. */
function startOfManilaDay(day: string): Date {
  return new Date(dayToUtc(day).getTime() - MANILA_OFFSET_MS);
}

export function resolveWindow(
  preset: DashboardRangePreset,
  from?: string,
  to?: string,
  now: Date = new Date(),
): DashboardWindow {
  const today = manilaDay(now);
  let fromDate: string;
  let toDate: string;

  switch (preset) {
    case 'TODAY':
      fromDate = today;
      toDate = today;
      break;
    case 'YESTERDAY':
      fromDate = addDays(today, -1);
      toDate = fromDate;
      break;
    case 'LAST_7_DAYS':
      fromDate = addDays(today, -6);
      toDate = today;
      break;
    case 'LAST_30_DAYS':
      fromDate = addDays(today, -29);
      toDate = today;
      break;
    case 'THIS_MONTH':
      fromDate = `${today.slice(0, 8)}01`;
      toDate = today;
      break;
    case 'LAST_MONTH': {
      const firstThisMonth = `${today.slice(0, 8)}01`;
      toDate = addDays(firstThisMonth, -1);
      fromDate = `${toDate.slice(0, 8)}01`;
      break;
    }
    case 'CUSTOM': {
      if (!from || !to) {
        throw new BadRequestException('Custom ranges need both from and to dates.');
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        throw new BadRequestException('Dates must use YYYY-MM-DD.');
      }
      if (from > to) {
        throw new BadRequestException('The start date must be on or before the end date.');
      }
      if (to > today) {
        throw new BadRequestException('The end date cannot be in the future.');
      }
      if (diffDays(from, to) > 366) {
        throw new BadRequestException('Ranges are limited to 366 days.');
      }
      fromDate = from;
      toDate = to;
      break;
    }
    default:
      throw new BadRequestException('Unknown range.');
  }

  const days = diffDays(fromDate, toDate) + 1;
  const start = startOfManilaDay(fromDate);
  const end = startOfManilaDay(addDays(toDate, 1));
  const previousEnd = start;
  const previousFromDate = addDays(fromDate, -days);
  const previousStart = startOfManilaDay(previousFromDate);
  const previousToDate = addDays(fromDate, -1);

  return {
    preset,
    fromDate,
    toDate,
    start,
    end,
    previousStart,
    previousEnd,
    previousFromDate,
    previousToDate,
    days,
  };
}
