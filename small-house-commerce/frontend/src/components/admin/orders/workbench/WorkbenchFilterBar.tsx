"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAdminI18n, type TKey } from "@/lib/admin-i18n";
import { WORKBENCH_COLUMNS, type WorkbenchColumnKey } from "./columns";
import type { SavedView } from "./prefs";

export interface WorkbenchFilterState {
  search: string;
  status: string;
  payment: string;
  paymentStatus: string;
  confirmation: string;
  region: string;
  phone: string;
  sku: string;
  owner: string;
  priority: string;
  classification: string;
  risk: string;
  verification: string;
  followUp: string;
  dateFrom: string;
  dateTo: string;
  sort: string;
}

export interface WorkbenchFilterBarProps {
  filters: WorkbenchFilterState;
  onChange: (patch: Partial<WorkbenchFilterState>) => void;
  onClear: () => void;
  assignees: { id: string; name: string | null }[];
  statusOptions: { value: string; label: string }[];
  hiddenColumns: WorkbenchColumnKey[];
  onToggleColumn: (key: WorkbenchColumnKey) => void;
  onResetColumns: () => void;
  views: SavedView[];
  onApplyView: (view: SavedView) => void;
  onSaveView: (name: string) => void;
  onDeleteView: (id: string) => void;
  onExport: () => void;
  activeFilterCount: number;
}

const ORDER_STATUS_OPTIONS = [
  { value: "NEW", label: "NEW" },
  { value: "PENDING", label: "PENDING" },
  { value: "QUESTION", label: "QUESTION" },
  { value: "CONFIRMED", label: "CONFIRMED" },
  { value: "ABNORMAL", label: "ABNORMAL" },
  { value: "SHIPPING", label: "SHIPPING" },
  { value: "SIGNED", label: "SIGNED" },
  { value: "CANCELLED", label: "CANCELLED" },
  { value: "DENIED", label: "DENIED" },
  { value: "AFTER_SALES", label: "AFTER_SALES" },
];

const RISK_OPTIONS = ["POSSIBLE_DUPLICATE", "CUSTOMER_RECHECK", "CUSTOMER_BLOCKED"];

const CLASSIFICATION_OPTIONS = ["NEW", "AGAIN", "RPT", "RECHECK"];

const PAYMENT_STATUS_OPTIONS = [
  "COD_PENDING",
  "COLLECTED",
  "SETTLEMENT_PENDING",
  "SETTLED",
  "ONLINE_PENDING",
  "PAID",
  "FAILED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
];

const CONFIRMATION_KEY: Record<string, TKey> = {
  UNCONFIRMED: "admin_search_confirmation_UNCONFIRMED",
  NEEDS_REVIEW: "admin_search_confirmation_NEEDS_REVIEW",
  CONFIRMED: "admin_search_confirmation_CONFIRMED",
  REJECTED: "admin_search_confirmation_REJECTED",
};

