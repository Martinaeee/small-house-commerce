import type { ReactNode } from "react";
import type { AttentionTone, MetricChange } from "@/lib/dashboard-api";

/**
 * Card shell for every dashboard module.
 *
 * Deliberately light: one hairline border, one small radius, no shadow. The
 * existing admin surfaces use `rounded-xl border border-border bg-card`, and
 * the dashboard keeps that language instead of inventing a heavier panel.
 */
export function DashboardCard({
  title,
  subtitle,
  action,
  children,
  className = "",
  bodyClassName = "",
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`flex min-w-0 flex-col rounded-xl border border-border bg-card ${className}`}>
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-ink">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-xs text-ink-muted">{subtitle}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      <div className={`min-w-0 flex-1 p-4 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

export function CardEmpty({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-4 text-center">
      <p className="text-sm font-medium text-ink-secondary">{title}</p>
      {hint ? <p className="text-xs text-ink-muted">{hint}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function CardSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="h-9 animate-pulse rounded-lg bg-admin-neutral-soft"
        />
      ))}
    </div>
  );
}

export const toneText: Record<AttentionTone, string> = {
  red: "text-admin-error",
  amber: "text-admin-warning",
  green: "text-admin-success",
  neutral: "text-ink-secondary",
};

export const toneSurface: Record<AttentionTone, string> = {
  red: "bg-admin-error-soft",
  amber: "bg-admin-warning-soft",
  green: "bg-admin-success-soft",
  neutral: "bg-admin-neutral-soft",
};

/**
 * Period-over-period change. A null percentage is rendered as a bare arrow
 * (growth from zero) or an em dash (no comparable period) — never as 0%.
 */
export function Trend({ change, label }: { change: MetricChange; label?: string }) {
  if (change.direction === "UNKNOWN") {
    return (
      <span className="text-xs text-ink-muted" title={label}>
        —
      </span>
    );
  }
  if (change.percent === null) {
    const glyph = change.direction === "UP" ? "↑" : change.direction === "DOWN" ? "↓" : "→";
    return (
      <span
        className={`text-xs font-semibold ${toneText[change.direction === "UP" ? "green" : change.direction === "DOWN" ? "red" : "neutral"]}`}
        title={label}
      >
        {glyph}
      </span>
    );
  }
  const tone = change.direction === "UP" ? "green" : change.direction === "DOWN" ? "red" : "neutral";
  const glyph = change.direction === "UP" ? "↑" : change.direction === "DOWN" ? "↓" : "→";
  return (
    <span className={`text-xs font-semibold tabular-nums ${toneText[tone]}`} title={label}>
      {glyph} {Math.abs(change.percent).toFixed(1)}%
    </span>
  );
}
