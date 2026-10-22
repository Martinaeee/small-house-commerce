import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardService } from './dashboard.service.js';

/**
 * Contract tests for the dashboard groups.
 *
 * The SQL itself is covered by the metric specs and by running against a real
 * database; these tests pin the *behaviour* the UI depends on: an operator
 * without a permission gets an empty group and a capability flag instead of a
 * failed request, and a period with no traffic reports conversion as
 * unavailable rather than zero.
 */

function emptyPrisma(
  permissions: string[] = [],
  rawRows: Array<Record<string, unknown>> = [],
) {
  const prisma = {
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'user-1',
        status: 'ACTIVE',
        roles: permissions.length
          ? [
              {
                role: {
                  permissions: permissions.map((code) => ({ permission: { code } })),
                },
              },
            ]
          : [],
      }),
    },
    $queryRaw: vi.fn().mockResolvedValue(rawRows),
    order: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
    newsletterSubscriber: { count: vi.fn().mockResolvedValue(0) },
    homepageVersion: { findMany: vi.fn().mockResolvedValue([]) },
    productLandingPage: { findMany: vi.fn().mockResolvedValue([]) },
    newsletterPromotion: { findMany: vi.fn().mockResolvedValue([]) },
    homepageDocument: { findUnique: vi.fn().mockResolvedValue(null) },
    product: { findMany: vi.fn().mockResolvedValue([]) },
    productImage: { findMany: vi.fn().mockResolvedValue([]) },
    campaignLink: { findMany: vi.fn().mockResolvedValue([]) },
    analyticsEvent: { findFirst: vi.fn().mockResolvedValue(null) },
  };
  const marketingReport = { report: vi.fn() };
  return { prisma, marketingReport };
}

describe('DashboardService.overview', () => {
  it('returns no sales groups for an operator without order permission', async () => {
    const { prisma, marketingReport } = emptyPrisma();
    const service = new DashboardService(prisma as never, marketingReport as never);

    const result = await service.overview('user-1', { range: 'LAST_7_DAYS', sort: 'revenue' });

    expect(result.capabilities.sales).toBe(false);
    expect(result.capabilities.profit).toBe(false);
    expect(result.kpis.netSales.value).toBeNull();
    expect(result.kpis.netSales.unavailableReason).toBe('NO_PERMISSION');
    expect(result.needsAttention).toEqual([]);
    expect(result.recentOrders).toEqual([]);
    expect(result.ordersOverview.tiles).toEqual([]);
    // Only the permission lookup should have hit the database.
    expect(prisma.order.count).not.toHaveBeenCalled();
  });

  it('reports conversion as unavailable when no session has been recorded', async () => {
    const { prisma, marketingReport } = emptyPrisma(['ORDER_VIEW_ALL', 'REPORT_PROFIT_VIEW']);
    const service = new DashboardService(prisma as never, marketingReport as never);

    const result = await service.overview('user-1', { range: 'LAST_7_DAYS', sort: 'revenue' });

    expect(result.capabilities.sales).toBe(true);
    expect(result.kpis.netSales.value).toBe(0);
    expect(result.kpis.orders.value).toBe(0);
    expect(result.kpis.conversionRate.value).toBeNull();
    expect(result.kpis.conversionRate.unavailableReason).toBe('NO_TRAFFIC_DATA');
    expect(result.kpis.averageOrderValue.unavailableReason).toBe('NO_ORDERS');
    expect(result.kpis.grossProfit.unavailableReason).toBe('COST_DATA_INCOMPLETE');
    expect(result.dataNotes.map((note) => note.key)).toContain('TRAFFIC');
  });

  it('hides the profit KPI from an operator without REPORT_PROFIT_VIEW', async () => {
    const { prisma, marketingReport } = emptyPrisma(['ORDER_VIEW_ALL']);
    const service = new DashboardService(prisma as never, marketingReport as never);

    const result = await service.overview('user-1', { range: 'TODAY', sort: 'revenue' });

    expect(result.capabilities.profit).toBe(false);
    expect(result.kpis.grossProfit.unavailableReason).toBe('NO_PERMISSION');
  });

  it('exposes quick-create entries only for permissions the operator holds', async () => {
    const { prisma, marketingReport } = emptyPrisma(['ORDER_VIEW_ALL']);
    const service = new DashboardService(prisma as never, marketingReport as never);

    const result = await service.overview('user-1', { range: 'TODAY', sort: 'revenue' });
    const keys = result.quickCreate.map((item) => item.key);

    expect(keys).toContain('ORDER');
    expect(keys).not.toContain('PRODUCT');
    expect(keys).not.toContain('DISCOUNT');
  });

  it('echoes the resolved range so the UI can label the period', async () => {
    const { prisma, marketingReport } = emptyPrisma();
    const service = new DashboardService(prisma as never, marketingReport as never);

    const result = await service.overview('user-1', { range: 'LAST_30_DAYS', sort: 'revenue' });

    expect(result.range.days).toBe(30);
    expect(result.range.preset).toBe('LAST_30_DAYS');
    expect(result.currency).toBe('PHP');
  });
});

