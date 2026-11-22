"use client";

import type { ReactNode } from "react";
import { StatusBadge, type ObsStatus } from "./StatusBadge";

/**
 * One KPI: big number, short label, tooltip-style definition, optional badge.
 * `null` renders as UNKNOWN — never as 0.
 */
export function KpiCard({
  label,
  value,
  hint,
  badge,
  sub,
  testId,
}: {
  label: string;
  value: number | string | null;
  hint?: string;
  badge?: ObsStatus;
  sub?: ReactNode;
  testId?: string;
}) {
  return (
    <div data-testid={testId} className="rounded-xl border border-admin-border bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-admin-muted">{label}</p>
        {badge ? <StatusBadge status={badge} /> : null}
      </div>
      <p
        className="mt-2 text-[28px] font-semibold leading-none text-admin-ink"
        title={hint}
      >
        {value === null ? "UNKNOWN" : String(value)}
      </p>
      {sub ? <div className="mt-2 text-xs text-admin-muted">{sub}</div> : null}
      {hint ? <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-admin-muted">{hint}</p> : null}
    </div>
  );
}