/** Local YYYY-MM-DD — toISOString() shifts the day in UTC+8. */
function localDay(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const TRIGGER_CLS =
  "inline-flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-2 text-[13px] text-ink-secondary hover:bg-background";
const POPOVER_CLS =
  "absolute z-40 mt-1 rounded-xl border border-border bg-card p-3 shadow-lg";

function Popover({
  label,
  children,
  align = "left",
  width = "w-64",
}: {
  label: ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={TRIGGER_CLS}
      >
        {label}
        <span aria-hidden className="text-ink-muted">
          ▾
        </span>
      </button>
      {open ? (
        <div className={`${POPOVER_CLS} ${width} ${align === "right" ? "right-0" : "left-0"}`}>
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

export function WorkbenchFilterBar({
  filters,
  onChange,
  onClear,
  assignees,
  statusOptions,
  hiddenColumns,
  onToggleColumn,
  onResetColumns,
  views,
  onApplyView,
  onSaveView,
  onDeleteView,
  onExport,
  activeFilterCount,
}: WorkbenchFilterBarProps) {
  const { t } = useAdminI18n();
  const selectedPaymentStatuses = filters.paymentStatus.split(",").filter(Boolean);
  const statusOptionList =
    statusOptions.length > 0 ? statusOptions : ORDER_STATUS_OPTIONS;
  // A dashboard link may carry a status set (CONFIRMED,SIGNED). Without a
  // matching option the select would read "all statuses" while filtering.
  const appliedStatusOptions =
    filters.status && !statusOptionList.some((option) => option.value === filters.status)
      ? [
          ...statusOptionList,
          { value: filters.status, label: filters.status.split(",").join(", ") },
        ]
      : statusOptionList;
  const [draftFrom, setDraftFrom] = useState(filters.dateFrom);
  const [draftTo, setDraftTo] = useState(filters.dateTo);
  const [viewName, setViewName] = useState("");

  // The drafts follow the URL: a change from outside (a saved view, the
  // back button) replaces them during render, like the admin shell does.
  const [syncedRange, setSyncedRange] = useState(`${filters.dateFrom}|${filters.dateTo}`);
  if (`${filters.dateFrom}|${filters.dateTo}` !== syncedRange) {
    setSyncedRange(`${filters.dateFrom}|${filters.dateTo}`);
    setDraftFrom(filters.dateFrom);
    setDraftTo(filters.dateTo);
  }

  const dateLabel =
    filters.dateFrom || filters.dateTo
      ? `${filters.dateFrom || "…"} → ${filters.dateTo || "…"}`
      : t("orders_date_all");

  /** The four ranges the draft offers, so the active one can be marked. */
  const presetRanges = useMemo(() => {
    const now = new Date();
    const today = localDay(now);
    const weekFrom = new Date(now);
    weekFrom.setDate(weekFrom.getDate() - 6);
    const monthFrom = new Date(now.getFullYear(), now.getMonth(), 1);
    return {
      today: { from: today, to: today },
      week: { from: localDay(weekFrom), to: today },
      month: { from: localDay(monthFrom), to: today },
      all: { from: "", to: "" },
    } as const;
  }, []);

  function applyPreset(kind: "today" | "week" | "month" | "all") {
    const range = presetRanges[kind];
    setDraftFrom(range.from);
    setDraftTo(range.to);
    onChange({ dateFrom: range.from, dateTo: range.to });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Date range */}
      <Popover label={t("orders_date_range") + "：" + dateLabel} width="w-80">
        {() => (
          <div>
            <div className="mb-2 text-[11px] font-bold uppercase tracking-[.06em] text-ink-muted">
              {t("orders_created")}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={draftFrom}
                max={draftTo || undefined}
                onChange={(event) => setDraftFrom(event.target.value)}
                aria-label={t("orders_date_from")}
                className="w-full rounded-lg border border-border bg-card px-2 py-1.5 text-[13px] text-ink"
              />
              <span className="text-ink-muted">→</span>
              <input
                type="date"
                value={draftTo}
                min={draftFrom || undefined}
                onChange={(event) => setDraftTo(event.target.value)}
                aria-label={t("orders_date_to")}
                className="w-full rounded-lg border border-border bg-card px-2 py-1.5 text-[13px] text-ink"
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(
                [
                  ["today", t("orders_date_today")],
                  ["week", t("orders_date_week")],
                  ["month", t("orders_date_month")],
                  ["all", t("orders_date_all")],
                ] as const
              ).map(([kind, label]) => {
                const range = presetRanges[kind];
                const active =
                  filters.dateFrom === range.from && filters.dateTo === range.to;
                return (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => applyPreset(kind)}
                    className={
                      active
                        ? "rounded-full border border-transparent bg-admin-primary-soft px-2.5 py-1 text-[12.5px] font-semibold text-cta"
                        : "rounded-full border border-border px-2.5 py-1 text-[12.5px] text-ink-secondary hover:bg-background"
                    }
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  setDraftFrom("");
                  setDraftTo("");
                }}
                className="rounded-lg border border-border px-3 py-1.5 text-[12.5px] font-semibold text-ink-secondary hover:bg-background"
              >
                {t("orders_date_clear")}
              </button>
              <button
                type="button"
                onClick={() => onChange({ dateFrom: draftFrom, dateTo: draftTo })}
                className="rounded-lg bg-cta px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-cta-hover"
              >
                {t("orders_date_apply")}
              </button>
            </div>
          </div>
        )}
      </Popover>

      {/* Status */}
      <select
        value={filters.status}
        onChange={(event) => onChange({ status: event.target.value })}
        aria-label={t("orders_filter_status")}
        className="rounded-lg border border-border bg-card px-3 py-2 text-[13px] text-ink-secondary"
      >
        <option value="">{t("orders_filter_all_status")}</option>
        {(appliedStatusOptions).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {/* Payment method */}
      <select
        value={filters.payment}
        onChange={(event) => onChange({ payment: event.target.value })}
        aria-label={t("orders_filter_payment")}
        className="rounded-lg border border-border bg-card px-3 py-2 text-[13px] text-ink-secondary"
      >
        <option value="">{t("orders_filter_all_payment")}</option>
        <option value="COD">COD</option>
        <option value="AIRWALLEX">AIRWALLEX</option>
      </select>

      {/* Region */}
      <input
        value={filters.region}
        onChange={(event) => onChange({ region: event.target.value })}
        placeholder={t("orders_filter_region")}
        aria-label={t("orders_filter_region")}
        className="w-32 rounded-lg border border-border bg-card px-3 py-2 text-[13px] text-ink placeholder:text-ink-muted"
      />

      {/* Phone */}
      <input
        value={filters.phone}
        onChange={(event) => onChange({ phone: event.target.value })}
        placeholder={t("orders_filter_phone")}
        aria-label={t("orders_filter_phone")}
        className="w-36 rounded-lg border border-border bg-card px-3 py-2 text-[13px] text-ink placeholder:text-ink-muted"
      />

      {/* Product / SKU */}
      <input
        value={filters.sku}
        onChange={(event) => onChange({ sku: event.target.value })}
        placeholder={t("orders_filter_product")}
        aria-label={t("orders_filter_product")}
        className="w-44 rounded-lg border border-border bg-card px-3 py-2 text-[13px] text-ink placeholder:text-ink-muted"
      />

      {/* More filters */}
      <Popover label={t("orders_more_filters")} width="w-72">
        {() => (
          <div className="space-y-2">
            <label className="block text-[13px] text-ink-secondary">
              {t("orders_filter_assigned")}
              <select
                value={filters.owner}
                onChange={(event) => onChange({ owner: event.target.value })}
                className="mt-1 w-full rounded-lg border border-border bg-card px-2 py-1.5 text-[13px] text-ink"
              >
                <option value="">{t("orders_filter_all_assigned")}</option>
                {assignees.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name ?? "—"}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[13px] text-ink-secondary">
              {t("orders_filter_priority")}
              <select
                value={filters.priority}
                onChange={(event) => onChange({ priority: event.target.value })}
                className="mt-1 w-full rounded-lg border border-border bg-card px-2 py-1.5 text-[13px] text-ink"
              >
                <option value="">{t("orders_all_priorities")}</option>
                <option value="NORMAL">{t("orders_priority_normal")}</option>
                <option value="HIGH">{t("orders_priority_high")}</option>
                <option value="URGENT">{t("orders_priority_urgent")}</option>
              </select>
            </label>
            <label className="block text-[13px] text-ink-secondary">
              {t("orders_filter_classification")}
              <select
                value={filters.classification}
                onChange={(event) => onChange({ classification: event.target.value })}
                className="mt-1 w-full rounded-lg border border-border bg-card px-2 py-1.5 text-[13px] text-ink"
              >
                <option value="">{t("orders_filter_all_classification")}</option>
                {CLASSIFICATION_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[13px] text-ink-secondary">
              {t("orders_filter_risk")}
              <select
                value={filters.risk}
                onChange={(event) => onChange({ risk: event.target.value })}
                className="mt-1 w-full rounded-lg border border-border bg-card px-2 py-1.5 text-[13px] text-ink"
              >
                <option value="">{t("orders_filter_all_risk")}</option>
                {RISK_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[13px] text-ink-secondary">
              {t("orders_filter_confirmation")}
              <select
                value={filters.confirmation}
                onChange={(event) => onChange({ confirmation: event.target.value })}
                className="mt-1 w-full rounded-lg border border-border bg-card px-2 py-1.5 text-[13px] text-ink"
              >
                <option value="">{t("orders_all_confirmation")}</option>
                {Object.entries(CONFIRMATION_KEY).map(([value, key]) => (
                  <option key={value} value={value}>
                    {t(key)}
                  </option>
                ))}
              </select>
            </label>
            <div className="text-[13px] text-ink-secondary">
              {t("orders_filter_payment_status")}
              <div className="mt-1 grid max-h-40 grid-cols-2 gap-x-2 gap-y-1 overflow-y-auto">
                {PAYMENT_STATUS_OPTIONS.map((value) => {
                  const checked = selectedPaymentStatuses.includes(value);
                  return (
                    <label key={value} className="flex items-center gap-1.5 text-[12px]">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          const next = checked
                            ? selectedPaymentStatuses.filter((item) => item !== value)
                            : [...selectedPaymentStatuses, value];
                          onChange({ paymentStatus: next.join(",") });
                        }}
                        className="h-3.5 w-3.5 accent-cta"
                      />
                      <span>{value}</span>
                    </label>
                  );
                })}
              </div>
            </div>
            <label className="block text-[13px] text-ink-secondary">
              {t("orders_filter_verification")}
              <select
                value={filters.verification}
                onChange={(event) => onChange({ verification: event.target.value })}
                className="mt-1 w-full rounded-lg border border-border bg-card px-2 py-1.5 text-[13px] text-ink"
              >
                <option value="">{t("orders_all")}</option>
                <option value="pending">{t("orders_pending_verification")}</option>
                <option value="open">{t("orders_open_verification")}</option>
                <option value="problem">{t("orders_verify_todo")}</option>
                <option value="done">{t("orders_all_verified")}</option>
                <option value="none">{t("orders_not_assigned")}</option>
              </select>
            </label>
          </div>
        )}
      </Popover>

      {activeFilterCount > 0 ? (
        <button
          type="button"
          onClick={onClear}
          className="rounded-lg px-2 py-2 text-[13px] text-ink-secondary hover:bg-background hover:text-ink"
        >
          {t("orders_clear_filters")}
        </button>
      ) : null}

      <div className="ml-auto flex flex-wrap items-center gap-2">
        {/* Columns */}
        <Popover label={t("orders_columns")} align="right" width="w-64">
          {() => (
            <div>
              <div className="mb-2 text-[11px] font-bold uppercase tracking-[.06em] text-ink-muted">
                {t("orders_columns")}
              </div>
              <div className="max-h-64 space-y-1 overflow-y-auto">
                {WORKBENCH_COLUMNS.map((column) => (
                  <label
                    key={column.key}
                    className="flex items-center gap-2 py-0.5 text-[13px] text-ink-secondary"
                  >
                    <input
                      type="checkbox"
                      checked={!hiddenColumns.includes(column.key)}
                      onChange={() => onToggleColumn(column.key)}
                    />
                    {t(column.labelKey)}
                  </label>
                ))}
              </div>
              <button
                type="button"
                onClick={onResetColumns}
                className="mt-2 w-full rounded-lg border border-border px-3 py-1.5 text-[12.5px] font-semibold text-ink-secondary hover:bg-background"
              >
                {t("orders_columns_reset")}
              </button>
            </div>
          )}
        </Popover>

        {/* Sort */}
        <select
          value={filters.sort}
          onChange={(event) => onChange({ sort: event.target.value })}
          aria-label={t("orders_filter_sort")}
          className="rounded-lg border border-border bg-card px-3 py-2 text-[13px] text-ink-secondary"
        >
          <option value="">{t("orders_filter_sort")}</option>
          <option value="waiting">{t("orders_waiting_longest")}</option>
          <option value="newest">{t("orders_newest_first")}</option>
          <option value="verify">{t("orders_verify_progress_sort")}</option>
        </select>

        {/* Saved views */}
        <Popover label={t("orders_views")} align="right" width="w-72">
          {(close) => (
            <div>
              <div className="mb-2 text-[11px] font-bold uppercase tracking-[.06em] text-ink-muted">
                {t("orders_views")}
              </div>
              {views.length === 0 ? (
                <p className="text-[13px] text-ink-muted">{t("orders_views_empty")}</p>
              ) : (
                <ul className="space-y-1">
                  {views.map((view) => (
                    <li key={view.id} className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          onApplyView(view);
                          close();
                        }}
                        className="flex-1 truncate rounded-lg px-2 py-1 text-left text-[13px] text-ink-secondary hover:bg-background"
                      >
                        {view.name}
                      </button>
                      <button
                        type="button"
                        aria-label={t("orders_views_delete")}
                        onClick={() => onDeleteView(view.id)}
                        className="rounded-lg px-1.5 py-1 text-[12.5px] text-ink-muted hover:bg-background"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 flex gap-2">
                <input
                  value={viewName}
                  onChange={(event) => setViewName(event.target.value)}
                  placeholder={t("orders_view_name")}
                  aria-label={t("orders_view_name")}
                  className="min-w-0 flex-1 rounded-lg border border-border bg-card px-2 py-1.5 text-[13px] text-ink"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!viewName.trim()) return;
                    onSaveView(viewName.trim());
                    setViewName("");
                    close();
                  }}
                  className="rounded-lg bg-cta px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-cta-hover"
                >
                  {t("orders_view_save")}
                </button>
              </div>
            </div>
          )}
        </Popover>

        {/* Export */}
        <button
          type="button"
          onClick={onExport}
          className={TRIGGER_CLS}
        >
          {t("orders_export")}
        </button>
      </div>
    </div>
  );
}
