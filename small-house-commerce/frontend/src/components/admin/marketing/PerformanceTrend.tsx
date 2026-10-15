"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { useAdminI18n, type TKey } from "@/lib/admin-i18n";
import type { MarketingPerformanceReport, PerformanceChange, PerformanceInterval, PerformancePoint, PerformanceTotals, TrendMetric } from "@/lib/marketing-api";

const Chart = dynamic(() => import("./PerformanceTrendChart"), { ssr: false });

const metrics: TrendMetric[] = ["visits", "validOrders", "signedOrders", "spendUsd", "orderCpaUsd", "signedRoas"];
const metricLabelKey: Record<TrendMetric, TKey> = {
  visits: "marketing_performance_trend_metric_visits",
  validOrders: "marketing_performance_trend_metric_valid_orders",
  signedOrders: "marketing_performance_trend_metric_signed_orders",
  spendUsd: "marketing_performance_trend_metric_spend_usd",
  orderCpaUsd: "marketing_performance_trend_metric_order_cpa_usd",
  signedRoas: "marketing_performance_trend_metric_signed_roas",
};
const dash = "—";
const fieldClass = "min-w-0 rounded-lg border border-admin-border bg-white px-3 py-2 text-sm";
const buttonClass = "rounded-lg border border-admin-border px-3 py-2 text-xs";

// Only the plotted numeric projection lives here; the equivalent table keeps the
// backend's exact strings. Unknown fees project to null so the chart never draws
// a partial spend as a complete number.
export function trendValue(point: PerformancePoint, metric: TrendMetric): number | null {
  const totals = point.totals;
  if (!totals) return null;
  if (metric === "spendUsd" && !totals.costCoverageComplete) return null;
  const value = totals[metric];
  return value === null ? null : Number(value);
}

function pointLabel(from: string, to: string): string {
  return from === to ? from : `${from}～${to.slice(5)}`;
}
function metricString(totals: PerformanceTotals | null, metric: TrendMetric): string {
  if (!totals) return dash;
  const value = totals[metric];
  return value === null ? dash : String(value);
}
function changeText(change: PerformanceChange, t: (key: TKey, vars?: Record<string, string | number>) => string): string {
  switch (change.state) {
    case "NEW": return t("marketing_performance_trend_new");
    case "UNCHANGED": return t("marketing_performance_trend_unchanged");
    case "UNAVAILABLE": return t("marketing_performance_trend_unavailable");
    case "COMPARABLE": {
      if (change.percent === null) return t("marketing_performance_trend_unavailable");
      const value = Number(change.percent);
      const arrow = value > 0 ? "↑" : value < 0 ? "↓" : "→";
      return t("marketing_performance_trend_change", { percent: `${arrow} ${Math.abs(value).toFixed(2)}%` });
    }
  }
}

export function PerformanceTrend({ report, onInterval, onClearPage }: { report: MarketingPerformanceReport; onInterval: (interval: PerformanceInterval) => void; onClearPage: () => void }) {
  const { t } = useAdminI18n();
  const [metric, setMetric] = useState<TrendMetric>("visits");
  const trend = report.trend;
  const trendName = trend.pageId ? report.rows.find(row => row.id === trend.pageId)?.name : null;
  const change = report.changes?.[metric];
  const chartPoints = useMemo(() => trend.points.map(point => ({ key: point.key, label: pointLabel(point.from, point.to), value: trendValue(point, metric) })), [trend.points, metric]);
  const allNull = chartPoints.length === 0 || chartPoints.every(point => point.value === null);
  const recent = trend.points.some(point => point.includesToday);

  return <section aria-label={t("marketing_performance_trend_heading")} className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-semibold">{trend.pageId ? t("marketing_performance_trend_for", { name: trendName ?? t("marketing_performance_trend_page") }) : t("marketing_performance_trend_overall")}</h3>
      {trend.pageId && <button type="button" className={buttonClass} onClick={onClearPage}>{t("marketing_performance_trend_clear_page")}</button>}
    </div>
    {report.previous && report.changes && change && <div className="rounded-xl border border-admin-border bg-white p-4">
      <p className="text-sm font-semibold">{t(metricLabelKey[metric])}</p>
      <p className="mt-1 text-xs text-admin-muted">{t("marketing_performance_trend_range_current")} {pointLabel(report.current.range.from, report.current.range.to)} · {t("marketing_performance_trend_range_previous")} {pointLabel(report.previous.range.from, report.previous.range.to)}</p>
      <p className="mt-1 text-sm">{t("marketing_performance_trend_current_value", { value: metricString(report.current.totals, metric) })} · {t("marketing_performance_trend_previous_value", { value: metricString(report.previous.totals, metric) })}</p>
      <p className="mt-1 text-xs text-admin-muted">{changeText(change, t)}</p>
    </div>}
    <div className="flex flex-wrap items-center gap-3">
      <label className="space-y-1 text-xs text-admin-muted">{t("marketing_performance_trend_metric")}<select className={fieldClass} aria-label={t("marketing_performance_trend_metric")} value={metric} onChange={(event) => setMetric(event.target.value as TrendMetric)}>
        {metrics.map(item => <option key={item} value={item}>{t(metricLabelKey[item])}</option>)}
      </select></label>
      <label className="space-y-1 text-xs text-admin-muted">{t("marketing_performance_interval")}<select className={fieldClass} aria-label={t("marketing_performance_interval")} value={trend.interval} onChange={(event) => onInterval(event.target.value as PerformanceInterval)}>
        <option value="DAY">{t("marketing_performance_interval_DAY")}</option>
        <option value="WEEK">{t("marketing_performance_interval_WEEK")}</option>
      </select></label>
    </div>
    {allNull && <p className="text-sm text-admin-muted">{t("marketing_performance_trend_no_data")}</p>}
    <Chart points={chartPoints} unit={t(metricLabelKey[metric])} />
    <table aria-label={t("marketing_performance_trend_table")} className="w-full text-left text-sm">
      <thead className="bg-slate-50 text-xs text-admin-muted"><tr>
        <th className="px-3 py-2">{t("marketing_performance_trend_col_period")}</th>
        <th className="px-3 py-2">{t("marketing_performance_trend_col_value")}</th>
        <th className="px-3 py-2">{t("marketing_performance_trend_col_note")}</th>
      </tr></thead>
      <tbody className="divide-y divide-admin-border">
        {trend.points.map(point => <tr key={point.key}>
          <td className="whitespace-nowrap px-3 py-2">{pointLabel(point.from, point.to)}</td>
          <td className="px-3 py-2 tabular-nums">{metricString(point.totals, metric)}</td>
          <td className="px-3 py-2 text-xs text-admin-muted">
            {point.partialWeek && <span className="mr-2">{t("marketing_performance_trend_partial_week")}</span>}
            {point.includesToday && <span className="mr-2">{t("marketing_performance_trend_today_incomplete")}</span>}
            {metric === "spendUsd" && point.totals && !point.totals.costCoverageComplete && <span className="mr-2">{t("marketing_performance_trend_costs_pending")}</span>}
          </td>
        </tr>)}
      </tbody>
    </table>
    {recent && <p className="text-xs text-admin-muted">{t("marketing_performance_trend_recent")}</p>}
  </section>;
}
