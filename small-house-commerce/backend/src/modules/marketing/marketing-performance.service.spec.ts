import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '../../generated/prisma/client.js';
import { marketingPerformanceQuerySchema, type MarketingPerformanceQuery } from './dto/marketing-performance.dto.js';
import { resolvePerformanceWindow } from './marketing-performance-period.js';
import { assemblePerformanceReport, MarketingPerformanceService, type PerformanceAssemblyInput } from './marketing-performance.service.js';
import type { PerformanceAggregateRow, PerformancePageInfo } from './marketing-performance.types.js';
import type { MarketingReportRawRow } from './marketing-report-metrics.js';

const OWNER = '11111111-1111-4111-a111-111111111111';
const OTHER = '22222222-2222-4222-a222-222222222222';
const PRODUCT = '33333333-3333-4333-a333-333333333333';
const NOW = new Date('2026-10-13T01:00:00Z');

const query = (extra: Record<string, unknown> = {}) => marketingPerformanceQuerySchema.parse({ view: 'PRODUCT', productId: PRODUCT, preset: 'CUSTOM', from: '2026-10-05', to: '2026-10-07', ...extra });

const aggregate = (id: string, overrides: Record<string, unknown> = {}): PerformanceAggregateRow => ({
  kind: 'REGISTERED', id, label: id, ownerUserId: null, ownerName: null, aid: null, productId: null, productName: null, productCode: null, landingPageId: null,
  visits: 1n, pageTotalVisits: null,
  submittedOrders: 0n, validOrders: 0n, confirmedOrders: 0n, signedOrders: 0n, duplicateOrders: 0n, riskOrders: 0n, afterSalesOrders: 0n, refundStatusOrders: 0n,
  validOrderValuePhp: new Prisma.Decimal(0), signedGrossPhp: new Prisma.Decimal(0), spendUsd: new Prisma.Decimal(0), spendPhp: new Prisma.Decimal(0),
  expectedCostDays: 0n, recordedCostDays: 0n, registeredLinkCount: 1n,
  ...overrides,
} as PerformanceAggregateRow);

const pageInfo = (id: string, name: string, overrides: Partial<PerformancePageInfo> = {}): PerformancePageInfo => ({
  id, name, slug: id, productId: PRODUCT, productName: 'Chair', productCode: 'LUW-001', productStatus: 'ACTIVE',
  ownerUserId: OWNER, ownerName: 'Owner', aid: 'OP-1', effectiveStatus: 'LIVE', linkCount: 1, createdAt: '2026-10-01T00:00:00.000Z',
  ...overrides,
});

function input(overrides: Partial<PerformanceAssemblyInput> = {}): PerformanceAssemblyInput {
  const parsed: MarketingPerformanceQuery = overrides.query ?? query();
  const base: PerformanceAssemblyInput = {
    query: parsed,
    window: resolvePerformanceWindow(parsed, NOW),
    onlyOwn: false,
    scopeOwnerUserId: null,
    directory: [],
    currentPages: [],
    currentTotal: null,
    trendRows: [],
    currentPageVisits: [],
    totalPageVisits: 0n,
    trendPageVisits: [],
    previousPages: [],
    previousTotal: null,
    previousPageVisits: [],
    previousTotalPageVisits: 0n,
    currentOther: [],
    previousOther: null,
    now: NOW,
  };
  return { ...base, ...overrides };
}

