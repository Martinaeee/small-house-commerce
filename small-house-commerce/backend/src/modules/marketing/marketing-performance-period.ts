import type { MarketingPerformanceQuery } from './dto/marketing-performance.dto.js';
import type { PerformanceBucket, PerformanceDateRange, PerformanceInterval, PerformanceReadRange, PerformanceWindow } from './marketing-performance.types.js';

const DAY_MS = 86_400_000;

const shiftDay = (day: string, delta: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + delta * DAY_MS).toISOString().slice(0, 10);
const mondayOf = (day: string): string => shiftDay(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
const manilaToday = (now: Date): string => new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
const daySpan = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;

const readRange = (from: string, to: string): PerformanceReadRange => ({
  from,
  to,
  startAt: new Date(`${from}T00:00:00+08:00`),
  endAt: new Date(`${shiftDay(to, 1)}T00:00:00+08:00`),
});

export function resolvePerformanceWindow(query: MarketingPerformanceQuery, now: Date): PerformanceWindow {
  const today = manilaToday(now);
  let from: string;
  let to: string;
  switch (query.preset) {
    case 'LAST_7_DAYS':
      from = shiftDay(today, -6);
      to = today;
      break;
    case 'LAST_30_DAYS':
      from = shiftDay(today, -29);
      to = today;
      break;
    case 'THIS_WEEK':
      from = mondayOf(today);
      to = today;
      break;
    case 'LAST_WEEK':
      to = shiftDay(mondayOf(today), -1);
      from = shiftDay(to, -6);
      break;
    case 'CUSTOM':
      from = query.from as string;
      to = query.to as string;
  }
  const current = readRange(from, to);
  let previous: PerformanceReadRange | null = null;
  if (query.compare) {
    previous = query.preset === 'THIS_WEEK'
      ? readRange(shiftDay(from, -7), shiftDay(to, -7))
      : readRange(shiftDay(from, -daySpan(from, to)), shiftDay(from, -1));
  }
  return { asOf: now, current, previous };
}

export function buildPerformanceBuckets(range: PerformanceDateRange, interval: PerformanceInterval, now: Date): PerformanceBucket[] {
  const today = manilaToday(now);
  const buckets: PerformanceBucket[] = [];
  if (interval === 'DAY') {
    for (let day = range.from; day <= range.to; day = shiftDay(day, 1)) {
      buckets.push({ key: day, from: day, to: day, partialWeek: false, includesToday: day === today });
    }
    return buckets;
  }
  for (let week = mondayOf(range.from); week <= range.to; week = shiftDay(week, 7)) {
    const weekEnd = shiftDay(week, 6);
    const from = week < range.from ? range.from : week;
    const to = weekEnd > range.to ? range.to : weekEnd;
    buckets.push({ key: week, from, to, partialWeek: from !== week || to !== weekEnd, includesToday: from <= today && today <= to });
  }
  return buckets;
}
