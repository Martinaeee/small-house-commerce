"use client";

import { useState } from "react";
import Link from "next/link";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { useAdminI18n, type TKey } from "@/lib/admin-i18n";
import { canManageMarketingPage, type MarketingPerformanceReport, type PerformancePageRow } from "@/lib/marketing-api";
import { CampaignLinksList } from "./CampaignLinksList";

const phpFormat = new Intl.NumberFormat("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dash = "—";
const buttonClass = "rounded-md border border-admin-border px-2 py-1.5 text-xs disabled:opacity-40";

function money(value: string | null): string {
  return value ?? dash;
}
function php(value: string | null): string {
  return value === null ? dash : phpFormat.format(Number(value));
}
function statusText(row: PerformancePageRow, t: (key: TKey, vars?: Record<string, string | number>) => string): string {
  return row.effectiveStatus === "DRAFT" ? t("marketing_performance_status_DRAFT") : t(`marketing_status_${row.effectiveStatus}`);
}

function RowDetail({ row, report }: { row: PerformancePageRow; report: MarketingPerformanceReport }) {
  const { t } = useAdminI18n();
  const totals = row.current.totals;
  const flags = totals ? <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-admin-muted md:grid-cols-4">
    {([[t("marketing_performance_metric_submitted"), totals.submittedOrders], [t("marketing_performance_metric_confirmed"), totals.confirmedOrders], [t("marketing_performance_metric_signed"), totals.signedOrders], [t("marketing_performance_metric_duplicate"), totals.duplicateOrders], [t("marketing_performance_metric_risk"), totals.riskOrders], [t("marketing_performance_metric_after_sales"), totals.afterSalesOrders], [t("marketing_performance_metric_refund"), totals.refundStatusOrders]] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="tabular-nums">{value}</dd></div>)}
  </dl> : null;
  const amounts = totals ? <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-xs md:grid-cols-3">
    {([[t("marketing_performance_metric_valid_order_value"), php(totals.validOrderValuePhp)], [t("marketing_performance_metric_signed_gross"), php(totals.signedGrossPhp)], [t("marketing_performance_metric_spend_php"), php(totals.spendPhp)], [t("marketing_performance_metric_signed_cpa"), money(totals.signedCpaUsd)], [t("marketing_performance_metric_spend_usd"), money(totals.spendUsd)]] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="tabular-nums">{value}</dd></div>)}
  </dl> : null;
  const otherSources = report.otherSources.current.map(source => <dl key={source.kind} className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-admin-muted md:grid-cols-4">
    {([[t(`marketing_performance_other_${source.kind}`), source.totals.visits ?? dash], [t("marketing_performance_metric_valid_orders"), source.totals.validOrders], [t("marketing_performance_metric_signed_gross"), php(source.totals.validOrderValuePhp)]] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="tabular-nums">{value}</dd></div>)}
  </dl>);
  return <div className="space-y-2">
    {flags}
    {amounts}
    {report.otherSources.current.length > 0 && <div><p className="text-xs font-medium text-admin-muted">{t("marketing_performance_other_sources")}</p>{otherSources}</div>}
    <CampaignLinksList productId={row.productId} landingPageId={row.id} />
  </div>;
}

function RowView({ row, report, expanded, onToggle, onTrendPage }: { row: PerformancePageRow; report: MarketingPerformanceReport; expanded: boolean; onToggle: () => void; onTrendPage: () => void }) {
  const { admin } = useAdminAuth();
  const { t } = useAdminI18n();
  const manage = canManageMarketingPage(admin, row.ownerUserId);
  const totals = row.current.totals;
  const cell = (number: number | null) => totals ? String(number) : dash;
  const moneyCell = (value: string | null) => totals ? money(value) : dash;
  const notices = row.notices.length > 0 ? <span className="text-xs text-amber-700">{row.notices.map(notice => t(`marketing_performance_notice_${notice}`)).join(" · ")}</span> : null;
  return <>
    <tr className="align-top">
      <td className="max-w-64 px-3 py-3"><p className="font-medium">{row.name}</p><p className="mt-1 text-xs text-admin-muted">{row.ownerName ?? t("marketing_performance_unassigned")}{row.aid ? ` · ${row.aid}` : ""}</p></td>
      <td className="whitespace-nowrap px-3 py-3"><p className="text-xs">{statusText(row, t)}</p>{notices}</td>
      <td className="px-3 py-3 tabular-nums">{cell(totals?.visits ?? null)}</td>
      <td className="px-3 py-3 tabular-nums">{cell(totals?.validOrders ?? null)}</td>
      <td className="px-3 py-3 tabular-nums">{moneyCell(totals?.conversionRate ?? null)}</td>
      <td className="px-3 py-3 tabular-nums">{moneyCell(totals?.spendUsd ?? null)}</td>
      <td className="px-3 py-3 tabular-nums">{moneyCell(totals?.orderCpaUsd ?? null)}</td>
      <td className="px-3 py-3 tabular-nums">{moneyCell(totals?.signedRoas ?? null)}</td>
      <td className="px-3 py-3"><div className="flex min-w-40 flex-wrap gap-1"><Link className={buttonClass} href={`/admin/marketing/${encodeURIComponent(row.id)}/edit`}>{t(manage ? "marketing_edit_page" : "marketing_page_view")}</Link><button type="button" className={buttonClass} onClick={onToggle}>{t(expanded ? "marketing_performance_collapse" : "marketing_performance_detail")}</button><button type="button" className={buttonClass} onClick={onTrendPage}>{t("marketing_performance_trend")}</button></div></td>
    </tr>
    {expanded && <tr><td colSpan={9} className="px-3 pb-4"><RowDetail row={row} report={report} /></td></tr>}
  </>;
}

export function PerformancePageTable({ report, groupByProduct, onTrendPage }: { report: MarketingPerformanceReport; groupByProduct: boolean; onTrendPage: (id: string) => void }) {
  const { t } = useAdminI18n();
  const [expanded, setExpanded] = useState<string | null>(null);
  const headers = ["marketing_performance_col_page", "marketing_performance_col_visits", "marketing_performance_col_valid_orders", "marketing_performance_col_conversion", "marketing_performance_col_spend", "marketing_performance_col_cpa", "marketing_performance_col_roas", ""].map(key => t(key as Parameters<typeof t>[0]));
  const table = (rows: PerformancePageRow[]) => <table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-admin-muted"><tr><th className="px-3 py-2">{t("marketing_performance_col_page")}</th>{headers.slice(1).map((header, index) => <th key={index} className="whitespace-nowrap px-3 py-2">{header}</th>)}</tr></thead><tbody className="divide-y divide-admin-border">
    {rows.map(row => <RowView key={row.id} row={row} report={report} expanded={expanded === row.id} onToggle={() => setExpanded(current => current === row.id ? null : row.id)} onTrendPage={() => onTrendPage(row.id)} />)}
  </tbody></table>;
  if (report.rows.length === 0) return <p className="text-sm text-admin-muted">{t("marketing_performance_no_rows")}</p>;
  if (!groupByProduct) return <div className="overflow-x-auto rounded-xl border border-admin-border bg-white">{table(report.rows)}</div>;
  return <div className="space-y-4">
    {report.overview.byProduct.map(group => {
      const items = report.rows.filter(row => row.productId === group.productId);
      if (items.length === 0) return null;
      return <div key={group.productId} className="overflow-x-auto rounded-xl border border-admin-border bg-white">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-admin-border bg-slate-50 px-3 py-2">
          <p className="text-sm font-semibold">{group.productName}{group.productCode ? ` · ${group.productCode}` : ""}</p>
          <p className="text-xs text-admin-muted">{items.length < group.pageCount ? t("marketing_performance_group_shown", { shown: String(items.length), total: String(group.pageCount) }) : t("marketing_performance_group_total", { total: String(group.pageCount) })}</p>
        </div>
        {table(items)}
      </div>;
    })}
  </div>;
}
