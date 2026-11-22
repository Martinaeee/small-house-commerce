import { ForbiddenException, Injectable, Optional } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AlertService } from './alert.service.js';
import { ApiMetricsService } from './api-metrics.service.js';
import { ROUTE_BUDGET_MS, type RouteGroup } from './api-metrics.js';
import {
  buildUptime,
  manilaDays,
  nodeState,
  overallProbeStatus,
  probeReason,
  probeRoutes,
  type ProbeCheckValue,
  type ProbeRouteStatus,
  type ProbeSource,
  type UptimeDay,
} from './observability-availability.js';

/**
 * Storefront Health (P1R): the minimal health contract that later phases fill.
 *
 * P1R deliberately asserts nothing: without probe or alert evidence the
 * status is UNKNOWN, never green. Business analytics were removed from this
 * module so Dashboard / ProductFunnel / Orders own those numbers.
 */

export interface ObservabilityAccount {
  id: string;
  permissions: string[];
}

export type HealthStatus = 'OPERATIONAL' | 'DEGRADED' | 'DOWN' | 'UNKNOWN' | 'MAINTENANCE';

export type SectionState = 'NO_DATA' | 'NOT_ENABLED' | 'VALUE' | 'UNKNOWN';

export interface HealthSection {
  state: SectionState;
  /** Real five-state health when the section has evaluated data. */
  status?: HealthStatus;
  note?: string;
}

export interface TelemetryActivity {
  state: 'VALUE' | 'UNKNOWN';
  lastEventAt?: string | null;
  events24h?: number | null;
  sources?: string[];
  note: string;
}

export interface HealthResponse {
  status: HealthStatus;
  reason: string;
  asOf: string;
  sections: {
    availability: HealthSection;
    issues: HealthSection;
    pageExperience: HealthSection;
    checkout: HealthSection;
  };
  telemetryActivity: TelemetryActivity;
}

export interface AvailabilityRoute {
  key: string;
  path: string;
  dns: ProbeCheckValue;
  tls: ProbeCheckValue;
  http: ProbeCheckValue;
  httpStatus: number | null;
  latencyMs: number | null;
  dom: ProbeCheckValue;
  lastCheckedAt: string | null;
  source: ProbeSource;
  status: ProbeRouteStatus;
}

export interface AvailabilityRun {
  runId: string;
  route: string;
  source: ProbeSource;
  status: ProbeRouteStatus;
  httpStatus: number | null;
  latencyMs: number | null;
  checkedAt: string;
}

export interface AvailabilityFailure {
  id: string;
  route: string;
  source: ProbeSource;
  at: string;
  httpStatus: number | null;
  latencyMs: number | null;
  recoveredAt: string | null;
  note: string;
}

export interface AvailabilityNode {
  key: string;
  label: string;
  state: 'ONLINE' | 'STALE' | 'OFFLINE';
  lastHeartbeatAt: string | null;
}

export interface AvailabilityResponse {
  status: ProbeRouteStatus;
  reason: string;
  asOf: string;
  routes: AvailabilityRoute[];
  uptime7d: UptimeDay[];
  uptime30d: UptimeDay[];
  recentFailures: AvailabilityFailure[];
  runs: AvailabilityRun[];
  nodes: AvailabilityNode[];
  /**
   * Edge evidence is served by System Status → Access Diagnostics. That
   * reader is not part of this branch yet, so the field stays null rather
   * than duplicating the access log parser.
   */
  edge: null;
}

const TELEMETRY_NOTE =
  'Informational only: no independent collector heartbeat is available, so this does not assert pipeline HEALTHY/FAILED.';

export interface ApiRouteHealth {
  routeGroup: string;
  requests: number;
  p50Ms: number;
  p90Ms: number;
  p95Ms: number;
  serverErrors: number;
  clientErrors: number;
  slowRequests: number;
  budgetMs: number;
  lastAt: string | null;
}

export interface CheckoutChainStep {
  key: 'begin_checkout' | 'submit_attempt' | 'submit_failed' | 'purchase';
  events: number;
  sessions: number;
}

export interface CheckoutFailureReason {
  reason: string;
  count: number;
}

