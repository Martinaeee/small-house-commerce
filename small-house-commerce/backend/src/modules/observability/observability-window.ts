/**
 * Observation windows for the storefront intelligence workbench.
 *
 * Windows are Manila calendar days, exactly like `analytics_events.event_day`.
 * Default = the last 7 days (today included). Maximum span is 90 days so the
 * daily groupings stay inside statement budgets.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DAYS = 90;

export interface ObsWindow {
  start: Date;
  end: Date;
  fromDate: string;
  toDate: string;
  days: number;
}

function manilaDayParts(now: Date): { year: number; month: number; day: number } {
  const shifted = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
  };
}

function manilaDayStart(utcMidnight: Date): Date {
  // A Manila calendar day starts at 16:00 UTC of the previous day.
  return new Date(utcMidnight.getTime() - 8 * 60 * 60 * 1000);
}

export function resolveObsWindow(
  from: string | undefined,
  to: string | undefined,
  now: Date,
): ObsWindow {
  const today = new Date(Date.UTC(...values(manilaDayParts(now))));
  const lastDate = to ? Date.parse(`${to}T00:00:00Z`) : today.getTime();
  const firstDate = from ? Date.parse(`${from}T00:00:00Z`) : lastDate - 6 * DAY_MS;
  if (!Number.isFinite(firstDate) || !Number.isFinite(lastDate)) {
    throw new Error('Invalid date range');
  }
  const days = Math.round((lastDate - firstDate) / DAY_MS) + 1;
  if (days < 1) throw new Error('Invalid date range: to is before from');
  if (days > MAX_DAYS) throw new Error(`Invalid date range: window exceeds ${MAX_DAYS} days`);
  return {
    // Start of the last Manila day includes the whole day after = to +1d
    start: manilaDayStart(new Date(firstDate)),
    end: manilaDayStart(new Date(lastDate + DAY_MS)),
    fromDate: new Date(firstDate).toISOString().slice(0, 10),
    toDate: new Date(lastDate).toISOString().slice(0, 10),
    days,
  };
}

function values({ year, month, day }: { year: number; month: number; day: number }) {
  return [year, month, day] as const;
}
