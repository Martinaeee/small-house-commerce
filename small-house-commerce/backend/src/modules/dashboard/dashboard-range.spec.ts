import { describe, expect, it } from 'vitest';
import { manilaDay, resolveWindow } from './dashboard-range.js';

const NOW = new Date('2026-10-21T02:00:00.000Z'); // 10:00 Manila, 2026-10-21

describe('manilaDay', () => {
  it('uses the Manila calendar day, not UTC', () => {
    expect(manilaDay(new Date('2026-10-21T15:30:00.000Z'))).toBe('2026-10-21');
    expect(manilaDay(new Date('2026-10-21T16:30:00.000Z'))).toBe('2026-10-22');
  });
});

describe('resolveWindow', () => {
  it('covers exactly today', () => {
    const window = resolveWindow('TODAY', undefined, undefined, NOW);
    expect(window.fromDate).toBe('2026-10-21');
    expect(window.toDate).toBe('2026-10-21');
    expect(window.days).toBe(1);
    expect(window.start.toISOString()).toBe('2026-10-20T16:00:00.000Z');
    expect(window.end.toISOString()).toBe('2026-10-21T16:00:00.000Z');
  });

  it('covers yesterday', () => {
    const window = resolveWindow('YESTERDAY', undefined, undefined, NOW);
    expect(window.fromDate).toBe('2026-10-20');
    expect(window.toDate).toBe('2026-10-20');
  });

  it('includes today in the last 7 days', () => {
    const window = resolveWindow('LAST_7_DAYS', undefined, undefined, NOW);
    expect(window.fromDate).toBe('2026-10-15');
    expect(window.toDate).toBe('2026-10-21');
    expect(window.days).toBe(7);
  });

  it('includes today in the last 30 days', () => {
    const window = resolveWindow('LAST_30_DAYS', undefined, undefined, NOW);
    expect(window.fromDate).toBe('2026-09-22');
    expect(window.days).toBe(30);
  });

  it('starts this month on the first and ends today', () => {
    const window = resolveWindow('THIS_MONTH', undefined, undefined, NOW);
    expect(window.fromDate).toBe('2026-10-01');
    expect(window.toDate).toBe('2026-10-21');
  });

  it('covers the whole previous month', () => {
    const window = resolveWindow('LAST_MONTH', undefined, undefined, NOW);
    expect(window.fromDate).toBe('2026-09-01');
    expect(window.toDate).toBe('2026-09-30');
  });

  it('places the previous window immediately before this one', () => {
    const window = resolveWindow('LAST_7_DAYS', undefined, undefined, NOW);
    expect(window.previousEnd.toISOString()).toBe(window.start.toISOString());
    // 2026-10-08 00:00 Manila == 2026-10-07T16:00Z.
    expect(window.previousStart.toISOString()).toBe('2026-10-07T16:00:00.000Z');
  });

  it('labels the previous period with its Manila days, not the UTC date', () => {
    const window = resolveWindow('LAST_7_DAYS', undefined, undefined, NOW);
    expect(window.previousFromDate).toBe('2026-10-08');
    expect(window.previousToDate).toBe('2026-10-14');
  });

  it('accepts a valid custom range', () => {
    const window = resolveWindow('CUSTOM', '2026-10-01', '2026-10-10', NOW);
    expect(window.days).toBe(10);
  });

  it('rejects a custom range without both dates', () => {
    expect(() => resolveWindow('CUSTOM', '2026-10-01', undefined, NOW)).toThrow(/both from and to/);
  });

  it('rejects an inverted custom range', () => {
    expect(() => resolveWindow('CUSTOM', '2026-10-10', '2026-10-01', NOW)).toThrow(/on or before/);
  });

  it('rejects a future custom range', () => {
    expect(() => resolveWindow('CUSTOM', '2026-10-01', '2026-10-30', NOW)).toThrow(/future/);
  });
});
