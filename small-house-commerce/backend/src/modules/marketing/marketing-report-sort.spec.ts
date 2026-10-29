import { describe, expect, it } from 'vitest';
import { compareMarketingReportRows, marketingReportSortValue, sortMarketingReportRows, type SortableReportRow } from './marketing-report-sort.js';

const row = (overrides: Partial<SortableReportRow> = {}): SortableReportRow => ({
  id: 'id', label: 'A', ownerName: 'Opt', productName: 'Chair', visits: 1,
  addToCarts: 0, checkouts: 0, submittedOrders: 0, validOrders: 0, confirmedOrders: 0, signedOrders: 0,
  validOrderValuePhp: '0.00', signedGrossPhp: '0.00', spendUsd: '0.00', spendPhp: '0.00',
  orderCpaUsd: null, signedCpaUsd: null, orderRoas: null, signedRoas: null, conversionRate: null, ...overrides,
});

describe('marketing report sorting', () => {
  it('maps every sort value to its field', () => {
    expect(marketingReportSortValue(row({ validOrders: 3 }), 'VALID')).toBe(3);
    expect(marketingReportSortValue(row({ validOrderValuePhp: '12.00' }), 'VALID_VALUE')).toBe(12);
    expect(marketingReportSortValue(row({ spendPhp: '57.30' }), 'SPEND_PHP')).toBe(57.3);
    expect(marketingReportSortValue(row({ label: 'Ad B' }), 'NAME')).toBe('Ad B');
    expect(marketingReportSortValue(row({ ownerName: null }), 'OWNER')).toBeNull();
  });

  it('sorts numerics ascending and descending', () => {
    const rows = [row({ id: 'b', validOrders: 2 }), row({ id: 'a', validOrders: 1 }), row({ id: 'c', validOrders: 3 })];
    expect(sortMarketingReportRows(rows, 'VALID', 'ASC').map(r => r.id)).toEqual(['a', 'b', 'c']);
    expect(sortMarketingReportRows(rows, 'VALID', 'DESC').map(r => r.id)).toEqual(['c', 'b', 'a']);
  });

  it('always puts nulls last regardless of direction', () => {
    const rows = [row({ id: 'x', orderCpaUsd: null }), row({ id: 'y', orderCpaUsd: '2.00' })];
    expect(sortMarketingReportRows(rows, 'ORDER_CPA', 'ASC').map(r => r.id)).toEqual(['y', 'x']);
    expect(sortMarketingReportRows(rows, 'ORDER_CPA', 'DESC').map(r => r.id)).toEqual(['y', 'x']);
  });

  it('breaks ties by id ascending in both directions so pagination stays stable', () => {
    const rows = [row({ id: 'b', validOrders: 1 }), row({ id: 'a', validOrders: 1 })];
    for (const direction of ['ASC', 'DESC'] as const) {
      expect(sortMarketingReportRows(rows, 'VALID', direction).map(r => r.id)).toEqual(['a', 'b']);
    }
    expect(compareMarketingReportRows(row({ id: 'b' }), row({ id: 'a' }), 'NAME', 'ASC')).toBeGreaterThan(0);
  });

  it('sorts text with the zh locale and ignores case', () => {
    const rows = [row({ id: '1', label: 'beta Ad' }), row({ id: '2', label: 'Alpha Ad' })];
    expect(sortMarketingReportRows(rows, 'NAME', 'ASC').map(r => r.id)).toEqual(['2', '1']);
  });

  it('never mutates the input array', () => {
    const rows = [row({ id: 'b', validOrders: 2 }), row({ id: 'a', validOrders: 1 })];
    sortMarketingReportRows(rows, 'VALID', 'ASC');
    expect(rows.map(r => r.id)).toEqual(['b', 'a']);
  });
});
