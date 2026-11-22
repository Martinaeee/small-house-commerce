"use client";

import Link from "next/link";
import type { AdminI18n } from "@/lib/admin-i18n";
import type {
  AdminAlertIssue,
  AdminAlertList,
  AdminAvailabilityReport,
  AdminHealthSection,
  AdminStorefrontHealth,
} from "@/lib/admin-api";
import { CheckPill, routeLabel } from "./AvailabilityView";
import { Card, HealthStatusBadge, StatusBadge, type ObsStatus } from "./StatusBadge";

function sectionBadge(section: AdminHealthSection): ObsStatus {
  if (section.state === "NOT_ENABLED") return "NOT_SUPPORTED";
  if (section.state === "NO_DATA") return "NO_DATA";
  if (section.state === "UNKNOWN") return "UNKNOWN";
  return section.status ? "UNKNOWN" : "NO_DATA";
}

/**
 * Data-state semantics (never conflated):
 * NO DATA → monitoring data is not available; NOT ENABLED → feature off;
 * UNKNOWN → cannot determine. "No active issues" is reserved for a future
 * evaluated state and is deliberately not shown in P1R.
 */
function sectionText(section: AdminHealthSection, t: AdminI18n["t"]): string {
  if (section.state === "NOT_ENABLED") return t("health_not_enabled");
  if (section.state === "NO_DATA") return t("health_monitoring_unavailable");
  if (section.state === "UNKNOWN") return "UNKNOWN";
  return section.note ?? "";
}

