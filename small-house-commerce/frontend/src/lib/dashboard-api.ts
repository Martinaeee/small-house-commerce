/**
 * Dashboard API client.
 *
 * Three grouped reads — overview, products, marketing — instead of one call
 * per card. Money arrives as a NUMBER here (the dashboard service rounds
 * before serialising), so these types deliberately differ from the raw-Prisma
 * admin endpoints that return Decimal strings.
 */

import { adminAuthedFetch } from "./admin-auth";

export type DashboardRangePreset =
  | "TODAY"
  | "YESTERDAY"
  | "LAST_7_DAYS"
  | "LAST_30_DAYS"
  | "THIS_MONTH"
  | "LAST_MONTH"
  | "CUSTOM";

/** How the product-performance table is ranked. */
export type ProductPerformanceSort = "revenue" | "orders" | "signed_rate" | "units";

export interface DashboardQuery {
  range: DashboardRangePreset;
  from?: string;
  to?: string;
  sort?: ProductPerformanceSort;
}

export type ChangeDirection = "UP" | "DOWN" | "FLAT" | "UNKNOWN";

export interface MetricChange {
  percent: number | null;
  direction: ChangeDirection;
}

export type AttentionTone = "red" | "amber" | "green" | "neutral";

export interface KpiValue {
  value: number | null;
  change: MetricChange;
  unavailableReason?: string;
}

export interface GrossProfitKpi extends KpiValue {
  costCoverage: number;
  /** True when the published value excludes an unrecorded cost input. */
  partial: boolean;
  missing: string[];
}

export interface RangeInfo {
  preset: DashboardRangePreset;
  fromDate: string;
  toDate: string;
  days: number;
  previousFromDate: string;
  previousToDate: string;
}

export interface DashboardCapabilities {
  sales: boolean;
  profit: boolean;
  inventory: boolean;
  products: boolean;
  marketing: boolean;
  content: boolean;
  customers: boolean;
}

export interface DailyPoint {
  day: string;
  label: string;
  revenue: number;
  orders: number;
}

export interface AttentionItem {
  key: string;
  /** Dictionary key for the row label; the wording lives in the interface. */
  labelKey: string;
  count: number;
  href: string;
  tone: AttentionTone;
  /** Dictionary key for the secondary line, when there is one. */
  hintKey?: string;
}

export interface OrderTile {
  key: string;
  count: number;
  href: string;
  tone: AttentionTone;
}

export interface LocationRow {
  province: string;
  orders: number;
  revenue: number;
}

export interface RecentOrder {
  id: string;
  orderNumber: string;
  customerName: string;
  itemCount: number;
  total: string;
  currency: string;
  paymentStatus: string;
  orderStatus: string;
  confirmationStatus: string;
  createdAt: string;
}

export interface CustomerSnapshot {
  newCustomers: number;
  returningCustomers: number;
  repeatPurchaseRate: number | null;
  repeatCustomers: number;
  /** Customers with at least one valid order in the period. */
  periodCustomers: number;
  emailSubscribers: number;
  newEmailSubscribers: number;
}

export interface ScheduledItem {
  id: string;
  kind: string;
  title: string;
  status: "SCHEDULED" | "LIVE" | "ENDED";
  scheduledFor: string | null;
  endsAt: string | null;
  href: string;
}

export interface QuickCreateItem {
  key: string;
  label: string;
  href: string;
}

export interface DataNote {
  key: string;
  /** Values the interface needs to phrase the note (e.g. a coverage %). */
  params?: Record<string, string | number>;
}

export interface DashboardOverview {
  range: RangeInfo;
  generatedAt: string;
  currency: "PHP";
  capabilities: DashboardCapabilities;
  kpis: {
    netSales: KpiValue;
    orders: KpiValue;
    conversionRate: KpiValue;
    averageOrderValue: KpiValue;
    refundRate: KpiValue;
    grossProfit: GrossProfitKpi;
  };
  salesSeries: DailyPoint[];
  salesTotals: {
    totalSales: number;
    orders: number;
    averageOrderValue: number | null;
    customers: number;
  };
  needsAttention: AttentionItem[];
  ordersOverview: { tiles: OrderTile[]; total: number };
  ordersByLocation: { rows: LocationRow[]; total: number };
  customerSnapshot: CustomerSnapshot | null;
  scheduledContent: ScheduledItem[];
  recentOrders: RecentOrder[];
  quickCreate: QuickCreateItem[];
  dataNotes: DataNote[];
}

export interface DashboardThresholds {
  lowStockUnits: number;
  stockoutHorizonDays: number;
  velocityWindowDays: number;
  lowConversionRate: number;
  minViewsForConversion: number;
  highCancellationRate: number;
  minOrdersForCancellation: number;
  lowTrafficViews: number;
  highRefundRate: number;
  minOrdersForRefund: number;
}

