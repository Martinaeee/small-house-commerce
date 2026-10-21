import type { Product } from "./api";
import type { Paged, ProductStatus } from "./admin-api";
import { adminAuthedFetch, type AdminUser } from "./admin-auth";
import type { LandingContent } from "./marketing-content";

export type MarketingPageStatus = "DRAFT" | "LIVE" | "SCHEDULED" | "ENDED" | "DISABLED";
export interface MarketingPageRow {
  id: string;
  productId: string;
  productName: string;
  productCode: string | null;
  productSlug: string;
  productStatus: ProductStatus;
  ownerUserId: string | null;
  ownerName: string | null;
  aid: string | null;
  name: string;
  slug: string;
  status: "DRAFT" | "ACTIVE" | "DISABLED";
  effectiveStatus: MarketingPageStatus;
  hasUnpublishedChanges: boolean;
  version: number;
  publishedRevision: number;
  publishedAt: string | null;
  startAt: string | null;
  endAt: string | null;
  updatedAt: string;
}
export interface MarketingPageListRow extends MarketingPageRow {
  linkCount: number;
  periodViews: number;
  periodOrders: number;
}
export interface MarketingPageDetail extends MarketingPageRow {
  draftContent: LandingContent | null;
  publishedContent: LandingContent | null;
  sourceContentHash: string | null;
}
export interface MarketingProductOption {
  id: string;
  name: string;
  productCode: string | null;
  slug: string;
  status: ProductStatus;
}
export interface MarketingOwnerOption {
  userId: string;
  aid: string;
  displayName: string;
  status: "ACTIVE" | "DISABLED";
  userStatus: "ACTIVE" | "DISABLED";
}
export interface MarketingPageQuery {
  search?: string;
  productId?: string;
  ownerUserId?: string;
  effectiveStatus?: MarketingPageStatus;
  dateFrom?: string;
  dateTo?: string;
  periodFrom?: string;
  periodTo?: string;
  page?: number;
  pageSize?: number;
}

export type MarketingSourceType = "FB_POST" | "META_AD" | "ORGANIC" | "DIRECT" | "EMAIL" | "OTHER";
export interface CampaignLinkInput {
  productId: string;
  variantId?: string | null;
  landingPageId?: string | null;
  name: string;
  sourceType: MarketingSourceType;
  campaignId?: string | null;
  adsetId?: string | null;
  adId?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
}
export interface CampaignLinkRow extends CampaignLinkInput {
  id: string;
  code: string;
  ownerUserId: string;
  ownerName: string;
  aid: string;
  variantId: string | null;
  variantNameSnapshot: string | null;
  landingPageId: string | null;
  productName: string;
  productCode: string | null;
  pageName: string | null;
  path: string;
  status: "ACTIVE" | "DISABLED";
  version: number;
  createdAt: string;
  updatedAt: string;
}
export interface CampaignLinkQuery {
  search?: string;
  ownerUserId?: string;
  productId?: string;
  landingPageId?: string;
  status?: "ACTIVE" | "DISABLED";
  page?: number;
  pageSize?: number;
}
export interface MarketingLinkContext {
  products: {
    id: string;
    name: string;
    productCode: string | null;
    slug: string;
    variants: { id: string; name: string }[];
    landingPages: { id: string; slug: string; title: string; ownerUserId: string | null; ownerName: string | null; aid: string | null; effectiveStatus: MarketingPageStatus }[];
  }[];
}

