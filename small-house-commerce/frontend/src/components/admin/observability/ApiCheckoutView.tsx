"use client";

import { useState } from "react";
import type { AdminI18n } from "@/lib/admin-i18n";
import type {
  AdminApiDiagnostics,
  AdminRequestCorrelation,
  AdminRequestTrace,
} from "@/lib/admin-api";
import { Card, HealthStatusBadge, StatusBadge } from "./StatusBadge";
import { StepHealthChain, type HealthStep } from "./StepHealthChain";

const GROUP_KEY: Record<string, string> = {
  orders: "api_group_orders",
  product: "api_group_product",
  catalog: "api_group_catalog",
  cart: "api_group_cart",
  content: "api_group_content",
  newsletter: "api_group_newsletter",
  analytics: "api_group_analytics",
  other: "api_group_other",
};

type TKey = Parameters<AdminI18n["t"]>[0];

function groupLabel(group: string, t: AdminI18n["t"]): string {
  return t((GROUP_KEY[group] ?? "api_group_other") as TKey);
}

function ms(value: number): string {
  return `${Math.round(value * 10) / 10} ms`;
}

function time(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("en-PH", { timeZone: "Asia/Manila" });
}

function correlationTone(correlation: AdminRequestCorrelation): string {
  if (correlation === "CORRELATED") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (correlation === "SERVER_LOG_MISSING" || correlation === "NOT_RECEIVED_CONFIRMED")
    return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function chainSteps(data: AdminApiDiagnostics, t: AdminI18n["t"]): HealthStep[] {
  const byKey = new Map(data.checkout.steps.map((step) => [step.key, step]));
  const begin = byKey.get("begin_checkout");
  const attempt = byKey.get("submit_attempt");
  const failed = byKey.get("submit_failed");
  const purchase = byKey.get("purchase");
  const detail = (step: typeof begin): string =>
    step
      ? `${t("api_events", { count: step.events })} · ${t("api_sessions", { count: step.sessions })}`
      : t("api_trace_none");
  return [
    {
      key: "begin_checkout",
      label: t("api_step_begin"),
      state: begin && begin.events > 0 ? "UNKNOWN" : "NO_DATA",
      detail: detail(begin),
    },
    {
      key: "submit_attempt",
      label: t("api_step_attempt"),
      state: attempt && attempt.events > 0 ? "UNKNOWN" : "NO_DATA",
      detail: detail(attempt),
    },
    {
      key: "submit_failed",
      label: t("api_step_failed"),
      state: failed && failed.events > 0 ? "WARNING" : "NO_DATA",
      detail: detail(failed),
    },
    {
      key: "purchase",
      label: t("api_step_purchase"),
      state: purchase && purchase.events > 0 ? "UNKNOWN" : "NO_DATA",
      detail: detail(purchase),
    },
  ];
}

function routeHealth(data: AdminApiDiagnostics): "OPERATIONAL" | "DEGRADED" | "UNKNOWN" {
  if (!data.collecting || !data.lastSampleAt || Date.parse(data.asOf) - Date.parse(data.lastSampleAt) > 600_000) return "UNKNOWN";
  if (data.routes.some((route) => route.serverErrors > 0)) return "DEGRADED";
  if (data.collector?.writeFailed || (data.collector?.dropped ?? 0) > 0) return "UNKNOWN";
  if (data.routes.some((route) => route.requests >= 20 && route.p95Ms > route.budgetMs))
    return "DEGRADED";
  return "OPERATIONAL";
}

function RequestTracePanel({
  trace,
  traceError,
  traceLoading,
  onLookup,
  t,
}: {
  trace: AdminRequestTrace | null;
  traceError: string | null;
  traceLoading: boolean;
  onLookup: (requestId: string) => void;
  t: AdminI18n["t"];
}) {
  const [value, setValue] = useState("");
  return (
    <Card title={t("api_trace_title")}>
      <p className="mt-2 text-xs text-admin-muted">{t("api_trace_hint")}</p>
      <form
        className="mt-3 flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const id = value.trim();
          if (id.length > 0) onLookup(id);
        }}
      >
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-label={t("api_trace_placeholder")}
          placeholder={t("api_trace_placeholder")}
          className="min-w-0 flex-1 rounded-lg border border-admin-border px-2.5 py-1.5 font-mono text-xs text-admin-ink"
        />
        <button
          type="submit"
          disabled={traceLoading || value.trim().length === 0}
          className="rounded-lg border border-admin-border px-2.5 py-1.5 text-xs font-medium text-admin-ink hover:bg-admin-muted/10 disabled:opacity-50"
        >
          {traceLoading ? "…" : t("api_trace_search")}
        </button>
      </form>

      {traceError ? (
        <p role="alert" className="mt-3 text-xs text-red-600">
          {traceError === "invalid" ? t("api_trace_invalid") : traceError === "forbidden" ? t("health_forbidden") : t("api_trace_error")}
        </p>
      ) : null}

      {trace ? (
        <div className="mt-3 space-y-3 rounded-lg border border-admin-border/70 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] text-admin-ink">{trace.requestId}</span>
            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${correlationTone(trace.correlation)}`}>
              {t("api_trace_correlation")}: {trace.correlation}
            </span>
          </div>
          <p className="text-[11px] text-admin-muted">{trace.note}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-admin-border/60 p-2.5">
              <p className="text-[11px] font-medium text-admin-ink">{t("api_trace_server")}</p>
              {trace.server ? (
                <dl className="mt-1 space-y-0.5 text-[11px] text-admin-muted">
                  <p className="font-mono text-admin-ink">{trace.server.method} {trace.server.path}</p>
                  <p>HTTP {trace.server.status} · {ms(trace.server.durationMs)} · {groupLabel(trace.server.routeGroup, t)}</p>
                  <p className="tabular-nums">{time(trace.server.at)}</p>
                </dl>
              ) : (
                <p className="mt-1 text-[11px] text-admin-muted">{t("api_trace_none")}</p>
              )}
            </div>
            <div className="rounded-md border border-admin-border/60 p-2.5">
              <p className="text-[11px] font-medium text-admin-ink">{t("api_trace_browser")}</p>
              {trace.browser.events.length > 0 ? (
                <ul className="mt-1 space-y-1 text-[11px] text-admin-muted">
                  {trace.browser.events.map((event, index) => (
                    <li key={`${event.eventName}-${event.at}-${index}`}>
                      <span className="font-mono text-admin-ink">{event.eventName}</span>
                      {event.reason ? ` · ${event.reason}` : ""}
                      {event.httpStatus ? ` · HTTP ${event.httpStatus}` : ""}
                      <span className="ml-1 tabular-nums">{time(event.at)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-[11px] text-admin-muted">{t("api_trace_none")}</p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

export function ApiCheckoutView({
  data,
  trace,
  traceError,
  traceLoading,
  onLookup,
  onRefresh,
  refreshing,
  t,
}: {
  data: AdminApiDiagnostics | null;
  trace: AdminRequestTrace | null;
  traceError: string | null;
  traceLoading: boolean;
  onLookup: (requestId: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
  t: AdminI18n["t"];
}) {
  if (!data) {
    return <p className="text-sm text-admin-muted">{t("health_loading")}</p>;
  }

  if (data.state === "UNKNOWN") {
    return (
      <Card title={t("api_title")} badge={<StatusBadge status="UNKNOWN" />}>
        <p role="status" className="mt-3 text-sm text-admin-muted">{data.note}</p>
        <button type="button" disabled={refreshing} onClick={onRefresh} className="mt-3 rounded-lg border border-admin-border px-3 py-2 text-xs text-admin-ink disabled:opacity-50">
          {refreshing ? "…" : t("health_refresh")}
        </button>
      </Card>
    );
  }
  const routeBadge =
    data.routes.length === 0 ? (
      <StatusBadge status="NO_DATA" />
    ) : (
      <HealthStatusBadge status={routeHealth(data)} />
    );
  const reasonMax = Math.max(1, ...data.checkout.failureReasons.map((row) => row.count));

  return (
    <div className="space-y-4 [overflow-wrap:anywhere]">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-admin-ink">{t("api_title")}</h1>
          <p className="mt-1 text-sm text-admin-muted">{t("api_subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="rounded-lg border border-admin-border px-2.5 py-1.5 text-xs font-medium text-admin-ink hover:bg-admin-muted/10 disabled:opacity-60"
        >
          {refreshing ? "…" : t("health_refresh")}
        </button>
      </div>

      {!data.collecting ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {t("api_collecting_off")}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-admin-muted">
        <span>{t("api_window")}</span>
        <span>{t("api_sample_rate", { rate: Math.round(data.sampleRate * 100) })}</span>
        <span>{t("api_last_sample", { at: time(data.lastSampleAt) })}</span>
        {data.collector ? <span>{t("api_collector", { queued: data.collector.queued, dropped: data.collector.dropped })}</span> : null}
      </div>
      <p className="text-[11px] text-admin-muted">{data.note}</p>

      <Card title={t("api_routes_title")} badge={routeBadge}>
        <p className="mt-2 text-xs text-admin-muted">{t("api_routes_subtitle")}</p>
        {data.routes.length === 0 ? (
          <p className="mt-3 text-xs text-admin-muted">
            {data.collecting ? t("api_no_data") : t("api_not_enabled")}
          </p>
        ) : (
          <>
            <div className="mt-3 hidden overflow-x-auto sm:block">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-admin-border/60 text-left text-admin-muted">
                    <th className="py-1.5 pr-2 font-medium">{t("api_col_group")}</th>
                    <th className="px-1.5 py-1.5 text-right font-medium">{t("api_col_requests")}</th>
                    <th className="px-1.5 py-1.5 text-right font-medium">{t("api_col_p50")}</th>
                    <th className="px-1.5 py-1.5 text-right font-medium">{t("api_col_p90")}</th>
                    <th className="px-1.5 py-1.5 text-right font-medium">{t("api_col_p95")}</th>
                    <th className="px-1.5 py-1.5 text-right font-medium">{t("api_col_5xx")}</th>
                    <th className="px-1.5 py-1.5 text-right font-medium">{t("api_col_slow")}</th>
                    <th className="py-1.5 pl-2 font-medium">{t("api_col_last")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.routes.map((route) => (
                    <tr key={route.routeGroup} className="border-b border-admin-border/40 last:border-0">
                      <td className="py-1.5 pr-2 text-admin-ink">{groupLabel(route.routeGroup, t)}</td>
                      <td className="px-1.5 py-1.5 text-right tabular-nums">{route.requests}</td>
                      <td className="px-1.5 py-1.5 text-right tabular-nums">{ms(route.p50Ms)}</td>
                      <td className="px-1.5 py-1.5 text-right tabular-nums">{ms(route.p90Ms)}</td>
                      <td className={`px-1.5 py-1.5 text-right tabular-nums ${route.p95Ms > route.budgetMs ? "font-semibold text-rose-700" : ""}`}>
                        {ms(route.p95Ms)}
                      </td>
                      <td className={`px-1.5 py-1.5 text-right tabular-nums ${route.serverErrors > 0 ? "font-semibold text-rose-700" : ""}`}>
                        {route.serverErrors}
                      </td>
                      <td className="px-1.5 py-1.5 text-right tabular-nums">{route.slowRequests}</td>
                      <td className="py-1.5 pl-2 tabular-nums text-admin-muted">{time(route.lastAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="mt-2 space-y-2 sm:hidden">
              {data.routes.map((route) => (
                <li key={route.routeGroup} className="rounded-md border border-admin-border/60 px-2.5 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-admin-ink">{groupLabel(route.routeGroup, t)}</span>
                    <span className="text-[11px] text-admin-muted">{route.requests} req</span>
                  </div>
                  <p className="mt-1 text-[11px] text-admin-muted">
                    p50 {ms(route.p50Ms)} · p90 {ms(route.p90Ms)} ·{" "}
                    <span className={route.p95Ms > route.budgetMs ? "font-semibold text-rose-700" : ""}>
                      p95 {ms(route.p95Ms)}
                    </span>
                    {" · "}5xx {route.serverErrors} · {t("api_col_slow")} {route.slowRequests}
                  </p>
                  <p className="text-[11px] text-admin-muted">{t("api_col_budget")} {ms(route.budgetMs)} · {time(route.lastAt)}</p>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <Card title={t("api_chain_title")}>
        <p className="mt-2 text-xs text-admin-muted">{t("api_chain_subtitle")}</p>
        <div className="mt-3">
          <StepHealthChain steps={chainSteps(data, t)} />
        </div>
      </Card>

      <div className="grid items-start gap-4 md:grid-cols-2">
        <Card title={t("api_reasons_title")}>
          <p className="mt-2 text-xs text-admin-muted">{t("api_reasons_subtitle")}</p>
          {data.checkout.failureReasons.length === 0 ? (
            <p className="mt-3 text-xs text-admin-muted">{t("api_no_reasons")}</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {data.checkout.failureReasons.map((row) => (
                <li key={row.reason}>
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-mono text-admin-ink">{row.reason}</span>
                    <span className="tabular-nums text-admin-muted">{row.count}</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-admin-muted/15">
                    <div
                      className="h-1.5 rounded-full bg-cta/70"
                      style={{ width: `${Math.max(4, Math.round((row.count / reasonMax) * 100))}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title={t("api_recent_title")}
          badge={<StatusBadge status={data.recentFailures.length > 0 ? "FAILED" : "NO_DATA"} />}
        >
          <p className="mt-2 text-xs text-admin-muted">{t("api_recent_subtitle")}</p>
          {data.recentFailures.length === 0 ? (
            <p className="mt-3 text-xs text-admin-muted">{t("api_no_failures")}</p>
          ) : (
            <ul className="mt-2 divide-y divide-admin-border/60">
              {data.recentFailures.map((row) => (
                <li key={`${row.requestId}-${row.at}-${row.path}`} className="py-2">
                  <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs">
                    <span className="font-mono text-admin-ink">
                      {row.method} {row.path}
                    </span>
                    <span className={`tabular-nums ${row.status >= 500 ? "font-semibold text-rose-700" : ""}`}>
                      HTTP {row.status} · {ms(row.durationMs)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-admin-muted">
                    <button
                      type="button"
                      onClick={() => onLookup(row.requestId)}
                      className="font-mono text-cta hover:underline"
                    >
                      {row.requestId}
                    </button>
                    <span className="tabular-nums">{time(row.at)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <RequestTracePanel
        trace={trace}
        traceError={traceError}
        traceLoading={traceLoading}
        onLookup={onLookup}
        t={t}
      />

      <p className="text-[11px] text-admin-muted">{t("api_sampling_note")}</p>
      <p className="text-[11px] text-admin-muted">{t("api_p95_note")}</p>
    </div>
  );
}
