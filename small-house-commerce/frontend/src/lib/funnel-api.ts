import { adminAuthedFetch } from "./admin-auth";
export type FailureReason =
  "VALIDATION" | "STOCK" | "NETWORK" | "SERVER" | "UNKNOWN";
export type FunnelKey =
  "VIEW" | "ADD_TO_CART" | "CHECKOUT" | "ATTEMPT" | "FAILURE" | "ORDER";
export interface FunnelStep {
  key: FunnelKey;
  rate: number | null;
  baselineRate: number | null;
  flagged: boolean;
  base: number;
  hits: number;
  sampleSmall: boolean;
}
export interface FunnelRow {
  productId: string;
  productName: string;
  productCode: string | null;
  thumbnailUrl: string | null;
  visits: number;
  views: number;
  addToCarts: number;
  checkouts: number;
  attempts: number;
  failures: number;
  orders: number;
  orderingSessions: number;
  conversion: number | null;
  steps: FunnelStep[];
  failureReasons: Partial<Record<FailureReason, number>>;
}
export interface FunnelFilters {
  from: string;
  to: string;
  traffic: "ALL" | "ADS" | "ORGANIC";
  ownerUserId?: string;
  productId?: string;
}
export interface FunnelReport {
  from: string;
  to: string;
  traffic: string;
  ownerUserId: string | null;
  baselineFrom: string;
  baselineTo: string;
  asOf: string;
  rows: FunnelRow[];
  total: number;
  page: number;
  pageSize: number;
}
export interface FunnelDetail {
  product: FunnelRow;
  baselineFrom: string;
  baselineTo: string;
  daily: Array<{
    day: string;
    visits: number;
    views: number;
    addToCarts: number;
    checkouts: number;
    attempts: number;
    failures: number;
    orders: number;
  }>;
  reasons: Array<{ label: string; count: number }>;
  devices: Array<{ label: string; count: number }>;
  sources: Array<{ label: string; count: number }>;
  messages: Array<{ label: string; count: number }>;
}
export interface FunnelDiagnostic {
  step?: "form" | "confirm";
  attemptId?: string;
  retry?: number;
  reason?: FailureReason;
  field?: string;
  httpStatus?: number | null;
  message?: string;
  skuIds?: string[];
  quantities?: number[];
  variantNames?: Array<string | null>;
  idempotencyKey?: string;
  customer?: Record<string, string | null>;
}
export interface FunnelSession {
  sessionId: string;
  startedAt: string;
  lastAt: string;
  entryPath: string;
  device: string;
  source: string;
  events: Array<{
    eventName: string;
    at: string;
    pagePath: string;
    diagnostic?: FunnelDiagnostic | null;
  }>;
}
export interface FunnelSessions {
  items: FunnelSession[];
  nextCursor: string | null;
}
function qs(q: object) {
  return new URLSearchParams(
    Object.entries(q)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => [k, String(v)]),
  ).toString();
}
const options = { cache: "no-store", referrerPolicy: "no-referrer" } as const;
export const funnelApi = {
  list: (
    q: FunnelFilters & {
      q?: string;
      onlyAnomaly?: string;
      sort?: string;
      page?: number;
    },
  ) =>
    adminAuthedFetch<FunnelReport>(
      `/api/v1/admin/marketing/funnel?${qs(q)}`,
      options,
    ),
  detail: (id: string, q: FunnelFilters) =>
    adminAuthedFetch<FunnelDetail>(
      `/api/v1/admin/marketing/funnel/${encodeURIComponent(id)}/detail?${qs(q)}`,
      options,
    ),
  sessions: (
    q: FunnelFilters & {
      productId: string;
      reason?: string;
      device?: string;
      source?: string;
      onlyFailures?: string;
      cursor?: string;
    },
  ) =>
    adminAuthedFetch<FunnelSessions>(
      `/api/v1/admin/marketing/funnel/sessions?${qs(q)}`,
      options,
    ),
};
