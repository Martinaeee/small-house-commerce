"use client";

import Link from "next/link";
import { useAdminI18n } from "@/lib/admin-i18n";
import type { DashboardRangePreset, QuickCreateItem } from "@/lib/dashboard-api";

const fieldClass =
  "h-9 rounded-lg border border-border bg-card px-2.5 text-sm text-ink focus:border-primary focus:outline-none";

const PRESETS: { value: DashboardRangePreset; key: Parameters<ReturnType<typeof useAdminI18n>["t"]>[0] }[] = [
  { value: "TODAY", key: "dash_range_today" },
  { value: "YESTERDAY", key: "dash_range_yesterday" },
  { value: "LAST_7_DAYS", key: "dash_range_7d" },
  { value: "LAST_30_DAYS", key: "dash_range_30d" },
  { value: "THIS_MONTH", key: "dash_range_this_month" },
  { value: "LAST_MONTH", key: "dash_range_last_month" },
  { value: "CUSTOM", key: "dash_range_custom" },
];

/**
 * Page-level controls. The global header already owns search, notifications,
 * language and the account menu, so this bar only adds what the dashboard
 * needs: the period, a store shortcut, quick create and a refresh.
 */
export function DashboardToolbar({
  range,
  from,
  to,
  onRangeChange,
  quickCreate,
  onRefresh,
  refreshing,
}: {
  range: DashboardRangePreset;
  from: string;
  to: string;
  onRangeChange: (next: { range: DashboardRangePreset; from: string; to: string }) => void;
  quickCreate: QuickCreateItem[];
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const { t } = useAdminI18n();
  const today = new Date().toISOString().slice(0, 10);
  const invalidRange =
    range === "CUSTOM" && (!from || !to || from > to);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="dashboard-range">
        {t("dash_range_custom")}
      </label>
      <select
        id="dashboard-range"
        className={fieldClass}
        value={range}
        onChange={(event) =>
          onRangeChange({ range: event.target.value as DashboardRangePreset, from, to })
        }
      >
        {PRESETS.map((preset) => (
          <option key={preset.value} value={preset.value}>
            {t(preset.key)}
          </option>
        ))}
      </select>

      {range === "CUSTOM" ? (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            className={fieldClass}
            aria-label={t("dash_from")}
            value={from}
            max={to || today}
            onChange={(event) => onRangeChange({ range, from: event.target.value, to })}
          />
          <span className="text-xs text-ink-muted">–</span>
          <input
            type="date"
            className={fieldClass}
            aria-label={t("dash_to")}
            value={to}
            min={from || undefined}
            max={today}
            onChange={(event) => onRangeChange({ range, from, to: event.target.value })}
          />
        </div>
      ) : null}

      <a
        href="/"
        target="_blank"
        rel="noreferrer"
        className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-2.5 text-sm text-ink-secondary transition-colors hover:border-primary hover:text-cta"
      >
        {t("dash_view_store")} ↗
      </a>

      {quickCreate.length > 0 ? (
        <details className="group relative">
          <summary className="flex h-9 cursor-pointer list-none items-center rounded-lg bg-admin-primary px-3 text-sm font-semibold text-white transition-colors hover:bg-admin-primary-hover [&::-webkit-details-marker]:hidden">
            + {t("dash_create")}
          </summary>
          <div className="absolute right-0 z-30 mt-2 w-60 overflow-hidden rounded-xl border border-border bg-card py-1 shadow-sm">
            {quickCreate.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                className="block px-3 py-2 text-sm text-ink-secondary transition-colors hover:bg-admin-surface-secondary hover:text-cta"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </details>
      ) : null}

      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing || invalidRange}
        className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-2.5 text-sm text-ink-secondary transition-colors hover:border-primary hover:text-cta disabled:opacity-60"
      >
        {refreshing ? t("dash_loading") : t("dash_refresh")}
      </button>

      {invalidRange ? (
        <span role="alert" className="text-xs font-medium text-admin-error">
          {t("dash_range_invalid")}
        </span>
      ) : null}
    </div>
  );
}
