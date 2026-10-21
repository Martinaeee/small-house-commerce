/**
 * Dashboard thresholds (dashboard §10-11).
 *
 * The anomaly rules are business policy, not component detail, so they live
 * here as one typed object. Every value can be overridden by an environment
 * variable without a code change, and the API returns the resolved object so
 * the UI can explain *why* a product was flagged.
 *
 * Defaults are deliberately conservative: they favour silence over noise.
 */

export interface DashboardThresholds {
  /** Remaining units at or below this count as low stock. */
  lowStockUnits: number;
  /** Only surface stockout estimates within this many days. */
  stockoutHorizonDays: number;
  /** Sales window used to derive daily units sold. */
  velocityWindowDays: number;
  /** Below this order/purchase ratio a product is a low converter. */
  lowConversionRate: number;
  /** Minimum product views before low conversion is claimed. */
  minViewsForConversion: number;
  /** At or above this cancelled share a product looks like a high canceller. */
  highCancellationRate: number;
  /** Minimum orders before the cancellation rule applies. */
  minOrdersForCancellation: number;
  /** Below this many views a product is considered low traffic. */
  lowTrafficViews: number;
  /** At or above this refunded share a product looks like a high refunder. */
  highRefundRate: number;
  /** Minimum orders before the refund rule applies. */
  minOrdersForRefund: number;
}

export const DEFAULT_THRESHOLDS: DashboardThresholds = {
  lowStockUnits: 10,
  stockoutHorizonDays: 14,
  velocityWindowDays: 7,
  lowConversionRate: 0.01,
  minViewsForConversion: 50,
  highCancellationRate: 0.15,
  minOrdersForCancellation: 5,
  lowTrafficViews: 20,
  highRefundRate: 0.05,
  minOrdersForRefund: 5,
};

type EnvSource = Record<string, string | undefined>;

function readNumber(
  env: EnvSource,
  name: string,
  fallback: number,
  { min, max }: { min: number; max: number },
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/** Resolves thresholds from the environment, ignoring malformed values. */
export function resolveThresholds(env: EnvSource = {}): DashboardThresholds {
  return {
    lowStockUnits: readNumber(env, 'DASHBOARD_LOW_STOCK_UNITS', DEFAULT_THRESHOLDS.lowStockUnits, { min: 0, max: 100000 }),
    stockoutHorizonDays: readNumber(env, 'DASHBOARD_STOCKOUT_HORIZON_DAYS', DEFAULT_THRESHOLDS.stockoutHorizonDays, { min: 1, max: 365 }),
    velocityWindowDays: readNumber(env, 'DASHBOARD_VELOCITY_WINDOW_DAYS', DEFAULT_THRESHOLDS.velocityWindowDays, { min: 1, max: 90 }),
    lowConversionRate: readNumber(env, 'DASHBOARD_LOW_CONVERSION_RATE', DEFAULT_THRESHOLDS.lowConversionRate, { min: 0, max: 1 }),
    minViewsForConversion: readNumber(env, 'DASHBOARD_MIN_VIEWS_FOR_CONVERSION', DEFAULT_THRESHOLDS.minViewsForConversion, { min: 1, max: 1000000 }),
    highCancellationRate: readNumber(env, 'DASHBOARD_HIGH_CANCELLATION_RATE', DEFAULT_THRESHOLDS.highCancellationRate, { min: 0, max: 1 }),
    minOrdersForCancellation: readNumber(env, 'DASHBOARD_MIN_ORDERS_FOR_CANCELLATION', DEFAULT_THRESHOLDS.minOrdersForCancellation, { min: 1, max: 100000 }),
    lowTrafficViews: readNumber(env, 'DASHBOARD_LOW_TRAFFIC_VIEWS', DEFAULT_THRESHOLDS.lowTrafficViews, { min: 0, max: 1000000 }),
    highRefundRate: readNumber(env, 'DASHBOARD_HIGH_REFUND_RATE', DEFAULT_THRESHOLDS.highRefundRate, { min: 0, max: 1 }),
    minOrdersForRefund: readNumber(env, 'DASHBOARD_MIN_ORDERS_FOR_REFUND', DEFAULT_THRESHOLDS.minOrdersForRefund, { min: 1, max: 100000 }),
  };
}
