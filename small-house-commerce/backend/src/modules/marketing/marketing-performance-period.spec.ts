import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { marketingPerformanceQuerySchema } from './dto/marketing-performance.dto.js';
import { buildPerformanceBuckets, resolvePerformanceWindow } from './marketing-performance-period.js';

const at = (iso: string) => new Date(iso);
const productQuery = (extra: Record<string, unknown> = {}) =>
  marketingPerformanceQuerySchema.parse({ view: 'PRODUCT', productId: '11111111-1111-4111-a111-111111111111', ...extra });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2028-03-05T04:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('performance window resolution', () => {
  it('resolves this week against the same weekdays of last week', () => {
    const window = resolvePerformanceWindow(productQuery({ preset: 'THIS_WEEK' }), at('2026-10-07T04:00:00Z'));
    expect(window.current).toMatchObject({ from: '2026-10-05', to: '2026-10-07' });
    expect(window.previous).toMatchObject({ from: '2026-09-28', to: '2026-09-30' });
    expect(window.current.startAt.toISOString()).toBe('2026-10-04T16:00:00.000Z');
    expect(window.current.endAt.toISOString()).toBe('2026-10-07T16:00:00.000Z');
    expect(window.asOf.toISOString()).toBe('2026-10-07T04:00:00.000Z');
  });

  it('resolves recent ranges against the adjacent equal-length range', () => {
    const seven = resolvePerformanceWindow(productQuery({ preset: 'LAST_7_DAYS' }), at('2026-10-07T04:00:00Z'));
    expect(seven.current).toMatchObject({ from: '2026-10-01', to: '2026-10-07' });
    expect(seven.previous).toMatchObject({ from: '2026-09-24', to: '2026-09-30' });
    const thirty = resolvePerformanceWindow(productQuery({ preset: 'LAST_30_DAYS' }), at('2026-10-07T04:00:00Z'));
    expect(thirty.current).toMatchObject({ from: '2026-09-08', to: '2026-10-07' });
    expect(thirty.previous).toMatchObject({ from: '2026-08-09', to: '2026-09-07' });
  });

  it('resolves last week against the week before it', () => {
    const window = resolvePerformanceWindow(productQuery({ preset: 'LAST_WEEK' }), at('2026-10-07T04:00:00Z'));
    expect(window.current).toMatchObject({ from: '2026-09-28', to: '2026-10-04' });
    expect(window.previous).toMatchObject({ from: '2026-09-21', to: '2026-09-27' });
  });

  it('resolves custom ranges across year and leap boundaries with an equal-length comparison', () => {
    const year = resolvePerformanceWindow(productQuery({ preset: 'CUSTOM', from: '2025-12-30', to: '2026-01-02' }), at('2026-10-07T04:00:00Z'));
    expect(year.current).toMatchObject({ from: '2025-12-30', to: '2026-01-02' });
    expect(year.previous).toMatchObject({ from: '2025-12-26', to: '2025-12-29' });
    const leap = resolvePerformanceWindow(productQuery({ preset: 'CUSTOM', from: '2028-02-27', to: '2028-03-01' }), at('2028-03-05T04:00:00Z'));
    expect(leap.current).toMatchObject({ from: '2028-02-27', to: '2028-03-01' });
    expect(leap.previous).toMatchObject({ from: '2028-02-23', to: '2028-02-26' });
  });

  it('omits the comparison when compare is disabled', () => {
    const window = resolvePerformanceWindow(productQuery({ preset: 'LAST_7_DAYS', compare: '0' }), at('2026-10-07T04:00:00Z'));
    expect(window.previous).toBeNull();
  });

  it('switches the Manila business day at 16:00 UTC', () => {
    const before = resolvePerformanceWindow(productQuery({ preset: 'THIS_WEEK' }), at('2026-10-07T15:59:59Z'));
    expect(before.current).toMatchObject({ from: '2026-10-05', to: '2026-10-07' });
    const after = resolvePerformanceWindow(productQuery({ preset: 'THIS_WEEK' }), at('2026-10-07T16:00:00Z'));
    expect(after.current).toMatchObject({ from: '2026-10-05', to: '2026-10-08' });
    expect(after.previous).toMatchObject({ from: '2026-09-28', to: '2026-10-01' });
  });

  it('treats Monday as the start of the week', () => {
    const window = resolvePerformanceWindow(productQuery({ preset: 'THIS_WEEK' }), at('2026-10-05T02:00:00Z'));
    expect(window.current).toMatchObject({ from: '2026-10-05', to: '2026-10-05' });
    expect(window.previous).toMatchObject({ from: '2026-09-28', to: '2026-09-28' });
  });
});

describe('performance trend buckets', () => {
  it('builds daily buckets that mark today', () => {
    expect(buildPerformanceBuckets({ from: '2026-10-05', to: '2026-10-07' }, 'DAY', at('2026-10-07T04:00:00Z'))).toEqual([
      { key: '2026-10-05', from: '2026-10-05', to: '2026-10-05', partialWeek: false, includesToday: false },
      { key: '2026-10-06', from: '2026-10-06', to: '2026-10-06', partialWeek: false, includesToday: false },
      { key: '2026-10-07', from: '2026-10-07', to: '2026-10-07', partialWeek: false, includesToday: true },
    ]);
  });

  it('builds Monday-keyed weekly buckets clipped to the requested range', () => {
    expect(buildPerformanceBuckets({ from: '2026-09-30', to: '2026-10-07' }, 'WEEK', at('2026-10-07T04:00:00Z'))).toEqual([
      { key: '2026-09-28', from: '2026-09-30', to: '2026-10-04', partialWeek: true, includesToday: false },
      { key: '2026-10-05', from: '2026-10-05', to: '2026-10-07', partialWeek: true, includesToday: true },
    ]);
  });

  it('marks a full Monday-to-Sunday week as complete', () => {
    expect(buildPerformanceBuckets({ from: '2026-09-28', to: '2026-10-04' }, 'WEEK', at('2026-10-07T04:00:00Z'))).toEqual([
      { key: '2026-09-28', from: '2026-09-28', to: '2026-10-04', partialWeek: false, includesToday: false },
    ]);
  });
});
