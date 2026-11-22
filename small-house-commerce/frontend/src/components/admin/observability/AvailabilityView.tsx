"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { AdminI18n, TKey } from "@/lib/admin-i18n";
import type {
  AdminAvailabilityReport,
  AdminProbeNode,
  AdminProbeRoute,
  AdminTelemetryActivity,
  AdminUptimeDay,
  ProbeCheck,
} from "@/lib/admin-api";
import { Card, HealthStatusBadge } from "./StatusBadge";
import { SystemDiagnostics } from "./SystemDiagnostics";

const ROUTE_LABEL: Record<string, TKey> = {
  home: "availability_route_home",
  collections: "availability_route_collections",
  product: "availability_route_product",
  cart: "availability_route_cart",
  checkout: "availability_route_checkout",
};

const CHECK_TONE: Record<ProbeCheck, string> = {
  PASS: "border-emerald-200 bg-emerald-50 text-emerald-800",
  FAIL: "border-rose-200 bg-rose-50 text-rose-800",
  UNKNOWN: "border-slate-200 bg-slate-50 text-slate-700",
};

const CHECK_LABEL: Record<ProbeCheck, TKey> = {
  PASS: "availability_pass",
  FAIL: "availability_fail",
  UNKNOWN: "availability_unknown",
};

const UPTIME_TONE: Record<AdminUptimeDay["state"], string> = {
  OK: "bg-emerald-500",
  DEGRADED: "bg-amber-500",
  DOWN: "bg-rose-500",
  NO_DATA: "bg-slate-200",
};

export function routeLabel(route: AdminProbeRoute, t: AdminI18n["t"]): string {
  const key = ROUTE_LABEL[route.key];
  return key ? t(key) : route.path;
}

export function CheckPill({ value, t }: { value: ProbeCheck; t: AdminI18n["t"] }) {
  return (
    <span className={`inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${CHECK_TONE[value]}`}>
      {t(CHECK_LABEL[value])}
    </span>
  );
}

function formatMs(value: number | null): string {
  return value === null ? "—" : `${value} ms`;
}

function formatRate(value: number | null): string {
  return value === null ? "—" : `${value}%`;
}

