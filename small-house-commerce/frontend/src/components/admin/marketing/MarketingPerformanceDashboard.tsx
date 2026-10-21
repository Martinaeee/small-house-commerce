"use client";

import { useEffect, useMemo, useState } from "react";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { useAdminI18n } from "@/lib/admin-i18n";
import type { MarketingPerformanceOptions, MarketingPerformanceQuery, PerformancePreset, PerformanceView } from "@/lib/marketing-api";
import { useMarketingPerformance } from "./useMarketingPerformance";
import { PerformanceFilters } from "./PerformanceFilters";
import { PerformanceSummary } from "./PerformanceSummary";
import { PerformancePageTable } from "./PerformancePageTable";
import { PerformanceTrend } from "./PerformanceTrend";

const DEFAULT_PAGE_SIZE = 20;

function buildInitial(view: PerformanceView, productId?: string, ownerUserId?: string, landingPageId?: string, initialDates?: { preset: PerformancePreset; from?: string; to?: string }): MarketingPerformanceQuery {
  return {
    view,
    productId: view === "PRODUCT" ? productId : undefined,
    ownerUserId: view === "OPTIMIZER" ? ownerUserId : undefined,
    landingPageId,
    trendPageId: landingPageId ?? undefined,
    effectiveStatus: undefined,
    preset: initialDates?.preset ?? "LAST_7_DAYS",
    from: initialDates?.from,
    to: initialDates?.to,
    interval: "DAY",
    compare: true,
    sortBy: "name",
    sortDirection: "asc",
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
  };
}

export function MarketingPerformanceDashboard({ view, productId, ownerUserId, landingPageId, initialDates, embedded, onSelectionChange }: {
  view: PerformanceView;
  productId?: string;
  ownerUserId?: string;
  landingPageId?: string;
  initialDates?: { preset: PerformancePreset; from?: string; to?: string };
  embedded?: boolean;
  onSelectionChange?: (query: MarketingPerformanceQuery | null) => void;
}) {
  const { admin } = useAdminAuth();
  // A changed actor scope must never keep the old owner, single-page or trend
  // selection: remount resets every choice, and the derived query below still
  // guards the own-scope cases that a remount alone could not (a URL owner).
  const actorKey = JSON.stringify([admin?.id, admin?.permissions]);
  return <DashboardInner key={actorKey} view={view} productId={productId} ownerUserId={ownerUserId} landingPageId={landingPageId} initialDates={initialDates} embedded={embedded} onSelectionChange={onSelectionChange} />;
}

