"use client";

import { useState } from "react";
import type { AdminI18n } from "@/lib/admin-i18n";
import {
  isCustomRangeValid,
  presetRange,
  type PeriodPreset,
  type PeriodRange,
} from "@/lib/observability-period";

const PRESETS: Array<{ preset: PeriodPreset; key: Parameters<AdminI18n["t"]>[0] }> = [
  { preset: "TODAY", key: "observability_period_today" },
  { preset: "YESTERDAY", key: "observability_period_yesterday" },
  { preset: "LAST_7", key: "observability_period_7" },
  { preset: "LAST_14", key: "observability_period_14" },
  { preset: "LAST_30", key: "observability_period_30" },
  { preset: "CUSTOM", key: "observability_period_custom" },
];

/**
 * Shared period toolbar (Overview + Attribution). Emits Manila-day ranges;
 * the backend enforces the same 90-day maximum.
 */
export function PeriodToolbar({
  preset,
  range,
  onRangeChange,
  onRefresh,
  loading,
  asOf,
  t,
}: {
  preset: PeriodPreset;
  range: PeriodRange;
  onRangeChange: (preset: PeriodPreset, range: PeriodRange) => void;
  onRefresh: () => void;
  loading: boolean;
  asOf?: string;
  t: AdminI18n["t"];
}) {
  const [draftFrom, setDraftFrom] = useState(range.from);
  const [draftTo, setDraftTo] = useState(range.to);

  function select(preset: PeriodPreset) {
    if (preset === "CUSTOM") {
      onRangeChange("CUSTOM", { from: draftFrom, to: draftTo });
      return;
    }
    const next = presetRange(preset, null);
    if (next) onRangeChange(preset, next);
  }

  const customValid = isCustomRangeValid(draftFrom, draftTo);
  return (
    <div className="flex flex-col gap-2 border-b border-admin-border pb-3 md:flex-row md:items-center md:justify-between">
      <div className="flex items-center gap-1 overflow-x-auto" role="tablist" aria-label="period">
        {PRESETS.map((item) => (
          <button
            key={item.preset}
            type="button"
            role="tab"
            aria-selected={preset === item.preset}
            onClick={() => select(item.preset)}
            className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium ${
              preset === item.preset
                ? "bg-cta text-cta-foreground"
                : "text-admin-muted hover:bg-admin-muted/10"
            }`}
          >
            {t(item.key)}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-admin-muted">
        <span>{t("observability_period_timezone")}</span>
        <span>{t("observability_period_range", { from: range.from, to: range.to })}</span>
        {asOf ? <span>{t("observability_last_updated", { at: new Date(asOf).toLocaleTimeString() })}</span> : null}
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="rounded-lg border border-admin-border px-2.5 py-1.5 text-xs font-medium text-admin-ink hover:bg-admin-muted/10 disabled:opacity-60"
        >
          {loading ? "…" : t("observability_refresh")}
        </button>
      </div>
      {preset === "CUSTOM" ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <input
            type="date"
            aria-label="from"
            value={draftFrom}
            onChange={(e) => setDraftFrom(e.target.value)}
            className="rounded-lg border border-admin-border px-2 py-1.5"
          />
          <input
            type="date"
            aria-label="to"
            value={draftTo}
            onChange={(e) => setDraftTo(e.target.value)}
            className="rounded-lg border border-admin-border px-2 py-1.5"
          />
          <button
            type="button"
            disabled={!customValid}
            onClick={() => onRangeChange("CUSTOM", { from: draftFrom, to: draftTo })}
            className="rounded-lg bg-cta px-3 py-1.5 font-medium text-cta-foreground disabled:opacity-50"
          >
            {t("observability_period_apply")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