export type MarketingReportLevel = "LINK" | "PAGE" | "PRODUCT" | "OWNER";
export interface MarketingReportQuery {
  from?: string;
  to?: string;
  groupBy?: MarketingReportLevel;
  linkIds?: string[];
  ownerUserId?: string;
  productId?: string;
  landingPageId?: string;
  page?: number;
  pageSize?: number;
}
export interface MarketingReportRow {
  kind: "REGISTERED" | "DIRECT" | "LEGACY" | "UNVERIFIED";
  id: string;
  label: string;
  ownerUserId: string | null;
  ownerName: string | null;
  aid: string | null;
  productId: string | null;
  productName: string | null;
  productCode: string | null;
  landingPageId: string | null;
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
  orderCpaUsd: string | null;
  signedCpaUsd: string | null;
  orderRoas: string | null;
  signedRoas: string | null;
  conversionRate: string | null;
  expectedCostDays: number;
  recordedCostDays: number;
  costCoverageComplete: boolean;
  periodBasis: "TOUCH" | "ORDER_CREATED";
}
export interface MarketingReport {
  from: string;
  to: string;
  groupBy: MarketingReportLevel;
  asOf: string;
  page: number;
  pageSize: number;
  total: number;
  rows: MarketingReportRow[];
  otherSources: MarketingReportRow[];
}

export type PerformanceView = "PRODUCT" | "OPTIMIZER";
export type PerformancePreset = "LAST_7_DAYS" | "LAST_30_DAYS" | "THIS_WEEK" | "LAST_WEEK" | "CUSTOM";
export type PerformanceInterval = "DAY" | "WEEK";
export type PerformanceSort = "name" | "visits" | "validOrders" | "conversionRate" | "spendUsd" | "orderCpaUsd" | "signedRoas";
export type EffectivePageStatus = "DRAFT" | "LIVE" | "SCHEDULED" | "ENDED" | "DISABLED";
export interface MarketingPerformanceQuery {
  view: PerformanceView;
  productId?: string;
  ownerUserId?: string;
  landingPageId?: string;
  trendPageId?: string;
  effectiveStatus?: EffectivePageStatus;
  preset: PerformancePreset;
  from?: string;
  to?: string;
  interval: PerformanceInterval;
  compare: boolean;
  sortBy: PerformanceSort;
  sortDirection: "asc" | "desc";
  page: number;
  pageSize: number;
}
export interface MarketingPerformanceOptionsQuery {
  ownerUserId?: string;
}
export interface PerformanceDateRange {
  from: string;
  to: string;
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
  periodBasis: "TOUCH" | "ORDER_CREATED";
}
export type PerformanceMetric = "visits" | "validOrders" | "signedOrders" | "spendUsd" | "orderCpaUsd" | "signedGrossPhp" | "signedRoas" | "conversionRate";
export type TrendMetric = Exclude<PerformanceMetric, "signedGrossPhp" | "conversionRate">;
export interface PerformanceChange {
  state: "COMPARABLE" | "NEW" | "UNCHANGED" | "UNAVAILABLE";
  absolute: string | null;
  percent: string | null;
}
export type PerformanceChanges = Record<PerformanceMetric, PerformanceChange>;
export interface PerformancePeriodResult {
  range: PerformanceDateRange;
  registeredLinkCount: number;
  totals: PerformanceTotals | null;
}
export type PerformanceNotice = "NO_LINKS" | "NOT_STARTED" | "NO_TRAFFIC" | "COSTS_INCOMPLETE" | "PARENT_INACTIVE";
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
  notices: PerformanceNotice[];
}
export interface PerformanceOverview {
  total: number;
  byStatus: Record<EffectivePageStatus, number>;
  byProduct: Array<{ productId: string; productName: string; productCode: string | null; pageCount: number }>;
}
export interface PerformanceBucket extends PerformanceDateRange {
  key: string;
  partialWeek: boolean;
  includesToday: boolean;
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
    current: Array<{ kind: "DIRECT" | "LEGACY" | "UNVERIFIED"; totals: PerformanceTotals }>;
    previous: Array<{ kind: "DIRECT" | "LEGACY" | "UNVERIFIED"; totals: PerformanceTotals }> | null;
  };
}
export interface MarketingPerformanceOptions {
  onlyOwn: boolean;
  products: Array<{ id: string; name: string; productCode: string | null; status: string; pageCount: number }>;
  owners: Array<{ userId: string; name: string; aid: string | null; isActive: boolean; pageCount: number }>;
}

