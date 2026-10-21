import type { DashboardWindow } from './dashboard-range.js';
import { manilaDay } from './dashboard-range.js';

/**
 * Canonical dashboard arithmetic.
 *
 * One definition per metric, used by every dashboard surface. These are pure
 * functions so the口径 can be unit-tested without a database, and so the same
 * numbers cannot drift between the KPI row and the drill-down cards.
 *
 * DEFINITIONS (dashboard §3)
 *   Net Sales      = product sales (subtotal) − order discounts − refunded value
 *   Orders         = distinct orders created in the window, excluding
 *                    CANCELLED and DENIED (an invalid order is not a sale)
 *   AOV            = Net Sales / Orders
 *   Conversion     = sessions that ordered / sessions that visited
 *   Refund Rate    = orders whose payment status is refunded / valid orders
 *                    (count basis: the schema records refund STATE, not amount,
 *                    except for a full REFUNDED order which we can subtract)
 *   Gross Profit   = Net Sales − product cost − shipping cost − payment fees,
 *                    reported as unavailable while cost coverage is incomplete
 *
 * Shipping revenue is always zero today (checkout has no rate rules yet), so
 * Net Sales never adds it.
 */

export type ChangeDirection = 'UP' | 'DOWN' | 'FLAT' | 'UNKNOWN';

export interface MetricChange {
  /** Percentage change against the previous window; null when incomparable. */
  percent: number | null;
  direction: ChangeDirection;
}

export interface OrderWindowFacts {
  validOrders: number;
  grossProductSales: number;
  discountTotal: number;
  refundedAmount: number;
  refundedOrders: number;
  cancelledOrders: number;
  signedOrders: number;
  confirmedOrders: number;
  customers: number;
}

export interface CostFacts {
  productCost: number;
  shippingCost: number;
  paymentFee: number;
  /** Order-item lines counted for coverage. */
  itemLines: number;
  /** Lines that carried a cost snapshot. */
  costedItemLines: number;
}

export interface KpiValue {
  /** Raw number, or null when the metric cannot be computed honestly. */
  value: number | null;
  change: MetricChange;
  /** Why `value` is null; omitted when the value is real. */
  unavailableReason?: string;
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function divide(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null;
  }
  return numerator / denominator;
}

export function percentChange(current: number, previous: number | null): MetricChange {
  if (previous === null || !Number.isFinite(previous)) {
    return { percent: null, direction: 'UNKNOWN' };
  }
  if (previous === 0) {
    if (current === 0) return { percent: 0, direction: 'FLAT' };
    // Growth from zero has no meaningful percentage; signal it without
    // pretending it is +100% or +∞.
    return { percent: null, direction: 'UP' };
  }
  const percent = ((current - previous) / Math.abs(previous)) * 100;
  const rounded = Math.round(percent * 10) / 10;
  return {
    percent: rounded,
    direction: rounded > 0.05 ? 'UP' : rounded < -0.05 ? 'DOWN' : 'FLAT',
  };
}

export function netSales(facts: OrderWindowFacts): number {
  return roundMoney(
    Math.max(0, facts.grossProductSales - facts.discountTotal - facts.refundedAmount),
  );
}

export function averageOrderValue(sales: number, orders: number): number | null {
  const value = divide(sales, orders);
  return value === null ? null : roundMoney(value);
}

/** Ratio in [0,1]; null when there is no traffic to divide by. */
export function conversionRate(orderingSessions: number, sessions: number): number | null {
  const value = divide(orderingSessions, sessions);
  return value === null ? null : Math.round(value * 10000) / 10000;
}

export function refundRate(refundedOrders: number, validOrders: number): number | null {
  const value = divide(refundedOrders, validOrders);
  return value === null ? null : Math.round(value * 10000) / 10000;
}

/** Ratio of two counts, rounded to 4 dp; null when the denominator is zero. */
export function rate(numerator: number, denominator: number): number | null {
  const value = divide(numerator, denominator);
  return value === null ? null : Math.round(value * 10000) / 10000;
}

/** Severity order of the product anomaly types, most urgent first. */
export const PRODUCT_ISSUE_ORDER = [
  'OUT_OF_STOCK',
  'HIGH_CANCELLATION',
  'HIGH_REFUND',
  'LOW_CONVERSION',
  'LOW_TRAFFIC',
] as const;

/**
 * Picks the rows the anomaly card shows.
 *
 * Twenty out-of-stock products must not push "this one converts badly" out
 * of sight, so the list is taken round by round: every detected issue type
 * gets a slot first, and only then are the remaining slots filled by
 * severity.
 */
export function pickAcrossIssues<T extends { issue: string }>(
  flagged: T[],
  limit = 8,
): T[] {
  const byIssue = new Map<string, T[]>();
  for (const item of flagged) {
    const list = byIssue.get(item.issue) ?? [];
    list.push(item);
    byIssue.set(item.issue, list);
  }
  const queues = PRODUCT_ISSUE_ORDER.map((issue) => byIssue.get(issue) ?? []).filter(
    (list) => list.length > 0,
  );
  const picked: T[] = [];
  let round = 0;
  while (picked.length < limit) {
    let added = false;
    for (const queue of queues) {
      if (round >= queue.length) continue;
      picked.push(queue[round]);
      added = true;
      if (picked.length >= limit) break;
    }
    if (!added) break;
    round += 1;
  }
  return picked;
}

