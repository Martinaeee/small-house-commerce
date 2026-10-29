"use client";

import { useEffect, useState } from "react";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { useAdminI18n } from "@/lib/admin-i18n";
import { marketingApi, type MarketingReport, type MarketingReportRow, type MarketingReportSort } from "@/lib/marketing-api";
import { reportColumns, ReportMetricCells, ProductThumb } from "./ReportColumns";
import { ReportTreeTable } from "./ReportTreeTable";

const fieldClass = "w-full min-w-0 rounded-lg border border-admin-border bg-white px-3 py-2 text-sm";
const buttonClass = "rounded-lg border border-admin-border px-3 py-2 text-xs disabled:opacity-40";
const dateFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" });
const levels = ["LINK", "PAGE", "PRODUCT", "OWNER"] as const;
type Mode = "TREE" | "FLAT";

function identity(row: MarketingReportRow, t: ReturnType<typeof useAdminI18n>["t"]) {
  return <>{row.kind === "REGISTERED" ? row.label : t(`marketing_report_${row.kind}`)}{row.kind !== "REGISTERED" ? null : null}
    {row.ownerName && row.kind === "REGISTERED" && <p className="text-xs text-admin-muted">{row.ownerName} · {row.aid ?? "—"}</p>}
    {row.kind !== "REGISTERED" && row.productName && <p className="text-xs text-admin-muted">{row.ownerName ?? ""}</p>}
    {row.productName && row.kind === "REGISTERED" && <p className="text-xs text-admin-muted">{row.productName} · {row.productCode ?? "—"}</p>}
    {row.kind === "REGISTERED" && <p className="mt-1 text-[11px] text-admin-muted">{t("marketing_report_flags", { duplicate: String(row.duplicateOrders), risk: String(row.riskOrders), afterSales: String(row.afterSalesOrders), refund: String(row.refundStatusOrders) })}</p>}</>;
}