describe('DashboardService.overview drill-downs', () => {
  // The dashboard runs on Manila calendar days; pinning "now" keeps the day
  // strings below identical on every machine.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-21T02:00:00.000Z')); // 10:00 Manila, Oct 21
  });
  afterEach(() => vi.useRealTimers());

  it('links each order tile to the same Manila days it counted', async () => {
    const { prisma, marketingReport } = emptyPrisma(['ORDER_VIEW_ALL']);
    const service = new DashboardService(prisma as never, marketingReport as never);

    const result = await service.overview('user-1', { range: 'LAST_MONTH', sort: 'revenue' });
    const tile = result.ordersOverview.tiles.find((row) => row.key === 'TO_FULFILL')!;
    const params = new URL(tile.href, 'http://admin.test').searchParams;

    // Last month is 2026-09-01 .. 2026-09-30 in Manila; the link must carry
    // those days, not the UTC day of the window's start instant.
    expect(params.get('dateFrom')).toBe('2026-09-01');
    expect(params.get('dateTo')).toBe('2026-09-30');
  });

  it('drills into failed payments by their exact payment status', async () => {
    const { prisma, marketingReport } = emptyPrisma(['ORDER_VIEW_ALL']);
    const service = new DashboardService(prisma as never, marketingReport as never);

    const result = await service.overview('user-1', { range: 'LAST_7_DAYS', sort: 'revenue' });
    const item = result.needsAttention.find((row) => row.key === 'FAILED_PAYMENTS')!;
    const params = new URL(item.href, 'http://admin.test').searchParams;

    expect(params.get('paymentStatus')).toBe('FAILED');
    // The card counts failed payments on orders that still need attention, so
    // the link must exclude cancelled and denied orders the same way.
    expect(params.get('status')?.split(',')).toEqual([
      'NEW',
      'PENDING',
      'QUESTION',
      'CONFIRMED',
      'ABNORMAL',
      'SHIPPING',
      'SIGNED',
      'AFTER_SALES',
    ]);
  });

  it('scopes the customer snapshot denominator to the period', async () => {
    const { prisma, marketingReport } = emptyPrisma(['ORDER_VIEW_ALL'], [
      {
        new_customers: 3n,
        returning_customers: 2n,
        repeat_customers: 1n,
        customers: 5n,
      },
    ]);
    const service = new DashboardService(prisma as never, marketingReport as never);

    const result = await service.overview('user-1', { range: 'LAST_MONTH', sort: 'revenue' });

    expect(result.customerSnapshot).toMatchObject({
      newCustomers: 3,
      returningCustomers: 2,
      repeatCustomers: 1,
      periodCustomers: 5,
      // new + returning = the period's customers.
      repeatPurchaseRate: 0.2,
    });
  });
});

