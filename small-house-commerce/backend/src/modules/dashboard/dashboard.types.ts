import type { MetricChange } from './dashboard-metrics.js';

/**
 * Dashboard response contracts.
 *
 * The UI renders exactly these objects; every field that can be honestly
 * unavailable is nullable and paired with a reason, so "no data" never renders
 * as a convincing zero.
 */

export type AttentionTone = 'red' | 'amber' | 'green' | 'neutral';

/**
 * An operational backlog row.
 *
 * The label is a KEY, not a sentence: the wording belongs to the interface
 * (which is bilingual), the API stays language-neutral. `hintKey` is the
 * same idea for the secondary line.
 */
export interface AttentionItem {
  key: string;
  labelKey: string;
  count: number;
  href: string;
  tone: AttentionTone;
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

export interface Kpi {
  value: number | null;
  change: MetricChange;
  unavailableReason?: string;
}

export interface GrossProfitKpi extends Kpi {
  costCoverage: number;
  missing: string[];
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

export interface RangeInfo {
  preset: string;
  fromDate: string;
  toDate: string;
  days: number;
  previousFromDate: string;
  previousToDate: string;
}

export interface DailyPoint {
  day: string;
  label: string;
  revenue: number;
  orders: number;
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
  totalCustomers: number;
  emailSubscribers: number;
  newEmailSubscribers: number;
}

export interface ScheduledItem {
  id: string;
  /** HOMEPAGE_VERSION | HOMEPAGE_SECTION | LANDING_PAGE | PROMOTION */
  kind: string;
  title: string;
  status: 'SCHEDULED' | 'LIVE' | 'ENDED';
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

export interface DashboardOverviewResponse {
  range: RangeInfo;
  generatedAt: string;
  currency: 'PHP';
  capabilities: DashboardCapabilities;
  kpis: {
    netSales: Kpi;
    orders: Kpi;
    conversionRate: Kpi;
    averageOrderValue: Kpi;
    refundRate: Kpi;
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

export interface TopProduct {
  productId: string;
  name: string;
  slug: string | null;
  imageUrl: string | null;
  /** All orders created in the period that contain the product (signed-rate denominator). */
  orders: number;
  /** Orders that were not cancelled or denied. */
  validOrders: number;
  units: number;
  /** Product revenue, net of the order-level discount allocated to the lines. */
  revenue: number;
  signedOrders: number;
  /** Signed orders ÷ orders (cancelled and denied stay in the denominator). */
  signedRate: number | null;
  /** Product cost; null when the product's lines do not all carry a cost snapshot. */
  cost: number | null;
  /** revenue − cost; null when the cost is unknown. */
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
  /** Signed orders ÷ orders that entered shipping (a different metric from the signed rate). */
  shippingToSignedRate: number | null;
}

export interface ProductAttention {
  productId: string;
  name: string;
  imageUrl: string | null;
  issue: 'LOW_CONVERSION' | 'HIGH_CANCELLATION' | 'HIGH_REFUND' | 'LOW_TRAFFIC' | 'OUT_OF_STOCK';
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
  status: 'OK' | 'OUT_OF_STOCK' | 'NO_RECENT_SALES' | 'NEW_SKU';
  restockHref: string;
}

export interface DashboardProductsResponse {
  range: RangeInfo;
  generatedAt: string;
  capabilities: Pick<DashboardCapabilities, 'products' | 'inventory'>;
  thresholds: {
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
  };
  topProducts: TopProduct[];
  productAttention: ProductAttention[];
  inventoryAlerts: InventoryAlert[];
  /** Period fulfilment metrics; null when the caller may not read orders. */
  codMetrics: CodMetrics | null;
  /** The ranking the table is sorted by. */
  sort: string;
}

export interface CampaignRow {
  id: string;
  name: string;
  productName: string | null;
  status: 'LIVE' | 'SCHEDULED' | 'ENDED';
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

export interface DashboardMarketingResponse {
  range: RangeInfo;
  generatedAt: string;
  capabilities: Pick<DashboardCapabilities, 'marketing' | 'content'>;
  campaigns: CampaignRow[];
  homepage: {
    sections: HomepageSectionPerformance[];
    totals: { impressions: number; clicks: number; ctr: number | null };
    /** First day with any section event; null when tracking has no data yet. */
    trackingSince: string | null;
  };
}