export interface ApiRecentFailure {
  requestId: string;
  routeGroup: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  at: string;
}

export interface ApiDiagnosticsResponse {
  collector: ReturnType<ApiMetricsService['status']> | null;
  state: 'VALUE' | 'NO_DATA' | 'UNKNOWN';
  note: string;
  /** API_METRICS_ENABLED; false means historical samples only. */
  collecting: boolean;
  sampleRate: number;
  asOf: string;
  windowMinutes: number;
  lastSampleAt: string | null;
  routes: ApiRouteHealth[];
  checkout: {
    steps: CheckoutChainStep[];
    failureReasons: CheckoutFailureReason[];
  };
  recentFailures: ApiRecentFailure[];
}

/**
 * The three states the evidence can actually support. A browser network error
 * cannot show that the server never received the request, and a retained
 * server sample proves nothing was dropped — so neither has a state here.
 */
export type RequestCorrelation =
  | 'CORRELATED'
  | 'SERVER_LOG_MISSING'
  | 'UNKNOWN';

export interface RequestTraceResponse {
  requestId: string;
  correlation: RequestCorrelation;
  server: {
    method: string;
    path: string;
    routeGroup: string;
    status: number;
    durationMs: number;
    at: string;
  } | null;
  browser: {
    events: Array<{
      eventName: string;
      at: string;
      reason: string | null;
      httpStatus: number | null;
    }>;
    failureReason: string | null;
  };
  note: string;
}

function emptyAvailability(now: Date, reason: string): AvailabilityResponse {
  const definitions = probeRoutes();
  return {
    status: 'UNKNOWN',
    reason,
    asOf: now.toISOString(),
    routes: definitions.map((definition) => ({
      key: definition.key,
      path: definition.path || '/products',
      dns: 'UNKNOWN',
      tls: 'UNKNOWN',
      http: 'UNKNOWN',
      httpStatus: null,
      latencyMs: null,
      dom: 'UNKNOWN',
      lastCheckedAt: null,
      source: 'PROD',
      status: 'UNKNOWN',
    })),
    uptime7d: buildUptime(manilaDays(7, now), []),
    uptime30d: buildUptime(manilaDays(30, now), []),
    recentFailures: [],
    runs: [],
    nodes: [
      {
        key: 'prod',
        label: 'Production probe',
        state: 'OFFLINE',
        lastHeartbeatAt: null,
      },
    ],
    edge: null,
  };
}

const MIN_P95_SAMPLES = 20;

function apiCheckoutStatus(api: ApiDiagnosticsResponse): 'OPERATIONAL' | 'DEGRADED' | 'UNKNOWN' {
  if (api.routes.some((route) => route.serverErrors > 0)) return 'DEGRADED';
  if (api.collector?.writeFailed || (api.collector?.dropped ?? 0) > 0) return 'UNKNOWN';
  const overBudget = api.routes.some(
    (route) => route.requests >= MIN_P95_SAMPLES && route.p95Ms > route.budgetMs,
  );
  return overBudget ? 'DEGRADED' : 'OPERATIONAL';
}

const CHECKOUT_STEPS: Array<{ key: CheckoutChainStep['key']; eventName: string }> = [
  { key: 'begin_checkout', eventName: 'BEGIN_CHECKOUT' },
  { key: 'submit_attempt', eventName: 'CHECKOUT_SUBMIT_ATTEMPT' },
  { key: 'submit_failed', eventName: 'CHECKOUT_SUBMIT_FAILED' },
  { key: 'purchase', eventName: 'PURCHASE' },
];

