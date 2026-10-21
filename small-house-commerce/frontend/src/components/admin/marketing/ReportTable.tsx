"use client";

import { useEffect, useState } from "react";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { useAdminI18n } from "@/lib/admin-i18n";
import { marketingApi, type MarketingReport, type MarketingReportLevel, type MarketingReportRow, type MarketingOwnerOption } from "@/lib/marketing-api";

const fieldClass = "w-full min-w-0 rounded-lg border border-admin-border bg-white px-3 py-2 text-sm";
const buttonClass = "rounded-lg border border-admin-border px-3 py-2 text-xs disabled:opacity-40";
const dateFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" });
const levels: MarketingReportLevel[] = ["LINK", "PAGE", "PRODUCT", "OWNER"];
const headers = ["marketing_internal_name", "marketing_report_visits", "marketing_report_submitted", "marketing_report_valid", "marketing_report_confirmed", "marketing_report_signed", "marketing_report_valid_value", "marketing_report_signed_gross", "marketing_cost_usd", "marketing_cost_php", "marketing_report_order_cpa", "marketing_report_signed_cpa", "marketing_report_order_roas", "marketing_report_signed_roas", "marketing_report_conversion", "marketing_report_coverage"] as const;

export function ReportTable({ productId, landingPageId, linkId }: { productId?: string; landingPageId?: string; linkId?: string }) {
  const { admin } = useAdminAuth();
  const { t } = useAdminI18n();
  const [inputs, setInputs] = useState(() => ({ from: dateFormat.format(new Date(Date.now() - 6 * 864e5)), to: dateFormat.format(new Date()), groupBy: "LINK" as MarketingReportLevel, ownerUserId: "" }));
  const [filters, setFilters] = useState(inputs);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const scopeKey = JSON.stringify([admin?.id, admin?.permissions, productId, landingPageId, linkId]);
  const queryKey = JSON.stringify([scopeKey, filters, page, revision]);
  const [loaded, setLoaded] = useState<{ key: string; data: MarketingReport } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [owners, setOwners] = useState<{ key: string; items: MarketingOwnerOption[]; error?: string } | null>(null);
  const all = Boolean(admin?.permissions.includes("MARKETING_VIEW_ALL"));

  useEffect(() => {
    if (!admin) return;
    let alive = true;
    marketingApi.report({ from: filters.from, to: filters.to, groupBy: filters.groupBy, ownerUserId: all ? filters.ownerUserId || undefined : undefined, productId, landingPageId, linkIds: linkId ? [linkId] : undefined, page, pageSize: 20 })
      .then(data => { if (alive) { setLoaded({ key: queryKey, data }); setError(null); } })
      .catch((reason: unknown) => { if (alive) setError({ key: queryKey, message: reason instanceof Error ? reason.message : String(reason) }); });
    return () => { alive = false; };
  }, [admin, queryKey, filters, all, productId, landingPageId, linkId, page]);

  useEffect(() => {
    if (!admin || !all) return;
    let alive = true;
    marketingApi.ownerOptions().then(items => { if (alive) setOwners({ key: scopeKey, items }); }).catch((reason: unknown) => { if (alive) setOwners({ key: scopeKey, items: [], error: reason instanceof Error ? reason.message : String(reason) }); });
    return () => { alive = false; };
  }, [admin, all, scopeKey]);

  const data = loaded?.key === queryKey ? loaded.data : null;
  const loadError = error?.key === queryKey ? error.message : null;
  const ownerData = owners?.key === scopeKey ? owners : null;
  function identity(row: MarketingReportRow) {
    return <><p className="font-medium">{row.kind === "REGISTERED" ? row.label : t(`marketing_report_${row.kind}`)}</p>{row.ownerName && <p className="text-xs text-admin-muted">{row.ownerName} · {row.aid ?? "—"}</p>}{row.productName && <p className="text-xs text-admin-muted">{row.productName} · {row.productCode ?? "—"}</p>}<p className="mt-1 text-[11px] text-admin-muted">{t("marketing_report_flags", { duplicate: String(row.duplicateOrders), risk: String(row.riskOrders), afterSales: String(row.afterSalesOrders), refund: String(row.refundStatusOrders) })}</p></>;
  }

  return <section className="min-w-0 space-y-3" aria-label={t("marketing_reports")}>
    <h2 className="font-semibold">{t("marketing_reports")}</h2>
    <form className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5" onSubmit={(event) => { event.preventDefault(); setFilters(inputs); setPage(1); }}>
      <label className="space-y-1 text-xs text-admin-muted">{t("marketing_report_from")}<input className={fieldClass} required type="date" value={inputs.from} max={inputs.to} onChange={(event) => setInputs(value => ({ ...value, from: event.target.value }))} /></label>
      <label className="space-y-1 text-xs text-admin-muted">{t("marketing_report_to")}<input className={fieldClass} required type="date" value={inputs.to} min={inputs.from} max={dateFormat.format(new Date())} onChange={(event) => setInputs(value => ({ ...value, to: event.target.value }))} /></label>
      <label className="space-y-1 text-xs text-admin-muted">{t("marketing_report_level")}<select className={fieldClass} value={inputs.groupBy} onChange={(event) => setInputs(value => ({ ...value, groupBy: event.target.value as MarketingReportLevel }))}>{levels.map(level => <option key={level} value={level}>{t(`marketing_report_${level}`)}</option>)}</select></label>
      {all && <label className="space-y-1 text-xs text-admin-muted">{t("marketing_owner")}<select className={fieldClass} value={inputs.ownerUserId} onChange={(event) => setInputs(value => ({ ...value, ownerUserId: event.target.value }))}><option value="">{t("marketing_all_owners")}</option>{ownerData?.items.map(owner => <option key={owner.userId} value={owner.userId}>{owner.displayName} · {owner.aid}</option>)}</select></label>}
      <div className="flex items-end gap-2"><button type="submit" className={buttonClass}>{t("marketing_report_query")}</button><button type="button" className={buttonClass} onClick={() => setRevision(value => value + 1)}>{t("marketing_reload")}</button></div>
    </form>
    <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{t("marketing_report_gross_warning")}</p>
    <p className="text-xs text-admin-muted">{t("marketing_report_visit_hint")}</p><p className="text-xs text-admin-muted">{t("marketing_report_cost_hint")}</p>
    {(loadError || ownerData?.error) && <p role="alert" className="text-sm text-red-700">{loadError ?? ownerData?.error}</p>}
    {!data && !loadError && <p className="text-sm text-admin-muted">{t("common_loading")}</p>}
    {data && <>
      <p className="text-xs text-admin-muted">{data.from} — {data.to} · {t("marketing_report_as_of")}: {new Date(data.asOf).toLocaleString("en-PH", { timeZone: "Asia/Manila", hour12: false })}</p>
      <div className="overflow-x-auto rounded-xl border border-admin-border bg-white"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-admin-muted"><tr>{headers.map(key => <th className="whitespace-nowrap px-3 py-2" key={key}>{t(key)}</th>)}</tr></thead><tbody className="divide-y divide-admin-border">{data.rows.map(row => <tr key={row.id}>
        <td className="min-w-56 px-3 py-3">{identity(row)}</td><td className="whitespace-nowrap px-3 py-3"><p>{row.visits ?? "—"}</p>{row.pageTotalVisits !== null && <p className="text-[11px] text-admin-muted">{t("marketing_report_page_visits")}: {row.pageTotalVisits}</p>}</td>
        {[row.submittedOrders, row.validOrders, row.confirmedOrders, row.signedOrders].map((count, index) => <td className="px-3 py-3" key={index}>{count}</td>)}
        <td className="whitespace-nowrap px-3 py-3">PHP {row.validOrderValuePhp}</td><td className="whitespace-nowrap px-3 py-3">PHP {row.signedGrossPhp}</td><td className="whitespace-nowrap px-3 py-3">USD {row.spendUsd}</td><td className="whitespace-nowrap px-3 py-3">PHP {row.spendPhp}</td>
        <td className="whitespace-nowrap px-3 py-3">{row.orderCpaUsd === null ? "—" : `USD ${row.orderCpaUsd}`}</td><td className="whitespace-nowrap px-3 py-3">{row.signedCpaUsd === null ? "—" : `USD ${row.signedCpaUsd}`}</td><td className="px-3 py-3">{row.orderRoas ?? "—"}</td><td className="px-3 py-3">{row.signedRoas ?? "—"}</td><td className="px-3 py-3">{row.conversionRate === null ? "—" : `${(Number(row.conversionRate) * 100).toFixed(2)}%`}</td>
        <td className="min-w-48 px-3 py-3 text-xs"><span className={row.costCoverageComplete ? "text-emerald-700" : "text-amber-800"}>{t(row.costCoverageComplete ? "marketing_report_complete" : "marketing_report_incomplete", { recorded: String(row.recordedCostDays), expected: String(row.expectedCostDays) })}</span></td>
      </tr>)}{!data.rows.length && <tr><td colSpan={headers.length} className="p-6 text-center text-admin-muted">{t("marketing_report_empty")}</td></tr>}</tbody></table></div>
      <div className="flex items-center justify-between text-xs text-admin-muted"><span>{t("marketing_records", { count: String(data.total) })}</span><div className="flex gap-2"><button type="button" className={buttonClass} disabled={page === 1} onClick={() => setPage(value => value - 1)}>{t("marketing_previous")}</button><span className="py-2">{page}</span><button type="button" className={buttonClass} disabled={page * 20 >= data.total} onClick={() => setPage(value => value + 1)}>{t("marketing_next")}</button></div></div>
      {data.otherSources.length > 0 && <div className="space-y-2"><h3 className="font-medium">{t("marketing_report_other")}</h3><p className="text-xs text-admin-muted">{t("marketing_report_other_hint")}</p><div className="overflow-x-auto rounded-xl border border-admin-border bg-white"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-admin-muted"><tr>{(["marketing_source_type", "marketing_report_submitted", "marketing_report_valid", "marketing_report_confirmed", "marketing_report_signed", "marketing_report_valid_value", "marketing_report_signed_gross"] as const).map(key => <th className="whitespace-nowrap px-3 py-2" key={key}>{t(key)}</th>)}</tr></thead><tbody className="divide-y divide-admin-border">{data.otherSources.map(row => <tr key={row.id}><td className="min-w-64 px-3 py-3">{identity(row)}</td>{[row.submittedOrders, row.validOrders, row.confirmedOrders, row.signedOrders].map((count, index) => <td className="px-3 py-3" key={index}>{count}</td>)}<td className="whitespace-nowrap px-3 py-3">PHP {row.validOrderValuePhp}</td><td className="whitespace-nowrap px-3 py-3">PHP {row.signedGrossPhp}</td></tr>)}</tbody></table></div></div>}
    </>}
  </section>;
}