export interface GrossProfitResult {
  value: number | null;
  /** Share of order lines that carried a cost snapshot, 0-1. */
  costCoverage: number;
  /**
   * True when every order line carried a cost snapshot. Shipping and payment
   * fees are NOT part of this flag: they are separate inputs the system
   * simply does not record yet, and the result names them in `missing`.
   */
  productCostComplete: boolean;
  /** Cost inputs that were not recorded for this period. */
  missing: string[];
}

export function grossProfit(
  sales: number,
  costs: CostFacts,
): GrossProfitResult {
  const costCoverage =
    costs.itemLines === 0 ? 0 : Math.round((costs.costedItemLines / costs.itemLines) * 10000) / 10000;
  const missing: string[] = [];
  if (costs.itemLines > 0 && costs.costedItemLines < costs.itemLines) {
    missing.push('PRODUCT_COST');
  }
  if (costs.shippingCost === 0) missing.push('SHIPPING_COST');
  if (costs.paymentFee === 0) missing.push('PAYMENT_FEE');

  // Never publish a profit built on partial product cost: a number that
  // silently omits unrecorded costs reads as real money.
  if (costs.itemLines === 0 || costs.costedItemLines < costs.itemLines) {
    return { value: null, costCoverage, productCostComplete: false, missing };
  }
  const profit = sales - costs.productCost - costs.shippingCost - costs.paymentFee;
  return { value: roundMoney(profit), costCoverage, productCostComplete: true, missing };
}

export type StockDataStatus = 'OK' | 'OUT_OF_STOCK' | 'NO_RECENT_SALES' | 'NEW_SKU';

/**
 * Days until stock reaches zero at the recent sales pace.
 *
 * Returns null with a status instead of inventing a number when the SKU has
 * no sales in the window, is newer than the window, or is already empty.
 */
export function estimateStockout(
  available: number,
  unitsSoldInWindow: number,
  windowDays: number,
  skuCreatedAt: Date,
  now: Date,
): { days: number | null; status: StockDataStatus; dailyUnits: number } {
  const dailyUnits =
    windowDays <= 0 ? 0 : Math.round((unitsSoldInWindow / windowDays) * 1000) / 1000;

  if (available <= 0) return { days: 0, status: 'OUT_OF_STOCK', dailyUnits };
  const ageDays = (now.getTime() - skuCreatedAt.getTime()) / 86_400_000;
  if (ageDays < windowDays) return { days: null, status: 'NEW_SKU', dailyUnits };
  if (unitsSoldInWindow <= 0 || dailyUnits <= 0) {
    return { days: null, status: 'NO_RECENT_SALES', dailyUnits };
  }
  return {
    days: Math.round((available / dailyUnits) * 10) / 10,
    status: 'OK',
    dailyUnits,
  };
}

/** Province spellings that mean the same place; anything else is left alone. */
const PROVINCE_ALIASES: Record<string, string> = {
  ncr: 'Metro Manila',
  'national capital region': 'Metro Manila',
  'metro manila': 'Metro Manila',
  'manila metropolitan area': 'Metro Manila',
  'region ncr': 'Metro Manila',
};

export function normalizeProvince(raw: string | null | undefined): string {
  const value = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (value === '') return 'Unspecified';
  const alias = PROVINCE_ALIASES[value.toLowerCase()];
  return alias ?? value;
}

export interface LocationAggregate {
  province: string;
  orders: number;
  revenue: number;
}

/** Collapses provinces into the top N plus an "Others" bucket. */
export function groupLocations(
  rows: LocationAggregate[],
  limit = 5,
): { rows: LocationAggregate[]; total: number } {
  const merged = new Map<string, LocationAggregate>();
  for (const row of rows) {
    const province = normalizeProvince(row.province);
    const current = merged.get(province) ?? { province, orders: 0, revenue: 0 };
    current.orders += row.orders;
    current.revenue += row.revenue;
    merged.set(province, current);
  }
  const sorted = [...merged.values()].sort((a, b) => b.orders - a.orders || b.revenue - a.revenue);
  const total = sorted.reduce((sum, row) => sum + row.orders, 0);
  if (sorted.length <= limit) {
    return {
      rows: sorted.map((row) => ({ ...row, revenue: roundMoney(row.revenue) })),
      total,
    };
  }
  const head = sorted.slice(0, limit);
  const rest = sorted.slice(limit);
  const others: LocationAggregate = {
    province: 'Others',
    orders: rest.reduce((sum, row) => sum + row.orders, 0),
    revenue: rest.reduce((sum, row) => sum + row.revenue, 0),
  };
  return {
    rows: [...head, others].map((row) => ({ ...row, revenue: roundMoney(row.revenue) })),
    total,
  };
}

export interface DailyPoint {
  day: string;
  label: string;
  revenue: number;
  orders: number;
}

/** Fills gaps so a chart never skips a quiet day. */
export function fillDailySeries(
  rows: Array<{ day: string; revenue: number; orders: number }>,
  window: DashboardWindow,
): DailyPoint[] {
  const byDay = new Map(rows.map((row) => [row.day, row]));
  const points: DailyPoint[] = [];
  const start = new Date(`${window.fromDate}T00:00:00.000Z`);
  const weekday = new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric',
  });
  for (let index = 0; index < window.days; index += 1) {
    const day = new Date(start.getTime() + index * 86_400_000).toISOString().slice(0, 10);
    const row = byDay.get(day);
    points.push({
      day,
      label: weekday.format(new Date(`${day}T04:00:00.000Z`)),
      revenue: row ? roundMoney(row.revenue) : 0,
      orders: row ? row.orders : 0,
    });
  }
  return points;
}

/** Manila day string of an instant, re-exported for callers building rows. */
export function dayOf(instant: Date): string {
  return manilaDay(instant);
}
