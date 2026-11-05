"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { Dialog } from "@/components/admin/Dialog";
import { useAdminI18n } from "@/lib/admin-i18n";
import { AdminApiError } from "@/lib/admin-auth";
import { copyText } from "@/lib/clipboard";
import { canManageMarketingPage, marketingApi, type CampaignLinkRow, type MarketingOwnerOption, type CampaignLinkProductGroup, type CampaignLinkQuery, type MarketingSourceType } from "@/lib/marketing-api";
import { CreateCampaignLinkDialog } from "./CreateCampaignLinkDialog";
import { ProductThumb } from "./ReportColumns";

import { ProductLinksTable } from "./ProductLinksTable";
import { ProductPostsDrawer } from "./ProductPostsDrawer";
import { EditPostDialog } from "./EditPostDialog";
import { PostLinkResultDialog } from "./PostLinkResultDialog";
import { SourceSections } from "./SourceSections";

const sources: MarketingSourceType[] = ["FB_POST", "META_AD", "ORGANIC", "DIRECT", "EMAIL", "OTHER"];
const buttonClass = "rounded-md border border-admin-border px-2 py-1.5 text-xs disabled:opacity-40";
export function CampaignLinksList({ productId, landingPageId, onLoaded, workspace = false }: { productId?: string; landingPageId?: string; onLoaded?: (total: number) => void; workspace?: boolean }) {
  const { admin } = useAdminAuth();
  const { t } = useAdminI18n();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [status, setStatus] = useState<"" | "ACTIVE" | "DISABLED">("");
  // The page can arrive scoped to one product (?productId=…); show that in the
  // filter so it is visible and clearable instead of silently hiding records.
  const [productFilter, setProductFilter] = useState(() => (workspace ? productId ?? "" : ""));
  const [noticeProduct, setNoticeProduct] = useState(false);
  const [ownerFilter, setOwnerFilter] = useState("");
  const [products, setProducts] = useState<{ id: string; name: string; productCode: string | null }[]>([]);
  const [ownerOptions, setOwnerOptions] = useState<MarketingOwnerOption[]>([]);
  const all = Boolean(admin?.permissions.includes("MARKETING_VIEW_ALL"));
  const [view, setView] = useState<"products" | "flat">("products");
  const [archiveState, setArchiveState] = useState<"UNARCHIVED" | "ARCHIVED" | "ALL">("UNARCHIVED");
  const [sourceType, setSourceType] = useState<MarketingSourceType | "">("");
  const [postDateFrom, setPostDateFrom] = useState("");
  const [postDateTo, setPostDateTo] = useState("");
  const [postMissingOnly, setPostMissingOnly] = useState(false);
  const [groups, setGroups] = useState<{ key: string; items: CampaignLinkProductGroup[]; total: number } | null>(null);
  const [drawerProduct, setDrawerProduct] = useState<{ id: string; name: string } | null>(null);
  const [resultLink, setResultLink] = useState<CampaignLinkRow | null>(null);
  const [editing, setEditing] = useState<CampaignLinkRow | null>(null);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const queryKey = JSON.stringify([admin?.id, productId, landingPageId, filter, status, productFilter, ownerFilter, page, revision, workspace, view, archiveState, sourceType, postDateFrom, postDateTo, postMissingOnly]);
  const [loaded, setLoaded] = useState<{ key: string; items: CampaignLinkRow[]; total: number } | null>(null);
  const [loadError, setLoadError] = useState<{ key: string; message: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState<{ url: string; ok: boolean } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const scopeKey = JSON.stringify([admin?.id, productId, landingPageId]);
  const [creating, setCreating] = useState<{ scopeKey: string; copyFrom?: CampaignLinkRow; productId?: string; defaultSourceType?: MarketingSourceType } | null>(null);
  const [renaming, setRenaming] = useState<{ row: CampaignLinkRow; name: string; error: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const operation = useRef(false);
  const canCreate = Boolean(admin?.permissions.some((permission) => ["MARKETING_MANAGE_ALL", "MARKETING_MANAGE_OWN"].includes(permission)));

  useEffect(() => {
    if (!admin) return;
    // The dropdown follows the link-builder context (active products). Links
    // to an inactive product stay listed when no filter is set.
    marketingApi.linkContext()
      .then(context => setProducts(context.products.map(({ id, name, productCode }) => ({ id, name, productCode }))))
      .catch(() => { /* optional filter dropdown */ });
    return () => { };
  }, [admin]);

  useEffect(() => {
    if (!admin || !all) return;
    marketingApi.ownerOptions().then(setOwnerOptions).catch(() => setOwnerOptions([]));
    return () => { };
  }, [admin, all]);

  const scopedProductId = workspace ? (productFilter || undefined) : (productFilter || productId);
  const filters: CampaignLinkQuery = { productId: scopedProductId, landingPageId, search: filter || undefined, status: status || undefined, ownerUserId: (all ? ownerFilter : undefined) || undefined,
    ...(workspace ? { archiveState, sourceType: sourceType || undefined, postDateFrom: postDateFrom || undefined, postDateTo: postDateTo || undefined, postDateMissingOnly: postMissingOnly || undefined } : {}) };
  const filterKey = JSON.stringify(filters);
  useEffect(() => {
    if (!admin) return;
    let alive = true;
    const current: CampaignLinkQuery = JSON.parse(filterKey);
    const failed = (reason: unknown) => { if (alive) setLoadError({ key: queryKey, message: reason instanceof Error ? reason.message : String(reason) }); };
    if (workspace && view === "products") {
      marketingApi.listProductGroups({ ...current, page, pageSize: 20 }).then(result => { if (alive) { setGroups({ key: queryKey, ...result }); setLoadError(null); } }).catch(failed);
    } else {
      marketingApi.listLinks({ ...current, page, pageSize: workspace ? 100 : 20, ...(workspace ? { orderBy: "POST_DATE_DESC" as const } : {}) }).then(result => { if (alive) { setLoaded({ key: queryKey, ...result }); setLoadError(null); onLoaded?.(result.total); } }).catch(failed);
    }
    return () => { alive = false; };
  }, [admin, queryKey, filterKey, page, workspace, view, onLoaded]);

  async function mutate(row: CampaignLinkRow, action: "rename" | "disable") {
    if (!canManageMarketingPage(admin, row.ownerUserId) || operation.current) return;
    if (action === "disable" && !window.confirm(t("marketing_link_disable_confirm"))) return;
    operation.current = true; setBusy(true); setActionError(null); setNotice(null);
    try {
      if (action === "rename") await marketingApi.updateLink(row.id, { name: renaming!.name.trim(), expectedVersion: row.version });
      else await marketingApi.disableLink(row.id, row.version);
      setRenaming(null); setRevision((value) => value + 1); setNoticeProduct(false); setNotice(t("marketing_link_saved"));
    } catch (reason) {
      const message = reason instanceof AdminApiError && reason.status === 409 ? t("marketing_link_conflict") : reason instanceof Error ? reason.message : String(reason);
      if (action === "rename") setRenaming((current) => current ? { ...current, error: message } : current);
      else setActionError(message);
    } finally { operation.current = false; setBusy(false); }
  }

  async function mutateArchive(row: CampaignLinkRow) {
    if (operation.current || !canManageMarketingPage(admin, row.ownerUserId)) return;
    if (!window.confirm(t(row.archivedAt ? "marketing_post_unarchive_confirm" : "marketing_post_archive_confirm"))) return;
    operation.current = true; setBusy(true); setActionError(null);
    try { if (row.archivedAt) await marketingApi.unarchiveLink(row.id, row.version); else await marketingApi.archiveLink(row.id, row.version); setRevision(v => v + 1); }
    catch (reason) { setActionError(reason instanceof AdminApiError && reason.status === 409 ? t("marketing_post_conflict") : reason instanceof Error ? reason.message : String(reason)); }
    finally { operation.current = false; setBusy(false); }
  }

  async function copy(row: CampaignLinkRow) {
    const url = new URL(row.path, window.location.origin).href;
    const ok = await copyText(url);
    setCopied({ url, ok });
  }
  async function copyAdid(adid: string) {
    let ok = false;
    try { ok = await copyText(adid); } catch { /* the number stays selectable */ }
    setNotice(ok ? t("link_builder_copied") : t("common_copy_failed_manual"));
  }
  const data = (!workspace || view === "flat") && loaded?.key === queryKey ? loaded : null;
  const groupData = workspace && view === "products" && groups?.key === queryKey ? groups : null;
  const error = loadError?.key === queryKey ? loadError.message : null;

  return <section className="min-w-0 space-y-3" aria-label={t("marketing_links")}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{t("marketing_links")}</h2>{canCreate && <button className="rounded-lg bg-cta px-3 py-2 text-sm font-semibold text-white disabled:opacity-40" type="button" disabled={busy} onClick={() => setCreating({ scopeKey, defaultSourceType: workspace ? "FB_POST" : "META_AD" })}>{t("marketing_link_create")}</button>}</div>
    {workspace && <div className="flex gap-2"><button type="button" aria-pressed={view === "products"} className={buttonClass} onClick={() => { setView("products"); setArchiveState("UNARCHIVED"); setPage(1); }}>{t("marketing_post_view_products")}</button><button type="button" aria-pressed={view === "flat"} className={buttonClass} onClick={() => { setView("flat"); setArchiveState("ALL"); setPage(1); }}>{t("marketing_post_view_all_links")}</button></div>}
    <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); setFilter(search); setPage(1); }}>
      <input className="min-w-0 flex-1 rounded-lg border border-admin-border px-3 py-2 text-sm" aria-label={t("marketing_link_search")} placeholder={t("marketing_link_search")} value={search} onChange={(event) => setSearch(event.target.value)} />
      <select className="rounded-lg border border-admin-border px-3 py-2 text-sm" aria-label={t("marketing_report_filter_product")} value={productFilter} onChange={(event) => { setProductFilter(event.target.value); setPage(1); }}><option value="">{t("marketing_report_all_products")}</option>{products.map(product => <option key={product.id} value={product.id}>{product.name}{product.productCode ? ` · ${product.productCode}` : ""}</option>)}</select>
      {all && <select className="rounded-lg border border-admin-border px-3 py-2 text-sm" aria-label={t("marketing_link_filter_owner")} value={ownerFilter} onChange={(event) => { setOwnerFilter(event.target.value); setPage(1); }}><option value="">{t("marketing_all_owners")}</option>{ownerOptions.map(owner => <option key={owner.userId} value={owner.userId}>{owner.displayName} · {owner.aid}</option>)}</select>}
      <select className="rounded-lg border border-admin-border px-3 py-2 text-sm" aria-label={t("common_status")} value={status} onChange={(event) => { setStatus(event.target.value as typeof status); setPage(1); }}><option value="">{t("marketing_all_statuses")}</option><option value="ACTIVE">{t("marketing_link_active")}</option><option value="DISABLED">{t("marketing_status_DISABLED")}</option></select>
      {workspace && <>
        <select className="rounded-lg border border-admin-border px-3 py-2 text-sm" aria-label={t("marketing_post_filter_source")} value={sourceType} onChange={e => { const next = e.target.value as MarketingSourceType | ""; setSourceType(next); if (next && next !== "FB_POST") { setPostDateFrom(""); setPostDateTo(""); setPostMissingOnly(false); } setPage(1); }}><option value="">{t("marketing_all_sources")}</option>{sources.map(source => <option key={source} value={source}>{t(`marketing_source_${source}`)}</option>)}</select>
        <select className="rounded-lg border border-admin-border px-3 py-2 text-sm" aria-label={t("marketing_post_filter_archive")} value={archiveState} onChange={e => { setArchiveState(e.target.value as typeof archiveState); setPage(1); }}><option value="UNARCHIVED">{t("marketing_post_archive_unarchived")}</option><option value="ARCHIVED">{t("marketing_post_archive_archived")}</option><option value="ALL">{t("marketing_post_archive_all")}</option></select>
        <label className="text-xs">{t("marketing_post_post_date_from")}<input aria-label={t("marketing_post_post_date_from")} className="block rounded border p-2" type="date" value={postDateFrom} max={postDateTo || undefined} disabled={Boolean(sourceType && sourceType !== "FB_POST")} onChange={e => { setPostDateFrom(e.target.value); setPostMissingOnly(false); setPage(1); }} /></label>
        <label className="text-xs">{t("marketing_post_post_date_to")}<input aria-label={t("marketing_post_post_date_to")} className="block rounded border p-2" type="date" value={postDateTo} min={postDateFrom || undefined} disabled={Boolean(sourceType && sourceType !== "FB_POST")} onChange={e => { setPostDateTo(e.target.value); setPostMissingOnly(false); setPage(1); }} /></label>
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={postMissingOnly} disabled={Boolean(sourceType && sourceType !== "FB_POST")} onChange={e => { setPostMissingOnly(e.target.checked); setPostDateFrom(""); setPostDateTo(""); setPage(1); }} />{t("marketing_post_missing_only")}</label>
      </>}
      <button className={buttonClass} type="submit">{t("common_search")}</button><button type="button" className={buttonClass} disabled={busy} onClick={() => setRevision((value) => value + 1)}>{t("marketing_reload")}</button>
    </form>
    {notice && <p role="status" className="text-sm text-emerald-700">{notice}{workspace && ownerFilter && <button type="button" className="ml-2 underline" onClick={() => { setOwnerFilter(""); setPage(1); setNotice(null); }}>{t("marketing_post_clear_owner")}</button>}{workspace && noticeProduct && <button type="button" className="ml-2 underline" onClick={() => { setProductFilter(""); setNoticeProduct(false); setNotice(null); setPage(1); }}>{t("marketing_post_clear_product")}</button>}</p>}
    {(error || actionError) && <p role="alert" className="text-sm text-red-700">{error ?? actionError}</p>}
    {!data && !groupData && !error && <p className="text-sm text-admin-muted">{t("common_loading")}</p>}
    {groupData && <><ProductLinksTable groups={groupData.items} canCreate={canCreate} onOpen={id => setDrawerProduct({ id, name: groupData.items.find(g => g.product.id === id)?.product.name ?? id })} onCreate={id => setCreating({ scopeKey, productId: id, defaultSourceType: "FB_POST" })} />{!groupData.items.length && <p className="p-4 text-sm text-admin-muted">{t("marketing_links_empty")}</p>}<div className="flex justify-end gap-2 text-xs"><button type="button" className={buttonClass} disabled={page === 1} onClick={() => setPage(v => v - 1)}>{t("marketing_previous")}</button><span>{page}</span><button type="button" className={buttonClass} disabled={page * 20 >= groupData.total} onClick={() => setPage(v => v + 1)}>{t("marketing_next")}</button></div></>}
    {data && <>
      <div className="rounded-xl border border-admin-border bg-white">
        {data.items.length === 0 ? <p className="p-6 text-center text-admin-muted">{t("marketing_links_empty")}</p> : <SourceSections rows={data.items} renderRow={(row) => <article key={row.id} className="flex flex-col gap-3 border-t border-admin-border px-3 py-4 md:flex-row md:items-start md:gap-4">
          <div className="text-sm md:w-28 md:shrink-0">{row.postDate ?? (row.sourceType === "FB_POST" ? t("marketing_post_unregistered") : "—")}{row.archivedAt && <span className="mt-1 block text-xs text-amber-800">{t("marketing_post_archived")}</span>}</div>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="break-words font-medium">{row.name}</p>
            <div className="flex items-center gap-2"><ProductThumb url={row.productThumbnailUrl} label={row.productName} /><span className="text-sm">{row.productName}</span><span className="font-mono text-[11px] text-admin-muted">{row.code}</span></div>
            {row.adid && <p className="break-words text-xs text-admin-muted">{t("marketing_link_adid")}: <span className="font-mono text-ink">{row.adid}</span></p>}
            <p className="break-words text-xs text-admin-muted">{row.pageName ?? t("link_builder_no_landing_page")}{row.variantNameSnapshot ? ` · ${row.variantNameSnapshot}` : ""} · {row.ownerName} · {row.aid}</p>
            <p className="break-all text-xs text-admin-muted">{typeof window === "undefined" ? row.path : new URL(row.path, window.location.origin).href}</p>
          </div>
          <div className="md:shrink-0"><span className={`whitespace-nowrap rounded-full px-2 py-1 text-xs ${row.status === "ACTIVE" ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>{t(row.status === "ACTIVE" ? "marketing_link_active" : "marketing_status_DISABLED")}</span></div>
          <div className="flex flex-wrap gap-1 md:w-[21rem] md:shrink-0 md:justify-end"><Link className={buttonClass} href={`/admin/marketing/reports?${new URLSearchParams({ productId: row.productId, ...(row.landingPageId ? { landingPageId: row.landingPageId } : {}), linkId: row.id })}`}>{t("marketing_reports")}</Link><Link className={buttonClass} href={`/admin/marketing/costs?${new URLSearchParams({ productId: row.productId, ...(row.landingPageId ? { landingPageId: row.landingPageId } : {}), linkId: row.id })}`}>{t("marketing_costs")}</Link><button type="button" className={buttonClass} onClick={() => void copy(row)}>{t("marketing_link_copy_url")}</button>{row.adid && <button type="button" className={buttonClass} onClick={() => void copyAdid(row.adid!)}>{t("marketing_link_copy_adid")}</button>}{canManageMarketingPage(admin, row.ownerUserId) && <>{workspace && <><button type="button" className={buttonClass} disabled={busy} onClick={() => setEditing(row)}>{t("marketing_post_edit")}</button><button type="button" className={buttonClass} disabled={busy} onClick={() => void mutateArchive(row)}>{t(row.archivedAt ? "marketing_post_unarchive" : "marketing_post_archive")}</button></>}<button type="button" className={buttonClass} disabled={busy} onClick={() => setRenaming({ row, name: row.name, error: null })}>{t("marketing_link_rename")}</button><button type="button" className={buttonClass} disabled={busy} onClick={() => setCreating({ scopeKey, copyFrom: row })}>{t("marketing_link_clone")}</button>{row.status === "ACTIVE" && <button type="button" className={buttonClass} disabled={busy} onClick={() => void mutate(row, "disable")}>{t("marketing_disable")}</button>}</>}</div>
        </article>} />}
      </div>
      <div className="flex items-center justify-between text-xs text-admin-muted"><span>{t("marketing_records", { count: String(data.total) })}</span>{data.total > (workspace ? 100 : 20) && <div className="flex gap-2"><button type="button" className={buttonClass} disabled={page === 1 || busy} onClick={() => setPage((value) => value - 1)}>{t("marketing_previous")}</button><span className="py-1.5">{page}</span><button type="button" className={buttonClass} disabled={page * (workspace ? 100 : 20) >= data.total || busy} onClick={() => setPage((value) => value + 1)}>{t("marketing_next")}</button></div>}</div>
    </>}
    {canCreate && creating?.scopeKey === scopeKey && <CreateCampaignLinkDialog key={`${scopeKey}:${creating.copyFrom?.id ?? "new"}`} productId={creating.productId ?? scopedProductId} landingPageId={landingPageId} copyFrom={creating.copyFrom} defaultSourceType={creating.defaultSourceType} lockProduct={Boolean(creating.productId) || !workspace} onClose={() => setCreating(null)} onSaved={link => { setCreating(null); if (workspace) setResultLink(link); const outsideProduct = Boolean(scopedProductId) && link.productId !== scopedProductId; setNoticeProduct(outsideProduct); setNotice(t(all && ownerFilter && ownerFilter !== link.ownerUserId ? "marketing_post_saved_outside_filter" : outsideProduct ? "marketing_post_saved_outside_product" : "marketing_link_saved")); setRevision((value) => value + 1); }} />}
    {drawerProduct && <ProductPostsDrawer key={drawerProduct.id + filterKey} productId={drawerProduct.id} productName={drawerProduct.name} filters={filters} onClose={() => setDrawerProduct(null)} onChanged={() => setRevision(v => v + 1)} onCreate={() => { setCreating({ scopeKey, productId: drawerProduct.id, defaultSourceType: "FB_POST" }); setDrawerProduct(null); }} onClone={row => { setCreating({ scopeKey, copyFrom: row }); setDrawerProduct(null); }} />}
    {editing && <EditPostDialog link={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setRevision(v => v + 1); }} />}
    {resultLink && <PostLinkResultDialog link={resultLink} onClose={() => setResultLink(null)} onContinue={() => { setCreating({ scopeKey, productId: resultLink.productId, defaultSourceType: resultLink.sourceType }); setResultLink(null); }} />}
    {renaming && <Dialog open title={t("marketing_link_rename")} onClose={() => { if (!operation.current) setRenaming(null); }}><form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void mutate(renaming.row, "rename"); }}>
      <p className="text-xs text-admin-muted">{t("marketing_link_immutable")}</p>{renaming.error && <p role="alert" className="text-sm text-red-700">{renaming.error}</p>}
      <label className="block space-y-1 text-sm">{t("marketing_internal_name")}<input className="w-full rounded-lg border border-admin-border px-3 py-2" required maxLength={120} disabled={busy} value={renaming.name} onChange={(event) => setRenaming((current) => current ? { ...current, name: event.target.value } : current)} /></label>
      <div className="flex justify-end gap-2"><button type="button" className={buttonClass} disabled={busy} onClick={() => setRenaming(null)}>{t("common_cancel")}</button><button type="submit" className={buttonClass} disabled={busy || !renaming.name.trim()}>{t("common_save")}</button></div>
    </form></Dialog>}
    {copied && <Dialog open title={t(copied.ok ? "marketing_link_copy_success" : "marketing_link_copy_failed")} onClose={() => setCopied(null)} width="sm" initialFocus="first">
      <div className="space-y-4">
        <p role="status" className={copied.ok ? "text-sm text-emerald-700" : "text-sm text-red-700"}>{t(copied.ok ? "link_builder_copied" : "common_copy_failed_manual")}</p>
        <label className="block space-y-1 text-sm">{t("marketing_link_url")}<input readOnly value={copied.url} onFocus={(event) => event.currentTarget.select()} className="w-full rounded-lg border border-admin-border px-3 py-2 font-mono text-xs" /></label>
        <div className="flex justify-end"><button type="button" className={buttonClass} onClick={() => setCopied(null)}>{t("common_close")}</button></div>
      </div>
    </Dialog>}
  </section>;
}