describe('performance report assembly', () => {
  it('paginates rows without changing the all-filter summary, overview, or trend', () => {
    const report = assemblePerformanceReport(input({
      query: query({ pageSize: '2' }),
      directory: [pageInfo('page-a', 'Alpha page'), pageInfo('page-b', 'Bravo page'), pageInfo('page-c', 'Charlie page')],
      currentPages: [aggregate('page-a', { visits: 2n }), aggregate('page-b', { visits: 1n })],
      currentTotal: aggregate('ALL', { visits: 3n, registeredLinkCount: 3n }),
      currentPageVisits: [{ id: 'page-a', visits: 4n }],
      totalPageVisits: 6n,
      trendRows: [aggregate('2026-10-05', { visits: 3n })],
    }));
    expect(report.total).toBe(3);
    expect(report.rows.map(row => row.id)).toEqual(['page-a', 'page-b']);
    expect(report.current).toMatchObject({ registeredLinkCount: 3, totals: { visits: 3, pageTotalVisits: 6 } });
    expect(report.overview.total).toBe(3);
    expect(report.trend.points.map(point => point.totals?.visits ?? null)).toEqual([3, null, null]);
    expect(report.rows[0].pageTotalVisits).toBe(4);
    expect(report.rows[1].pageTotalVisits).toBe(0);
  });

  it('sorts by metric with unknown values last and a stable id tie-break', () => {
    const directory = [pageInfo('page-a', 'Alpha page'), pageInfo('page-b', 'Bravo page'), pageInfo('page-c', 'Charlie page'), pageInfo('page-d', 'Delta draft', { linkCount: 0 })];
    const build = (sortDirection: 'asc' | 'desc') => assemblePerformanceReport(input({
      query: query({ sortBy: 'visits', sortDirection, pageSize: '100' }),
      directory,
      currentPages: [aggregate('page-a', { visits: 2n }), aggregate('page-b', { visits: 0n }), aggregate('page-c', { visits: 2n })],
    }));
    expect(build('asc').rows.map(row => row.id)).toEqual(['page-b', 'page-a', 'page-c', 'page-d']);
    expect(build('desc').rows.map(row => row.id)).toEqual(['page-a', 'page-c', 'page-b', 'page-d']);
  });

  it('labels no links, late links, zero traffic, incomplete costs, and inactive parents distinctly', () => {
    const report = assemblePerformanceReport(input({
      query: query({ pageSize: '100' }),
      directory: [
        pageInfo('page-nolink', 'No link', { linkCount: 0 }),
        pageInfo('page-late', 'Late link'),
        pageInfo('page-zero', 'Zero traffic'),
        pageInfo('page-partial', 'Partial costs'),
        pageInfo('page-inactive', 'Inactive parent', { productStatus: 'DISABLED' }),
      ],
      currentPages: [
        aggregate('page-zero', { visits: 0n }),
        aggregate('page-partial', { expectedCostDays: 3n, recordedCostDays: 1n }),
        aggregate('page-inactive'),
      ],
      currentPageVisits: [{ id: 'page-nolink', visits: 5n }],
    }));
    const byId = new Map(report.rows.map(row => [row.id, row]));
    expect(byId.get('page-nolink')).toMatchObject({ notices: ['NO_LINKS'], pageTotalVisits: 5 });
    expect(byId.get('page-late')).toMatchObject({ notices: ['NOT_STARTED'], current: { registeredLinkCount: 0, totals: null } });
    expect(byId.get('page-zero')).toMatchObject({ notices: ['NO_TRAFFIC'] });
    expect(byId.get('page-partial')?.notices).toContain('COSTS_INCOMPLETE');
    expect(byId.get('page-inactive')?.notices).toContain('PARENT_INACTIVE');
  });

  it('marks new counters and withholds changes when a period cannot compare', () => {
    const report = assemblePerformanceReport(input({
      directory: [pageInfo('page-a', 'Alpha page')],
      currentPages: [aggregate('page-a', { visits: 2n })],
      currentTotal: aggregate('ALL', { visits: 2n, expectedCostDays: 3n, recordedCostDays: 1n, spendUsd: new Prisma.Decimal('10.00'), spendPhp: new Prisma.Decimal('573.00') }),
      previousPages: [aggregate('page-a', { visits: 0n })],
      previousTotal: aggregate('ALL', { visits: 0n, expectedCostDays: 3n, recordedCostDays: 3n }),
    }));
    expect(report.changes).toMatchObject({
      visits: { state: 'NEW', absolute: '2', percent: null },
      spendUsd: { state: 'UNAVAILABLE', absolute: null, percent: null },
      validOrders: { state: 'UNCHANGED', absolute: '0', percent: null },
    });
    expect(report.rows[0].changes).toMatchObject({ visits: { state: 'NEW', absolute: '2' } });
    expect(report.rows[0].previous).toMatchObject({ registeredLinkCount: 1, totals: { visits: 0 } });
  });

  it('omits comparison data when compare is disabled', () => {
    const report = assemblePerformanceReport(input({ query: query({ compare: '0' }) }));
    expect(report.previous).toBeNull();
    expect(report.changes).toBeNull();
    expect(report.rows).toEqual([]);
  });

  it('summarizes other sources without touching registered totals', () => {
    const direct: MarketingReportRawRow = aggregate('DIRECT', { kind: 'DIRECT', visits: null, validOrderValuePhp: new Prisma.Decimal('99999.00') }) as unknown as MarketingReportRawRow;
    const report = assemblePerformanceReport(input({
      currentTotal: aggregate('ALL', { visits: 3n }),
      currentOther: [direct],
      previousOther: [direct],
    }));
    expect(report.current.totals).toMatchObject({ visits: 3 });
    expect(report.otherSources.current).toEqual([{ kind: 'DIRECT', totals: expect.objectContaining({ visits: null, validOrderValuePhp: '99999.00', orderRoas: null, periodBasis: 'TOUCH' }) }]);
    expect(report.otherSources.previous).toHaveLength(1);
  });
});

describe('performance access guards', () => {
  const prisma = { $transaction: vi.fn(), productLandingPage: { findMany: vi.fn() }, optimizerProfile: { findMany: vi.fn() }, user: { findMany: vi.fn() } };
  const service = new MarketingPerformanceService(prisma as never);
  beforeEach(() => vi.clearAllMocks());

  it('carries the product photo so the filter can show which product it is', async () => {
    prisma.productLandingPage.findMany.mockResolvedValue([{
      productId: 'p1', ownerUserId: 'u1',
      product: { name: 'Oak Table', productCode: 'LUW-001', status: 'ACTIVE', images: [{ url: '/uploads/oak.jpg' }] },
    }]);
    const result = await service.options({}, { id: OWNER, permissions: ['MARKETING_VIEW_OWN'] });
    expect(result.products).toEqual([
      { id: 'p1', name: 'Oak Table', productCode: 'LUW-001', status: 'ACTIVE', thumbnailUrl: '/uploads/oak.jpg', pageCount: 1 },
    ]);
  });

  it('requires an explicitly chosen optimizer for the all-view optimizer scope before any read', async () => {
    await expect(service.performance(query({ view: 'OPTIMIZER', productId: undefined }), { id: OTHER, permissions: ['MARKETING_VIEW_ALL'] })).rejects.toMatchObject({ status: 400 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('hides another owner before any read', async () => {
    await expect(service.performance(query({ ownerUserId: OTHER }), { id: OWNER, permissions: ['MARKETING_VIEW_OWN'] })).rejects.toMatchObject({ status: 404 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
