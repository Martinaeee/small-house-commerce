import { describe, expect, it } from 'vitest';
import { marketingReportQuerySchema } from './marketing-report.dto.js';

describe('marketing report query schema', () => {
  it('defaults to flat order by name ascending', () => {
    expect(marketingReportQuerySchema.parse({})).toMatchObject({ mode: 'FLAT', sortBy: 'NAME', sortDirection: 'ASC' });
  });

  it('accepts every documented combination', () => {
    const parsed = marketingReportQuerySchema.parse({ mode: 'TREE', sortBy: 'ADD_TO_CARTS', sortDirection: 'DESC' });
    expect(parsed).toMatchObject({ mode: 'TREE', sortBy: 'ADD_TO_CARTS', sortDirection: 'DESC' });
  });

  it('rejects unknown modes, sorts and directions', () => {
    for (const input of [
      { mode: 'TREE_FLAT' }, { mode: 5 },
      { sortBy: 'CLICKS' }, { sortDirection: 'desc' },
    ]) {
      expect(marketingReportQuerySchema.safeParse(input).success).toBe(false);
    }
  });
});