export interface TopProduct {
  productId: string;
  name: string;
  slug: string | null;
  imageUrl: string | null;
  /** All orders created in the period that contain the product. */
  orders: number;
  /** Orders that were not cancelled or denied. */
  validOrders: number;
  units: number;
  revenue: number;
  signedOrders: number;
  /** Signed orders ÷ orders (cancelled and denied stay in the denominator). */
  signedRate: number | null;
  /** Product cost; null while the cost snapshot is incomplete. */
  cost: number | null;
  /** revenue − cost; null while the cost snapshot is incomplete. */
  profit: number | null;
  /** Share of this product's order lines that carried a cost snapshot, 0-1. */
  costCoverage: number;
  change: MetricChange;
}

export interface CodMetrics {
  createdOrders: number;
  validOrders: number;
  confirmedOrders: number;
  shippedOrders: number;
  signedOrders: number;
  cancelledOrders: number;
  deniedOrders: number;
  confirmationRate: number | null;
  signedRate: number | null;
  cancelRate: number | null;
  deniedRate: number | null;
  /** Signed orders ÷ orders that entered shipping. */
  shippingToSignedRate: number | null;
}

export interface ProductAttention {
  productId: string;
  name: string;
  imageUrl: string | null;
  issue:
    | "LOW_CONVERSION"
    | "HIGH_CANCELLATION"
    | "HIGH_REFUND"
    | "LOW_TRAFFIC"
    | "OUT_OF_STOCK";
  /** The measured rate (0-1), or the view count for the traffic issue. */
  value: number;
  /** Orders of this product in the period, when the issue needs a denominator. */
  orders: number | null;
  /** Distinct viewers of this product in the period, when the issue needs it. */
  views: number | null;
}

export interface InventoryAlert {
  skuId: string;
  productName: string;
  variantName: string;
  skuCode: string;
  imageUrl: string | null;
  available: number;
  unitsSold: number;
  dailyUnits: number;
  stockoutDays: number | null;
  status: "OK" | "OUT_OF_STOCK" | "NO_RECENT_SALES" | "NEW_SKU";
  restockHref: string;
}

export interface DashboardProducts {
  range: RangeInfo;
  generatedAt: string;
  capabilities: Pick<DashboardCapabilities, "products" | "inventory">;
  thresholds: DashboardThresholds;
  topProducts: TopProduct[];
  productAttention: ProductAttention[];
  inventoryAlerts: InventoryAlert[];
  /** Period fulfilment metrics; null when the caller may not read orders. */
  codMetrics: CodMetrics | null;
  /** The ranking the product table is sorted by. */
  sort: ProductPerformanceSort;
}

export interface CampaignRow {
  id: string;
  name: string;
  productName: string | null;
  status: "LIVE" | "SCHEDULED" | "ENDED";
  sales: number;
  orders: number;
  conversionRate: number | null;
  visits: number | null;
  spendPhp: number;
  startsAt: string | null;
  endsAt: string | null;
  href: string;
}

export interface HomepageSectionPerformance {
  sectionId: string;
  sectionType: string;
  /** Title from the live homepage document; null when it does not know the section. */
  title: string | null;
  impressions: number;
  clicks: number;
  ctr: number | null;
}

export interface DashboardMarketing {
  range: RangeInfo;
  generatedAt: string;
  capabilities: Pick<DashboardCapabilities, "marketing" | "content">;
  campaigns: CampaignRow[];
  homepage: {
    sections: HomepageSectionPerformance[];
    totals: { impressions: number; clicks: number; ctr: number | null };
    trackingSince: string | null;
  };
}

function toQueryString(query: DashboardQuery): string {
  const params = new URLSearchParams({ range: query.range });
  if (query.range === "CUSTOM") {
    if (query.from) params.set("from", query.from);
    if (query.to) params.set("to", query.to);
  }
  if (query.sort) params.set("sort", query.sort);
  return params.toString();
}

export const dashboardApi = {
  overview: (query: DashboardQuery): Promise<DashboardOverview> =>
    adminAuthedFetch(`/api/v1/admin/dashboard/overview?${toQueryString(query)}`),
  products: (query: DashboardQuery): Promise<DashboardProducts> =>
    adminAuthedFetch(`/api/v1/admin/dashboard/products?${toQueryString(query)}`),
  marketing: (query: DashboardQuery): Promise<DashboardMarketing> =>
    adminAuthedFetch(`/api/v1/admin/dashboard/marketing?${toQueryString(query)}`),
};
