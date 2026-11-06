import { describe, it, expect } from 'vitest';
import {
  marketingFunnelQuerySchema,
  marketingFunnelSessionsQuerySchema,
} from './marketing-funnel.dto.js';

describe('funnel query', () => {
  it('bounds ranges and defaults sorting', () => {
    expect(
      marketingFunnelQuerySchema.parse({
        from: '2026-11-01',
        to: '2026-11-06',
      }),
    ).toMatchObject({ traffic: 'ALL', sort: 'ORDER_COUNT', page: 1 });
    expect(
      marketingFunnelQuerySchema.safeParse({
        from: '2026-11-06',
        to: '2026-11-01',
      }).success,
    ).toBe(false);
    expect(
      marketingFunnelQuerySchema.safeParse({
        from: '2025-01-01',
        to: '2026-11-01',
      }).success,
    ).toBe(false);
  });
  it('rejects malformed cursors and unknown reasons', () => {
    expect(
      marketingFunnelSessionsQuerySchema.safeParse({
        productId: '11111111-1111-4111-8111-111111111111',
        from: '2026-11-01',
        to: '2026-11-06',
        reason: 'TIMEOUT',
      }).success,
    ).toBe(false);
  });
});