export function ReportTable({ productId, landingPageId, linkId }: { productId?: string; landingPageId?: string; linkId?: string }) {
  const { admin } = useAdminAuth();
  const { t } = useAdminI18n();
  const [inputs, setInputs] = useState(() => ({ from: dateFormat.format(new Date(Date.now() - 6 * 864e5)), to: dateFormat.format(new Date()), groupBy: "LINK" as const, ownerUserId: "" }));
  const [filters, setFilters] = useState(inputs);
  const [productFilter, setProductFilter] = useState(productId ?? "");
  const [mode, setMode] = useState<Mode>("TREE");
  const [sortBy, setSortBy] = useState<MarketingReportSort>("NAME");
  const [sortDirection, setSortDirection] = useState<"ASC" | "DESC">("ASC");
  const [products, setProducts] = useState<{ id: string; name: string; productCode: string | null }[]>([]);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const scopeKey = JSON.stringify([admin?.id, admin?.permissions, productId, landingPageId, linkId]);
  const queryKey = JSON.stringify([scopeKey, filters, productFilter, mode, sortBy, sortDirection, page, revision]);
  const [loaded, setLoaded] = useState<{ key: string; data: MarketingReport } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [owners, setOwners] = useState<{ key: string; items: Awaited<ReturnType<typeof marketingApi.ownerOptions>>; error?: string } | null>(null);
  const all = Boolean(admin?.permissions.includes("MARKETING_VIEW_ALL"));

  useEffect(() => {
    if (!admin) return;
    let alive = true;
    marketingApi.report({ from: filters.from, to: filters.to, groupBy: filters.groupBy, mode, sortBy, sortDirection, ownerUserId: all ? filters.ownerUserId || undefined : undefined, productId: productFilter || undefined, landingPageId, linkIds: linkId ? [linkId] : undefined, page: mode === "FLAT" ? page : 1, pageSize: 20 })
      .then(data => { if (alive) { setLoaded({ key: queryKey, data }); setError(null); } })
      .catch((reason: unknown) => { if (alive) setError({ key: queryKey, message: reason instanceof Error ? reason.message : String(reason) }); });
    return () => { alive = false; };
  }, [admin, queryKey, filters, productFilter, mode, sortBy, sortDirection, all, landingPageId, linkId, page, revision]);

  useEffect(() => {
    if (!admin) return;
    let alive = true;
    // The product dropdown is a convenience filter; linkContext() keeps it
    // aligned with products that still have pages or variants. A link to an
    // inactive product stays listed when no filter is set (spec §5.1 note).
    marketingApi.linkContext()
      .then(context => { if (alive) setProducts(context.products.map(({ id, name, productCode }) => ({ id, name, productCode }))); })
      .catch(() => { /* dropdown optional, table is not */ });
    return () => { alive = false; };
  }, [admin]);

  useEffect(() => {
    if (!admin || !all) return;
    let alive = true;
    marketingApi.ownerOptions().then(items => { if (alive) setOwners({ key: scopeKey, items }); }).catch((reason: unknown) => { if (alive) setOwners({ key: scopeKey, items: [], error: reason instanceof Error ? reason.message : String(reason) }); });
    return () => { alive = false; };
  }, [admin, all, scopeKey]);

  const data = loaded?.key === queryKey ? loaded.data : null;
  const loadError = error?.key === queryKey ? error.message : null;
  const ownerData = owners?.key === scopeKey ? owners : null;

  /** Numeric columns open descending (biggest first), text columns ascending. */
  function toggleSort(column?: string, firstClickDesc = false) {
    if (!column) return;
    if (column === sortBy) setSortDirection(value => value === "ASC" ? "DESC" : "ASC");
    else { setSortBy(column as MarketingReportSort); setSortDirection(firstClickDesc ? "DESC" : "ASC"); }
    setPage(1);
  }
  const indicator = (column?: string) => column === sortBy ? (sortDirection === "ASC" ? " ▲" : " ▼") : "";

  function changeStatusFields(partial: Partial<typeof inputs>) {
    setInputs(value => ({ ...value, ...partial }));
  }

  const flatTable = data && <div className="overflow-x-auto rounded-xl border border-admin-border bg-white"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-admin-muted"><tr>
    <th className="min-w-56 whitespace-nowrap px-3 py-2"><button type="button" aria-label={t("marketing_report_sort_hint")} onClick={() => toggleSort("NAME", false)}>{t("marketing_internal_name")}{indicator("NAME")}</button></th>
    {reportColumns.slice(1).map(column => <th key={column.key} className="whitespace-nowrap px-3 py-2" aria-sort={column.sortBy === sortBy ? (sortDirection === "ASC" ? "ascending" : "descending") : undefined}>{column.sortBy
      ? <button type="button" aria-label={`${t(column.key)} · ${t("marketing_report_sort_hint")}`} onClick={() => toggleSort(column.sortBy, Boolean(column.numeric))}>{t(column.key)}{indicator(column.sortBy)}</button>
      : t(column.key)}</th>)}
  </tr></thead><tbody className="divide-y divide-admin-border">{data.rows.map(row => <tr key={row.id} className="align-top">
    <td className="min-w-56 px-3 py-3"><div className="flex items-start gap-2"><ProductThumb url={row.productThumbnailUrl} label={row.productName ?? row.label} /><div>{identity(row, t)}</div></div></td>
    <ReportMetricCells row={row} />
  </tr>)}{!data.rows.length && <tr><td colSpan={reportColumns.length} className="p-6 text-center text-admin-muted">{t("marketing_report_empty")}</td></tr>}</tbody></table></div>;

  return <section className="min-w-0 space-y-3" aria-label={t("marketing_reports")}>
    <h2 className="font-semibold">{t("marketing_reports")}</h2>
    <form className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5" onSubmit={(event) => { event.preventDefault(); setFilters(inputs); setPage(1); }}>
      <label className="space-y-1 text-xs text-admin-muted">{t("marketing_report_from")}<input className={fieldClass} required type="date" value={inputs.from} max={inputs.to} onChange={(event) => changeStatusFields({ from: event.target.value })} /></label>
      <label className="space-y-1 text-xs text-admin-muted">{t("marketing_report_to")}<input className={fieldClass} required type="date" value={inputs.to} min={inputs.from} max={dateFormat.format(new Date())} onChange={(event) => changeStatusFields({ to: event.target.value })} /></label>
      <label className="space-y-1 text-xs text-admin-muted">{t("marketing_report_level")}<select className={fieldClass} value={inputs.groupBy} onChange={(event) => changeStatusFields({ groupBy: event.target.value as typeof inputs.groupBy })}>{levels.map(level => <option key={level} value={level}>{t(`marketing_report_${level}`)}</option>)}</select></label>
      <label className="space-y-1 text-xs text-admin-muted">{t("marketing_report_filter_product")}<select className={fieldClass} aria-label={t("marketing_report_filter_product")} value={productFilter} onChange={(event) => { setProductFilter(event.target.value); setPage(1); }}><option value="">{t("marketing_report_all_products")}</option>{products.map(product => <option key={product.id} value={product.id}>{product.name}{product.productCode ? ` · ${product.productCode}` : ""}</option>)}</select></label>
      {all && <label className="space-y-1 text-xs text-admin-muted">{t("marketing_owner")}<select className={fieldClass} aria-label={t("marketing_owner")} value={inputs.ownerUserId} onChange={(event) => changeStatusFields({ ownerUserId: event.target.value })}><option value="">{t("marketing_all_owners")}</option>{ownerData?.items.map(owner => <option key={owner.userId} value={owner.userId}>{owner.displayName} · {owner.aid}</option>)}</select></label>}
      <div className="flex items-end gap-2"><button type="submit" className={buttonClass}>{t("marketing_report_query")}</button><button type="button" className={buttonClass} onClick={() => setRevision(value => value + 1)}>{t("marketing_reload")}</button></div>
    </form>
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-2 text-xs text-admin-muted"><span>{t("marketing_report_view")}</span>
        <select className={`${fieldClass} w-auto`} aria-label={t("marketing_report_view")} value={mode} onChange={(event) => { setMode(event.target.value as Mode); setPage(1); }}>
          <option value="TREE">{t("marketing_report_view_tree")}</option>
          <option value="FLAT">{t("marketing_report_view_flat")}</option>
        </select>
      </label>
    </div>
    <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{t("marketing_report_gross_warning")}</p>
    <p className="text-xs text-admin-muted">{t("marketing_report_visit_hint")}</p><p className="text-xs text-admin-muted">{t("marketing_report_cost_hint")}</p>
    <p className="text-xs text-admin-muted">{t("marketing_report_sort_hint")} · {t("marketing_report_funnel_hint")}</p>
    {(loadError || ownerData?.error) && <p role="alert" className="text-sm text-red-700">{loadError ?? ownerData?.error}</p>}
    {!data && !loadError && <p className="text-sm text-admin-muted">{t("common_loading")}</p>}
    {data && <>
      <p className="text-xs text-admin-muted">{data.from} — {data.to} · {t("marketing_report_as_of")}: {new Date(data.asOf).toLocaleString("en-PH", { timeZone: "Asia/Manila", hour12: false })}</p>
      {data.mode === "TREE"
        ? <>
          {data.linkCount !== undefined && data.linkCount > 500 && <p role="alert" className="text-xs text-amber-800">{t("marketing_report_tree_too_many")}</p>}
          <ReportTreeTable tree={data.tree ?? []} sortBy={data.sortBy} sortDirection={data.sortDirection} onSort={toggleSort} />
          <p className="text-xs text-admin-muted">{t("marketing_report_tree_total", { count: String(data.linkCount ?? 0) })}</p>
        </>
        : flatTable}
      {data.mode === "FLAT" && <div className="flex items-center justify-between text-xs text-admin-muted"><span>{t("marketing_records", { count: String(data.total) })}</span><div className="flex gap-2"><button type="button" className={buttonClass} disabled={page === 1} onClick={() => setPage(value => value - 1)}>{t("marketing_previous")}</button><span className="py-2">{page}</span><button type="button" className={buttonClass} disabled={page * 20 >= data.total} onClick={() => setPage(value => value + 1)}>{t("marketing_next")}</button></div></div>}
      {data.otherSources.length > 0 && <div className="space-y-2"><h3 className="font-medium">{t("marketing_report_other")}</h3><p className="text-xs text-admin-muted">{t("marketing_report_other_hint")}</p><div className="overflow-x-auto rounded-xl border border-admin-border bg-white"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-admin-muted"><tr>{(["marketing_source_type", "marketing_report_submitted", "marketing_report_valid", "marketing_report_confirmed", "marketing_report_signed", "marketing_report_valid_value", "marketing_report_signed_gross"] as const).map(key => <th className="whitespace-nowrap px-3 py-2" key={key}>{t(key)}</th>)}</tr></thead><tbody className="divide-y divide-admin-border">{data.otherSources.map(row => <tr key={row.id}><td className="min-w-64 px-3 py-3">{identity(row, t)}</td>{[row.submittedOrders, row.validOrders, row.confirmedOrders, row.signedOrders].map((count, index) => <td className="px-3 py-3" key={index}>{count}</td>)}<td className="whitespace-nowrap px-3 py-3">PHP {row.validOrderValuePhp}</td><td className="whitespace-nowrap px-3 py-3">PHP {row.signedGrossPhp}</td></tr>)}</tbody></table></div></div>}
    </>}
  </section>;
}
