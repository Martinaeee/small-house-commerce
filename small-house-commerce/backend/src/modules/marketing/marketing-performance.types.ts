import type { MarketingReportRawRow } from './marketing-report-metrics.js';

export type PerformanceView = 'PRODUCT' | 'OPTIMIZER';
export type PerformancePreset = 'LAST_7_DAYS' | 'LAST_30_DAYS' | 'THIS_WEEK' | 'LAST_WEEK' | 'CUSTOM';
export type PerformanceInterval = 'DAY' | 'WEEK';
export type PerformanceSort = 'name' | 'visits' | 'validOrders' | 'conversionRate' | 'spendUsd' | 'orderCpaUsd' | 'signedRoas';
export type EffectivePageStatus = 'DRAFT' | 'LIVE' | 'SCHEDULED' | 'ENDED' | 'DISABLED';

export interface PerformanceDateRange {
  from: string;
  to: string;
}

export interface PerformanceReadRange extends PerformanceDateRange {
  startAt: Date;
  endAt: Date;
}

export interface PerformanceWindow {
  asOf: Date;
  current: PerformanceReadRange;
  previous: PerformanceReadRange | null;
}

export interface PerformanceBucket extends PerformanceDateRange {
  key: string;
  partialWeek: boolean;
  includesToday: boolean;
}

export interface PerformanceTotals {
  visits: number | null;
  pageTotalVisits: number | null;
  submittedOrders: number;
  validOrders: number;
  confirmedOrders: number;
  signedOrders: number;
  duplicateOrders: number;
  riskOrders: number;
  afterSalesOrders: number;
  refundStatusOrders: number;
  validOrderValuePhp: string;
  signedGrossPhp: string;
  spendUsd: string;
  spendPhp: string;
  expectedCostDays: number;
  recordedCostDays: number;
  costCoverageComplete: boolean;
  orderCpaUsd: string | null;
  signedCpaUsd: string | null;
  orderRoas: string | null;
  signedRoas: string | null;
  conversionRate: string | null;
  periodBasis: 'TOUCH' | 'ORDER_CREATED';
}

export type PerformanceMetric =
  | 'visits'
  | 'validOrders'
  | 'signedOrders'
  | 'spendUsd'
  | 'orderCpaUsd'
  | 'signedGrossPhp'
  | 'signedRoas'
  | 'conversionRate';

export type TrendMetric = Exclude<PerformanceMetric, 'signedGrossPhp' | 'conversionRate'>;

export interface PerformanceChange {
  state: 'COMPARABLE' | 'NEW' | 'UNCHANGED' | 'UNAVAILABLE';
  absolute: string | null;
  percent: string | null;
}

export type PerformanceChanges = Record<PerformanceMetric, PerformanceChange>;

export interface PerformancePeriodResult {
  range: PerformanceDateRange;
  registeredLinkCount: number;
  totals: PerformanceTotals | null;
}

export interface PerformancePageInfo {
  id: string;
  name: string;
  slug: string;
  productId: string;
  productName: string;
  productCode: string | null;
  productStatus: string;
  ownerUserId: string | null;
  ownerName: string | null;
  aid: string | null;
  effectiveStatus: EffectivePageStatus;
  linkCount: number;
  createdAt: string;
}

export interface PerformancePageRow extends PerformancePageInfo {
  pageTotalVisits: number;
  current: PerformancePeriodResult;
  previous: PerformancePeriodResult | null;
  changes: PerformanceChanges | null;
  notices: Array<'NO_LINKS' | 'NOT_STARTED' | 'NO_TRAFFIC' | 'COSTS_INCOMPLETE' | 'PARENT_INACTIVE'>;
}

export interface PerformanceOverview {
  total: number;
  byStatus: Record<EffectivePageStatus, number>;
  byProduct: Array<{ productId: string; productName: string; productCode: string | null; pageCount: number }>;
}

export interface PerformancePoint extends PerformanceBucket {
  registeredLinkCount: number;
  totals: PerformanceTotals | null;
}

export interface MarketingPerformanceReport {
  asOf: string;
  scope: {
    view: PerformanceView;
    productId: string | null;
    ownerUserId: string | null;
    landingPageId: string | null;
    effectiveStatus: EffectivePageStatus | null;
    onlyOwn: boolean;
  };
  overview: PerformanceOverview;
  current: PerformancePeriodResult;
  previous: PerformancePeriodResult | null;
  changes: PerformanceChanges | null;
  page: number;
  pageSize: number;
  total: number;
  rows: PerformancePageRow[];
  trend: { pageId: string | null; interval: PerformanceInterval; points: PerformancePoint[] };
  otherSources: {
    current: Array<{ kind: 'DIRECT' | 'LEGACY' | 'UNVERIFIED'; totals: PerformanceTotals }>;
    previous: Array<{ kind: 'DIRECT' | 'LEGACY' | 'UNVERIFIED'; totals: PerformanceTotals }> | null;
  };
}

export interface MarketingPerformanceOptions {
  onlyOwn: boolean;
  products: Array<{ id: string; name: string; productCode: string | null; status: string; thumbnailUrl: string | null; pageCount: number }>;
  owners: Array<{ userId: string; name: string; aid: string | null; isActive: boolean; pageCount: number }>;
}

export interface PerformanceSqlScope {
  pageIds: string[];
  ownerUserId: string | null;
  productId: string | null;
  landingPageId: string | null;
}

export interface PerformanceAggregateRow extends MarketingReportRawRow {
  registeredLinkCount: bigint;
}

export interface PerformancePageVisitsRow {
  id: string;
  visits: bigint;
}
