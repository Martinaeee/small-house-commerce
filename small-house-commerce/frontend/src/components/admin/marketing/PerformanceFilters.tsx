"use client";

import { useAdminI18n } from "@/lib/admin-i18n";
import type { EffectivePageStatus, MarketingPerformanceOptions, MarketingPerformanceQuery, PerformancePreset, PerformanceSort } from "@/lib/marketing-api";

const fieldClass = "min-w-0 rounded-lg border border-admin-border bg-white px-3 py-2 text-sm";
const presets: PerformancePreset[] = ["LAST_7_DAYS", "LAST_30_DAYS", "THIS_WEEK", "LAST_WEEK", "CUSTOM"];
const statuses: EffectivePageStatus[] = ["DRAFT", "LIVE", "SCHEDULED", "ENDED", "DISABLED"];
const sorts: PerformanceSort[] = ["name", "visits", "validOrders", "conversionRate", "spendUsd", "orderCpaUsd", "signedRoas"];

export function PerformanceFilters({ query, onChange, options, onlyOwn, loading, embedded }: {
  query: MarketingPerformanceQuery;
  onChange: (next: MarketingPerformanceQuery) => void;
  options: MarketingPerformanceOptions;
  onlyOwn: boolean;
  loading: boolean;
  embedded?: boolean;
}) {
  const { t } = useAdminI18n();
  const set = (patch: Partial<MarketingPerformanceQuery>) => onChange({ ...query, ...patch });
  const custom = query.preset === "CUSTOM";
  return <div aria-label={t("marketing_performance_filters")} className="flex flex-wrap items-end gap-2">
    {query.view === "PRODUCT" && !embedded && <label className="space-y-1 text-xs text-admin-muted">{t("marketing_performance_products_label")}<select className={fieldClass} disabled={loading} aria-label={t("marketing_performance_products_label")} value={query.productId ?? ""} onChange={(event) => set({ productId: event.target.value || undefined })}>
      <option value="">{t("marketing_performance_choose_product")}</option>
      {options.products.map(product => <option key={product.id} value={product.id}>{product.name} · {product.productCode ?? "—"}</option>)}
    </select></label>}
    {query.view === "OPTIMIZER" && !onlyOwn && <label className="space-y-1 text-xs text-admin-muted">{t("marketing_performance_optimizer_label")}<select className={fieldClass} disabled={loading} aria-label={t("marketing_performance_optimizer_label")} value={query.ownerUserId ?? ""} onChange={(event) => set({ ownerUserId: event.target.value || undefined })}>
      <option value="">{t("marketing_performance_choose_optimizer")}</option>
      {options.owners.map(owner => <option key={owner.userId} value={owner.userId}>{owner.name} · {owner.aid ?? "—"}</option>)}
    </select></label>}
    {!embedded && <label className="space-y-1 text-xs text-admin-muted">{t("marketing_performance_status_filter")}<select className={fieldClass} disabled={loading} aria-label={t("marketing_performance_status_filter")} value={query.effectiveStatus ?? ""} onChange={(event) => set({ effectiveStatus: (event.target.value || undefined) as EffectivePageStatus | undefined })}>
      <option value="">{t("marketing_all_statuses")}</option>
      {statuses.map(status => <option key={status} value={status}>{t(`marketing_status_${status}`)}</option>)}
    </select></label>}
    <label className="space-y-1 text-xs text-admin-muted">{t("marketing_performance_preset")}<select className={fieldClass} disabled={loading} aria-label={t("marketing_performance_preset")} value={query.preset} onChange={(event) => set({ preset: event.target.value as PerformancePreset, from: undefined, to: undefined })}>
      {presets.map(preset => <option key={preset} value={preset}>{t(`marketing_performance_preset_${preset}`)}</option>)}
    </select></label>
    {custom && <>
      <label className="space-y-1 text-xs text-admin-muted">{t("marketing_performance_from")}<input className={fieldClass} disabled={loading} required type="date" aria-label={t("marketing_performance_from")} value={query.from ?? ""} max={query.to || undefined} onChange={(event) => set({ from: event.target.value || undefined })} /></label>
      <label className="space-y-1 text-xs text-admin-muted">{t("marketing_performance_to")}<input className={fieldClass} disabled={loading} required type="date" aria-label={t("marketing_performance_to")} min={query.from || undefined} value={query.to ?? ""} onChange={(event) => set({ to: event.target.value || undefined })} /></label>
    </>}
    <label className="space-y-1 text-xs text-admin-muted">{t("marketing_performance_sort")}<select className={fieldClass} disabled={loading} aria-label={t("marketing_performance_sort")} value={query.sortBy} onChange={(event) => set({ sortBy: event.target.value as PerformanceSort })}>
      {sorts.map(sort => <option key={sort} value={sort}>{t(`marketing_performance_sort_${sort}`)}</option>)}
    </select></label>
    <label className="space-y-1 text-xs text-admin-muted">{t("marketing_performance_interval")}<select className={fieldClass} disabled={loading} aria-label={t("marketing_performance_interval")} value={query.interval} onChange={(event) => set({ interval: event.target.value as "DAY" | "WEEK" })}>
      <option value="DAY">{t("marketing_performance_interval_DAY")}</option>
      <option value="WEEK">{t("marketing_performance_interval_WEEK")}</option>
    </select></label>
    <label className="flex items-center gap-2 pb-2 text-xs text-admin-muted"><input type="checkbox" className="h-4 w-4" disabled={loading} checked={query.compare} onChange={(event) => set({ compare: event.target.checked })} />{t("marketing_performance_compare_toggle")}</label>
  </div>;
}
