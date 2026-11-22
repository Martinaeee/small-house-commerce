"use client";

import type { ReactNode } from "react";

/** Six-state status vocabulary shared by cards and delivery layers. */
export type ObsStatus = "SUCCESS" | "WARNING" | "FAILED" | "UNKNOWN" | "NOT_SUPPORTED" | "NO_DATA";

const TONE: Record<ObsStatus, string> = {
  SUCCESS: "border-emerald-200 bg-emerald-50 text-emerald-800",
  WARNING: "border-amber-200 bg-amber-50 text-amber-800",
  FAILED: "border-rose-200 bg-rose-50 text-rose-800",
  UNKNOWN: "border-slate-200 bg-slate-50 text-slate-700",
  NOT_SUPPORTED: "border-sky-200 bg-sky-50 text-sky-800",
  NO_DATA: "border-admin-border bg-transparent text-admin-muted",
};

const LABEL: Record<ObsStatus, string> = {
  SUCCESS: "SUCCESS",
  WARNING: "WARNING",
  FAILED: "FAILED",
  UNKNOWN: "UNKNOWN",
  NOT_SUPPORTED: "NOT SUPPORTED",
  NO_DATA: "NO DATA",
};

export function StatusBadge({ status, label }: { status: ObsStatus; label?: string }) {
  return (
    <span
      data-status={status}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold tracking-wide ${TONE[status]}`}
    >
      {label ?? LABEL[status]}
    </span>
  );
}

/** Five real health states. The label always shows the true state name. */
export type HealthStatus = "OPERATIONAL" | "DEGRADED" | "DOWN" | "UNKNOWN" | "MAINTENANCE";

const HEALTH_TONE: Record<HealthStatus, string> = {
  OPERATIONAL: "border-emerald-200 bg-emerald-50 text-emerald-800",
  DEGRADED: "border-amber-200 bg-amber-50 text-amber-900",
  DOWN: "border-rose-200 bg-rose-50 text-rose-800",
  UNKNOWN: "border-slate-200 bg-slate-50 text-slate-700",
  MAINTENANCE: "border-dashed border-slate-300 bg-white text-slate-600",
};

/**
 * Overall storefront health badge. Color expresses severity only; the text is
 * always one of the five real states. Invalid/absent input falls back to
 * UNKNOWN — never to a green default.
 */
export function HealthStatusBadge({ status }: { status: HealthStatus | string | null | undefined }) {
  const normalized: HealthStatus =
    typeof status === "string" && Object.prototype.hasOwnProperty.call(HEALTH_TONE, status)
      ? (status as HealthStatus)
      : "UNKNOWN";
  return (
    <span
      data-health-status={normalized}
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-wide ${HEALTH_TONE[normalized]}`}
    >
      {normalized}
    </span>
  );
}

export function Card({ title, badge, children }: { title: string; badge?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-admin-border bg-white p-4 md:p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-admin-ink">{title}</h2>
        {badge}
      </div>
      {children}
    </section>
  );
}
