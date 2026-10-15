"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { Dialog } from "@/components/admin/Dialog";
import { useAdminI18n } from "@/lib/admin-i18n";
import { AdminApiError } from "@/lib/admin-auth";
import { canManageMarketingPage, marketingApi, type MarketingOwnerOption, type MarketingPageListRow, type MarketingPageQuery, type MarketingPageStatus } from "@/lib/marketing-api";
import { CreateMarketingPageDialog } from "./CreateMarketingPageDialog";

const fieldClass = "min-w-0 rounded-lg border border-admin-border bg-white px-3 py-2 text-sm";
const statuses: MarketingPageStatus[] = ["DRAFT", "LIVE", "SCHEDULED", "ENDED", "DISABLED"];
const actionClass = "rounded-md border border-admin-border px-2 py-1.5 text-xs disabled:opacity-40";
const dateFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" });
export function MarketingPagesList({ productId }: { productId?: string }) {
  const { admin } = useAdminAuth();
  const { t } = useAdminI18n();
  const [inputs, setInputs] = useState(() => ({ search: "", ownerUserId: "", effectiveStatus: "", dateFrom: "", dateTo: "", periodFrom: dateFormat.format(new Date(Date.now() - 6 * 864e5)), periodTo: dateFormat.format(new Date()) }));
  const [filters, setFilters] = useState<MarketingPageQuery>(() => ({ periodFrom: inputs.periodFrom, periodTo: inputs.periodTo }));
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const scopeKey = JSON.stringify([admin?.id, admin?.permissions, productId]);
  const queryKey = JSON.stringify([scopeKey, filters, page, revision]);
  const [loaded, setLoaded] = useState<{ key: string; items: MarketingPageListRow[]; total: number } | null>(null);
  const [loadError, setLoadError] = useState<{ key: string; message: string } | null>(null);
  const [owners, setOwners] = useState<{ key: string; items: MarketingOwnerOption[] } | null>(null);
  const [creatingFor, setCreatingFor] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<{ scopeKey: string; row: MarketingPageListRow; ownerUserId: string; error: string | null; conflicted: boolean } | null>(null);
  const canAssign = Boolean(admin?.permissions.includes("MARKETING_MANAGE_ALL"));
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const operation = useRef(false);
  const all = admin?.permissions.includes("MARKETING_VIEW_ALL");
  const canCreate = admin?.permissions.some((permission) => ["MARKETING_MANAGE_ALL", "MARKETING_MANAGE_OWN"].includes(permission));
  useEffect(() => {
    if (!admin) return;
    let alive = true;
    marketingApi.ownerOptions().then((items) => { if (alive) setOwners({ key: scopeKey, items }); }).catch((reason: unknown) => { if (alive) setActionError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { alive = false; };
  }, [admin, scopeKey]);
  useEffect(() => {
    if (!admin) return;
    let alive = true;
    marketingApi.listPages({ ...filters, ownerUserId: all ? filters.ownerUserId : undefined, productId, page, pageSize: 20 }).then((result) => { if (alive) { setLoaded({ key: queryKey, ...result }); setLoadError(null); } }).catch((reason: unknown) => { if (alive) setLoadError({ key: queryKey, message: reason instanceof Error ? reason.message : String(reason) }); });
    return () => { alive = false; };
  }, [admin, all, productId, filters, page, queryKey]);
  async function disable(row: MarketingPageListRow) {
    if (!canManageMarketingPage(admin, row.ownerUserId) || operation.current || !window.confirm(t("marketing_page_disable_confirm"))) return;
    operation.current = true; setBusy(true); setActionError(null);
    try { await marketingApi.disable(row.id, row.version); setRevision((value) => value + 1); }
    catch (reason) { setActionError(reason instanceof AdminApiError && reason.status === 409 ? t("marketing_conflict") : reason instanceof Error ? reason.message : String(reason)); }
    finally { operation.current = false; setBusy(false); }
  }
  async function assignOwner(reload = false) {
    if (!assigning || assigning.scopeKey !== scopeKey || !canAssign || operation.current) return;
    if (!reload && (!assigning.ownerUserId || assigning.conflicted)) return;
    operation.current = true; setBusy(true);
    try {
      if (reload) {
        const saved = await marketingApi.getPage(assigning.row.id);
        if (saved.ownerUserId !== null) {
          setAssigning(null); setActionError(t("marketing_assigned_elsewhere")); setRevision(value => value + 1);
        } else setAssigning(current => current ? { ...current, row: { ...current.row, ...saved }, error: null, conflicted: false } : current);
      } else {
        await marketingApi.assignOwner(assigning.row.id, assigning.ownerUserId, assigning.row.version);
        setAssigning(null); setActionError(null); setRevision(value => value + 1);
      }
    } catch (reason) {
      const conflicted = reason instanceof AdminApiError && reason.status === 409;
      setAssigning(current => current ? { ...current, conflicted, error: conflicted ? t("marketing_conflict") : reason instanceof Error ? reason.message : String(reason) } : current);
    } finally { operation.current = false; setBusy(false); }
  }
  const data = loaded?.key === queryKey ? loaded : null;
  const error = loadError?.key === queryKey ? loadError.message : null;
  const ownerChoices = owners?.key === scopeKey ? owners.items : [];
  return <section className="min-w-0 space-y-3" aria-label={t("marketing_pages")}>
    <div className="flex flex-wrap justify-between gap-2"><h2 className="font-semibold">{t("marketing_pages")}</h2>{canCreate && <button type="button" className="rounded-lg bg-cta px-3 py-2 text-sm font-semibold text-white" onClick={() => setCreatingFor(scopeKey)}>{t("marketing_page_create")}</button>}</div>
    <form className="grid gap-2 md:grid-cols-3 xl:grid-cols-6" onSubmit={(event) => { event.preventDefault(); setFilters({ search: inputs.search || undefined, ownerUserId: all ? inputs.ownerUserId || undefined : undefined, effectiveStatus: inputs.effectiveStatus as MarketingPageStatus || undefined, dateFrom: inputs.dateFrom || undefined, dateTo: inputs.dateTo || undefined, periodFrom: inputs.periodFrom, periodTo: inputs.periodTo }); setPage(1); }}>
      <input className={fieldClass} aria-label={t("marketing_page_search")} placeholder={t("marketing_page_search")} value={inputs.search} onChange={(event) => setInputs((value) => ({ ...value, search: event.target.value }))} />
      {all && <label className="text-xs text-admin-muted">{t("marketing_owner")}<select className={`${fieldClass} w-full`} value={inputs.ownerUserId} onChange={(event) => setInputs((value) => ({ ...value, ownerUserId: event.target.value }))}><option value="">{t("marketing_all_owners")}</option>{ownerChoices.map((owner) => <option key={owner.userId} value={owner.userId}>{owner.displayName} · {owner.aid}</option>)}</select></label>}
      <select aria-label={t("common_status")} className={fieldClass} value={inputs.effectiveStatus} onChange={(event) => setInputs((value) => ({ ...value, effectiveStatus: event.target.value }))}><option value="">{t("marketing_all_statuses")}</option>{statuses.map((status) => <option key={status} value={status}>{t(`marketing_status_${status}`)}</option>)}</select>
      <label className="text-xs text-admin-muted">{t("marketing_modified_from")}<input type="date" className={`${fieldClass} w-full`} value={inputs.dateFrom} onChange={(event) => setInputs((value) => ({ ...value, dateFrom: event.target.value }))} /></label>
      <label className="text-xs text-admin-muted">{t("marketing_modified_to")}<input type="date" className={`${fieldClass} w-full`} value={inputs.dateTo} onChange={(event) => setInputs((value) => ({ ...value, dateTo: event.target.value }))} /></label>
      <label className="text-xs text-admin-muted">{t("marketing_period_from")}<input required type="date" max={inputs.periodTo || undefined} className={`${fieldClass} w-full`} value={inputs.periodFrom} onChange={(event) => setInputs((value) => ({ ...value, periodFrom: event.target.value }))} /></label>
      <label className="text-xs text-admin-muted">{t("marketing_period_to")}<input required type="date" min={inputs.periodFrom || undefined} className={`${fieldClass} w-full`} value={inputs.periodTo} onChange={(event) => setInputs((value) => ({ ...value, periodTo: event.target.value }))} /></label>
      <div className="flex items-end gap-2"><button type="submit" className={actionClass}>{t("common_search")}</button><button type="button" className={actionClass} disabled={busy} onClick={() => setRevision((value) => value + 1)}>{t("marketing_reload")}</button></div>
    </form>
    <p className="text-xs text-admin-muted">{t("marketing_modified_hint")}</p>
    <p className="text-xs text-admin-muted">{t("marketing_period_hint")}</p>
    {(error || actionError) && <p role="alert" className="text-sm text-red-700">{error ?? actionError}</p>}
    {!data && !error && <p className="text-sm text-admin-muted">{t("common_loading")}</p>}
    {data && <><div className="overflow-x-auto rounded-xl border border-admin-border bg-white"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-admin-muted"><tr>{(["marketing_internal_name", "link_builder_product", "link_builder_aid", "common_status", "marketing_link_count", "marketing_period_views", "marketing_period_orders", "marketing_modified_at", "common_actions"] as const).map((key) => <th key={key} className="whitespace-nowrap px-3 py-2">{t(key)}</th>)}</tr></thead><tbody className="divide-y divide-admin-border">
      {data.items.map((row) => {
        const manage = canManageMarketingPage(admin, row.ownerUserId);
        const linkable = manage && row.productStatus === "ACTIVE" && (row.effectiveStatus === "LIVE" || row.effectiveStatus === "SCHEDULED") && row.publishedRevision > 0;
        const links = `/admin/marketing/links?${new URLSearchParams({ productId: row.productId, landingPageId: row.id })}`;
        return <tr key={row.id}>
          <td className="px-3 py-3"><p className="font-medium">{row.name}</p><p className="mt-1 text-xs text-admin-muted">/lp/{row.slug}</p></td>
          <td className="px-3 py-3"><p>{row.productName}</p><p className="text-xs text-admin-muted">{row.productCode}</p></td>
          <td className="px-3 py-3"><p>{row.ownerName ?? t("marketing_legacy_owner")}</p><p className="text-xs text-admin-muted">{row.aid}</p></td>
          <td className="px-3 py-3"><span className="whitespace-nowrap rounded-full bg-slate-100 px-2 py-1 text-xs">{t(`marketing_status_${row.effectiveStatus}`)}</span>{row.hasUnpublishedChanges && <p className="mt-2 whitespace-nowrap text-xs text-amber-700">{t("marketing_unpublished")}</p>}</td>
          <td className="px-3 py-3"><Link className="underline" href={links}>{row.linkCount}</Link></td>
          <td className="px-3 py-3 tabular-nums">{row.periodViews}</td>
          <td className="px-3 py-3 tabular-nums">{row.periodOrders}</td>
          <td className="whitespace-nowrap px-3 py-3 text-xs text-admin-muted">{new Date(row.updatedAt).toLocaleString("en-PH", { timeZone: "Asia/Manila", hour12: false })}</td>
          <td className="px-3 py-3"><div className="flex min-w-56 flex-wrap gap-1"><Link className={actionClass} href={`/admin/marketing/${encodeURIComponent(row.id)}/edit`}>{t(manage ? "marketing_edit_page" : "marketing_page_view")}</Link><Link className={actionClass} href={`/admin/marketing/compare?${new URLSearchParams({ productId: row.productId })}`}>{t("marketing_view_performance")}</Link>{canAssign && row.ownerUserId === null && <button type="button" className={actionClass} disabled={busy} onClick={() => { setActionError(null); setAssigning({ scopeKey, row, ownerUserId: "", error: null, conflicted: false }); }}>{t("marketing_assign_owner")}</button>}<Link className={actionClass} href={`/admin/marketing/reports?${new URLSearchParams({ productId: row.productId, landingPageId: row.id })}`}>{t("marketing_reports")}</Link><Link className={actionClass} href={`/admin/marketing/costs?${new URLSearchParams({ productId: row.productId, landingPageId: row.id })}`}>{t("marketing_costs")}</Link><Link className={actionClass} href={`/admin/marketing/${encodeURIComponent(row.id)}/preview`}>{t("marketing_saved_preview")}</Link>{linkable && <Link className={actionClass} href={links}>{t("marketing_link_create")}</Link>}{manage && row.effectiveStatus !== "DISABLED" && <button type="button" className={actionClass} disabled={busy} onClick={() => void disable(row)}>{t("marketing_disable")}</button>}</div></td>
        </tr>;
      })}
      {data.items.length === 0 && <tr><td colSpan={9} className="p-6 text-center text-admin-muted">{t("marketing_pages_empty")}</td></tr>}
    </tbody></table></div><div className="flex justify-between text-xs text-admin-muted"><span>{t("marketing_records", { count: String(data.total) })}</span><div className="flex gap-2"><button type="button" className={actionClass} disabled={page === 1 || busy} onClick={() => setPage((value) => value - 1)}>{t("marketing_previous")}</button><span className="py-1.5">{page}</span><button type="button" className={actionClass} disabled={page * 20 >= data.total || busy} onClick={() => setPage((value) => value + 1)}>{t("marketing_next")}</button></div></div></>}
    {canAssign && assigning?.scopeKey === scopeKey && <Dialog open title={t("marketing_assign_owner")} initialFocus="first" onClose={() => { if (!operation.current) setAssigning(null); }}>
      <form className="space-y-4" onSubmit={event => { event.preventDefault(); void assignOwner(); }}>
        <p className="text-sm font-medium">{assigning.row.name}</p>
        <p className="text-xs text-admin-muted">{t("marketing_assign_hint")}</p>
        {assigning.error && <p role="alert" className="text-sm text-red-700">{assigning.error}</p>}
        <label className="block space-y-1 text-sm">{t("marketing_owner")}<select required className={`${fieldClass} w-full`} disabled={busy} value={assigning.ownerUserId} onChange={event => setAssigning(current => current ? { ...current, ownerUserId: event.target.value } : current)}>
          <option value="">{t("marketing_choose_owner")}</option>
          {ownerChoices.filter(owner => owner.status === "ACTIVE" && owner.userStatus === "ACTIVE").map(owner => <option key={owner.userId} value={owner.userId}>{owner.displayName} · {owner.aid}</option>)}
        </select></label>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={actionClass} disabled={busy} onClick={() => setAssigning(null)}>{t("common_cancel")}</button>
          {assigning.conflicted && <button type="button" className={actionClass} disabled={busy} onClick={() => void assignOwner(true)}>{t("marketing_reload")}</button>}
          <button type="submit" className={actionClass} disabled={busy || !assigning.ownerUserId || assigning.conflicted}>{t("marketing_assign_confirm")}</button>
        </div>
      </form>
    </Dialog>}
    {canCreate && creatingFor === scopeKey && <CreateMarketingPageDialog key={scopeKey} productId={productId} owners={ownerChoices} onClose={() => setCreatingFor(null)} />}
  </section>;
}
