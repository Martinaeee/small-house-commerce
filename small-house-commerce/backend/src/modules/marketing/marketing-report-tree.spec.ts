import { describe, expect, it } from 'vitest';
import { Prisma } from '../../generated/prisma/client.js';
import { buildMarketingReportTree, type MarketingReportVisitRow } from './marketing-report-tree.js';
import type { MarketingReportRawRow } from './marketing-report-metrics.js';

const P1 = '11111111-1111-4111-a111-111111111111';
const P2 = '22222222-2222-4222-a222-222222222222';
const link = (overrides: Partial<MarketingReportRawRow> & { id: string; sourceType: string; productId: string }): MarketingReportRawRow => ({
  kind: 'REGISTERED', label: overrides.id, ownerUserId: null, ownerName: null, aid: null,
  productName: overrides.productId === P1 ? 'Chair' : 'Table', productCode: 'LUW-1', landingPageId: null,
  visits: 2n, pageTotalVisits: null, addToCarts: 1n, checkouts: 0n,
  submittedOrders: 1n, validOrders: 1n, confirmedOrders: 0n, signedOrders: 0n,
  duplicateOrders: 0n, riskOrders: 0n, afterSalesOrders: 0n, refundStatusOrders: 0n,
  validOrderValuePhp: new Prisma.Decimal('1000'), signedGrossPhp: new Prisma.Decimal('0'),
  spendUsd: new Prisma.Decimal('10'), spendPhp: new Prisma.Decimal('570'),
  expectedCostDays: 1n, recordedCostDays: 1n,
  ...overrides,
});

describe('marketing report tree', () => {
  const rows = [
    link({ id: 'l-meta', productId: P1, sourceType: 'META_AD', visits: 3n, addToCarts: 2n, validOrders: 2n, signedOrders: 1n, signedGrossPhp: new Prisma.Decimal('500'), expectedCostDays: 2n, recordedCostDays: 1n }),
    link({ id: 'l-post', productId: P1, sourceType: 'FB_POST', visits: 4n, addToCarts: 1n, validOrders: 1n, spendUsd: new Prisma.Decimal('5'), spendPhp: new Prisma.Decimal('285') }),
    link({ id: 'l-table', productId: P2, sourceType: 'META_AD', visits: 1n, addToCarts: 0n, validOrders: 0n, productName: 'Table', validOrderValuePhp: new Prisma.Decimal('0'), spendUsd: new Prisma.Decimal('0'), spendPhp: new Prisma.Decimal('0') }),
  ];
  // 7 summed link visits collapse to 6 distinct sessions for the product.
  const visitRows: MarketingReportVisitRow[] = [
    { product: P1, source: null, visits: 6n },
    { product: P1, source: 'META_AD', visits: 3n },
    { product: P1, source: 'FB_POST', visits: 4n },
    { product: P2, source: null, visits: 1n },
  ];

  it('sums orders, money, spend and funnel events but dedupes visits', () => {
    const tree = buildMarketingReportTree(rows, visitRows, new Map([[P1, '/uploads/chair.jpg']]), 'NAME', 'ASC');
    expect(tree).toHaveLength(2);
    expect(tree[0].product).toEqual({ id: P1, name: 'Chair', productCode: 'LUW-1', thumbnailUrl: '/uploads/chair.jpg' });
    expect(tree[0].totals).toMatchObject({
      visits: 6, submittedOrders: 2, validOrders: 3, signedOrders: 1,
      addToCarts: 3, checkouts: 0, spendUsd: '15.00', expectedCostDays: 3, recordedCostDays: 2, costCoverageComplete: false,
    });
    expect(tree[0].totals.signedGrossPhp).toBe('500.00');
    // conversion uses the deduped visit count, not the summed link visits (7)
    expect(tree[0].totals.conversionRate).toBe('0.5000');
  });

  it('keeps source-level totals with their own deduped visits', () => {
    const tree = buildMarketingReportTree(rows, visitRows, new Map(), 'NAME', 'ASC');
    const chair = tree[0].sources;
    expect(chair.map(s => s.sourceType)).toEqual(['FB_POST', 'META_AD']); // tie on NAME → source type order
    const meta = chair.find(s => s.sourceType === 'META_AD')!;
    expect(meta.totals).toMatchObject({ visits: 3, validOrders: 2, signedOrders: 1, spendUsd: '10.00', expectedCostDays: 2, recordedCostDays: 1 });
    expect(meta.links.map(l => l.id)).toEqual(['l-meta']);
  });

  it('sorts links inside each source by the requested metric', () => {
    const links = [
      link({ id: 'm1', productId: P1, sourceType: 'META_AD', validOrders: 1n }),
      link({ id: 'm2', productId: P1, sourceType: 'META_AD', validOrders: 5n }),
    ].concat([rows[2]]);
    const shared = [
      { product: P1, source: null, visits: 9n } satisfies MarketingReportVisitRow,
      { product: P1, source: 'META_AD', visits: 9n } satisfies MarketingReportVisitRow,
      { product: P2, source: null, visits: 1n } satisfies MarketingReportVisitRow,
    ];
    const tree = buildMarketingReportTree(links, shared, new Map(), 'VALID', 'DESC');
    const meta = tree[0].sources.find(s => s.sourceType === 'META_AD')!;
    expect(meta.links.map(l => l.id)).toEqual(['m2', 'm1']);
  });

  it('sorts products by the requested metric, not just alphabetically', () => {
    const sorted = buildMarketingReportTree(rows, visitRows, new Map(), 'ADD_TO_CARTS', 'DESC');
    expect(sorted.map(node => node.product.id)).toEqual([P1, P2]);
  });

  it('treats unknown source types as OTHER without throwing', () => {
    const odd = [link({ id: 'l-x', productId: P2, sourceType: 'OTHER', productName: 'Table' })];
    const tree = buildMarketingReportTree(odd, [{ product: P2, source: null, visits: 1n }, { product: P2, source: 'OTHER', visits: 1n }], new Map(), 'NAME', 'ASC');
    expect(tree[0].sources[0].sourceType).toBe('OTHER');
    expect(tree[0].sources[0].totals.visits).toBe(1);
  });

  it('returns an empty tree for an empty scope', () => {
    expect(buildMarketingReportTree([], [], new Map(), 'NAME', 'ASC')).toEqual([]);
  });
});
