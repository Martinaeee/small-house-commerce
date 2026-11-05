"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAdminI18n } from "@/lib/admin-i18n";
import {
  marketingDay,
  monthEnd,
  monthGrid,
  monthStart,
  presetForRange,
  quickDateRange,
  rangePresets,
  shiftMonth,
  type QuickRangePreset,
} from "@/lib/quick-date-range";

const fieldTriggerClass =
  "flex h-9 w-full min-w-0 items-center gap-2 rounded-lg border border-admin-border bg-white px-3 text-left text-sm";

const dateText = (day?: string) => (day ? day.replaceAll("-", "/") : "");

/**
 * A Facebook-style range picker: preset column on the left, two months in the
 * middle, and nothing is applied until the operator presses 更新. Dates are
 * Manila calendar days.
 */
export function DateRangePicker({ label, value, onChange, allowEmpty, max }: {
  label: string;
  value: { from?: string; to?: string };
  onChange: (range: { from?: string; to?: string }) => void;
  allowEmpty?: boolean;
  max?: string;
}) {
  const { t, lang } = useAdminI18n();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<{ from?: string; to?: string }>({ from: value.from, to: value.to });
  const [viewMonth, setViewMonth] = useState(() => monthStart(value.to || marketingDay()));
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const locale = lang === "zh" ? "zh-CN" : "en-PH";
  const months = useMemo(
    () => [viewMonth, shiftMonth(viewMonth, 1)],
    [viewMonth],
  );
  const monthLabel = (day: string) =>
    new Intl.DateTimeFormat(locale, { timeZone: "UTC", month: "long", year: "numeric" })
      .format(new Date(`${day}T00:00:00Z`));
  const weekdayLabels = useMemo(
    () => Array.from({ length: 7 }, (_, index) =>
      // 2026-11-02 is a Monday; walk forward from it.
      new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "short" })
        .format(new Date(`2026-11-${String(index + 2).padStart(2, "0")}T00:00:00Z`)),
    ),
    [locale],
  );

  const openPicker = () => {
    setDraft({ from: value.from, to: value.to });
    // Show the month the range starts in so a cross-month range is visible end to end.
    setViewMonth(monthStart(value.from || value.to || marketingDay()));
    setOpen(true);
  };

  const pickDay = (day: string) => {
    if (!draft.from || (draft.from && draft.to)) {
      setDraft({ from: day, to: undefined });
      return;
    }
    if (day < draft.from) {
      setDraft({ from: day, to: draft.from });
      return;
    }
    setDraft({ from: draft.from, to: day });
  };

  const pickPreset = (preset: QuickRangePreset) => {
    const range = quickDateRange(preset);
    setDraft(range);
    setViewMonth(monthStart(range.from));
  };

  const activePreset = draft.from ? presetForRange({ from: draft.from, to: draft.to ?? draft.from }) : null;
  const rangeStart = draft.from;
  const rangeEnd = draft.to ?? draft.from;
  const valuePreset = value.from ? presetForRange({ from: value.from, to: value.to ?? value.from }) : null;
  const dates = value.from
    ? value.to && value.to !== value.from
      ? `${dateText(value.from)} – ${dateText(value.to)}`
      : dateText(value.from)
    : "";
  const triggerText = valuePreset
    ? `${t(`marketing_performance_preset_${valuePreset}`)} · ${dates}`
    : value.from ? dates : t("marketing_date_empty");

  return <div ref={wrapperRef} className="relative min-w-0">
    <button
      type="button"
      aria-label={label}
      aria-expanded={open}
      aria-haspopup="dialog"
      disabled={false}
      onClick={() => (open ? setOpen(false) : openPicker())}
      className={`${fieldTriggerClass} hover:border-primary`}
    >
      <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-admin-muted" fill="none">
        <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
        <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <span className={`min-w-0 flex-1 truncate ${value.from ? "text-ink" : "text-admin-muted"}`}>{triggerText}</span>
      <svg aria-hidden viewBox="0 0 12 12" className={`h-3 w-3 shrink-0 text-admin-muted transition-transform ${open ? "rotate-180" : ""}`}>
        <path d="M2 4.5 6 8.5 10 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </button>

    {open && <div
      role="dialog"
      aria-label={label}
      className="absolute left-0 top-full z-50 mt-2 w-[min(46rem,calc(100vw-3rem))] rounded-xl border border-admin-border bg-white p-3 shadow-xl"
      onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}
    >
      <div className="flex gap-3">
        <ul aria-label={t("marketing_date_recent")} className="w-32 shrink-0 space-y-0.5 border-r border-admin-border pr-2">
          {rangePresets.map(preset => <li key={preset}>
            <button
              type="button"
              aria-pressed={activePreset === preset}
              onClick={() => pickPreset(preset)}
              className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs ${activePreset === preset ? "bg-admin-primary-soft font-semibold text-cta" : "text-ink hover:bg-slate-50"}`}
            >
              <span aria-hidden className={`h-3 w-3 rounded-full border ${activePreset === preset ? "border-cta bg-cta" : "border-admin-border"}`} />
              {t(`marketing_performance_preset_${preset}`)}
            </button>
          </li>)}
        </ul>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between pb-2">
            <button type="button" aria-label={t("marketing_date_prev_month")} onClick={() => setViewMonth(shiftMonth(viewMonth, -1))} className="rounded-lg px-2 py-1 text-admin-muted hover:bg-slate-50">
              <svg aria-hidden viewBox="0 0 12 12" className="h-3 w-3"><path d="M7.5 2 3.5 6l4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            </button>
            <span className="text-xs text-admin-muted">{t("marketing_date_timezone")}</span>
            <button type="button" aria-label={t("marketing_date_next_month")} onClick={() => setViewMonth(shiftMonth(viewMonth, 1))} className="rounded-lg px-2 py-1 text-admin-muted hover:bg-slate-50">
              <svg aria-hidden viewBox="0 0 12 12" className="h-3 w-3"><path d="M4.5 2 8.5 6l-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            </button>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {months.map(month => <div key={month}>
              <h3 className="pb-1 text-center text-xs font-semibold text-ink">{monthLabel(month)}</h3>
              <div className="grid grid-cols-7 text-center text-[11px] text-admin-muted">
                {weekdayLabels.map(day => <span key={day} className="py-1">{day}</span>)}
              </div>
              <div className="grid grid-cols-7 gap-y-0.5">
                {monthGrid(month).flat().map((day, index) => day === null
                  ? <span key={`pad-${index}`} />
                  : <div key={day} className={`flex justify-center ${rangeStart && rangeEnd && day >= rangeStart && day <= rangeEnd && !(day === rangeStart && rangeEnd !== rangeStart) ? "bg-admin-primary-soft" : ""}`}>
                    <button
                      type="button"
                      aria-label={day}
                      aria-pressed={day === rangeStart || day === rangeEnd}
                      disabled={Boolean(max && day > max)}
                      onClick={() => pickDay(day)}
                      className={`h-7 w-7 rounded-full text-xs ${day === rangeStart || day === rangeEnd ? "bg-cta font-semibold text-cta-foreground" : "text-ink hover:bg-slate-100"} disabled:cursor-not-allowed disabled:text-admin-muted`}
                    >
                      {Number(day.slice(8))}
                    </button>
                  </div>)}
              </div>
            </div>)}
          </div>
          <p className="pt-2 text-[11px] text-admin-muted">{t("marketing_date_hint")}</p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-2 border-t border-admin-border pt-3">
        {allowEmpty && <button type="button" onClick={() => { onChange({ from: "", to: "" }); setOpen(false); }} className="mr-auto rounded-lg px-3 py-1.5 text-xs text-admin-muted hover:bg-slate-50">{t("marketing_date_clear")}</button>}
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-admin-border px-3 py-1.5 text-xs">{t("marketing_date_cancel")}</button>
        <button
          type="button"
          onClick={() => {
            if (!draft.from) {
              if (allowEmpty) onChange({ from: "", to: "" });
              setOpen(false);
              return;
            }
            onChange({ from: draft.from, to: draft.to ?? draft.from });
            setOpen(false);
          }}
          className="rounded-lg bg-cta px-4 py-1.5 text-xs font-semibold text-cta-foreground"
        >
          {t("marketing_date_apply")}
        </button>
      </div>
    </div>}
  </div>;
}
