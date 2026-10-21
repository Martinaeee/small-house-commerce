"use client";

import { useEffect, useRef, useState } from "react";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { Dialog } from "@/components/admin/Dialog";
import { useAdminI18n } from "@/lib/admin-i18n";
import { AdminApiError } from "@/lib/admin-auth";
import { canManageMarketingPage, marketingApi, type AdCostAuditRow, type AdCostRow, type AdCostSnapshot, type CampaignLinkRow, type MarketingOwnerOption } from "@/lib/marketing-api";
import { CostForm } from "./CostForm";

const buttonClass = "rounded-lg border border-admin-border px-3 py-2 text-xs disabled:opacity-40";
const fieldClass = "w-full min-w-0 rounded-lg border border-admin-border px-3 py-2 text-sm";
export function AdCostsList({ productId, landingPageId, linkId }: { productId?: string; landingPageId?: string; linkId?: string }) {
  const { admin } = useAdminAuth();
  const { t } = useAdminI18n();
  const [inputs, setInputs] = useState({ dateFrom: "", dateTo: "", ownerUserId: "" });
  const [filters, setFilters] = useState(inputs);
  const [includeVoided, setIncludeVoided] = useState(false);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const scopeKey = JSON.stringify([admin?.id, admin?.permissions, productId, landingPageId, linkId]);
  const queryKey = JSON.stringify([scopeKey, filters, includeVoided, page, revision]);
  const [loaded, setLoaded] = useState<{ key: string; items: AdCostRow[]; total: number } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [owners, setOwners] = useState<{ key: string; items: MarketingOwnerOption[] } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const operation = useRef(false);
  const all = Boolean(admin?.permissions.includes("MARKETING_VIEW_ALL"));
  const canCreate = Boolean(admin?.permissions.some(permission => ["MARKETING_MANAGE_OWN", "MARKETING_MANAGE_ALL"].includes(permission)));
  const [editing, setEditing] = useState<{ scope: string; link: Parameters<typeof CostForm>[0]["link"]; entry?: AdCostRow } | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [linkSearch, setLinkSearch] = useState("");
  const [linkFilter, setLinkFilter] = useState("");
  const [linkPage, setLinkPage] = useState(1);
  const choiceKey = JSON.stringify([scopeKey, choosing, linkFilter, linkPage]);
  const [choices, setChoices] = useState<{ key: string; items: CampaignLinkRow[]; total: number; error?: string } | null>(null);
  const [auditId, setAuditId] = useState<string | null>(null);
  const auditKey = JSON.stringify([scopeKey, auditId]);
  const [audit, setAudit] = useState<{ key: string; items: AdCostAuditRow[]; error?: string } | null>(null);

  useEffect(() => {
    if (!admin) return;
    let alive = true;
    marketingApi.listCosts({ productId, landingPageId, linkId, ownerUserId: all ? filters.ownerUserId || undefined : undefined, dateFrom: filters.dateFrom || undefined, dateTo: filters.dateTo || undefined, includeVoided, page, pageSize: 20 })
      .then(result => { if (alive) { setLoaded({ key: queryKey, ...result }); setError(null); } })
      .catch((reason: unknown) => { if (alive) setError({ key: queryKey, message: reason instanceof Error ? reason.message : String(reason) }); });
    return () => { alive = false; };
  }, [admin, queryKey, productId, landingPageId, linkId, all, filters, includeVoided, page]);

  useEffect(() => {
    if (!admin || !all) return;
    let alive = true;
    marketingApi.ownerOptions().then(items => { if (alive) setOwners({ key: scopeKey, items }); }).catch((reason: unknown) => { if (alive) setActionError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { alive = false; };
  }, [admin, all, scopeKey]);

  useEffect(() => {
    if (!admin || !choosing) return;
    let alive = true;
    const result = linkId ? marketingApi.getLink(linkId).then(row => ({ items: [row], total: 1 })) : marketingApi.listLinks({ productId, landingPageId, search: linkFilter || undefined, page: linkPage, pageSize: 20 });
    result.then(value => { if (alive) setChoices({ key: choiceKey, ...value }); }).catch((reason: unknown) => { if (alive) setChoices({ key: choiceKey, items: [], total: 0, error: reason instanceof Error ? reason.message : String(reason) }); });
    return () => { alive = false; };
  }, [admin, choosing, choiceKey, linkId, productId, landingPageId, linkFilter, linkPage]);

  useEffect(() => {
    if (!admin || !auditId) return;
    let alive = true;
    marketingApi.costAudit(auditId).then(items => { if (alive) setAudit({ key: auditKey, items }); }).catch((reason: unknown) => { if (alive) setAudit({ key: auditKey, items: [], error: reason instanceof Error ? reason.message : String(reason) }); });
    return () => { alive = false; };
  }, [admin, auditId, auditKey]);

  async function voidCost(row: AdCostRow) {
    if (operation.current || !canManageMarketingPage(admin, row.ownerUserId) || !window.confirm(t("marketing_cost_void_confirm"))) return;
    operation.current = true; setBusy(true); setActionError(null); setNotice(null);
    try { await marketingApi.voidCost(row.id, row.version); setRevision(value => value + 1); setNotice(t("marketing_cost_saved")); }
    catch (reason) { setActionError(reason instanceof AdminApiError && reason.status === 409 ? t("marketing_cost_conflict") : reason instanceof Error ? reason.message : String(reason)); }
    finally { operation.current = false; setBusy(false); }
  }

  const data = loaded?.key === queryKey ? loaded : null;
  const loadError = error?.key === queryKey ? error.message : null;
  const picker = choices?.key === choiceKey ? choices : null;
  const history = audit?.key === auditKey ? audit : null;
  const ownerChoices = owners?.key === scopeKey ? owners.items : [];
  function values(snapshot: AdCostSnapshot) {
    return <div className="space-y-1 text-xs"><p>USD {snapshot.amountUsd}</p><p>{snapshot.phpPerUsd === null ? "—" : `1 USD = ${snapshot.phpPerUsd} PHP`}</p><p>PHP {snapshot.amountPhp}</p><p>{t(snapshot.voidedAt ? "marketing_cost_voided" : "marketing_cost_active")} · v{snapshot.version}</p>{snapshot.note && <p className="break-words">{snapshot.note}</p>}</div>;
  }

  return <section className="min-w-0 space-y-3" aria-label={t("marketing_costs")}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{t("marketing_costs")}</h2>{canCreate && <button className="rounded-lg bg-cta px-3 py-2 text-sm font-semibold text-white" type="button" onClick={() => { setChoosing(true); setLinkPage(1); }}>{t("marketing_cost_create")}</button>}</div>
    <form className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4" onSubmit={(event) => { event.preventDefault(); setFilters(inputs); setPage(1); }}>
      <label className="space-y-1 text-xs text-admin-muted">{t("marketing_cost_date_from")}<input className={fieldClass} type="date" value={inputs.dateFrom} onChange={(event) => setInputs(value => ({ ...value, dateFrom: event.target.value }))} /></label>
      <label className="space-y-1 text-xs text-admin-muted">{t("marketing_cost_date_to")}<input className={fieldClass} type="date" value={inputs.dateTo} onChange={(event) => setInputs(value => ({ ...value, dateTo: event.target.value }))} /></label>
      {all && <label className="space-y-1 text-xs text-admin-muted">{t("marketing_owner")}<select className={fieldClass} value={inputs.ownerUserId} onChange={(event) => setInputs(value => ({ ...value, ownerUserId: event.target.value }))}><option value="">{t("marketing_all_owners")}</option>{ownerChoices.map(owner => <option key={owner.userId} value={owner.userId}>{owner.displayName} · {owner.aid}</option>)}</select></label>}
      <div className="flex items-end gap-2"><button className={buttonClass} type="submit">{t("common_search")}</button><button className={buttonClass} type="button" disabled={busy} onClick={() => setRevision(value => value + 1)}>{t("marketing_reload")}</button></div>
    </form>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeVoided} onChange={(event) => { setIncludeVoided(event.target.checked); setPage(1); }} />{t("marketing_cost_include_voided")}</label>
    {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}{(loadError || actionError) && <p role="alert" className="text-sm text-red-700">{loadError ?? actionError}</p>}
    {!data && !loadError && <p className="text-sm text-admin-muted">{t("common_loading")}</p>}
    {data && <><div className="overflow-x-auto rounded-xl border border-admin-border bg-white"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-admin-muted"><tr>{(["marketing_cost_date", "marketing_links", "link_builder_product", "link_builder_aid", "marketing_cost_usd", "marketing_cost_fx", "marketing_cost_php", "common_status", "common_actions"] as const).map(key => <th key={key} className="whitespace-nowrap px-3 py-2">{t(key)}</th>)}</tr></thead><tbody className="divide-y divide-admin-border">
      {data.items.map(row => <tr key={row.id} className={row.voidedAt ? "bg-slate-50 text-admin-muted" : ""}>
        <td className="whitespace-nowrap px-3 py-3">{row.costDate}</td><td className="px-3 py-3"><p className="font-medium">{row.linkName}</p><p className="text-xs text-admin-muted">{row.linkCode}</p></td><td className="px-3 py-3"><p>{row.productName}</p><p className="text-xs text-admin-muted">{row.productCode}</p></td><td className="px-3 py-3"><p>{row.ownerName}</p><p className="text-xs text-admin-muted">{row.aid}</p></td>
        <td className="whitespace-nowrap px-3 py-3"><p>USD {row.amountUsd}</p>{row.amountUsd === "0.00" && <p className="text-xs text-admin-muted">{t("marketing_cost_zero")}</p>}</td><td className="whitespace-nowrap px-3 py-3">{row.phpPerUsd === null ? "—" : `1 USD = ${row.phpPerUsd} PHP`}</td><td className="whitespace-nowrap px-3 py-3">PHP {row.amountPhp}</td><td className="whitespace-nowrap px-3 py-3">{t(row.voidedAt ? "marketing_cost_voided" : "marketing_cost_active")}</td>
        <td className="px-3 py-3"><div className="flex min-w-48 flex-wrap gap-1"><button type="button" className={buttonClass} onClick={() => setAuditId(row.id)}>{t("marketing_cost_audit")}</button>{canManageMarketingPage(admin, row.ownerUserId) && <><button type="button" className={buttonClass} disabled={busy} onClick={() => setEditing({ scope: scopeKey, entry: row, link: { id: row.linkId, name: row.linkName, ownerName: row.ownerName, aid: row.aid, productName: row.productName, productCode: row.productCode } })}>{t("common_edit")}</button>{!row.voidedAt && <button type="button" className={buttonClass} disabled={busy} onClick={() => void voidCost(row)}>{t("marketing_cost_void")}</button>}</>}</div></td>
      </tr>)}
      {!data.items.length && <tr><td colSpan={9} className="p-6 text-center text-admin-muted">{t("marketing_cost_empty")}</td></tr>}
    </tbody></table></div><div className="flex items-center justify-between text-xs text-admin-muted"><span>{t("marketing_records", { count: String(data.total) })}</span><div className="flex gap-2"><button type="button" className={buttonClass} disabled={page === 1 || busy} onClick={() => setPage(value => value - 1)}>{t("marketing_previous")}</button><span className="py-2">{page}</span><button type="button" className={buttonClass} disabled={page * 20 >= data.total || busy} onClick={() => setPage(value => value + 1)}>{t("marketing_next")}</button></div></div></>}
    {canCreate && choosing && <Dialog open initialFocus="first" title={t("marketing_cost_choose_link")} onClose={() => setChoosing(false)}><div className="min-w-0 space-y-3">{!linkId && <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); setLinkFilter(linkSearch); setLinkPage(1); }}><input className={fieldClass} aria-label={t("marketing_link_search")} placeholder={t("marketing_link_search")} value={linkSearch} onChange={(event) => setLinkSearch(event.target.value)} /><button className={buttonClass} type="submit">{t("common_search")}</button></form>}{!picker && <p>{t("common_loading")}</p>}{picker?.error && <p role="alert" className="text-sm text-red-700">{picker.error}</p>}{picker?.items.filter(link => canManageMarketingPage(admin, link.ownerUserId)).map(link => <button type="button" key={link.id} className="block w-full rounded-lg border border-admin-border p-3 text-left text-sm" onClick={() => { setChoosing(false); setEditing({ scope: scopeKey, link }); }}><p className="font-medium">{link.name}</p><p className="text-xs text-admin-muted">{link.productName} · {link.productCode} · {link.ownerName} · {link.aid}</p></button>)}{picker && !picker.items.length && !picker.error && <p className="text-sm text-admin-muted">{t("marketing_links_empty")}</p>}{picker && !linkId && <div className="flex justify-end gap-2"><button type="button" className={buttonClass} disabled={linkPage === 1} onClick={() => setLinkPage(value => value - 1)}>{t("marketing_previous")}</button><span className="py-2 text-xs">{linkPage}</span><button type="button" className={buttonClass} disabled={linkPage * 20 >= picker.total} onClick={() => setLinkPage(value => value + 1)}>{t("marketing_next")}</button></div>}</div></Dialog>}
    {canCreate && editing?.scope === scopeKey && <CostForm key={`${scopeKey}:${editing.entry?.id ?? editing.link.id}`} link={editing.link} entry={editing.entry} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setRevision(value => value + 1); setNotice(t("marketing_cost_saved")); }} />}
    {auditId && <Dialog open title={t("marketing_cost_audit")} onClose={() => setAuditId(null)}><div className="min-w-0 space-y-3">{!history && <p>{t("common_loading")}</p>}{history?.error && <p role="alert" className="text-sm text-red-700">{history.error}</p>}{history?.items.map(item => <article key={item.id} className="rounded-lg border border-admin-border p-3"><p className="text-sm font-medium">{t(`marketing_cost_audit_${item.action}`)}</p><p className="mb-3 text-xs text-admin-muted">{item.actor.name} · {new Date(item.createdAt).toLocaleString("en-PH", { timeZone: "Asia/Manila", hour12: false })}</p><div className="grid gap-3 sm:grid-cols-2">{item.before && <div><p className="mb-1 text-xs font-semibold">{t("marketing_cost_before")}</p>{values(item.before)}</div>}<div><p className="mb-1 text-xs font-semibold">{t("marketing_cost_after")}</p>{values(item.after)}</div></div></article>)}</div></Dialog>}
  </section>;
}
