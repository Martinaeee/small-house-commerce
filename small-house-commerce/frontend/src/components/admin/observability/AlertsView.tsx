"use client";

import { useMemo, useState } from "react";
import type { AdminI18n } from "@/lib/admin-i18n";
import type {
  AdminAlertIssue,
  AdminAlertList,
  AdminAlertSeverity,
  AdminAlertStatus,
} from "@/lib/admin-api";

const SEVERITY_TONE: Record<AdminAlertSeverity, string> = {
  P0: "border-rose-200 bg-rose-50 text-rose-800",
  P1: "border-amber-200 bg-amber-50 text-amber-900",
  P2: "border-slate-200 bg-slate-50 text-slate-700",
};

function formatTime(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function statusLabel(status: AdminAlertStatus, t: AdminI18n["t"]): string {
  if (status === "ACKNOWLEDGED") return t("alerts_acknowledged");
  if (status === "CLOSED") return t("alerts_filter_closed");
  return t("alerts_filter_open");
}

function IssueCard({
  issue,
  canUpdate,
  updating,
  onUpdate,
  t,
}: {
  issue: AdminAlertIssue;
  canUpdate: boolean;
  updating: boolean;
  onUpdate: (id: string, status: AdminAlertStatus) => void;
  t: AdminI18n["t"];
}) {
  return (
    <li className="rounded-xl border border-admin-border bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${SEVERITY_TONE[issue.severity]}`}>
          {issue.severity}
        </span>
        <span className="rounded-full border border-admin-border px-2 py-0.5 text-[11px] font-medium text-admin-muted">
          {statusLabel(issue.status, t)}
        </span>
        <span className="text-sm font-semibold text-admin-ink">{issue.title}</span>
        <span className="font-mono text-[11px] text-admin-muted">{issue.ruleCode}</span>
      </div>

      <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-admin-ink">{issue.detail}</p>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-admin-muted sm:grid-cols-4">
        <div>
          <dt>{t("alerts_first_seen")}</dt>
          <dd className="tabular-nums text-admin-ink">{formatTime(issue.firstSeenAt)}</dd>
        </div>
        <div>
          <dt>{t("alerts_last_seen")}</dt>
          <dd className="tabular-nums text-admin-ink">{formatTime(issue.lastSeenAt)}</dd>
        </div>
        <div>
          <dt>{t("alerts_occurrences")}</dt>
          <dd className="tabular-nums text-admin-ink">{issue.occurrences}</dd>
        </div>
        <div>
          <dt>{t("alerts_status")}</dt>
          <dd className="text-admin-ink">{statusLabel(issue.status, t)}</dd>
        </div>
      </dl>

      {canUpdate ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {issue.status === "OPEN" ? (
            <button
              type="button"
              disabled={updating}
              onClick={() => onUpdate(issue.id, "ACKNOWLEDGED")}
              className="rounded-lg border border-admin-border px-2.5 py-1 text-xs font-medium text-admin-ink hover:bg-admin-muted/10 disabled:opacity-50"
            >
              {t("alerts_ack")}
            </button>
          ) : null}
          {issue.status !== "CLOSED" ? (
            <button
              type="button"
              disabled={updating}
              onClick={() => onUpdate(issue.id, "CLOSED")}
              className="rounded-lg border border-admin-border px-2.5 py-1 text-xs font-medium text-admin-ink hover:bg-admin-muted/10 disabled:opacity-50"
            >
              {t("alerts_close")}
            </button>
          ) : (
            <button
              type="button"
              disabled={updating}
              onClick={() => onUpdate(issue.id, "OPEN")}
              className="rounded-lg border border-admin-border px-2.5 py-1 text-xs font-medium text-admin-ink hover:bg-admin-muted/10 disabled:opacity-50"
            >
              {t("alerts_reopen")}
            </button>
          )}
        </div>
      ) : null}
    </li>
  );
}

export function AlertsView({
  data,
  error,
  loading,
  canUpdate,
  updatingId,
  onUpdate,
  onRefresh,
  t,
}: {
  data: AdminAlertList | null;
  error: string | null;
  loading: boolean;
  canUpdate: boolean;
  updatingId: string | null;
  onUpdate: (id: string, status: AdminAlertStatus) => void;
  onRefresh: () => void;
  t: AdminI18n["t"];
}) {
  const [filter, setFilter] = useState<"all" | "open" | "closed">("all");
  const issues = data?.issues ?? [];
  const openIssues = issues.filter((issue) => issue.status !== "CLOSED");
  const worst = openIssues.some((issue) => issue.severity === "P0")
    ? "P0"
    : openIssues.some((issue) => issue.severity === "P1")
      ? "P1"
      : openIssues.length > 0
        ? "P2"
        : null;

  const visible = useMemo(
    () =>
      issues.filter((issue) =>
        filter === "all"
          ? true
          : filter === "open"
            ? issue.status !== "CLOSED"
            : issue.status === "CLOSED",
      ),
    [issues, filter],
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

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-admin-border bg-white p-4 md:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs font-medium text-admin-muted">{t("alerts_status")}</p>
          {data.alertingEnabled ? (
            <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${worst ? SEVERITY_TONE[worst] : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
              {worst ?? "OPERATIONAL"}
            </span>
          ) : (
            <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] font-semibold text-slate-700">
              NOT ENABLED
            </span>
          )}
          {data.alertingEnabled ? (
            <span className="text-xs text-admin-muted">
              {openIssues.length === 0
                ? t("alerts_none_evaluated")
                : t("alerts_active_count", { count: openIssues.length })}
            </span>
          ) : (
            <span className="text-xs text-admin-muted">{t("alerts_not_enabled")}</span>
          )}
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="ml-auto rounded-lg border border-admin-border px-2.5 py-1 text-xs font-medium text-admin-ink disabled:opacity-50"
          >
            {t("health_refresh")}
          </button>
        </div>
      </section>

      <div className="flex flex-wrap gap-1">
        {(["all", "open", "closed"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={`rounded-full border px-2.5 py-1 text-xs ${filter === value ? "border-cta bg-cta text-white" : "border-admin-border text-admin-ink"}`}
          >
            {value === "all"
              ? t("alerts_filter_all")
              : value === "open"
                ? t("alerts_filter_open")
                : t("alerts_filter_closed")}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-admin-border bg-white px-4 py-6 text-sm text-admin-muted">
          {data.alertingEnabled ? t("alerts_none_evaluated") : t("alerts_not_enabled")}
        </div>
      ) : (
        <ul className="space-y-3">
          {visible.map((issue) => (
            <IssueCard
              key={issue.id}
              issue={issue}
              canUpdate={canUpdate}
              updating={updatingId === issue.id}
              onUpdate={onUpdate}
              t={t}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
