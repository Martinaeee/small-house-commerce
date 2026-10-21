"use client";

import { useAdminI18n } from "@/lib/admin-i18n";
import type { MarketingPerformanceReport, PerformanceDateRange } from "@/lib/marketing-api";

function Metric({ label, value, labelled }: { label: string; value: string; labelled?: string }) {
  return <div className="rounded-xl border border-admin-border bg-white p-3">
    <dt className="text-xs text-admin-muted">{label}</dt>
    <dd className="mt-1 text-lg font-semibold tabular-nums" aria-label={labelled}>{value}</dd>
  </div>;
}

export function PerformanceSummary({ report }: { report: MarketingPerformanceReport }) {
  const { t } = useAdminI18n();
  const { overview, current } = report;
  const totals = current.totals;
  const dash = t("marketing_performance_metric_pending");
  const money = (value: string | null) => value ?? dash;
  const value = (number: number | null) => number === null ? dash : String(number);
  const byStatus = overview.byStatus;
  const rangeLabel = (range: PerformanceDateRange) => range.from === range.to ? range.from : `${range.from}～${range.to.slice(5)}`;
  const manilaTime = (iso: string) => new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 16).replace("T", " ");
  return <div className="space-y-2">
    <p className="text-sm text-admin-muted">{t("marketing_performance_pages_total", { total: String(overview.total) })}</p>
    <p className="text-xs text-admin-muted">{t("marketing_performance_by_status", { live: String(byStatus.LIVE), draft: String(byStatus.DRAFT), scheduled: String(byStatus.SCHEDULED), ended: String(byStatus.ENDED), disabled: String(byStatus.DISABLED) })}</p>
    <p className="text-xs text-admin-muted">{t("marketing_performance_trend_range_current")} {rangeLabel(current.range)}{report.previous ? <> · {t("marketing_performance_trend_range_previous")} {rangeLabel(report.previous.range)}</> : null} · {t("marketing_performance_summary_as_of")} {manilaTime(report.asOf)}</p>
    <dl className="grid grid-cols-2 gap-2 md:grid-cols-4">
      <Metric label={t("marketing_performance_metric_visits")} value={value(totals?.visits ?? null)} labelled={t("marketing_performance_total_visits_label")} />
      <Metric label={t("marketing_performance_metric_page_visits")} value={value(totals?.pageTotalVisits ?? null)} />
      <Metric label={t("marketing_performance_metric_valid_orders")} value={totals ? String(totals.validOrders) : dash} />
      <Metric label={t("marketing_performance_metric_conversion")} value={totals ? money(totals.conversionRate) : dash} />
      <Metric label={t("marketing_performance_metric_spend_usd")} value={totals ? money(totals.spendUsd) : dash} />
      <Metric label={t("marketing_performance_metric_cpa")} value={totals ? money(totals.orderCpaUsd) : dash} />
      <Metric label={t("marketing_performance_metric_roas")} value={totals ? money(totals.signedRoas) : dash} />
      <Metric label={t("marketing_performance_metric_signed_gross")} value={totals ? money(totals.signedGrossPhp) : dash} />
    </dl>
  </div>;
}