export interface AdCostInput {
  linkId: string;
  costDate: string;
  amountUsd: string;
  phpPerUsd?: string | null;
  note?: string | null;
  expectedVersion?: number;
}
export interface AdCostSnapshot {
  id: string;
  linkId: string;
  ownerUserId: string;
  costDate: string;
  amountUsd: string;
  phpPerUsd: string | null;
  amountPhp: string;
  note: string | null;
  voidedAt: string | null;
  version: number;
}
export interface AdCostRow extends AdCostSnapshot {
  linkCode: string;
  linkName: string;
  ownerName: string;
  aid: string;
  productId: string;
  productName: string;
  productCode: string | null;
  landingPageId: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface AdCostQuery {
  ownerUserId?: string;
  productId?: string;
  landingPageId?: string;
  linkId?: string;
  dateFrom?: string;
  dateTo?: string;
  includeVoided?: boolean;
  page?: number;
  pageSize?: number;
}
export interface AdCostAuditRow {
  id: string;
  actorUserId: string;
  actor: { name: string };
  action: "CREATE" | "UPDATE" | "VOID";
  before: AdCostSnapshot | null;
  after: AdCostSnapshot;
  createdAt: string;
}

function queryString(query: object): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== "") params.set(key, String(value));
  return params.size ? `?${params}` : "";
}
function request<T>(path: string, init?: RequestInit): Promise<T> {
  return adminAuthedFetch<T>(`/api/v1/admin/landing-pages${path}`, { cache: "no-store", referrerPolicy: "no-referrer", ...init });
}
function post<T>(path: string, body: object): Promise<T> {
  return request<T>(path, { method: "POST", body: JSON.stringify(body) });
}
const pagePath = (id: string) => `/${encodeURIComponent(id)}`;
function linkRequest<T>(path: string, init?: RequestInit): Promise<T> {
  return adminAuthedFetch<T>(`/api/v1/admin/campaign-links${path}`, { cache: "no-store", referrerPolicy: "no-referrer", ...init });
}

export function canManageMarketingPage(account: Pick<AdminUser, "id" | "permissions"> | null, ownerUserId: string | null): boolean {
  if (!account) return false;
  return account.permissions.includes("MARKETING_MANAGE_ALL") ||
    (account.permissions.includes("MARKETING_MANAGE_OWN") && account.id === ownerUserId);
}

function costRequest<T>(path: string, init?: RequestInit): Promise<T> {
  return adminAuthedFetch<T>(`/api/v1/admin/marketing/costs${path}`, { cache: "no-store", referrerPolicy: "no-referrer", ...init });
}

