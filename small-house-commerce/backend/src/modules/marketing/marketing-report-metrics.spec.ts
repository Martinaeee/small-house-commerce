import { describe, expect, it } from 'vitest';
import { Prisma } from '../../generated/prisma/client.js';
import { performanceChange, serializeMarketingReportRow, serializeMarketingTotals, type MarketingReportRawRow } from './marketing-report-metrics.js';

const OWNER = '11111111-1111-4111-a111-111111111111';
const LINK = '33333333-3333-4333-a333-333333333333';
const raw: MarketingReportRawRow = {
  kind: 'REGISTERED', id: LINK, label: 'Ad A', ownerUserId: OWNER, ownerName: 'Optimizer', aid: 'OP-1',
  productId: 'product-1', productName: 'Chair', productCode: 'LUW-001', landingPageId: 'page-1',
  sourceType: 'META_AD',
  visits: 2n, pageTotalVisits: 5n,
  addToCarts: 0n, checkouts: 0n,
  submittedOrders: 2n, validOrders: 2n, confirmedOrders: 1n, signedOrders: 1n,
  validOrderValuePhp: new Prisma.Decimal('10000'), signedGrossPhp: new Prisma.Decimal('10000'),
  spendUsd: new Prisma.Decimal('50'), spendPhp: new Prisma.Decimal('2865'),
  expectedCostDays: 1n, recordedCostDays: 1n,
  duplicateOrders: 0n, riskOrders: 0n, afterSalesOrders: 0n, refundStatusOrders: 0n,
};
const totalsKeys = ['visits', 'pageTotalVisits', 'submittedOrders', 'validOrders', 'confirmedOrders', 'signedOrders', 'duplicateOrders', 'riskOrders', 'afterSalesOrders', 'refundStatusOrders', 'validOrderValuePhp', 'signedGrossPhp', 'spendUsd', 'spendPhp', 'expectedCostDays', 'recordedCostDays', 'costCoverageComplete', 'orderCpaUsd', 'signedCpaUsd', 'orderRoas', 'signedRoas', 'conversionRate', 'periodBasis'];

describe('shared marketing report metrics', () => {
  it('computes period changes with Decimal precision and explicit new or unavailable states', () => {
    expect(performanceChange('10.00', '0.00', 2)).toEqual({ state: 'NEW', absolute: '10.00', percent: null });
    expect(performanceChange(0, 0, 0)).toEqual({ state: 'UNCHANGED', absolute: '0', percent: null });
    expect(performanceChange('3.00', '2.00', 2)).toEqual({ state: 'COMPARABLE', absolute: '1.00', percent: '50.00' });
    expect(performanceChange(null, '2.00', 2)).toEqual({ state: 'UNAVAILABLE', absolute: null, percent: null });
  });

  it('keeps an omitted aggregate page total unavailable instead of serializing NaN', () => {
    const row = { ...raw, pageTotalVisits: undefined };
    const serialized = serializeMarketingReportRow(row);
    expect(serialized.pageTotalVisits).toBeNull();
    expect(Number.isNaN(serialized.pageTotalVisits)).toBe(false);
    expect(serializeMarketingTotals(row).pageTotalVisits).toBeNull();
  });

  it.each([
    [null, null],
    [0n, 0],
  ] as const)('preserves page total %s as %s in rows and totals', (pageTotalVisits, expected) => {
    const row = { ...raw, pageTotalVisits };
    expect(serializeMarketingReportRow(row).pageTotalVisits).toBe(expected);
    expect(serializeMarketingTotals(row).pageTotalVisits).toBe(expected);
  });

  it('keeps the full report projection with its metadata', () => {
    expect(serializeMarketingReportRow(raw)).toMatchObject({ kind: 'REGISTERED', id: LINK, label: 'Ad A', ownerName: 'Optimizer', productName: 'Chair', productCode: 'LUW-001', landingPageId: 'page-1', visits: 2, pageTotalVisits: 5, orderCpaUsd: '25.00', orderRoas: '3.49' });
  });

  it('projects shared totals without catalog or customer metadata', () => {
    const totals = serializeMarketingTotals(raw);
    expect(Object.keys(totals).sort()).toEqual([...totalsKeys].sort());
    expect(totals).toMatchObject({ visits: 2, pageTotalVisits: 5, orderCpaUsd: '25.00', signedCpaUsd: '50.00', orderRoas: '3.49', signedRoas: '3.49', conversionRate: '1.0000', costCoverageComplete: true, periodBasis: 'TOUCH' });
    for (const key of ['id', 'label', 'ownerUserId', 'ownerName', 'aid', 'productName', 'landingPageId']) expect(totals).not.toHaveProperty(key);
  });

  it('keeps unverifiable history on the order-created basis with unknown visits', () => {
    const totals = serializeMarketingTotals({ ...raw, kind: 'UNVERIFIED' });
    expect(totals).toMatchObject({ visits: null, periodBasis: 'ORDER_CREATED', conversionRate: null });
  });

  it('exposes funnel event counts and the product thumbnail', () => {
    const row = serializeMarketingReportRow({ ...raw, addToCarts: 3n, checkouts: 1n }, '/uploads/chair.jpg');
    expect(row).toMatchObject({ addToCarts: 3, checkouts: 1, sourceType: 'META_AD', productThumbnailUrl: '/uploads/chair.jpg' });
    expect(serializeMarketingReportRow(raw)).toMatchObject({ addToCarts: 0, checkouts: 0, productThumbnailUrl: null });
  });

  it('serializes performance-side rows that predate the funnel columns without NaN', () => {
    const legacy = { ...raw, addToCarts: undefined, checkouts: undefined, sourceType: undefined } as unknown as MarketingReportRawRow;
    expect(serializeMarketingReportRow(legacy)).toMatchObject({ addToCarts: 0, checkouts: 0, sourceType: null });
  });
});