function formatTime(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function uptimeSummary(days: AdminUptimeDay[]): string {
  const values = days.map((day) => day.uptimePct).filter((value): value is number => value !== null);
  if (values.length === 0) return "—";
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return `${average.toFixed(2)}%`;
}

function NodeRow({ node, t }: { node: AdminProbeNode; t: AdminI18n["t"] }) {
  const tone =
    node.state === "ONLINE"
      ? "text-emerald-700"
      : node.state === "STALE"
        ? "text-amber-700"
        : "text-rose-700";
  const label =
    node.state === "ONLINE"
      ? t("availability_node_online")
      : node.state === "STALE"
        ? t("availability_node_stale")
        : t("availability_node_offline");
  return (
    <div className="flex flex-col gap-1 py-1.5 text-sm sm:flex-row sm:items-center sm:justify-between">
      <span className="text-admin-ink">{node.label}</span>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
        <span className="whitespace-nowrap text-admin-muted">
          {t("availability_last_heartbeat")}: {formatTime(node.lastHeartbeatAt)}
        </span>
        <span className={`whitespace-nowrap font-semibold ${tone}`}>{label}</span>
      </span>
    </div>
  );
}

export function AvailabilityView({
  data,
  telemetry,
  error,
  loading,
  onRefresh,
  t,
}: {
  data: AdminAvailabilityReport | null;
  telemetry?: AdminTelemetryActivity;
  error: string | null;
  loading: boolean;
  onRefresh: () => void;
  t: AdminI18n["t"];
}) {
  const [range, setRange] = useState<"7d" | "30d">("7d");
  const [runDetail, setRunDetail] = useState<string | null>(null);

  const uptime = useMemo(
    () => (data ? (range === "7d" ? data.uptime7d : data.uptime30d) : []),
    [data, range],
  );

  if (error) {
    return (
      <div className="mt-5 rounded-xl border border-admin-border bg-white px-4 py-6 text-sm text-admin-muted">
        {error === "forbidden" ? t("health_forbidden") : error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mt-5 rounded-xl border border-admin-border bg-white px-4 py-6 text-sm text-admin-muted">
        {loading ? t("health_loading") : t("health_monitoring_unavailable")}
      </div>
    );
  }

  const median = (() => {
    const values = data.routes
      .map((route) => route.latencyMs)
      .filter((value): value is number => value !== null)
      .sort((a, b) => a - b);
    if (values.length === 0) return null;
    const middle = Math.floor(values.length / 2);
    return values.length % 2 === 0
      ? Math.round((values[middle - 1] + values[middle]) / 2)
      : values[middle];
  })();

  const lastCheck = data.routes
    .map((route) => route.lastCheckedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;

  const onlineNodes = data.nodes.filter((node) => node.state === "ONLINE").length;

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-admin-border bg-white p-4 md:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs font-medium text-admin-muted">{t("health_status")}</p>
          <HealthStatusBadge status={data.status} />
          <span className="text-xs text-admin-muted">
            {t("health_updated", { at: formatTime(data.asOf) })}
          </span>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="ml-auto rounded-lg border border-admin-border px-2.5 py-1 text-xs font-medium text-admin-ink disabled:opacity-50"
          >
            {t("health_refresh")}
          </button>
        </div>
        <p className="mt-2 text-sm text-admin-ink">{data.reason}</p>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card title={t("availability_routes_monitored")}>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-admin-ink">{data.routes.length}</p>
        </Card>
        <Card title={t("availability_uptime_7d")}>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-emerald-700">
            {uptimeSummary(data.uptime7d)}
          </p>
        </Card>
        <Card title={t("availability_median_latency")}>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-admin-ink">{formatMs(median)}</p>
        </Card>
        <Card title={t("availability_nodes")}>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-admin-ink">
            {onlineNodes}/{data.nodes.length}
          </p>
          <p className="mt-1 text-[11px] text-admin-muted">
            {t("availability_last_check")}: {formatTime(lastCheck)}
          </p>
        </Card>
      </div>

      <Card title={t("availability_matrix_title")}>
        <p className="mt-1 text-xs text-admin-muted">{t("availability_matrix_subtitle")}</p>

        <div className="mt-3 hidden overflow-x-auto md:block">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-admin-border text-left text-xs text-admin-muted">
                <th className="py-2 pr-3 font-medium">{t("availability_col_route")}</th>
                <th className="px-2 py-2 font-medium">{t("availability_col_dns")}</th>
                <th className="px-2 py-2 font-medium">{t("availability_col_tls")}</th>
                <th className="px-2 py-2 font-medium">{t("availability_col_http")}</th>
                <th className="px-2 py-2 font-medium">{t("availability_col_dom")}</th>
                <th className="px-2 py-2 text-right font-medium">{t("availability_col_latency")}</th>
                <th className="px-2 py-2 text-right font-medium">{t("availability_col_last_check")}</th>
                <th className="py-2 pl-3 font-medium">{t("availability_col_status")}</th>
              </tr>
            </thead>
            <tbody>
              {data.routes.map((route) => (
                <tr key={route.key} className="border-b border-admin-border/60 last:border-0">
                  <td className="py-2 pr-3">
                    <span className="font-medium text-admin-ink">{routeLabel(route, t)}</span>
                    <span className="ml-2 font-mono text-[11px] text-admin-muted">{route.path}</span>
                  </td>
                  <td className="px-2 py-2"><CheckPill value={route.dns} t={t} /></td>
                  <td className="px-2 py-2"><CheckPill value={route.tls} t={t} /></td>
                  <td className="px-2 py-2">
                    <CheckPill value={route.http} t={t} />
                    {route.httpStatus !== null ? (
                      <span className="ml-1 text-[11px] text-admin-muted">{route.httpStatus}</span>
                    ) : null}
                  </td>
                  <td className="px-2 py-2"><CheckPill value={route.dom} t={t} /></td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatMs(route.latencyMs)}</td>
                  <td className="px-2 py-2 text-right text-xs text-admin-muted">{formatTime(route.lastCheckedAt)}</td>
                  <td className="py-2 pl-3"><HealthStatusBadge status={route.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ul className="mt-3 space-y-2 md:hidden">
          {data.routes.map((route) => (
            <li key={route.key} className="rounded-lg border border-admin-border/70 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-admin-ink">{routeLabel(route, t)}</span>
                <HealthStatusBadge status={route.status} />
              </div>
              <p className="mt-1 font-mono text-[11px] text-admin-muted">{route.path}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-admin-muted">
                <span>{t("availability_col_dns")}: <CheckPill value={route.dns} t={t} /></span>
                <span>{t("availability_col_tls")}: <CheckPill value={route.tls} t={t} /></span>
                <span>{t("availability_col_http")}: <CheckPill value={route.http} t={t} /></span>
                <span>{t("availability_col_dom")}: <CheckPill value={route.dom} t={t} /></span>
                <span className="tabular-nums">{formatMs(route.latencyMs)}</span>
                <span>{formatTime(route.lastCheckedAt)}</span>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card title={t("availability_uptime_title")}>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setRange("7d")}
            className={`rounded-full border px-2.5 py-1 text-xs ${range === "7d" ? "border-cta bg-cta text-white" : "border-admin-border text-admin-ink"}`}
          >
            {t("availability_range_7d")}
          </button>
          <button
            type="button"
            onClick={() => setRange("30d")}
            className={`rounded-full border px-2.5 py-1 text-xs ${range === "30d" ? "border-cta bg-cta text-white" : "border-admin-border text-admin-ink"}`}
          >
            {t("availability_range_30d")}
          </button>
          <span className="ml-auto text-sm font-semibold tabular-nums text-admin-ink">
            {uptimeSummary(uptime)}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap gap-1">
          {uptime.map((day) => (
            <span
              key={day.day}
              title={`${day.day} · ${day.state}${day.uptimePct === null ? "" : ` · ${day.uptimePct}%`}`}
              className={`h-6 min-w-3 flex-1 rounded-sm ${UPTIME_TONE[day.state]}`}
            />
          ))}
        </div>

        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-admin-muted">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-emerald-500" />{t("availability_uptime_legend_ok")}</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-amber-500" />{t("availability_uptime_legend_degraded")}</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-rose-500" />{t("availability_uptime_legend_down")}</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-slate-200" />{t("availability_uptime_legend_no_data")}</span>
        </div>
      </Card>

      <Card title={t("availability_failures_title")}>
        {data.recentFailures.length === 0 ? (
          <p className="mt-3 text-sm text-admin-muted">{t("availability_failures_none")}</p>
        ) : (
          <ul className="mt-2 divide-y divide-admin-border/60">
            {data.recentFailures.map((failure) => (
              <li key={failure.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm text-admin-ink">
                    {failure.httpStatus ?? "—"} · {failure.route}
                    <span className="ml-2 font-mono text-[11px] text-admin-muted">{failure.source}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-admin-muted">{failure.note}</p>
                </div>
                <div className="text-right text-xs text-admin-muted">
                  <p>{formatTime(failure.at)}</p>
                  {failure.recoveredAt ? (
                    <p className="mt-0.5 font-medium text-emerald-700">
                      {t("availability_recovered")} · {formatTime(failure.recoveredAt)}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={t("availability_runs_title")}>
        <div className="mt-3 hidden overflow-x-auto md:block">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-admin-border text-left text-xs text-admin-muted">
                <th className="py-2 pr-3 font-medium">{t("availability_col_time")}</th>
                <th className="px-2 py-2 font-medium">{t("availability_col_route")}</th>
                <th className="px-2 py-2 font-medium">{t("availability_col_source")}</th>
                <th className="px-2 py-2 text-right font-medium">{t("availability_col_code")}</th>
                <th className="px-2 py-2 text-right font-medium">{t("availability_col_latency")}</th>
                <th className="px-2 py-2 font-medium">{t("availability_col_status")}</th>
                <th className="py-2 pl-3 font-medium">{t("availability_col_run_id")}</th>
              </tr>
            </thead>
            <tbody>
              {data.runs.map((run) => (
                <tr key={run.runId} className="border-b border-admin-border/60 last:border-0">
                  <td className="py-2 pr-3 text-xs text-admin-muted">{formatTime(run.checkedAt)}</td>
                  <td className="px-2 py-2">{run.route}</td>
                  <td className="px-2 py-2 text-xs text-admin-muted">{run.source}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{run.httpStatus ?? "—"}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatMs(run.latencyMs)}</td>
                  <td className="px-2 py-2"><HealthStatusBadge status={run.status} /></td>
                  <td className="py-2 pl-3 font-mono text-[11px] text-admin-muted">{run.runId.slice(0, 12)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ul className="mt-3 space-y-2 md:hidden">
          {data.runs.map((run) => (
            <li key={run.runId}>
              <button
                type="button"
                onClick={() => setRunDetail(runDetail === run.runId ? null : run.runId)}
                className="flex w-full items-center justify-between gap-2 rounded-lg border border-admin-border/70 px-3 py-2 text-left"
              >
                <span className="text-xs text-admin-muted">{formatTime(run.checkedAt)}</span>
                <span className="text-sm text-admin-ink">{run.route}</span>
                <HealthStatusBadge status={run.status} />
              </button>
              {runDetail === run.runId ? (
                <p className="mt-1 px-3 text-[11px] text-admin-muted">
                  {run.source} · HTTP {run.httpStatus ?? "—"} · {formatMs(run.latencyMs)} · {run.runId}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>

      <Card title={t("availability_edge_title")}>
        {data.edge?.available ? (
          <>
            <p className="mt-1 text-xs text-admin-muted">{t("availability_edge_note")}</p>
            <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div>
                <p className="text-xs text-admin-muted">{t("availability_edge_5xx")}</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-admin-ink">{formatRate(data.edge.errorRate5xx)}</p>
              </div>
              <div>
                <p className="text-xs text-admin-muted">{t("availability_edge_4xx")}</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-admin-ink">{formatRate(data.edge.errorRate4xx)}</p>
              </div>
              <div>
                <p className="text-xs text-admin-muted">{t("availability_edge_slowest")}</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-admin-ink">{formatMs(data.edge.slowestMs)}</p>
                <p className="truncate text-[11px] text-admin-muted" title={data.edge.slowestPath ?? ""}>
                  {data.edge.slowestPath ?? "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-admin-muted">{t("availability_edge_image_hit")}</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-admin-ink">{formatRate(data.edge.imageRealHitRate)}</p>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-admin-muted">
              {data.edge.requests ?? "—"} requests · {formatTime(data.edge.generatedAt)}
            </p>
            {data.edge.stale ? (
              <p className="mt-1 text-xs font-medium text-amber-700">{t("availability_edge_stale")}</p>
            ) : null}
            <Link href="/admin/status/access" className="mt-2 inline-block text-xs font-medium text-cta hover:underline">
              {t("availability_edge_link")} →
            </Link>
          </>
        ) : (
          <p className="mt-3 text-sm text-admin-muted">{t("availability_edge_unavailable")}</p>
        )}
      </Card>

      <div className="rounded-xl border border-admin-border bg-white px-4 py-3">
        <p className="text-xs font-semibold text-admin-ink">{t("availability_nodes_title")}</p>
        <div className="mt-1 divide-y divide-admin-border/60">
          {data.nodes.map((node) => (
            <NodeRow key={node.key} node={node} t={t} />
          ))}
        </div>
      </div>

      <SystemDiagnostics telemetry={telemetry} t={t} />
    </div>
  );
}
