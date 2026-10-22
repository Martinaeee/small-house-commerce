import { describe, expect, it } from 'vitest';
import { manilaDayEndExclusive, manilaDayStart } from './manila-day.js';

describe('manilaDayStart', () => {
  it('is the UTC instant of 00:00 on that Manila day', () => {
    expect(manilaDayStart('2026-09-15').toISOString()).toBe('2026-09-14T16:00:00.000Z');
  });
});

describe('manilaDayEndExclusive', () => {
  it('is the next Manila midnight, so the day is a half-open interval', () => {
    expect(manilaDayEndExclusive('2026-09-15').toISOString()).toBe('2026-09-15T16:00:00.000Z');
  });

  it('rolls over month and year boundaries', () => {
    expect(manilaDayEndExclusive('2026-09-30').toISOString()).toBe('2026-09-30T16:00:00.000Z');
    expect(manilaDayEndExclusive('2026-12-31').toISOString()).toBe('2026-12-31T16:00:00.000Z');
  });
});
