"use client";

import { useAdminI18n } from "@/lib/admin-i18n";
import { quickDateRange, quickRangeButtonClass, quickRangePresets, type QuickDateRangeValue } from "@/lib/quick-date-range";

/**
 * The four ranges operators switch between most often, applied straight to a
 * from/to pair. The active one is the preset whose dates are already filled in.
 */
export function QuickDateRange({ from, to, disabled, onSelect }: {
  from?: string;
  to?: string;
  disabled?: boolean;
  onSelect: (range: QuickDateRangeValue) => void;
}) {
  const { t } = useAdminI18n();
  const now = new Date();
  return <div role="group" aria-label={t("marketing_quick_range")} className="flex flex-wrap items-center gap-1 pb-0.5">
    {quickRangePresets.map(preset => {
      const range = quickDateRange(preset, now);
      const active = from === range.from && to === range.to;
      return <button key={preset} type="button" aria-pressed={active} disabled={disabled} onClick={() => onSelect(range)} className={quickRangeButtonClass(active)}>
        {t(`marketing_performance_preset_${preset}`)}
      </button>;
    })}
  </div>;
}
