import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { marketingPerformanceOptionsQuerySchema, marketingPerformanceQuerySchema } from './marketing-performance.dto.js';

const product = { view: 'PRODUCT', productId: '11111111-1111-4111-a111-111111111111' } as const;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-13T01:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('marketing performance query schema', () => {
  it('applies defaults and converts compare to a boolean', () => {
    expect(marketingPerformanceQuerySchema.parse(product)).toMatchObject({ view: 'PRODUCT', preset: 'LAST_7_DAYS', interval: 'DAY', compare: true, sortBy: 'name', sortDirection: 'asc', page: 1, pageSize: 20 });
    expect(marketingPerformanceQuerySchema.parse({ ...product, compare: '0' }).compare).toBe(false);
    const optimizer = marketingPerformanceQuerySchema.parse({ view: 'OPTIMIZER' });
    expect(optimizer).toMatchObject({ view: 'OPTIMIZER', preset: 'LAST_7_DAYS' });
    expect(optimizer.ownerUserId).toBeUndefined();
  });

  it('requires a product for the product view and explicit dates only for the custom preset', () => {
    expect(marketingPerformanceQuerySchema.safeParse({ view: 'PRODUCT' }).success).toBe(false);
    expect(marketingPerformanceQuerySchema.parse({ ...product, preset: 'CUSTOM', from: '2026-10-05', to: '2026-10-07' })).toMatchObject({ from: '2026-10-05', to: '2026-10-07' });
    expect(marketingPerformanceQuerySchema.safeParse({ ...product, preset: 'CUSTOM', from: '2026-10-05' }).success).toBe(false);
    expect(marketingPerformanceQuerySchema.safeParse({ ...product, preset: 'THIS_WEEK', from: '2026-10-05', to: '2026-10-07' }).success).toBe(false);
  });

  it('rejects invalid, inverted and future custom dates', () => {
    for (const input of [
      { ...product, preset: 'CUSTOM', from: '2026-02-30', to: '2026-03-01' },
      { ...product, preset: 'CUSTOM', from: '2023-02-29', to: '2023-03-01' },
      { ...product, preset: 'CUSTOM', from: '2026-10-12', to: '2026-10-11' },
      { ...product, preset: 'CUSTOM', from: '2026-10-01', to: '2026-10-14' },
    ]) expect(marketingPerformanceQuerySchema.safeParse(input).success).toBe(false);
    expect(marketingPerformanceQuerySchema.safeParse({ ...product, preset: 'CUSTOM', from: '2024-02-29', to: '2024-02-29' }).success).toBe(true);
  });

  it('rejects malformed ids, enums, paging and unknown fields', () => {
    for (const input of [
      { ...product, productId: 'not-a-uuid' },
      { ...product, ownerUserId: 'not-a-uuid' },
      { ...product, trendPageId: 'not-a-uuid' },
      { ...product, compare: 'yes' },
      { ...product, sortBy: 'profit' },
      { ...product, sortDirection: 'sideways' },
      { ...product, interval: 'MONTH' },
      { ...product, effectiveStatus: 'PAUSED' },
      { ...product, page: '0' },
      { ...product, pageSize: '101' },
      { ...product, unexpected: '1' },
      { view: 'CHANNEL' },
    ]) expect(marketingPerformanceQuerySchema.safeParse(input).success).toBe(false);
  });

  it('keeps the options query narrow', () => {
    expect(marketingPerformanceOptionsQuerySchema.parse({})).toEqual({});
    expect(marketingPerformanceOptionsQuerySchema.parse({ ownerUserId: '11111111-1111-4111-a111-111111111111' })).toMatchObject({ ownerUserId: '11111111-1111-4111-a111-111111111111' });
    expect(marketingPerformanceOptionsQuerySchema.safeParse({ ownerUserId: 'nope' }).success).toBe(false);
    expect(marketingPerformanceOptionsQuerySchema.safeParse({ view: 'PRODUCT' }).success).toBe(false);
  });
});