function DashboardInner({ view, productId, ownerUserId, landingPageId, initialDates, embedded, onSelectionChange }: {
  view: PerformanceView;
  productId?: string;
  ownerUserId?: string;
  landingPageId?: string;
  initialDates?: { preset: PerformancePreset; from?: string; to?: string };
  embedded?: boolean;
  onSelectionChange?: (query: MarketingPerformanceQuery | null) => void;
}) {
  const { admin } = useAdminAuth();
  const { t } = useAdminI18n();
  const allView = Boolean(admin?.permissions.includes("MARKETING_VIEW_ALL"));
  const onlyOwn = !allView;
  const [selection, setSelection] = useState<MarketingPerformanceQuery>(() => buildInitial(view, productId, ownerUserId, landingPageId, initialDates));
  const [prevOptions, setPrevOptions] = useState<MarketingPerformanceOptions | null>(null);

  // The actor scope bounds what the selection may ask for: an own-scoped view
  // never sends an owner, and an embedded dashboard is always scoped to its own
  // landing page.
  const scopedQuery = useMemo<MarketingPerformanceQuery | null>(() => {
    if (selection.view === "PRODUCT") {
      if (!selection.productId) return null;
    } else if (allView && !selection.ownerUserId) {
      return null;
    }
    return {
      ...selection,
      ownerUserId: selection.view === "OPTIMIZER" && allView ? selection.ownerUserId : undefined,
      landingPageId: embedded ? landingPageId : undefined,
      trendPageId: embedded ? (selection.trendPageId ?? landingPageId) : selection.trendPageId,
    };
  }, [selection, allView, embedded, landingPageId]);

  const { report, options, loading, error, reload } = useMarketingPerformance(scopedQuery);
  const ready = scopedQuery !== null;

  // Re-point an unauthorized product at the first authorized one once the
  // options arrive. Render-phase state adjustment (React's documented pattern);
  // not an effect, so it never leaks a stale scope.
  if (prevOptions !== options) {
    setPrevOptions(options);
    if (selection.view === "PRODUCT" && options && !options.products.some(item => item.id === selection.productId)) {
      const first = options.products[0];
      setSelection(current => first
        ? { ...current, productId: first.id, page: 1, trendPageId: embedded ? landingPageId : undefined }
        : { ...current, productId: undefined, page: 1, trendPageId: embedded ? landingPageId : undefined });
    }
  }

  useEffect(() => {
    onSelectionChange?.(scopedQuery);
  }, [scopedQuery, onSelectionChange]);

  const applyFilters = (next: MarketingPerformanceQuery) => {
    const base = scopedQuery ?? selection;
    const scopeChanged = next.productId !== base.productId || next.ownerUserId !== base.ownerUserId || next.effectiveStatus !== base.effectiveStatus;
    setSelection({ ...next, page: 1, trendPageId: scopeChanged ? (embedded ? landingPageId : undefined) : next.trendPageId });
  };
  const applyPage = (page: number) => setSelection(current => ({ ...current, page }));
  const handleTrendPage = (id: string) => setSelection(current => ({ ...current, trendPageId: id }));

  const heading = t(embedded ? "marketing_performance_heading_page" : view === "PRODUCT" ? "marketing_performance_heading_compare" : "marketing_performance_heading_optimizers");
  const pageCount = report ? Math.max(1, Math.ceil(report.total / report.pageSize)) : 1;

  return <section aria-label={heading} className="min-w-0 space-y-4">
    <h2 className="text-xl font-semibold">{heading}</h2>
    {onlyOwn && <p className="text-xs text-admin-muted">{t("marketing_performance_only_own_note")}</p>}
    <PerformanceFilters query={scopedQuery ?? selection} onChange={applyFilters} options={options ?? { onlyOwn, products: [], owners: [] }} onlyOwn={onlyOwn} loading={loading} embedded={embedded} />
    {!ready && selection.view === "OPTIMIZER" && <p className="text-sm text-admin-muted">{t("marketing_performance_choose_optimizer_hint")}</p>}
    {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"><p>{error}</p><button type="button" className="mt-2 rounded-lg border border-red-200 px-3 py-2 text-xs" onClick={reload}>{t("marketing_performance_retry")}</button></div>}
    {!error && loading && !report && <p className="text-sm text-admin-muted">{t("marketing_performance_loading")}</p>}
    {!error && report && <>
      <PerformanceSummary report={report} />
      <PerformancePageTable report={report} groupByProduct={view === "OPTIMIZER"} onTrendPage={handleTrendPage} />
      <div className="flex items-center justify-between text-xs text-admin-muted">
        <span>{t("marketing_performance_page_position", { page: String(report.page), total: String(pageCount) })}</span>
        <div className="flex gap-2">
          <button type="button" className="rounded-lg border border-admin-border px-3 py-2 text-xs disabled:opacity-40" disabled={report.page <= 1} onClick={() => applyPage(report.page - 1)}>{t("marketing_performance_previous_page")}</button>
          <button type="button" className="rounded-lg border border-admin-border px-3 py-2 text-xs disabled:opacity-40" disabled={report.page * report.pageSize >= report.total} onClick={() => applyPage(report.page + 1)}>{t("marketing_performance_next_page")}</button>
        </div>
      </div>
      <PerformanceTrend report={report} onInterval={(interval) => setSelection(current => ({ ...current, interval }))} onClearPage={() => setSelection(current => ({ ...current, trendPageId: undefined }))} />
    </>}
  </section>;
}