export const marketingApi = {
  report: (query: MarketingReportQuery = {}) => adminAuthedFetch<MarketingReport>(`/api/v1/admin/marketing/reports${queryString({ ...query, linkIds: query.linkIds?.join(",") })}`, { cache: "no-store", referrerPolicy: "no-referrer" }),
  performance: (query: MarketingPerformanceQuery) => adminAuthedFetch<MarketingPerformanceReport>(
    `/api/v1/admin/marketing/performance${queryString({ ...query, compare: query.compare ? "1" : "0" })}`,
    { cache: "no-store", referrerPolicy: "no-referrer" },
  ),
  performanceOptions: (query: MarketingPerformanceOptionsQuery = {}) => adminAuthedFetch<MarketingPerformanceOptions>(
    `/api/v1/admin/marketing/performance/options${queryString(query)}`,
    { cache: "no-store", referrerPolicy: "no-referrer" },
  ),
  listCosts: (query: AdCostQuery = {}) => costRequest<Paged<AdCostRow>>(queryString(query)),
  saveCost: (input: AdCostInput) => costRequest<AdCostRow>("", { method: "POST", body: JSON.stringify(input) }),
  voidCost: (id: string, expectedVersion: number) => costRequest<AdCostRow>(`${pagePath(id)}/void`, { method: "POST", body: JSON.stringify({ expectedVersion }) }),
  costAudit: (id: string) => costRequest<AdCostAuditRow[]>(`${pagePath(id)}/audit`),
  getLink: (id: string) => linkRequest<CampaignLinkRow>(pagePath(id)),
  listLinks: (query: CampaignLinkQuery = {}) => linkRequest<Paged<CampaignLinkRow>>(queryString(query)),
  linkContext: () => adminAuthedFetch<MarketingLinkContext>("/api/v1/admin/link-builder/context", { cache: "no-store", referrerPolicy: "no-referrer" }),
  createLink: (input: CampaignLinkInput) => linkRequest<CampaignLinkRow>("", { method: "POST", body: JSON.stringify(input) }),
  updateLink: (id: string, name: string, expectedVersion: number) => linkRequest<CampaignLinkRow>(pagePath(id), { method: "PATCH", body: JSON.stringify({ name, expectedVersion }) }),
  disableLink: (id: string, expectedVersion: number) => linkRequest<CampaignLinkRow>(`${pagePath(id)}/disable`, { method: "POST", body: JSON.stringify({ expectedVersion }) }),
  cloneLink: (id: string, input: Partial<CampaignLinkInput> = {}) => linkRequest<CampaignLinkRow>(`${pagePath(id)}/clone`, { method: "POST", body: JSON.stringify(input) }),
  listPages: (query: MarketingPageQuery = {}) => request<Paged<MarketingPageListRow>>(queryString(query)),
  productOptions: (query: { search?: string; page?: number; pageSize?: number } = {}) => request<Paged<MarketingProductOption>>(`/product-options${queryString(query)}`),
  ownerOptions: () => request<MarketingOwnerOption[]>("/owner-options"),
  getPage: (id: string) => request<MarketingPageDetail>(pagePath(id)),
  uploadMedia: (id: string, file: File, contentType: string) => request<{ url: string; key: string }>(`${pagePath(id)}/uploads`, { method: "POST", headers: { "Content-Type": contentType }, body: file }),
  getPreview: (id: string) => request<{ content: LandingContent; product: Product; version: number }>(`${pagePath(id)}/preview`),
  createPage: (productId: string, name: string, ownerUserId?: string, slug?: string) => post<MarketingPageDetail>("", { productId, name, ...(ownerUserId ? { ownerUserId } : {}), ...(slug ? { slug } : {}) }),
  saveDraft: (id: string, content: LandingContent, expectedVersion: number, name?: string) => request<MarketingPageDetail>(pagePath(id), { method: "PATCH", body: JSON.stringify({ content, expectedVersion, ...(name !== undefined ? { name } : {}) }) }),
  validate: (id: string, content: LandingContent) => post<LandingContent>(`${pagePath(id)}/validate`, { content }),
  publish: (id: string, expectedVersion: number) => post<MarketingPageDetail>(`${pagePath(id)}/publish`, { expectedVersion }),
  assignOwner: (id: string, ownerUserId: string, expectedVersion: number) => post<MarketingPageDetail>(`${pagePath(id)}/assign-owner`, { ownerUserId, expectedVersion }),
  disable: (id: string, expectedVersion: number) => post<MarketingPageDetail>(`${pagePath(id)}/disable`, { expectedVersion }),
  source: (id: string) => request<{ content: LandingContent; sourceContentHash: string; changed: boolean }>(`${pagePath(id)}/source`),
  sync: (id: string, sourceKeys: string[], expectedVersion: number, insertBeforeId?: string | null) => post<MarketingPageDetail>(`${pagePath(id)}/sync`, { sourceKeys, expectedVersion, ...(insertBeforeId !== undefined ? { insertBeforeId } : {}) }),
};
