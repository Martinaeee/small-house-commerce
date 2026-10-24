import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { OrderStatus, Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { MarketingReportService } from '../marketing/marketing-report.service.js';
import type { MarketingAccount } from '../marketing/marketing-access.js';
import type { MarketingReportQuery } from '../marketing/dto/marketing-report.dto.js';
import {
  confirmedOrderSql,
  shippedOrderSql,
  signedOrderSql,
  validOrderSql,
} from '../orders/order-facts.js';
import { resolveThresholds, type DashboardThresholds } from './dashboard.config.js';
import {
  averageOrderValue,
  conversionRate,
  divide,
  estimateStockout,
  fillDailySeries,
  grossProfit,
  groupLocations,
  netSales,
  normalizeProvince,
  percentChange,
  pickAcrossIssues,
  rate,
  refundRate,
  roundMoney,
  type CostFacts,
  type OrderWindowFacts,
} from './dashboard-metrics.js';
import { resolveWindow, type DashboardWindow } from './dashboard-range.js';
import type {
  DashboardQuery,
  ProductPerformanceSort,
} from './dto/dashboard.dto.js';
import type {
  AttentionItem,
  CampaignRow,
  CodMetrics,
  DashboardMarketingResponse,
  DashboardOverviewResponse,
  DashboardProductsResponse,
  DataNote,
  InventoryAlert,
  LocationRow,
  OrderTile,
  ProductAttention,
  QuickCreateItem,
  RangeInfo,
  RecentOrder,
  ScheduledItem,
  TopProduct,
} from './dashboard.types.js';

/** Fixed id of the singleton homepage document (homepage_documents CHECK). */
const HOMEPAGE_DOCUMENT_ID = '00000000-0000-0000-0000-000000000001';

const CANCELLED_ORDER_STATUSES = Prisma.sql`('CANCELLED','DENIED')`;

/**
 * Orders that produced no kept sale: cancelled/denied plus fully or partly
 * returned. A returned order must not appear as gross sales, customer activity
 * or a payment backlog. Net-of-return revenue arrives with the analytics stage.
 */
const NON_SALE_ORDER_STATUSES = Prisma.sql`('CANCELLED','DENIED','RETURNED','PARTIALLY_RETURNED')`;

/**
 * Every order status that can still need an operator's action. Backlog
 * drill-downs list these because the order list only filters by inclusion.
 */
const ACTIVE_ORDER_STATUSES = Object.values(OrderStatus).filter(
  (status) =>
    status !== 'CANCELLED' &&
    status !== 'DENIED' &&
    status !== 'RETURNED' &&
    status !== 'PARTIALLY_RETURNED',
);

/**
 * The failed-payment backlog counts orders whose payment failed and that are
 * not cancelled, denied or returned. The order list can only include statuses,
 * so the link names every status the count kept — its length then equals the
 * card.
 */
function failedPaymentsHref(): string {
  return `/admin/orders?${new URLSearchParams({
    paymentStatus: 'FAILED',
    status: ACTIVE_ORDER_STATUSES.join(','),
  }).toString()}`;
}

function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number') return value;
  const parsed = Number(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function toMoney(value: unknown): number {
  return roundMoney(num(value));
}

function rangeInfo(window: DashboardWindow): RangeInfo {
  return {
    preset: window.preset,
    fromDate: window.fromDate,
    toDate: window.toDate,
    days: window.days,
    previousFromDate: window.previousFromDate,
    previousToDate: window.previousToDate,
  };
}

/**
 * Read-only aggregation for the operator dashboard.
 *
 * Every number is derived from the transactional tables at request time —
 * there is no dashboard copy of business data. Groups are fetched in parallel
 * and each one is a small number of set-based queries, never per-row lookups.
 *
 * Permission model (dashboard §20): the page itself is open to any signed-in
 * operator, but each group is gated by the permission that already governs
 * its source module. A group the caller may not read comes back as an empty
 * list plus `capabilities.x = false`, so the UI can say "no permission"
 * without the request failing.
 */
@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly marketingReport: MarketingReportService,
  ) {}

  // ------------------------------------------------------------------ overview

  async overview(userId: string, query: DashboardQuery): Promise<DashboardOverviewResponse> {
    const window = resolveWindow(query.range, query.from, query.to);
    const thresholds = resolveThresholds(process.env);
    const permissions = await this.permissionsOf(userId);
    const can = (code: string) => permissions.has(code);

    // Sales aggregates cover every order, so they need the site-wide view.
    // ORDER_VIEW_OWN is deliberately not enough: an optimizer must not see
    // the whole business's numbers on the workbench.
    const canSales = can('ORDER_VIEW_ALL');
    const canProfit = can('REPORT_PROFIT_VIEW') && canSales;
    const canInventory = can('INVENTORY_VIEW');
    const canProducts = can('PRODUCT_MANAGE');
    const canMarketing = can('MARKETING_VIEW_ALL') || can('MARKETING_VIEW_OWN');
    const canContent = can('PRODUCT_MANAGE');
    const canCustomers = canSales || can('CUSTOMER_MANAGE');

    const [
      currentFacts,
      previousFacts,
      currentCosts,
      previousCosts,
      series,
      orderTiles,
      locations,
      attention,
      customerSnapshot,
      scheduledContent,
      recentOrders,
      traffic,
    ] = await Promise.all([
      canSales
        ? this.orderWindowFacts(window.start, window.end)
        : Promise.resolve<OrderWindowFacts>(emptyOrderFacts()),
      canSales
        ? this.orderWindowFacts(window.previousStart, window.previousEnd)
        : Promise.resolve<OrderWindowFacts>(emptyOrderFacts()),
      canSales ? this.costFacts(window.start, window.end) : Promise.resolve(emptyCostFacts()),
      canSales ? this.costFacts(window.previousStart, window.previousEnd) : Promise.resolve(emptyCostFacts()),
      canSales ? this.dailySeries(window) : Promise.resolve([]),
      canSales ? this.orderTiles(window) : Promise.resolve(null),
      canSales ? this.ordersByLocation(window.start, window.end) : Promise.resolve(null),
      this.needsAttention(window, thresholds, { canSales, canInventory, canContent, canMarketing }),
      canCustomers ? this.customerSnapshot(window) : Promise.resolve(null),
      canContent || canMarketing ? this.scheduledContent() : Promise.resolve([]),
      canSales ? this.recentOrders(window.start, window.end) : Promise.resolve([]),
      canSales ? this.trafficSummary(window) : Promise.resolve(null),
    ]);

    const sales = netSales(currentFacts);
    const previousSales = netSales(previousFacts);
    const aov = averageOrderValue(sales, currentFacts.validOrders);
    const previousAov = averageOrderValue(previousSales, previousFacts.validOrders);
    const refunds = refundRate(currentFacts.refundedOrders, currentFacts.validOrders);
    const previousRefunds = refundRate(previousFacts.refundedOrders, previousFacts.validOrders);
    const conversion = traffic
      ? conversionRate(traffic.orderingSessions, traffic.sessions)
      : null;
    const previousConversion = traffic?.previous
      ? conversionRate(traffic.previous.orderingSessions, traffic.previous.sessions)
      : null;
    const profit = grossProfit(sales, currentCosts);
    const previousProfit = grossProfit(previousSales, previousCosts);

    const dataNotes: DataNote[] = [];
    if (!traffic || traffic.sessions === 0) {
      dataNotes.push({ key: 'TRAFFIC' });
    }
    if (profit.missing.includes('PRODUCT_COST')) {
      dataNotes.push({
        key: 'PRODUCT_COST',
        params: { coverage: Math.round((1 - profit.costCoverage) * 100) },
      });
    }
    if (profit.missing.includes('SHIPPING_COST')) {
      dataNotes.push({ key: 'SHIPPING_COST' });
    }
    if (profit.missing.includes('PAYMENT_FEE')) {
      dataNotes.push({ key: 'PAYMENT_FEE' });
    }
    if (currentFacts.refundedOrders > 0 && currentFacts.refundedAmount === 0) {
      dataNotes.push({ key: 'REFUND_AMOUNT' });
    }

    const kpis: DashboardOverviewResponse['kpis'] = {
      netSales: {
        value: canSales ? sales : null,
        change: percentChange(sales, previousSales),
        ...(canSales ? {} : { unavailableReason: 'NO_PERMISSION' }),
      },
      orders: {
        value: canSales ? currentFacts.validOrders : null,
        change: percentChange(currentFacts.validOrders, previousFacts.validOrders),
        ...(canSales ? {} : { unavailableReason: 'NO_PERMISSION' }),
      },
      conversionRate: {
        value: conversion,
        change: percentChange(conversion ?? 0, previousConversion),
        ...(conversion === null ? { unavailableReason: 'NO_TRAFFIC_DATA' } : {}),
      },
      averageOrderValue: {
        value: aov,
        change: percentChange(aov ?? 0, previousAov),
        ...(aov === null ? { unavailableReason: 'NO_ORDERS' } : {}),
      },
      refundRate: {
        value: refunds,
        change: percentChange(refunds ?? 0, previousRefunds),
        ...(refunds === null ? { unavailableReason: 'NO_ORDERS' } : {}),
      },
      grossProfit: {
        value: canProfit ? profit.value : null,
        change: percentChange(profit.value ?? 0, previousProfit.value),
        costCoverage: profit.costCoverage,
        partial: profit.partial,
        missing: profit.missing,
        ...(canProfit ? {} : { unavailableReason: 'NO_PERMISSION' }),
        ...(canProfit && profit.value === null ? { unavailableReason: 'COST_DATA_INCOMPLETE' } : {}),
      },
    };

    return {
      range: rangeInfo(window),
      generatedAt: new Date().toISOString(),
      currency: 'PHP',
      capabilities: {
        sales: canSales,
        profit: canProfit,
        inventory: canInventory,
        products: canProducts,
        marketing: canMarketing,
        content: canContent,
        customers: canCustomers,
      },
      kpis,
      salesSeries: fillDailySeries(series, window),
      salesTotals: {
        totalSales: sales,
        orders: currentFacts.validOrders,
        averageOrderValue: aov,
        customers: currentFacts.customers,
      },
      needsAttention: attention,
      ordersOverview: orderTiles ?? { tiles: [], total: 0 },
      ordersByLocation: locations ?? { rows: [], total: 0 },
      customerSnapshot,
      scheduledContent,
      recentOrders,
      quickCreate: this.quickCreate(permissions),
      dataNotes,
    };
  }

  // ------------------------------------------------------------------ products

  async products(userId: string, query: DashboardQuery): Promise<DashboardProductsResponse> {
    const window = resolveWindow(query.range, query.from, query.to);
    const thresholds = resolveThresholds(process.env);
    const permissions = await this.permissionsOf(userId);
    const canProducts = permissions.has('PRODUCT_MANAGE');
    const canInventory = permissions.has('INVENTORY_VIEW') || canProducts;
    const canSales = permissions.has('ORDER_VIEW_ALL');

    const emptyThresholds: DashboardProductsResponse['thresholds'] = {
      lowStockUnits: thresholds.lowStockUnits,
      stockoutHorizonDays: thresholds.stockoutHorizonDays,
      velocityWindowDays: thresholds.velocityWindowDays,
      lowConversionRate: thresholds.lowConversionRate,
      minViewsForConversion: thresholds.minViewsForConversion,
      highCancellationRate: thresholds.highCancellationRate,
      minOrdersForCancellation: thresholds.minOrdersForCancellation,
      lowTrafficViews: thresholds.lowTrafficViews,
      highRefundRate: thresholds.highRefundRate,
      minOrdersForRefund: thresholds.minOrdersForRefund,
    };

    const [topProducts, productAttention, inventoryAlerts, codMetrics] = await Promise.all([
      canProducts ? this.productPerformance(window, query.sort) : Promise.resolve([]),
      canProducts ? this.productAttention(window, thresholds) : Promise.resolve([]),
      canInventory ? this.inventoryAlerts(thresholds) : Promise.resolve([]),
      canSales ? this.codMetrics(window.start, window.end) : Promise.resolve(null),
    ]);

    return {
      range: rangeInfo(window),
      generatedAt: new Date().toISOString(),
      capabilities: { products: canProducts, inventory: canInventory },
      thresholds: emptyThresholds,
      topProducts,
      productAttention,
      inventoryAlerts,
      codMetrics,
      sort: query.sort,
    };
  }

  // ----------------------------------------------------------------- marketing

  async marketing(userId: string, query: DashboardQuery): Promise<DashboardMarketingResponse> {
    const window = resolveWindow(query.range, query.from, query.to);
    const permissions = await this.permissionsOf(userId);
    const canMarketing =
      permissions.has('MARKETING_VIEW_ALL') || permissions.has('MARKETING_VIEW_OWN');
    const canContent = permissions.has('PRODUCT_MANAGE');

    const [campaigns, homepage] = await Promise.all([
      canMarketing ? this.campaigns(userId, permissions, window) : Promise.resolve([]),
      canContent ? this.homepagePerformance(window) : Promise.resolve(null),
    ]);

    return {
      range: rangeInfo(window),
      generatedAt: new Date().toISOString(),
      capabilities: { marketing: canMarketing, content: canContent },
      campaigns,
      homepage: homepage ?? {
        sections: [],
        totals: { impressions: 0, clicks: 0, ctr: null },
        trackingSince: null,
      },
    };
  }

  // ------------------------------------------------------------------- helpers

  private async permissionsOf(userId: string): Promise<Set<string>> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
      },
    });
    if (!user || user.status !== 'ACTIVE') throw new ForbiddenException();
    return new Set(
      user.roles.flatMap((userRole) =>
        userRole.role.permissions.map((grant) => grant.permission.code as string),
      ),
    );
  }

  private async orderWindowFacts(start: Date, end: Date): Promise<OrderWindowFacts> {
    const rows = await this.prisma.$queryRaw<
      Array<Record<string, unknown>>
    >(Prisma.sql`
      SELECT
        COUNT(*) FILTER (WHERE o.order_status NOT IN ${NON_SALE_ORDER_STATUSES}) AS valid_orders,
        COALESCE(SUM(o.subtotal) FILTER (WHERE o.order_status NOT IN ${NON_SALE_ORDER_STATUSES}), 0) AS gross_product_sales,
        COALESCE(SUM(o.discount_total) FILTER (WHERE o.order_status NOT IN ${NON_SALE_ORDER_STATUSES}), 0) AS discount_total,
        COALESCE(SUM(o.subtotal - o.discount_total) FILTER (WHERE o.payment_status = 'REFUNDED'), 0) AS refunded_amount,
        COUNT(*) FILTER (WHERE o.payment_status IN ('REFUNDED','PARTIALLY_REFUNDED')) AS refunded_orders,
        COUNT(*) FILTER (WHERE o.order_status IN ${CANCELLED_ORDER_STATUSES}) AS cancelled_orders,
        COUNT(*) FILTER (WHERE o.order_status = 'SIGNED') AS signed_orders,
        COUNT(*) FILTER (WHERE o.confirmation_status = 'CONFIRMED') AS confirmed_orders,
        COUNT(DISTINCT o.customer_id) FILTER (WHERE o.order_status NOT IN ${NON_SALE_ORDER_STATUSES}) AS customers
      FROM orders o
      WHERE o.created_at >= ${start}::timestamptz AND o.created_at < ${end}::timestamptz
    `);
    const row = rows[0] ?? {};
    return {
      validOrders: num(row.valid_orders),
      grossProductSales: toMoney(row.gross_product_sales),
      discountTotal: toMoney(row.discount_total),
      refundedAmount: toMoney(row.refunded_amount),
      refundedOrders: num(row.refunded_orders),
      cancelledOrders: num(row.cancelled_orders),
      signedOrders: num(row.signed_orders),
      confirmedOrders: num(row.confirmed_orders),
      customers: num(row.customers),
    };
  }

  private async costFacts(start: Date, end: Date): Promise<CostFacts> {
    const [items, shipping] = await Promise.all([
      this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT
          COALESCE(SUM(oi.unit_cost_snapshot * oi.quantity), 0) AS product_cost,
          COUNT(oi.id) AS item_lines,
          COUNT(oi.id) FILTER (WHERE oi.unit_cost_snapshot IS NOT NULL) AS costed_item_lines
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE o.created_at >= ${start}::timestamptz AND o.created_at < ${end}::timestamptz
          AND o.order_status NOT IN ${NON_SALE_ORDER_STATUSES}
      `),
      this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT COALESCE(SUM(s.shipping_cost), 0) AS shipping_cost
        FROM shipments s
        JOIN orders o ON o.id = s.order_id
        WHERE o.created_at >= ${start}::timestamptz AND o.created_at < ${end}::timestamptz
          AND o.order_status NOT IN ${NON_SALE_ORDER_STATUSES}
      `),
    ]);
    const item = items[0] ?? {};
    return {
      productCost: toMoney(item.product_cost),
      shippingCost: toMoney(shipping[0]?.shipping_cost),
      // No COD/gateway fee is recorded anywhere in the schema yet; 0 means
      // "not tracked", which the profit result reports as a gap.
      paymentFee: 0,
      itemLines: num(item.item_lines),
      costedItemLines: num(item.costed_item_lines),
    };
  }

  private async dailySeries(
    window: DashboardWindow,
  ): Promise<Array<{ day: string; revenue: number; orders: number }>> {
    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT
        to_char((o.created_at AT TIME ZONE 'Asia/Manila')::date, 'YYYY-MM-DD') AS day,
        COALESCE(SUM(o.subtotal - o.discount_total) FILTER (WHERE o.order_status NOT IN ${NON_SALE_ORDER_STATUSES}), 0) AS revenue,
        COUNT(*) FILTER (WHERE o.order_status NOT IN ${NON_SALE_ORDER_STATUSES}) AS orders
      FROM orders o
      WHERE o.created_at >= ${window.start}::timestamptz AND o.created_at < ${window.end}::timestamptz
      GROUP BY 1
      ORDER BY 1
    `);
    return rows.map((row) => ({
      day: String(row.day),
      revenue: toMoney(row.revenue),
      orders: num(row.orders),
    }));
  }

  private async orderTiles(
    window: DashboardWindow,
  ): Promise<{ tiles: OrderTile[]; total: number }> {
    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT
        COUNT(*) FILTER (WHERE order_status = 'CONFIRMED') AS to_fulfill,
        COUNT(*) FILTER (WHERE order_status NOT IN ${NON_SALE_ORDER_STATUSES} AND payment_status IN ('COD_PENDING','ONLINE_PENDING')) AS awaiting_payment,
        COUNT(*) FILTER (WHERE order_status IN ('NEW','PENDING','QUESTION','ABNORMAL')) AS processing,
        COUNT(*) FILTER (WHERE order_status = 'SHIPPING') AS shipped,
        COUNT(*) FILTER (WHERE order_status = 'SIGNED') AS delivered,
        COUNT(*) FILTER (WHERE order_status IN ${CANCELLED_ORDER_STATUSES}) AS cancelled,
        COUNT(*) FILTER (WHERE payment_status IN ('REFUNDED','PARTIALLY_REFUNDED') OR order_status = 'AFTER_SALES') AS refund_requested,
        COUNT(*) AS total
      FROM orders
      WHERE created_at >= ${window.start}::timestamptz AND created_at < ${window.end}::timestamptz
    `);
    const row = rows[0] ?? {};
    // The orders list reads its From/To as Manila calendar days, so the
    // drill-down carries the window's own days. Using the UTC date of `start`
    // would point one day early: Manila 00:00 is the previous UTC evening.
    const dayParams = {
      dateFrom: window.fromDate,
      dateTo: window.toDate,
    };
    const href = (params: Record<string, string>) =>
      `/admin/orders?${new URLSearchParams({ ...dayParams, ...params }).toString()}`;
    const tiles: OrderTile[] = [
      { key: 'TO_FULFILL', count: num(row.to_fulfill), href: href({ status: 'CONFIRMED' }), tone: 'amber' },
      { key: 'AWAITING_PAYMENT', count: num(row.awaiting_payment), href: href({ status: 'NEW,PENDING,QUESTION,CONFIRMED,SHIPPING' }), tone: 'neutral' },
      { key: 'PROCESSING', count: num(row.processing), href: href({ status: 'NEW,PENDING,QUESTION,ABNORMAL' }), tone: 'amber' },
      { key: 'SHIPPED', count: num(row.shipped), href: href({ status: 'SHIPPING' }), tone: 'neutral' },
      { key: 'DELIVERED', count: num(row.delivered), href: href({ status: 'SIGNED' }), tone: 'green' },
      { key: 'CANCELLED', count: num(row.cancelled), href: href({ status: 'CANCELLED,DENIED' }), tone: 'red' },
      { key: 'REFUND_REQUESTED', count: num(row.refund_requested), href: href({ status: 'AFTER_SALES' }), tone: 'red' },
    ];
    return { tiles, total: num(row.total) };
  }

  private async ordersByLocation(
    start: Date,
    end: Date,
  ): Promise<{ rows: LocationRow[]; total: number }> {
    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT a.province,
        COUNT(*) AS orders,
        COALESCE(SUM(o.subtotal - o.discount_total), 0) AS revenue
      FROM orders o
      JOIN order_shipping_address a ON a.order_id = o.id
      WHERE o.created_at >= ${start}::timestamptz AND o.created_at < ${end}::timestamptz
        AND o.order_status NOT IN ${NON_SALE_ORDER_STATUSES}
      GROUP BY a.province
    `);
    const grouped = groupLocations(
      rows.map((row) => ({
        province: String(row.province ?? ''),
        orders: num(row.orders),
        revenue: toMoney(row.revenue),
      })),
    );
    return { rows: grouped.rows, total: grouped.total };
  }

  private async needsAttention(
    window: DashboardWindow,
    thresholds: DashboardThresholds,
    can: { canSales: boolean; canInventory: boolean; canContent: boolean; canMarketing: boolean },
  ): Promise<AttentionItem[]> {
    const items: AttentionItem[] = [];

    if (can.canSales) {
      const [toFulfill, toConfirm, failed, afterSales] = await Promise.all([
        this.prisma.order.count({ where: { orderStatus: 'CONFIRMED' } }),
        this.prisma.order.count({
          where: {
            orderStatus: { in: ['NEW', 'PENDING', 'QUESTION'] },
            confirmationStatus: { in: ['UNCONFIRMED', 'NEEDS_REVIEW'] },
          },
        }),
        this.prisma.order.count({
          where: { paymentStatus: 'FAILED', orderStatus: { in: ACTIVE_ORDER_STATUSES } },
        }),
        this.prisma.order.count({
          where: {
            OR: [
              { paymentStatus: { in: ['REFUNDED', 'PARTIALLY_REFUNDED'] } },
              { orderStatus: 'AFTER_SALES' },
            ],
          },
        }),
      ]);
      items.push(
        { key: 'AWAITING_FULFILLMENT', labelKey: 'AWAITING_FULFILLMENT', count: toFulfill, href: '/admin/orders?status=CONFIRMED', tone: toFulfill > 0 ? 'amber' : 'neutral' },
        { key: 'COD_TO_CONFIRM', labelKey: 'COD_TO_CONFIRM', count: toConfirm, href: '/admin/orders?status=NEW,PENDING,QUESTION', tone: toConfirm > 0 ? 'amber' : 'neutral' },
        { key: 'FAILED_PAYMENTS', labelKey: 'FAILED_PAYMENTS', count: failed, href: failedPaymentsHref(), tone: failed > 0 ? 'red' : 'neutral', hintKey: 'FAILED_PAYMENTS_HINT' },
        { key: 'REFUNDS_AFTER_SALES', labelKey: 'REFUNDS_AFTER_SALES', count: afterSales, href: '/admin/orders?status=AFTER_SALES', tone: afterSales > 0 ? 'red' : 'neutral', hintKey: 'REFUNDS_AFTER_SALES_HINT' },
      );
    }

    if (can.canInventory) {
      const stock = await this.stockCounts(thresholds);
      items.push(
        { key: 'LOW_STOCK', labelKey: 'LOW_STOCK', count: stock.lowStock, href: `/admin/inventory?stock=low`, tone: stock.lowStock > 0 ? 'amber' : 'neutral' },
        { key: 'OUT_OF_STOCK', labelKey: 'OUT_OF_STOCK', count: stock.outOfStock, href: `/admin/inventory?stock=out`, tone: stock.outOfStock > 0 ? 'red' : 'neutral' },
      );
    }

    if (can.canContent || can.canMarketing) {
      const scheduled = await this.scheduledContent();
      const soon = scheduled.filter(
        (item) =>
          item.status === 'SCHEDULED' &&
          item.scheduledFor !== null &&
          new Date(item.scheduledFor).getTime() - Date.now() <= 7 * 86_400_000,
      );
      items.push({
        key: 'SCHEDULED_SOON',
        labelKey: 'SCHEDULED_SOON',
        count: soon.length,
        href: '/admin/homepage/versions',
        tone: 'neutral',
      });
    }

    // Windows are not used here on purpose: backlog is "now", not "this week".
    void window;
    return items;
  }

  private async stockCounts(
    thresholds: DashboardThresholds,
  ): Promise<{ lowStock: number; outOfStock: number }> {
    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      WITH stock AS (
        SELECT sku_id, SUM(on_hand - reserved) AS available
        FROM inventory
        GROUP BY sku_id
      )
      SELECT
        COUNT(*) FILTER (WHERE COALESCE(s.available, 0) <= 0) AS out_of_stock,
        COUNT(*) FILTER (WHERE COALESCE(s.available, 0) > 0 AND COALESCE(s.available, 0) <= ${thresholds.lowStockUnits}) AS low_stock
      FROM skus k
      JOIN products p ON p.id = k.product_id
      LEFT JOIN stock s ON s.sku_id = k.id
      WHERE k.status = 'ACTIVE' AND p.status = 'ACTIVE'
    `);
    return {
      lowStock: num(rows[0]?.low_stock),
      outOfStock: num(rows[0]?.out_of_stock),
    };
  }

  private async customerSnapshot(window: DashboardWindow) {
    // Everything is scoped to the period: the denominator is the customers who
    // ordered in it, so an empty range reports "no rate" instead of a
    // historical one. New + returning always equals that denominator, and the
    // repeat customers are a subset of it.
    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      WITH period AS (
        SELECT o.customer_id
        FROM orders o
        WHERE o.order_status NOT IN ${NON_SALE_ORDER_STATUSES}
          AND o.created_at >= ${window.start}::timestamptz
          AND o.created_at < ${window.end}::timestamptz
        GROUP BY o.customer_id
      ),
      lifetime AS (
        SELECT o.customer_id,
          MIN(o.created_at) AS first_order,
          COUNT(*) AS orders
        FROM orders o
        WHERE o.order_status NOT IN ${NON_SALE_ORDER_STATUSES}
        GROUP BY o.customer_id
      )
      SELECT
        COUNT(*) FILTER (WHERE l.first_order >= ${window.start}::timestamptz AND l.first_order < ${window.end}::timestamptz) AS new_customers,
        COUNT(*) FILTER (WHERE l.first_order < ${window.start}::timestamptz) AS returning_customers,
        COUNT(*) FILTER (WHERE l.orders >= 2) AS repeat_customers,
        COUNT(*) AS customers
      FROM period p
      JOIN lifetime l ON l.customer_id = p.customer_id
    `);
    const row = rows[0] ?? {};
    const [emailSubscribers, newEmailSubscribers] = await Promise.all([
      this.prisma.newsletterSubscriber.count({ where: { status: 'SUBSCRIBED' } }),
      this.prisma.newsletterSubscriber.count({
        where: { status: 'SUBSCRIBED', createdAt: { gte: window.start, lt: window.end } },
      }),
    ]);
    const customers = num(row.customers);
    return {
      newCustomers: num(row.new_customers),
      returningCustomers: num(row.returning_customers),
      repeatPurchaseRate:
        customers === 0 ? null : Math.round((num(row.repeat_customers) / customers) * 10000) / 10000,
      repeatCustomers: num(row.repeat_customers),
      periodCustomers: customers,
      emailSubscribers,
      newEmailSubscribers,
    };
  }

  private async scheduledContent(): Promise<ScheduledItem[]> {
    const now = new Date();
    const [versions, landingPages, promotions, document] = await Promise.all([
      this.prisma.homepageVersion.findMany({
        where: { publishAt: { gt: now } },
        orderBy: { publishAt: 'asc' },
        take: 5,
        select: { id: true, versionNo: true, publishAt: true, unpublishAt: true },
      }),
      this.prisma.productLandingPage.findMany({
        where: { startAt: { gt: now } },
        orderBy: { startAt: 'asc' },
        take: 5,
        select: { id: true, slug: true, titleOverride: true, startAt: true, endAt: true },
      }),
      this.prisma.newsletterPromotion.findMany({
        where: { validFrom: { gt: now } },
        orderBy: { validFrom: 'asc' },
        take: 5,
        select: { id: true, code: true, validFrom: true, validUntil: true },
      }),
      this.prisma.homepageDocument.findUnique({
        where: { id: HOMEPAGE_DOCUMENT_ID },
        select: { draft: true },
      }),
    ]);

    const items: ScheduledItem[] = [];
    for (const version of versions) {
      items.push({
        id: `homepage-version-${version.id}`,
        kind: 'HOMEPAGE_VERSION',
        title: `Homepage version ${version.versionNo}`,
        status: 'SCHEDULED',
        scheduledFor: version.publishAt.toISOString(),
        endsAt: version.unpublishAt?.toISOString() ?? null,
        href: '/admin/homepage/versions',
      });
    }

    // Section-level schedules live inside the homepage document JSON.
    const sections = readSectionSchedules(document?.draft);
    for (const section of sections) {
      if (!section.publishAt || section.publishAt.getTime() <= now.getTime()) continue;
      items.push({
        id: `homepage-section-${section.id}`,
        kind: 'HOMEPAGE_SECTION',
        title: section.title ?? section.type,
        status: 'SCHEDULED',
        scheduledFor: section.publishAt.toISOString(),
        endsAt: section.unpublishAt?.toISOString() ?? null,
        href: '/admin/homepage',
      });
    }

    for (const page of landingPages) {
      items.push({
        id: `landing-page-${page.id}`,
        kind: 'LANDING_PAGE',
        title: page.titleOverride ?? page.slug,
        status: 'SCHEDULED',
        scheduledFor: page.startAt?.toISOString() ?? null,
        endsAt: page.endAt?.toISOString() ?? null,
        href: '/admin/single-pages',
      });
    }

    for (const promotion of promotions) {
      items.push({
        id: `promotion-${promotion.id}`,
        kind: 'PROMOTION',
        title: `Promo code ${promotion.code}`,
        status: 'SCHEDULED',
        scheduledFor: promotion.validFrom?.toISOString() ?? null,
        endsAt: promotion.validUntil?.toISOString() ?? null,
        href: '/admin/newsletter?tab=promotions',
      });
    }

    return items
      .sort((a, b) => (a.scheduledFor ?? '').localeCompare(b.scheduledFor ?? ''))
      .slice(0, 8);
  }

  private async recentOrders(start: Date, end: Date): Promise<RecentOrder[]> {
    const orders = await this.prisma.order.findMany({
      where: { createdAt: { gte: start, lt: end } },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: {
        id: true,
        orderNumber: true,
        grandTotal: true,
        currency: true,
        paymentStatus: true,
        orderStatus: true,
        confirmationStatus: true,
        createdAt: true,
        customer: { select: { name: true } },
        shippingAddress: { select: { fullName: true } },
        items: { select: { quantity: true } },
      },
    });
    return orders.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      customerName: order.shippingAddress?.fullName ?? order.customer.name ?? 'Guest',
      itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
      total: order.grandTotal.toFixed(2),
      currency: order.currency,
      paymentStatus: order.paymentStatus,
      orderStatus: order.orderStatus,
      confirmationStatus: order.confirmationStatus,
      createdAt: order.createdAt.toISOString(),
    }));
  }

  /**
   * Sessions and ordering sessions for the site-wide conversion rate.
   *
   * Denominator: sessions that actually visited (a page_view event).
   * Numerator: sessions that placed an order in the period. A later
   * cancellation does NOT undo the conversion — the checkout did happen —
   * and the cancellation is reported on its own as the cancel rate. Mixing
   * the two口径 would make the funnel contradict itself.
   */
  private async trafficSummary(
    window: DashboardWindow,
  ): Promise<{ sessions: number; orderingSessions: number; previous: { sessions: number; orderingSessions: number } | null }> {
    const count = async (start: Date, end: Date) => {
      const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT
          COUNT(DISTINCT e.session_id) FILTER (WHERE e.event_name = 'PAGE_VIEW') AS sessions,
          COUNT(DISTINCT e.session_id) FILTER (WHERE o.id IS NOT NULL) AS ordering_sessions
        FROM analytics_events e
        LEFT JOIN orders o ON o.tracking_session_id = e.session_id
          AND o.created_at >= ${start}::timestamptz AND o.created_at < ${end}::timestamptz
        WHERE e.created_at >= ${start}::timestamptz AND e.created_at < ${end}::timestamptz
      `);
      const row = rows[0] ?? {};
      return { sessions: num(row.sessions), orderingSessions: num(row.ordering_sessions) };
    };
    const [current, previous] = await Promise.all([
      count(window.start, window.end),
      count(window.previousStart, window.previousEnd),
    ]);
    return { ...current, previous };
  }

  /**
   * Product performance for the period: what sold, how well it was
   * delivered, and what it left behind.
   *
   * Revenue is net of the order-level discount, allocated to the order's
   * lines in proportion to their amount, so the column adds up to the
   * period's placed revenue. Signed rate uses the project's definition
   * (signed orders ÷ all created orders — cancelled and denied stay in the
   * denominator, BUSINESS_RULES §11).
   */
  private async productPerformance(
    window: DashboardWindow,
    sort: ProductPerformanceSort,
  ): Promise<TopProduct[]> {
    const orderBy = {
      revenue: Prisma.sql`net_revenue DESC`,
      orders: Prisma.sql`orders DESC`,
      signed_rate: Prisma.sql`signed_rate DESC NULLS LAST`,
      units: Prisma.sql`units DESC`,
    }[sort];

    const current = await this.perProductRows(window.start, window.end, orderBy, 8);
    if (current.length === 0) return [];

    // The previous period is only needed for the growth of the rows shown,
    // so it is restricted to those products.
    const ids = current.map((row) => String(row.product_id));
    const previous = await this.perProductRows(
      window.previousStart,
      window.previousEnd,
      Prisma.sql`net_revenue DESC`,
      undefined,
      ids,
    );
    const previousByProduct = new Map(
      previous.map((row) => [String(row.product_id), toMoney(row.net_revenue)]),
    );

    const productIds = ids;
    const [products, images] = await Promise.all([
      this.prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, name: true, slug: true },
      }),
      this.prisma.productImage.findMany({
        where: { productId: { in: productIds } },
        orderBy: [{ productId: 'asc' }, { sortOrder: 'asc' }],
        select: { productId: true, url: true },
      }),
    ]);
    const productById = new Map(products.map((product) => [product.id, product]));
    const imageByProduct = new Map<string, string>();
    for (const image of images) {
      if (!imageByProduct.has(image.productId)) imageByProduct.set(image.productId, image.url);
    }

    return current.map((row) => {
      const productId = String(row.product_id);
      const revenue = toMoney(row.net_revenue);
      const orders = num(row.orders);
      const signedOrders = num(row.signed_orders);
      const itemLines = num(row.item_lines);
      const costedLines = num(row.costed_lines);
      const costCoverage =
        itemLines === 0 ? 0 : Math.round((costedLines / itemLines) * 10000) / 10000;
      // Profit is only published when every line of this product carries a
      // cost snapshot; a partial cost would read as real margin.
      const costComplete = itemLines > 0 && costedLines === itemLines;
      const cost = costComplete ? toMoney(row.cost) : null;
      return {
        productId,
        name: productById.get(productId)?.name ?? String(row.name),
        slug: productById.get(productId)?.slug ?? null,
        imageUrl: imageByProduct.get(productId) ?? null,
        orders,
        validOrders: num(row.valid_orders),
        units: num(row.units),
        revenue,
        signedOrders,
        signedRate: rate(signedOrders, orders),
        cost,
        profit: cost === null ? null : roundMoney(revenue - cost),
        costCoverage,
        change: percentChange(revenue, previousByProduct.get(productId) ?? null),
      };
    });
  }

  /**
   * One grouped query per product in a window.
   *
   * `limit` is applied after the ranking; `productIds` narrows the scan to
   * the products the caller actually shows.
   */
  private async perProductRows(
    start: Date,
    end: Date,
    orderBy: Prisma.Sql,
    limit?: number,
    productIds?: string[],
  ): Promise<Array<Record<string, unknown>>> {
    const idFilter = productIds?.length
      ? Prisma.sql`AND oi.product_id IN (${Prisma.join(productIds)})`
      : Prisma.empty;
    return this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      WITH per_product AS (
        SELECT oi.product_id,
          MIN(oi.product_name_snapshot) AS name,
          COUNT(DISTINCT o.id) AS orders,
          COUNT(DISTINCT o.id) FILTER (WHERE ${validOrderSql}) AS valid_orders,
          COUNT(DISTINCT o.id) FILTER (WHERE ${signedOrderSql}) AS signed_orders,
          COALESCE(SUM(oi.quantity) FILTER (WHERE ${validOrderSql}), 0) AS units,
          COALESCE(SUM(oi.line_total) FILTER (WHERE ${validOrderSql}), 0) AS gross_revenue,
          COALESCE(SUM(o.discount_total * oi.line_total / NULLIF(o.subtotal, 0)) FILTER (WHERE ${validOrderSql}), 0) AS allocated_discount,
          COALESCE(SUM(oi.unit_cost_snapshot * oi.quantity) FILTER (WHERE ${validOrderSql}), 0) AS cost,
          COUNT(oi.id) FILTER (WHERE ${validOrderSql}) AS item_lines,
          COUNT(oi.id) FILTER (WHERE ${validOrderSql} AND oi.unit_cost_snapshot IS NOT NULL) AS costed_lines
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE o.created_at >= ${start}::timestamptz AND o.created_at < ${end}::timestamptz
          AND oi.product_id IS NOT NULL
          ${idFilter}
        GROUP BY oi.product_id
      )
      SELECT *,
        (gross_revenue - allocated_discount) AS net_revenue,
        (signed_orders::numeric / NULLIF(orders, 0)) AS signed_rate
      FROM per_product
      ORDER BY ${orderBy}
      ${limit === undefined ? Prisma.empty : Prisma.sql`LIMIT ${limit}`}
    `);
  }

  /**
   * Period fulfilment metrics (ADMIN_SPEC §6.2).
   *
   * The signed rate's denominator is every order created in the period —
   * cancelled and denied orders stay in it (DATABASE.md §71). The
   * shipping-to-signed rate is a different metric and is reported separately.
   */
  private async codMetrics(start: Date, end: Date): Promise<CodMetrics> {
    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT
        COUNT(*) AS created_orders,
        COUNT(*) FILTER (WHERE ${validOrderSql}) AS valid_orders,
        COUNT(*) FILTER (WHERE ${confirmedOrderSql}) AS confirmed_orders,
        COUNT(*) FILTER (WHERE ${shippedOrderSql}) AS shipped_orders,
        COUNT(*) FILTER (WHERE ${signedOrderSql}) AS signed_orders,
        COUNT(*) FILTER (WHERE o.order_status = 'CANCELLED') AS cancelled_orders,
        COUNT(*) FILTER (WHERE o.order_status = 'DENIED') AS denied_orders
      FROM orders o
      WHERE o.created_at >= ${start}::timestamptz AND o.created_at < ${end}::timestamptz
    `);
    const row = rows[0] ?? {};
    const created = num(row.created_orders);
    const shipped = num(row.shipped_orders);
    const signed = num(row.signed_orders);
    return {
      createdOrders: created,
      validOrders: num(row.valid_orders),
      confirmedOrders: num(row.confirmed_orders),
      shippedOrders: shipped,
      signedOrders: signed,
      cancelledOrders: num(row.cancelled_orders),
      deniedOrders: num(row.denied_orders),
      confirmationRate: rate(num(row.confirmed_orders), created),
      signedRate: rate(signed, created),
      cancelRate: rate(num(row.cancelled_orders), created),
      deniedRate: rate(num(row.denied_orders), created),
      shippingToSignedRate: rate(signed, shipped),
    };
  }

  private async productAttention(
    window: DashboardWindow,
    thresholds: DashboardThresholds,
  ): Promise<ProductAttention[]> {
    const [orderStats, viewStats, stockRows, products] = await Promise.all([
      this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT oi.product_id,
          COUNT(DISTINCT o.id) AS orders,
          COUNT(DISTINCT o.id) FILTER (WHERE o.order_status IN ${CANCELLED_ORDER_STATUSES}) AS cancelled,
          COUNT(DISTINCT o.id) FILTER (WHERE o.payment_status IN ('REFUNDED','PARTIALLY_REFUNDED')) AS refunded
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE o.created_at >= ${window.start}::timestamptz AND o.created_at < ${window.end}::timestamptz
          AND oi.product_id IS NOT NULL
        GROUP BY oi.product_id
      `),
      this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT product_id, COUNT(DISTINCT session_id) AS views
        FROM analytics_events
        WHERE event_name = 'PRODUCT_VIEW'
          AND event_day >= ${window.fromDate}::date AND event_day <= ${window.toDate}::date
          AND product_id IS NOT NULL
        GROUP BY product_id
      `),
      this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT k.product_id, SUM(i.on_hand - i.reserved) AS available
        FROM inventory i
        JOIN skus k ON k.id = i.sku_id
        GROUP BY k.product_id
      `),
      this.prisma.product.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, name: true, images: { take: 1, orderBy: { sortOrder: 'asc' }, select: { url: true } } },
      }),
    ]);

    const viewsByProduct = new Map(
      viewStats.map((row) => [String(row.product_id), num(row.views)]),
    );
    const stockByProduct = new Map(
      stockRows.map((row) => [String(row.product_id), num(row.available)]),
    );
    const statsByProduct = new Map(
      orderStats.map((row) => [
        String(row.product_id),
        { orders: num(row.orders), cancelled: num(row.cancelled), refunded: num(row.refunded) },
      ]),
    );

    const flagged: ProductAttention[] = [];
    for (const product of products) {
      const stats = statsByProduct.get(product.id) ?? { orders: 0, cancelled: 0, refunded: 0 };
      const views = viewsByProduct.get(product.id) ?? 0;
      const available = stockByProduct.get(product.id) ?? 0;
      const imageUrl = product.images[0]?.url ?? null;

      if (available <= 0) {
        flagged.push({
          productId: product.id,
          name: product.name,
          imageUrl,
          issue: 'OUT_OF_STOCK',
          value: available,
          orders: stats.orders,
          views,
        });
        continue;
      }

      // Conversion is measured per viewer, not per page load, so a reload
      // cannot make a product look better.
      if (
        views >= thresholds.minViewsForConversion &&
        stats.orders / Math.max(views, 1) < thresholds.lowConversionRate
      ) {
        flagged.push({
          productId: product.id,
          name: product.name,
          imageUrl,
          issue: 'LOW_CONVERSION',
          value: Math.round((stats.orders / views) * 10000) / 10000,
          orders: stats.orders,
          views,
        });
        continue;
      }

      if (
        stats.orders >= thresholds.minOrdersForCancellation &&
        stats.cancelled / stats.orders >= thresholds.highCancellationRate
      ) {
        flagged.push({
          productId: product.id,
          name: product.name,
          imageUrl,
          issue: 'HIGH_CANCELLATION',
          value: Math.round((stats.cancelled / stats.orders) * 10000) / 10000,
          orders: stats.orders,
          views,
        });
        continue;
      }

      if (
        stats.orders >= thresholds.minOrdersForRefund &&
        stats.refunded / stats.orders >= thresholds.highRefundRate
      ) {
        flagged.push({
          productId: product.id,
          name: product.name,
          imageUrl,
          issue: 'HIGH_REFUND',
          value: Math.round((stats.refunded / stats.orders) * 10000) / 10000,
          orders: stats.orders,
          views,
        });
        continue;
      }

      if (views < thresholds.lowTrafficViews) {
        flagged.push({
          productId: product.id,
          name: product.name,
          imageUrl,
          issue: 'LOW_TRAFFIC',
          value: views,
          orders: stats.orders,
          views,
        });
      }
    }

    return pickAcrossIssues(flagged);
  }

  private async inventoryAlerts(thresholds: DashboardThresholds): Promise<InventoryAlert[]> {
    const velocityDays = thresholds.velocityWindowDays;
    const velocityStart = new Date(Date.now() - velocityDays * 86_400_000);
    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      WITH stock AS (
        SELECT sku_id, SUM(on_hand - reserved) AS available
        FROM inventory
        GROUP BY sku_id
      ), sales AS (
        SELECT oi.sku_id, SUM(oi.quantity) AS units
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE o.created_at >= ${velocityStart}::timestamptz
          AND o.order_status NOT IN ${NON_SALE_ORDER_STATUSES}
        GROUP BY oi.sku_id
      )
      SELECT k.id AS sku_id, k.sku_code, k.created_at,
        p.id AS product_id, p.name AS product_name, v.name AS variant_name,
        COALESCE(s.available, 0) AS available, COALESCE(sa.units, 0) AS units_sold
      FROM skus k
      JOIN products p ON p.id = k.product_id
      JOIN product_variants v ON v.id = k.variant_id
      LEFT JOIN stock s ON s.sku_id = k.id
      LEFT JOIN sales sa ON sa.sku_id = k.id
      WHERE k.status = 'ACTIVE' AND p.status = 'ACTIVE'
        AND (
          COALESCE(s.available, 0) <= ${thresholds.lowStockUnits}
          OR (
            COALESCE(sa.units, 0) > 0
            AND COALESCE(s.available, 0) <= (COALESCE(sa.units, 0) / ${velocityDays}::numeric) * ${thresholds.stockoutHorizonDays}
          )
        )
      ORDER BY COALESCE(s.available, 0) ASC
      LIMIT 30
    `);

    const productIds = [...new Set(rows.map((row) => String(row.product_id)))];
    const images = productIds.length
      ? await this.prisma.productImage.findMany({
          where: { productId: { in: productIds } },
          orderBy: [{ productId: 'asc' }, { sortOrder: 'asc' }],
          select: { productId: true, url: true },
        })
      : [];
    const imageByProduct = new Map<string, string>();
    for (const image of images) {
      if (!imageByProduct.has(image.productId)) imageByProduct.set(image.productId, image.url);
    }

    const now = new Date();
    const alerts = rows.map((row) => {
      const available = num(row.available);
      const unitsSold = num(row.units_sold);
      const estimate = estimateStockout(
        available,
        unitsSold,
        velocityDays,
        new Date(String(row.created_at)),
        now,
      );
      return {
        skuId: String(row.sku_id),
        productName: String(row.product_name),
        variantName: String(row.variant_name),
        skuCode: String(row.sku_code),
        imageUrl: imageByProduct.get(String(row.product_id)) ?? null,
        available,
        unitsSold,
        dailyUnits: estimate.dailyUnits,
        stockoutDays: estimate.days,
        status: estimate.status,
        restockHref: `/admin/inventory?search=${encodeURIComponent(String(row.sku_code))}`,
      } satisfies InventoryAlert;
    });

    // Surface the most urgent first: empty, then soonest estimated stockout.
    return alerts
      .sort((a, b) => {
        if (a.stockoutDays === null && b.stockoutDays === null) return a.available - b.available;
        if (a.stockoutDays === null) return 1;
        if (b.stockoutDays === null) return -1;
        return a.stockoutDays - b.stockoutDays;
      })
      .slice(0, 8);
  }

  private async campaigns(
    userId: string,
    permissions: Set<string>,
    window: DashboardWindow,
  ): Promise<CampaignRow[]> {
    const account: MarketingAccount = { id: userId, permissions: [...permissions] };
    let report: Awaited<ReturnType<MarketingReportService['report']>>;
    try {
      report = await this.marketingReport.report(
        {
          from: window.fromDate,
          to: window.toDate,
          groupBy: 'LINK',
          page: 1,
          pageSize: 100,
        } as MarketingReportQuery,
        account,
      );
    } catch (error) {
      // The dashboard is not a marketing surface: a caller without marketing
      // scope gets an empty card, not a failed page.
      if (error instanceof ForbiddenException) return [];
      this.logger.warn(`campaign report failed: ${(error as Error).message}`);
      return [];
    }

    const rows = report.rows as unknown as Array<Record<string, unknown>>;
    const ids = rows.map((row) => String(row.id));
    if (ids.length === 0) return [];

    const links = await this.prisma.campaignLink.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        name: true,
        status: true,
        createdAt: true,
        landingPage: { select: { startAt: true, endAt: true, status: true } },
      },
    });
    const linkById = new Map(links.map((link) => [link.id, link]));
    const now = Date.now();

    const campaigns = rows.map((row) => {
      const link = linkById.get(String(row.id));
      const startsAt = link?.landingPage?.startAt ?? null;
      const endsAt = link?.landingPage?.endAt ?? null;
      const status: CampaignRow['status'] =
        link?.status === 'DISABLED' || (endsAt && endsAt.getTime() < now)
          ? 'ENDED'
          : startsAt && startsAt.getTime() > now
            ? 'SCHEDULED'
            : 'LIVE';
      return {
        id: String(row.id),
        name: String(row.label ?? link?.name ?? 'Campaign'),
        productName: (row.productName as string | null) ?? null,
        status,
        sales: toMoney(row.validOrderValuePhp),
        orders: num(row.validOrders),
        conversionRate: row.conversionRate === null ? null : Number(row.conversionRate),
        visits: row.visits === null ? null : num(row.visits),
        spendPhp: toMoney(row.spendPhp),
        startsAt: (startsAt ?? link?.createdAt ?? null)?.toISOString() ?? null,
        endsAt: endsAt?.toISOString() ?? null,
        href: `/admin/marketing/${String(row.id)}/edit`,
      } satisfies CampaignRow;
    });

    const rank = { LIVE: 0, SCHEDULED: 1, ENDED: 2 } as const;
    return campaigns
      .sort((a, b) => rank[a.status] - rank[b.status] || b.sales - a.sales)
      .slice(0, 8);
  }

  private async homepagePerformance(window: DashboardWindow) {
    const [rows, document, earliest] = await Promise.all([
      this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT section_id,
          MAX(section_type) AS section_type,
          COUNT(*) FILTER (WHERE event_name = 'HOMEPAGE_SECTION_IMPRESSION') AS impressions,
          COUNT(*) FILTER (WHERE event_name = 'HOMEPAGE_SECTION_CLICK') AS clicks
        FROM analytics_events
        WHERE event_name IN ('HOMEPAGE_SECTION_IMPRESSION','HOMEPAGE_SECTION_CLICK')
          AND section_id IS NOT NULL
          AND event_day >= ${window.fromDate}::date AND event_day <= ${window.toDate}::date
        GROUP BY section_id
      `),
      this.prisma.homepageDocument.findUnique({
        where: { id: HOMEPAGE_DOCUMENT_ID },
        select: { draft: true },
      }),
      this.prisma.analyticsEvent.findFirst({
        where: { eventName: 'HOMEPAGE_SECTION_IMPRESSION' },
        orderBy: { eventDay: 'asc' },
        select: { eventDay: true },
      }),
    ]);

    const sectionMeta = new Map(
      readSectionSchedules(document?.draft).map((section) => [
        section.id,
        { type: section.type, title: section.title },
      ]),
    );

    const sections = rows
      .map((row) => {
        const sectionId = String(row.section_id);
        const meta = sectionMeta.get(sectionId);
        const impressions = num(row.impressions);
        const clicks = num(row.clicks);
        return {
          sectionId,
          sectionType: String(row.section_type ?? meta?.type ?? 'UNKNOWN'),
          // null when the live document does not know this section (a
          // preview build, or a section replaced since the event was sent):
          // the interface then shows the type alone instead of repeating it.
          title: meta?.title ?? null,
          impressions,
          clicks,
          ctr: divide(clicks, impressions),
        };
      })
      .sort((a, b) => b.impressions - a.impressions);

    const impressions = sections.reduce((sum, section) => sum + section.impressions, 0);
    const clicks = sections.reduce((sum, section) => sum + section.clicks, 0);
    return {
      sections,
      totals: { impressions, clicks, ctr: divide(clicks, impressions) },
      trackingSince: earliest?.eventDay ? earliest.eventDay.toISOString().slice(0, 10) : null,
    };
  }

  private quickCreate(permissions: Set<string>): QuickCreateItem[] {
    const items: QuickCreateItem[] = [];
    if (permissions.has('PRODUCT_MANAGE')) {
      items.push({ key: 'PRODUCT', label: 'Add product', href: '/admin/products/new' });
      items.push({ key: 'HOMEPAGE_SECTION', label: 'Add homepage section', href: '/admin/homepage' });
    }
    if (permissions.has('ORDER_VIEW_ALL') || permissions.has('ORDER_CONFIRM')) {
      items.push({ key: 'ORDER', label: 'Create order', href: '/admin/orders?create=1' });
    }
    if (permissions.has('SYSTEM_SETTINGS_EDIT')) {
      items.push({ key: 'DISCOUNT', label: 'Create discount', href: '/admin/newsletter?tab=promotions' });
    }
    if (permissions.has('MARKETING_MANAGE_ALL') || permissions.has('MARKETING_MANAGE_OWN')) {
      items.push({ key: 'CAMPAIGN', label: 'Create campaign', href: '/admin/link-builder' });
    }
    return items;
  }
}

function emptyOrderFacts(): OrderWindowFacts {
  return {
    validOrders: 0,
    grossProductSales: 0,
    discountTotal: 0,
    refundedAmount: 0,
    refundedOrders: 0,
    cancelledOrders: 0,
    signedOrders: 0,
    confirmedOrders: 0,
    customers: 0,
  };
}

function emptyCostFacts(): CostFacts {
  return { productCost: 0, shippingCost: 0, paymentFee: 0, itemLines: 0, costedItemLines: 0 };
}

interface SectionSchedule {
  id: string;
  type: string;
  title: string | null;
  publishAt: Date | null;
  unpublishAt: Date | null;
}

/** Defensive read of the homepage document's section schedules. */
function readSectionSchedules(document: unknown): SectionSchedule[] {
  if (!document || typeof document !== 'object') return [];
  const sections = (document as { sections?: unknown }).sections;
  if (!Array.isArray(sections)) return [];
  const output: SectionSchedule[] = [];
  for (const raw of sections) {
    if (!raw || typeof raw !== 'object') continue;
    const section = raw as Record<string, unknown>;
    if (typeof section.id !== 'string' || typeof section.type !== 'string') continue;
    const schedule = (section.schedule ?? {}) as Record<string, unknown>;
    output.push({
      id: section.id,
      type: section.type,
      title: typeof section.title === 'string' ? section.title : null,
      publishAt: parseDate(schedule.publishAt),
      unpublishAt: parseDate(schedule.unpublishAt),
    });
  }
  return output;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// `normalizeProvince` is re-exported for the spec's convenience.
export { normalizeProvince };