@Injectable()
export class ObservabilityService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly alerts?: AlertService,
    @Optional() private readonly metrics?: ApiMetricsService,
  ) {}

  async health(
    account: ObservabilityAccount,
    now: Date = new Date(),
  ): Promise<HealthResponse> {
    const availability = await this.availability(now);
    const probeStatus = availability.status;
    const alertingEnabled = process.env.ALERT_ENABLED === 'true';
    const issues =
      alertingEnabled && this.alerts ? await this.alerts.list() : null;
    const openIssues =
      issues?.filter(
        (issue) => issue.status === 'OPEN' || issue.status === 'ACKNOWLEDGED',
      ) ?? [];
    const worst: 'P0' | 'P1' | 'P2' | null = openIssues.some((issue) => issue.severity === 'P0')
      ? 'P0'
      : openIssues.some((issue) => issue.severity === 'P1')
        ? 'P1'
        : openIssues.length > 0
          ? 'P2'
          : null;
    const hasP0P1 = worst === 'P0' || worst === 'P1';

    const issuesSection: HealthSection =
      issues === null
        ? { state: 'NO_DATA', note: 'Alerting is not enabled yet (P2-lite).' }
        : {
            state: 'VALUE',
            status: worst === 'P0' ? 'DOWN' : worst === 'P1' ? 'DEGRADED' : 'OPERATIONAL',
            note:
              openIssues.length === 0
                ? 'No active issues detected.'
                : `${openIssues.length} active issue(s); highest severity ${worst}.`,
          };

    // Alerts, once enabled, are real evidence both ways: an open P0/P1 degrades
    // the overall state, and an empty evaluated set allows OPERATIONAL when the
    // probes are green. Without alerting, a green probe round is still UNKNOWN.
    const status: HealthStatus =
      worst === 'P0'
        ? 'DOWN'
        : worst === 'P1' || probeStatus === 'DEGRADED'
          ? 'DEGRADED'
          : probeStatus === 'DOWN'
            ? 'DOWN'
            : probeStatus === 'OPERATIONAL' && issues !== null && !hasP0P1
              ? 'OPERATIONAL'
              : 'UNKNOWN';
    const reason =
      openIssues.length > 0
        ? `${openIssues.length} active issue(s); highest severity ${worst}.`
        : probeStatus === 'OPERATIONAL' && issues !== null
          ? 'Key routes passed the latest probe round and no active P0/P1 issues were detected.'
          : probeStatus === 'OPERATIONAL'
            ? 'Availability probes are passing, but alerting is not enabled, so overall storefront health cannot be asserted.'
            : probeStatus === 'UNKNOWN'
              ? 'Probe evidence is missing, so storefront health cannot be asserted.'
              : availability.reason;

    const api = await this.apiDiagnostics(now, account);
    const checkoutSection: HealthSection =
      api.state === 'UNKNOWN'
        ? { state: 'UNKNOWN', status: 'UNKNOWN', note: api.note }
        : api.routes.length === 0
          ? api.collecting
            ? { state: 'NO_DATA', status: 'UNKNOWN', note: api.note }
            : { state: 'NOT_ENABLED', note: 'API metrics collection is disabled.' }
          : {
              state: 'VALUE',
              status: !api.collecting || !api.lastSampleAt || now.getTime() - Date.parse(api.lastSampleAt) > 600_000
                ? 'UNKNOWN'
                : apiCheckoutStatus(api),
              note: `${api.routes.reduce((sum, route) => sum + route.requests, 0)} sampled API request(s) in 24h; ${api.routes.reduce((sum, route) => sum + route.serverErrors, 0)} server error(s). ${api.note}`,
            };

    return {
      status,
      reason,
      asOf: now.toISOString(),
      sections: {
        availability:
          probeStatus === 'UNKNOWN'
            ? { state: 'NO_DATA', status: 'UNKNOWN', note: availability.reason }
            : { state: 'VALUE', status: probeStatus, note: availability.reason },
        issues: issuesSection,
        pageExperience: { state: 'NOT_ENABLED', note: 'RUM is not enabled yet (P4).' },
        checkout: checkoutSection,
      },
      telemetryActivity: await this.telemetryActivity(account),
    };
  }

  /**
   * P1.5 availability: latest probe round per key route, 7/30-day uptime, recent
   * failures with recovery, the latest runs and node heartbeats. Missing
   * evidence is UNKNOWN, never a green default.
   */
  async availability(now: Date = new Date()): Promise<AvailabilityResponse> {
    try {
      const [latest, recentRuns, uptimeRows, failureRows, lastProd, lastExternal, lastExternalHeartbeat] =
        await Promise.all([
          this.prisma.syntheticProbeRun.findMany({
            orderBy: { checkedAt: 'desc' },
            take: 300,
          }),
          this.prisma.syntheticProbeRun.findMany({
            orderBy: { checkedAt: 'desc' },
            take: 8,
          }),
          this.prisma.$queryRaw<
            Array<{ day: string; total: number; ok: number }>
          >(Prisma.sql`
            SELECT to_char((checked_at AT TIME ZONE 'Asia/Manila')::date, 'YYYY-MM-DD') AS day,
                   count(*)::int AS total,
                   count(*) FILTER (WHERE status = 'OPERATIONAL')::int AS ok
              FROM synthetic_probe_runs
             WHERE checked_at >= ${new Date(now.getTime() - 32 * 86_400_000)}
             GROUP BY 1
             ORDER BY 1
          `),
          this.prisma.$queryRaw<
            Array<{
              route_key: string;
              environment: string;
              checked_at: Date;
              http_status: number | null;
              latency_ms: number | null;
              error_code: string | null;
              recovered_at: Date | null;
            }>
          >(Prisma.sql`
            SELECT f.route_key, f.environment, f.checked_at, f.http_status,
                   f.latency_ms, f.error_code,
                   (SELECT min(o.checked_at)
                      FROM synthetic_probe_runs o
                     WHERE o.route_key = f.route_key
                       AND o.environment = f.environment
                       AND o.checked_at > f.checked_at
                       AND o.status = 'OPERATIONAL') AS recovered_at
              FROM synthetic_probe_runs f
             WHERE f.status IN ('DOWN', 'DEGRADED')
               AND f.checked_at >= ${new Date(now.getTime() - 24 * 3_600_000)}
             ORDER BY f.checked_at DESC
             LIMIT 10
          `),
          this.prisma.syntheticProbeRun.findFirst({
            where: { environment: 'PROD' },
            orderBy: { checkedAt: 'desc' },
          }),
          this.prisma.syntheticProbeRun.findFirst({
            where: { environment: 'EXTERNAL' },
            orderBy: { checkedAt: 'desc' },
          }),
          this.prisma.probeNodeHeartbeat.findFirst({
            where: { environment: 'EXTERNAL' },
            orderBy: { reportedAt: 'desc' },
          }),
        ]);

      const latestByRoute = new Map<string, (typeof latest)[number]>();
      for (const run of latest) {
        if (!latestByRoute.has(run.routeKey)) latestByRoute.set(run.routeKey, run);
      }

      const definitions = probeRoutes();
      const routes: AvailabilityRoute[] = definitions.map((definition) => {
        const run = latestByRoute.get(definition.key);
        if (!run || definition.path.length === 0) {
          return {
            key: definition.key,
            path: definition.path || '/products',
            dns: 'UNKNOWN',
            tls: 'UNKNOWN',
            http: 'UNKNOWN',
            httpStatus: null,
            latencyMs: null,
            dom: 'UNKNOWN',
            lastCheckedAt: run ? run.checkedAt.toISOString() : null,
            source: (run?.environment as ProbeSource | undefined) ?? 'PROD',
            status: 'UNKNOWN',
          };
        }
        return {
          key: definition.key,
          path: definition.path,
          dns: run.dns as ProbeCheckValue,
          tls: run.tls as ProbeCheckValue,
          http: run.http as ProbeCheckValue,
          httpStatus: run.httpStatus,
          latencyMs: run.latencyMs,
          dom: run.dom as ProbeCheckValue,
          lastCheckedAt: run.checkedAt.toISOString(),
          source: run.environment as ProbeSource,
          status: run.status as ProbeRouteStatus,
        };
      });

      const status = overallProbeStatus(routes.map((route) => route.status));
      const nodes: AvailabilityNode[] = [
        {
          key: 'prod',
          label: 'Production probe',
          state: nodeState(lastProd?.checkedAt ?? null, now),
          lastHeartbeatAt: lastProd?.checkedAt.toISOString() ?? null,
        },
      ];
      if (process.env.PROBE_EXTERNAL_ENABLED === 'true' || lastExternalHeartbeat || lastExternal) {
        const externalLast =
          lastExternalHeartbeat?.reportedAt ?? lastExternal?.checkedAt ?? null;
        nodes.push({
          key: 'external',
          label: 'External node',
          state: nodeState(externalLast, now),
          lastHeartbeatAt: externalLast ? externalLast.toISOString() : null,
        });
      }

      return {
        status,
        reason: probeReason(status, routes.map((route) => route.status)),
        asOf: now.toISOString(),
        routes,
        uptime7d: buildUptime(manilaDays(7, now), uptimeRows),
        uptime30d: buildUptime(manilaDays(30, now), uptimeRows),
        recentFailures: failureRows.map((row) => {
          const path =
            definitions.find((definition) => definition.key === row.route_key)?.path ??
            row.route_key;
          return {
            id: `${row.route_key}-${row.checked_at.toISOString()}`,
            route: path,
            source: row.environment as ProbeSource,
            at: row.checked_at.toISOString(),
            httpStatus: row.http_status,
            latencyMs: row.latency_ms,
            recoveredAt: row.recovered_at ? row.recovered_at.toISOString() : null,
            note: row.error_code ?? `HTTP ${row.http_status ?? '—'}`,
          };
        }),
        runs: recentRuns.map((run) => ({
          runId: run.runId,
          route: run.routeKey,
          source: run.environment as ProbeSource,
          status: run.status as ProbeRouteStatus,
          httpStatus: run.httpStatus,
          latencyMs: run.latencyMs,
          checkedAt: run.checkedAt.toISOString(),
        })),
        nodes,
        edge: null,
      };
    } catch {
      return emptyAvailability(now, 'Probe evidence is not available yet.');
    }
  }

  /**
   * P3 API & Checkout diagnostics: per-route latency percentiles, the checkout
   * technical chain and recent failures. Missing samples stay empty; nothing is
   * zero-filled into a health claim.
   */
  async apiDiagnostics(now: Date = new Date(), account?: ObservabilityAccount): Promise<ApiDiagnosticsResponse> {
    const since = new Date(now.getTime() - 24 * 3_600_000);
    const collecting = process.env.API_METRICS_ENABLED === 'true';
    const sampleRate = this.apiSampleRate();
    const empty = (note: string): ApiDiagnosticsResponse => ({
      collector: null,
      state: 'UNKNOWN',
      note,
      collecting,
      sampleRate,
      asOf: now.toISOString(),
      windowMinutes: 1440,
      lastSampleAt: null,
      routes: [],
      checkout: { steps: [], failureReasons: [] },
      recentFailures: [],
    });
    if (!account?.permissions.includes('MARKETING_VIEW_ALL')) {
      return empty('Platform-wide API metrics and checkout events are withheld in owner-scoped views.');
    }
    try {
      const [routeRows, eventRows, reasonRows, failureRows, lastSample] = await Promise.all([
        this.prisma.$queryRaw<
          Array<{
            route_group: string;
            requests: number;
            p50: number;
            p90: number;
            p95: number;
            server_errors: number;
            client_errors: number;
            slow_requests: number;
            last_at: Date | null;
          }>
        >(Prisma.sql`
          SELECT route_group,
                 count(*)::int AS requests,
                 percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms)::float8 AS p50,
                 percentile_cont(0.9) WITHIN GROUP (ORDER BY duration_ms)::float8 AS p90,
                 percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)::float8 AS p95,
                 (count(*) FILTER (WHERE status >= 500))::int AS server_errors,
                 (count(*) FILTER (WHERE status >= 400 AND status < 500))::int AS client_errors,
                 (count(*) FILTER (WHERE duration_ms > CASE route_group
                    WHEN 'orders' THEN ${ROUTE_BUDGET_MS.orders}
                    WHEN 'product' THEN ${ROUTE_BUDGET_MS.product}
                    WHEN 'catalog' THEN ${ROUTE_BUDGET_MS.catalog}
                    WHEN 'cart' THEN ${ROUTE_BUDGET_MS.cart}
                    WHEN 'content' THEN ${ROUTE_BUDGET_MS.content}
                    WHEN 'newsletter' THEN ${ROUTE_BUDGET_MS.newsletter}
                    WHEN 'analytics' THEN ${ROUTE_BUDGET_MS.analytics}
                    ELSE ${ROUTE_BUDGET_MS.other} END::int))::int AS slow_requests,
                 max(sampled_at) AS last_at
            FROM api_request_metrics
           WHERE sampled_at >= ${since}
           GROUP BY route_group
           ORDER BY requests DESC
        `),
        this.prisma.$queryRaw<Array<{ event_name: string; events: number; sessions: number }>>(
          Prisma.sql`
            SELECT event_name, count(*)::int AS events,
                   count(DISTINCT session_id)::int AS sessions
              FROM analytics_events
             WHERE created_at >= ${since}
               AND event_name IN ('BEGIN_CHECKOUT','CHECKOUT_SUBMIT_ATTEMPT','CHECKOUT_SUBMIT_FAILED','PURCHASE')
             GROUP BY event_name
          `,
        ),
        this.prisma.$queryRaw<Array<{ reason: string; count: number }>>(Prisma.sql`
          SELECT coalesce(metadata->>'reason','UNKNOWN') AS reason, count(*)::int AS count
            FROM analytics_events
           WHERE created_at >= ${since}
             AND event_name = 'CHECKOUT_SUBMIT_FAILED'
           GROUP BY 1
           ORDER BY count DESC
           LIMIT 8
        `),
        this.prisma.$queryRaw<
          Array<{
            request_id: string;
            route_group: string;
            method: string;
            path: string;
            status: number;
            duration_ms: number;
            sampled_at: Date;
          }>
        >(Prisma.sql`
          SELECT request_id, route_group, method, path, status, duration_ms, sampled_at
            FROM api_request_metrics
           WHERE sampled_at >= ${since}
             AND (status >= 500 OR duration_ms > CASE route_group
                WHEN 'orders' THEN ${ROUTE_BUDGET_MS.orders}
                WHEN 'product' THEN ${ROUTE_BUDGET_MS.product}
                WHEN 'catalog' THEN ${ROUTE_BUDGET_MS.catalog}
                WHEN 'cart' THEN ${ROUTE_BUDGET_MS.cart}
                WHEN 'content' THEN ${ROUTE_BUDGET_MS.content}
                WHEN 'newsletter' THEN ${ROUTE_BUDGET_MS.newsletter}
                WHEN 'analytics' THEN ${ROUTE_BUDGET_MS.analytics}
                ELSE ${ROUTE_BUDGET_MS.other} END::int)
           ORDER BY sampled_at DESC
           LIMIT 10
        `),
        this.prisma.apiRequestMetric.findFirst({ orderBy: { sampledAt: 'desc' } }),
      ]);

      const eventByName = new Map(eventRows.map((row) => [row.event_name, row]));
      return {
        collector: this.metrics?.status() ?? null,
        state: routeRows.length > 0 || eventRows.length > 0 ? 'VALUE' : 'NO_DATA',
        note: 'API handler duration excludes Next.js page rendering and client/network latency; checkout counts are browser events, not authoritative order counts.',
        collecting,
        sampleRate,
        asOf: now.toISOString(),
        windowMinutes: 1440,
        lastSampleAt: lastSample ? lastSample.sampledAt.toISOString() : null,
        routes: routeRows.map((row) => ({
          routeGroup: row.route_group,
          requests: row.requests,
          p50Ms: Math.round(row.p50 * 10) / 10,
          p90Ms: Math.round(row.p90 * 10) / 10,
          p95Ms: Math.round(row.p95 * 10) / 10,
          serverErrors: row.server_errors,
          clientErrors: row.client_errors,
          slowRequests: row.slow_requests,
          budgetMs: ROUTE_BUDGET_MS[row.route_group as RouteGroup] ?? ROUTE_BUDGET_MS.other,
          lastAt: row.last_at ? row.last_at.toISOString() : null,
        })),
        checkout: {
          steps: CHECKOUT_STEPS.map(({ key, eventName }) => ({
            key,
            events: eventByName.get(eventName)?.events ?? 0,
            sessions: eventByName.get(eventName)?.sessions ?? 0,
          })),
          failureReasons: reasonRows.map((row) => ({ reason: row.reason, count: row.count })),
        },
        recentFailures: failureRows.map((row) => ({
          requestId: row.request_id,
          routeGroup: row.route_group,
          method: row.method,
          path: row.path,
          status: row.status,
          durationMs: row.duration_ms,
          at: row.sampled_at.toISOString(),
        })),
      };
    } catch {
      return empty('API diagnostics lookup failed; missing evidence is not a clean result.');
    }
  }

  async requestTrace(rawId: string, now: Date = new Date(), account?: ObservabilityAccount): Promise<RequestTraceResponse> {
    if (!account?.permissions.includes('MARKETING_VIEW_ALL')) {
      throw new ForbiddenException('Platform-wide request traces are withheld in owner-scoped views.');
    }
    const requestId = rawId.slice(0, 64);
    const since = new Date(now.getTime() - 7 * 86_400_000);
    const [server, events] = await Promise.all([
      this.prisma.apiRequestMetric.findFirst({
        where: { requestId },
        orderBy: { sampledAt: 'desc' },
      }),
      this.prisma.$queryRaw<
        Array<{
          event_name: string;
          created_at: Date;
          reason: string | null;
          http_status: number | null;
        }>
      >(Prisma.sql`
        SELECT event_name, created_at,
               metadata->>'reason' AS reason,
               (nullif(metadata->>'httpStatus',''))::int AS http_status
          FROM analytics_events
         WHERE event_name IN ('CHECKOUT_SUBMIT_ATTEMPT','CHECKOUT_SUBMIT_FAILED')
           AND metadata->>'requestId' = ${requestId}
           AND created_at >= ${since}
         ORDER BY created_at DESC
         LIMIT 5
      `),
    ]);
    const failureReason =
      events.find((event) => event.event_name === 'CHECKOUT_SUBMIT_FAILED')?.reason ?? null;
    let correlation: RequestCorrelation;
    let note: string;
    if (server && events.length > 0) {
      correlation = 'CORRELATED';
      note = 'Browser attempt and server sample share this request id.';
    } else if (!server && events.some((event) => event.http_status !== null && event.http_status >= 100)) {
      correlation = 'SERVER_LOG_MISSING';
      note = 'The browser reported an HTTP response, but no retained server sample matches. Sampling or collection failure may explain the gap.';
    } else {
      correlation = 'UNKNOWN';
      note = server
        ? 'A server sample exists, but no matching browser event was retained.'
        : 'No matching server sample. A browser network error cannot prove whether the server received the request.';
    }
    return {
      requestId,
      correlation,
      server: server
        ? {
            method: server.method,
            path: server.path,
            routeGroup: server.routeGroup,
            status: server.status,
            durationMs: server.durationMs,
            at: server.sampledAt.toISOString(),
          }
        : null,
      browser: {
        events: events.map((event) => ({
          eventName: event.event_name,
          at: event.created_at.toISOString(),
          reason: event.reason,
          httpStatus: event.http_status,
        })),
        failureReason,
      },
      note,
    };
  }

  private apiSampleRate(): number {
    const raw = Number(process.env.API_METRICS_SAMPLE_RATE);
    return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : 1;
  }

  /** Telemetry Activity: facts only (freshness/volume/source). Owner-scoped
   * views must not receive platform-wide telemetry, so they get UNKNOWN. */
  private async telemetryActivity(account: ObservabilityAccount): Promise<TelemetryActivity> {
    if (!account.permissions.includes('MARKETING_VIEW_ALL')) {
      return {
        state: 'UNKNOWN',
        note: 'Telemetry activity is platform-wide and is withheld in owner-scoped views.',
      };
    }
    try {
      const rows = (await this.prisma.$queryRaw(
        Prisma.sql`SELECT max(created_at) AS last,
               count(*) FILTER (WHERE created_at >= now() - interval '24 hours')::int AS count
          FROM analytics_events`,
      )) as Array<{ last: Date | null; count: number }>;
      const row = rows[0];
      return {
        state: 'VALUE',
        lastEventAt: row?.last ? new Date(row.last).toISOString() : null,
        events24h: row?.count ?? 0,
        sources: ['analytics_events'],
        note: TELEMETRY_NOTE,
      };
    } catch {
      return { state: 'UNKNOWN', note: 'Telemetry activity lookup failed; not zero-filled.' };
    }
  }
}