describe('DashboardService.products', () => {
  it('returns an empty product group without PRODUCT_MANAGE', async () => {
    const { prisma, marketingReport } = emptyPrisma(['INVENTORY_VIEW']);
    const service = new DashboardService(prisma as never, marketingReport as never);

    const result = await service.products('user-1', { range: 'LAST_7_DAYS', sort: 'revenue' });

    expect(result.capabilities.products).toBe(false);
    expect(result.capabilities.inventory).toBe(true);
    expect(result.topProducts).toEqual([]);
    expect(result.productAttention).toEqual([]);
    // Fulfilment metrics are order data: no order permission, no metrics.
    expect(result.codMetrics).toBeNull();
    // Thresholds are still returned so the UI can explain the rules.
    expect(result.thresholds.lowStockUnits).toBeGreaterThan(0);
  });

  it('reports the period fulfilment metrics with the project signed-rate definition', async () => {
    const { prisma, marketingReport } = emptyPrisma(
      ['ORDER_VIEW_ALL', 'PRODUCT_MANAGE'],
      [
        {
          created_orders: 10n,
          valid_orders: 8n,
          confirmed_orders: 6n,
          shipped_orders: 5n,
          signed_orders: 4n,
          cancelled_orders: 1n,
          denied_orders: 1n,
        },
      ],
    );
    const service = new DashboardService(prisma as never, marketingReport as never);

    const result = await service.products('user-1', { range: 'LAST_7_DAYS', sort: 'revenue' });

    expect(result.codMetrics).toMatchObject({
      createdOrders: 10,
      validOrders: 8,
      confirmedOrders: 6,
      shippedOrders: 5,
      signedOrders: 4,
      // Denominator is every created order — cancelled and denied included.
      signedRate: 0.4,
      confirmationRate: 0.6,
      cancelRate: 0.1,
      deniedRate: 0.1,
      // A different metric: signed ÷ orders that entered shipping.
      shippingToSignedRate: 0.8,
    });
  });

  it('publishes per-product profit only when every line carries a cost', async () => {
    const { prisma, marketingReport } = emptyPrisma(
      ['ORDER_VIEW_ALL', 'PRODUCT_MANAGE'],
      [
        {
          product_id: 'p1',
          name: 'Rolling Cart',
          orders: 5n,
          valid_orders: 4n,
          signed_orders: 2n,
          units: 6n,
          gross_revenue: 1000,
          allocated_discount: 100,
          net_revenue: 900,
          cost: 400,
          item_lines: 4n,
          costed_lines: 4n,
          signed_rate: 0.4,
        },
      ],
    );
    const service = new DashboardService(prisma as never, marketingReport as never);

    const result = await service.products('user-1', { range: 'LAST_7_DAYS', sort: 'revenue' });

    expect(result.topProducts[0]).toMatchObject({
      name: 'Rolling Cart',
      revenue: 900,
      signedOrders: 2,
      signedRate: 0.4,
      cost: 400,
      profit: 500,
      costCoverage: 1,
    });
  });

  it('withholds per-product profit while a line has no cost snapshot', async () => {
    const { prisma, marketingReport } = emptyPrisma(
      ['ORDER_VIEW_ALL', 'PRODUCT_MANAGE'],
      [
        {
          product_id: 'p1',
          name: 'Rolling Cart',
          orders: 5n,
          valid_orders: 4n,
          signed_orders: 2n,
          units: 6n,
          gross_revenue: 1000,
          allocated_discount: 0,
          net_revenue: 1000,
          cost: 400,
          item_lines: 4n,
          costed_lines: 2n,
          signed_rate: 0.4,
        },
      ],
    );
    const service = new DashboardService(prisma as never, marketingReport as never);

    const result = await service.products('user-1', { range: 'LAST_7_DAYS', sort: 'revenue' });

    expect(result.topProducts[0]).toMatchObject({ cost: null, profit: null, costCoverage: 0.5 });
  });
});

describe('DashboardService.marketing', () => {
  it('returns an empty campaign list without marketing scope', async () => {
    const { prisma, marketingReport } = emptyPrisma(['ORDER_VIEW_ALL']);
    const service = new DashboardService(prisma as never, marketingReport as never);

    const result = await service.marketing('user-1', { range: 'LAST_7_DAYS', sort: 'revenue' });

    expect(result.capabilities.marketing).toBe(false);
    expect(result.campaigns).toEqual([]);
    expect(result.homepage.sections).toEqual([]);
    expect(result.homepage.totals.ctr).toBeNull();
    expect(marketingReport.report).not.toHaveBeenCalled();
  });
});
