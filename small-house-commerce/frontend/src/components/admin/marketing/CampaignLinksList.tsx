"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { Dialog } from "@/components/admin/Dialog";
import { useAdminI18n } from "@/lib/admin-i18n";
import { AdminApiError } from "@/lib/admin-auth";
import { copyText } from "@/lib/clipboard";
import { canManageMarketingPage, marketingApi, type CampaignLinkRow } from "@/lib/marketing-api";
import { CreateCampaignLinkDialog } from "./CreateCampaignLinkDialog";

const buttonClass = "rounded-md border border-admin-border px-2 py-1.5 text-xs disabled:opacity-40";
export function CampaignLinksList({ productId, landingPageId, onLoaded }: { productId?: string; landingPageId?: string; onLoaded?: (total: number) => void }) {
  const { admin } = useAdminAuth();
  const { t } = useAdminI18n();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [status, setStatus] = useState<"" | "ACTIVE" | "DISABLED">("");
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const queryKey = JSON.stringify([admin?.id, productId, landingPageId, filter, status, page, revision]);
  const [loaded, setLoaded] = useState<{ key: string; items: CampaignLinkRow[]; total: number } | null>(null);
  const [loadError, setLoadError] = useState<{ key: string; message: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const scopeKey = JSON.stringify([admin?.id, productId, landingPageId]);
  const [creating, setCreating] = useState<{ scopeKey: string; copyFrom?: CampaignLinkRow } | null>(null);
  const [renaming, setRenaming] = useState<{ row: CampaignLinkRow; name: string; error: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const operation = useRef(false);
  const canCreate = Boolean(admin?.permissions.some((permission) => ["MARKETING_MANAGE_ALL", "MARKETING_MANAGE_OWN"].includes(permission)));

  useEffect(() => {
    if (!admin) return;
    let alive = true;
    marketingApi.listLinks({ productId, landingPageId, search: filter || undefined, status: status || undefined, page, pageSize: 20 })
      .then((result) => { if (alive) { setLoaded({ key: queryKey, ...result }); setLoadError(null); onLoaded?.(result.total); } })
      .catch((reason: unknown) => { if (alive) setLoadError({ key: queryKey, message: reason instanceof Error ? reason.message : String(reason) }); });
    return () => { alive = false; };
  }, [admin, queryKey, productId, landingPageId, filter, status, page, onLoaded]);

  async function mutate(row: CampaignLinkRow, action: "rename" | "disable") {
    if (!canManageMarketingPage(admin, row.ownerUserId) || operation.current) return;
    if (action === "disable" && !window.confirm(t("marketing_link_disable_confirm"))) return;
    operation.current = true; setBusy(true); setActionError(null); setNotice(null);
    try {
      if (action === "rename") await marketingApi.updateLink(row.id, renaming!.name.trim(), row.version);
      else await marketingApi.disableLink(row.id, row.version);
      setRenaming(null); setRevision((value) => value + 1); setNotice(t("marketing_link_saved"));
    } catch (reason) {
      const message = reason instanceof AdminApiError && reason.status === 409 ? t("marketing_link_conflict") : reason instanceof Error ? reason.message : String(reason);
      if (action === "rename") setRenaming((current) => current ? { ...current, error: message } : current);
      else setActionError(message);
    } finally { operation.current = false; setBusy(false); }
  }

  async function copy(row: CampaignLinkRow) {
    const copied = await copyText(new URL(row.path, window.location.origin).href);
    setNotice(t(copied ? "link_builder_copied" : "common_copy_failed_manual"));
  }
  const data = loaded?.key === queryKey ? loaded : null;
  const error = loadError?.key === queryKey ? loadError.message : null;

  return <section className="min-w-0 space-y-3" aria-label={t("marketing_links")}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{t("marketing_links")}</h2>{canCreate && <button className="rounded-lg bg-cta px-3 py-2 text-sm font-semibold text-white disabled:opacity-40" type="button" disabled={busy} onClick={() => setCreating({ scopeKey })}>{t("marketing_link_create")}</button>}</div>
    <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); setFilter(search); setPage(1); }}>
      <input className="min-w-0 flex-1 rounded-lg border border-admin-border px-3 py-2 text-sm" aria-label={t("marketing_link_search")} placeholder={t("marketing_link_search")} value={search} onChange={(event) => setSearch(event.target.value)} />
      <select className="rounded-lg border border-admin-border px-3 py-2 text-sm" aria-label={t("common_status")} value={status} onChange={(event) => { setStatus(event.target.value as typeof status); setPage(1); }}><option value="">{t("marketing_all_statuses")}</option><option value="ACTIVE">{t("marketing_link_active")}</option><option value="DISABLED">{t("marketing_status_DISABLED")}</option></select>
      <button className={buttonClass} type="submit">{t("common_search")}</button><button type="button" className={buttonClass} disabled={busy} onClick={() => setRevision((value) => value + 1)}>{t("marketing_reload")}</button>
    </form>
    {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
    {(error || actionError) && <p role="alert" className="text-sm text-red-700">{error ?? actionError}</p>}
    {!data && !error && <p className="text-sm text-admin-muted">{t("common_loading")}</p>}
    {data && <>
      <div className="overflow-x-auto rounded-xl border border-admin-border bg-white"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-admin-muted"><tr>{["marketing_internal_name", "link_builder_product", "link_builder_aid", "link_builder_target_section", "marketing_source_type", "common_status", "common_actions"].map((key) => <th key={key} className="whitespace-nowrap px-3 py-2">{t(key as Parameters<typeof t>[0])}</th>)}</tr></thead><tbody className="divide-y divide-admin-border">
        {data.items.map((row) => <tr key={row.id}>
          <td className="px-3 py-3"><p className="font-medium">{row.name}</p><p className="mt-1 font-mono text-[11px] text-admin-muted">{row.code}</p></td>
          <td className="px-3 py-3"><p>{row.productName}</p><p className="text-xs text-admin-muted">{row.productCode}</p></td>
          <td className="px-3 py-3"><p>{row.ownerName}</p><p className="text-xs text-admin-muted">{row.aid}</p></td>
          <td className="max-w-72 px-3 py-3"><p>{row.pageName ?? t("link_builder_no_landing_page")}{row.variantNameSnapshot ? ` · ${row.variantNameSnapshot}` : ""}</p><input aria-label={`${t("marketing_link_url")} · ${row.name}`} readOnly className="mt-1 w-full min-w-48 bg-transparent text-xs text-admin-muted" value={typeof window === "undefined" ? row.path : new URL(row.path, window.location.origin).href} /></td>
          <td className="px-3 py-3"><p>{t(`marketing_source_${row.sourceType}`)}</p><p className="text-xs text-admin-muted">{row.adId ?? "—"}</p></td>
          <td className="whitespace-nowrap px-3 py-3"><span className={`rounded-full px-2 py-1 text-xs ${row.status === "ACTIVE" ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>{t(row.status === "ACTIVE" ? "marketing_link_active" : "marketing_status_DISABLED")}</span></td>
          <td className="px-3 py-3"><div className="flex min-w-48 flex-wrap gap-1"><Link className={buttonClass} href={`/admin/marketing/reports?${new URLSearchParams({ productId: row.productId, ...(row.landingPageId ? { landingPageId: row.landingPageId } : {}), linkId: row.id })}`}>{t("marketing_reports")}</Link><Link className={buttonClass} href={`/admin/marketing/costs?${new URLSearchParams({ productId: row.productId, ...(row.landingPageId ? { landingPageId: row.landingPageId } : {}), linkId: row.id })}`}>{t("marketing_costs")}</Link><button type="button" className={buttonClass} onClick={() => void copy(row)}>{t("marketing_link_copy_url")}</button>{canManageMarketingPage(admin, row.ownerUserId) && <><button type="button" className={buttonClass} disabled={busy} onClick={() => setRenaming({ row, name: row.name, error: null })}>{t("marketing_link_rename")}</button><button type="button" className={buttonClass} disabled={busy} onClick={() => setCreating({ scopeKey, copyFrom: row })}>{t("marketing_link_clone")}</button>{row.status === "ACTIVE" && <button type="button" className={buttonClass} disabled={busy} onClick={() => void mutate(row, "disable")}>{t("marketing_disable")}</button>}</>}</div></td>
        </tr>)}
        {data.items.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-admin-muted">{t("marketing_links_empty")}</td></tr>}
      </tbody></table></div>
      <div className="flex items-center justify-between text-xs text-admin-muted"><span>{t("marketing_records", { count: String(data.total) })}</span><div className="flex gap-2"><button type="button" className={buttonClass} disabled={page === 1 || busy} onClick={() => setPage((value) => value - 1)}>{t("marketing_previous")}</button><span className="py-1.5">{page}</span><button type="button" className={buttonClass} disabled={page * 20 >= data.total || busy} onClick={() => setPage((value) => value + 1)}>{t("marketing_next")}</button></div></div>
    </>}
    {canCreate && creating?.scopeKey === scopeKey && <CreateCampaignLinkDialog key={`${scopeKey}:${creating.copyFrom?.id ?? "new"}`} productId={productId} landingPageId={landingPageId} copyFrom={creating.copyFrom} onClose={() => setCreating(null)} onSaved={() => { setCreating(null); setNotice(t("marketing_link_saved")); setRevision((value) => value + 1); }} />}
    {renaming && <Dialog open title={t("marketing_link_rename")} onClose={() => { if (!operation.current) setRenaming(null); }}><form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void mutate(renaming.row, "rename"); }}>
      <p className="text-xs text-admin-muted">{t("marketing_link_immutable")}</p>{renaming.error && <p role="alert" className="text-sm text-red-700">{renaming.error}</p>}
      <label className="block space-y-1 text-sm">{t("marketing_internal_name")}<input className="w-full rounded-lg border border-admin-border px-3 py-2" required maxLength={120} disabled={busy} value={renaming.name} onChange={(event) => setRenaming((current) => current ? { ...current, name: event.target.value } : current)} /></label>
      <div className="flex justify-end gap-2"><button type="button" className={buttonClass} disabled={busy} onClick={() => setRenaming(null)}>{t("common_cancel")}</button><button type="submit" className={buttonClass} disabled={busy || !renaming.name.trim()}>{t("common_save")}</button></div>
    </form></Dialog>}
  </section>;
}