function severityTone(severity: AdminAlertIssue["severity"]): string {
  if (severity === "P0") return "border-rose-200 bg-rose-50 text-rose-800";
  if (severity === "P1") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function IssueList({ issues, t }: { issues: AdminAlertIssue[]; t: AdminI18n["t"] }) {
  return (
    <ul className="mt-2 divide-y divide-admin-border/60">
      {issues.map((issue) => (
        <li key={issue.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${severityTone(issue.severity)}`}>
                {issue.severity}
              </span>
              <span className="text-sm text-admin-ink">{issue.title}</span>
              <span className="font-mono text-[11px] text-admin-muted">{issue.ruleCode}</span>
            </div>
            <p className="mt-0.5 whitespace-pre-wrap text-xs text-admin-muted">{issue.detail}</p>
          </div>
          <div className="text-right text-[11px] text-admin-muted">
            <p>{issue.occurrences}×</p>
            <p className="tabular-nums">{new Date(issue.lastSeenAt).toLocaleString()}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function AvailabilityDetails({
  report,
  t,
}: {
  report: AdminAvailabilityReport;
  t: AdminI18n["t"];
}) {
  const uptimeValues = report.uptime7d
    .map((day) => day.uptimePct)
    .filter((value): value is number => value !== null);
  const uptime =
    uptimeValues.length > 0
      ? `${(uptimeValues.reduce((sum, value) => sum + value, 0) / uptimeValues.length).toFixed(2)}%`
      : "—";

  return (
    <details className="mt-3 rounded-lg border border-admin-border/70">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-admin-ink">
        {t("availability_details_toggle")}
      </summary>
      <div className="border-t border-admin-border/60 p-3">
        <p className="text-[11px] text-admin-muted">{t("availability_details_hint")}</p>
        <div className="mt-2 hidden overflow-x-auto sm:block">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-admin-border/60 text-left text-admin-muted">
                <th className="py-1.5 pr-2 font-medium">{t("availability_col_route")}</th>
                <th className="px-1.5 py-1.5 font-medium">{t("availability_col_dns")}</th>
                <th className="px-1.5 py-1.5 font-medium">{t("availability_col_tls")}</th>
                <th className="px-1.5 py-1.5 font-medium">{t("availability_col_http")}</th>
                <th className="px-1.5 py-1.5 text-right font-medium">{t("availability_col_latency")}</th>
                <th className="py-1.5 pl-2 font-medium">{t("availability_col_status")}</th>
              </tr>
            </thead>
            <tbody>
              {report.routes.map((route) => (
                <tr key={route.key} className="border-b border-admin-border/40 last:border-0">
                  <td className="py-1.5 pr-2">{routeLabel(route, t)}</td>
                  <td className="px-1.5 py-1.5"><CheckPill value={route.dns} t={t} /></td>
                  <td className="px-1.5 py-1.5"><CheckPill value={route.tls} t={t} /></td>
                  <td className="px-1.5 py-1.5"><CheckPill value={route.http} t={t} /></td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums">
                    {route.latencyMs === null ? "—" : `${route.latencyMs} ms`}
                  </td>
                  <td className="py-1.5 pl-2"><HealthStatusBadge status={route.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ul className="mt-2 space-y-2 sm:hidden">
          {report.routes.map((route) => (
            <li key={route.key} className="rounded-md border border-admin-border/60 px-2.5 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-admin-ink">{routeLabel(route, t)}</span>
                <HealthStatusBadge status={route.status} />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-admin-muted">
                <span className="flex items-center gap-1">
                  {t("availability_col_dns")} <CheckPill value={route.dns} t={t} />
                </span>
                <span className="flex items-center gap-1">
                  {t("availability_col_tls")} <CheckPill value={route.tls} t={t} />
                </span>
                <span className="flex items-center gap-1">
                  {t("availability_col_http")} <CheckPill value={route.http} t={t} />
                </span>
                <span className="tabular-nums">
                  {route.latencyMs === null ? "—" : `${route.latencyMs} ms`}
                </span>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-admin-muted">
          <span>
            {t("availability_details_uptime")}: <span className="font-semibold text-admin-ink">{uptime}</span>
          </span>
          {report.edge?.available ? (
            <span>
              {t("availability_details_edge")}: 5xx {report.edge.errorRate5xx ?? "—"}% · 4xx{" "}
              {report.edge.errorRate4xx ?? "—"}% · {report.edge.slowestMs ?? "—"} ms
            </span>
          ) : null}
        </div>
      </div>
    </details>
  );
}

export function HealthHomeView({
  data,
  availability,
  alerts,
  t,
}: {
  data: AdminStorefrontHealth;
  availability?: AdminAvailabilityReport | null;
  alerts?: AdminAlertList | null;
  t: AdminI18n["t"];
}) {
  const openIssues = alerts?.issues.filter((issue) => issue.status !== "CLOSED") ?? [];
  const worstIssue = openIssues.find((issue) => issue.severity === "P0") ?? openIssues[0] ?? null;
  const sections = [
    { key: "availability", title: t("health_section_availability"), href: "/admin/observability/availability", section: data.sections.availability },
    { key: "issues", title: t("health_section_issues"), href: "/admin/observability/alerts", section: data.sections.issues },
    { key: "pageExperience", title: t("health_section_page_experience"), href: "/admin/observability/page-experience", section: data.sections.pageExperience },
    { key: "checkout", title: t("health_section_checkout"), href: "/admin/observability/api-checkout", section: data.sections.checkout },
  ] as const;

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-admin-border bg-white p-4 md:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs font-medium text-admin-muted">{t("health_status")}</p>
          <HealthStatusBadge status={data.status} />
          <span className="text-xs text-admin-muted">
            {t("health_updated", { at: new Date(data.asOf).toLocaleString() })}
          </span>
        </div>
        <p className="mt-2 text-sm text-admin-ink">{data.reason}</p>
      </section>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {sections.map((item) => (
          <Card
            key={item.key}
            title={item.title}
            badge={
              item.section.state === "VALUE" && item.section.status ? (
                <HealthStatusBadge status={item.section.status} />
              ) : (
                <StatusBadge
                  status={sectionBadge(item.section)}
                  label={item.section.state === "NOT_ENABLED" ? t("health_not_enabled") : undefined}
                />
              )
            }
          >
            <p className="mt-3 text-xs text-admin-muted">{sectionText(item.section, t)}</p>
            {item.section.state === "NO_DATA" && item.section.note ? (
              <p className="mt-1 text-[11px] text-admin-muted">{item.section.note}</p>
            ) : null}
            {item.key === "availability" &&
            availability &&
            item.section.state === "VALUE" ? (
              <AvailabilityDetails report={availability} t={t} />
            ) : null}
            <Link href={item.href} className="mt-2 inline-block text-xs font-medium text-cta hover:underline">
              {t("health_open_module")} →
            </Link>
          </Card>
        ))}
      </div>

      <Card
        title={t("health_recent_issues")}
        badge={
          alerts?.alertingEnabled ? (
            <HealthStatusBadge
              status={
                worstIssue
                  ? worstIssue.severity === "P0"
                    ? "DOWN"
                    : worstIssue.severity === "P1"
                      ? "DEGRADED"
                      : "OPERATIONAL"
                  : "OPERATIONAL"
              }
            />
          ) : (
            <StatusBadge status="NO_DATA" />
          )
        }
      >
        {alerts?.alertingEnabled ? (
          openIssues.length === 0 ? (
            <p className="mt-3 text-xs text-admin-muted">{t("alerts_none_evaluated")}</p>
          ) : (
            <IssueList issues={openIssues.slice(0, 5)} t={t} />
          )
        ) : (
          <p className="mt-3 text-xs text-admin-muted">
            {alerts ? t("alerts_not_enabled") : t("health_monitoring_unavailable")}
          </p>
        )}
      </Card>

      <Card title={t("health_matrix")} badge={<StatusBadge status="NO_DATA" />}>
        <p className="mt-3 text-xs text-admin-muted">{t("health_monitoring_unavailable")}</p>
      </Card>

      <Card title={t("health_priority")}>
        {worstIssue ? (
          <IssueList issues={[worstIssue]} t={t} />
        ) : (
          <p className="mt-3 text-xs text-admin-muted">
            {alerts?.alertingEnabled
              ? t("alerts_none_evaluated")
              : alerts
                ? t("alerts_not_enabled")
                : t("health_no_priority_data")}
          </p>
        )}
      </Card>
    </div>
  );
}
