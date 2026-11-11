"use client";
import { useEffect, useState } from "react";
import { Dialog } from "@/components/admin/Dialog";
import { useAdminI18n } from "@/lib/admin-i18n";
import { copyText } from "@/lib/clipboard";
import { marketingApi, type CampaignLinkRow } from "@/lib/marketing-api";

const fieldClass = "w-full min-w-0 rounded-lg border border-admin-border bg-gray-50 px-3 py-2 text-sm";
export function PostLinkResultDialog({ link, onClose, onContinue }: { link: CampaignLinkRow; onClose: () => void; onContinue: () => void }) {
  const { t } = useAdminI18n();
  const [shortPath, setShortPath] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(() => link.sourceType === "FB_POST" && link.attributionMode === "CL");
  const [origin] = useState(() => typeof window === "undefined" ? "" : window.location.origin);
  const isMetaAd = link.sourceType === "META_AD";
  useEffect(() => {
    // Only Facebook-post links keep the short-link entrance; Meta ads use the
    // clean URL + CL/AID parameters.
    if (link.sourceType !== "FB_POST" || link.attributionMode !== "CL") return;
    let alive = true;
    marketingApi.createShortLink({ url: link.path }).then(result => { if (alive) setShortPath(result.path); }).catch(() => { if (alive) setFailed(true); }).finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [link.sourceType, link.attributionMode, link.path, attempt]);
  const fullUrl = origin ? new URL(link.path, origin).href : link.path;
  const shortUrl = shortPath ? (origin ? new URL(shortPath, origin).href : shortPath) : "";
  const cl = link.cl ?? link.code;
  const cleanUrl = isMetaAd && link.cleanPath ? (origin ? new URL(link.cleanPath, origin).href : link.cleanPath) : null;
  const metaParameters = isMetaAd ? link.metaUrlParameters : null;
  async function copy(value: string) {
    let ok = false;
    try { ok = await copyText(value); } catch { /* keep the selectable value */ }
    setNotice(t(ok ? "link_builder_copied" : "common_copy_failed_manual"));
  }
  return <Dialog open initialFocus="first" onClose={onClose} title={t("marketing_post_create_result")}>
    <div className="space-y-4">
      <p className="font-medium">{link.name}</p>
      <p className="text-sm text-admin-muted">{t("marketing_post_create_result_hint")}</p>
      {isMetaAd ? <>
        <label className="block space-y-1 text-sm">{t("link_result_landing_url")}<input readOnly onFocus={e => e.currentTarget.select()} className={fieldClass} value={cleanUrl ?? ""} /></label>
        <label className="block space-y-1 text-sm">{t("link_result_cl")}<input readOnly onFocus={e => e.currentTarget.select()} className={fieldClass} value={cl} /></label>
        <label className="block space-y-1 text-sm">{t("link_result_aid")}<input readOnly onFocus={e => e.currentTarget.select()} className={fieldClass} value={link.aid} /></label>
        <label className="block space-y-1 text-sm">{t("link_result_meta_params")}<textarea readOnly rows={2} onFocus={e => e.currentTarget.select()} className={fieldClass} value={metaParameters ?? ""} /><span className="text-xs text-admin-muted">{t("link_result_meta_params_hint")}</span></label>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="rounded-lg bg-cta px-3 py-2 text-sm text-white" disabled={!cleanUrl} onClick={() => cleanUrl && void copy(cleanUrl)}>{t("link_result_copy_url")}</button>
          <button type="button" className="rounded-lg border border-admin-border px-3 py-2 text-sm" onClick={() => void copy(cl)}>{t("link_result_copy_cl")}</button>
          <button type="button" className="rounded-lg border border-admin-border px-3 py-2 text-sm" onClick={() => void copy(link.aid)}>{t("link_result_copy_aid")}</button>
          <button type="button" className="rounded-lg border border-admin-border px-3 py-2 text-sm" disabled={!metaParameters} onClick={() => metaParameters && void copy(metaParameters)}>{t("link_result_copy_meta")}</button>
        </div>
      </> : <>
        {link.adid && <label className="block space-y-1 text-sm">{t("marketing_link_adid")}<input readOnly onFocus={e => e.currentTarget.select()} className={fieldClass} value={link.adid} /></label>}
        {link.attributionMode === "CL" && <label className="block space-y-1 text-sm">{t("marketing_post_short_link")}<input readOnly onFocus={e => e.currentTarget.select()} className={fieldClass} value={shortUrl} /></label>}
        {link.attributionMode === "CL" && busy && <p role="status" className="text-xs">{t("common_loading")}</p>}
        {link.attributionMode === "CL" && failed && <p role="alert" className="text-xs text-red-700">{t("marketing_post_short_failed")} <button type="button" disabled={busy} className="underline" onClick={() => { setBusy(true); setFailed(false); setAttempt(v => v + 1); }}>{t("marketing_post_retry_short")}</button></p>}
        <label className="block space-y-1 text-sm">{t("marketing_post_full_link")}<input readOnly onFocus={e => e.currentTarget.select()} className={fieldClass} value={fullUrl} /></label>
        <div className="flex flex-wrap gap-2">{link.attributionMode === "CL" && <button type="button" className="rounded-lg bg-cta px-3 py-2 text-sm text-white disabled:opacity-40" disabled={!shortUrl} onClick={() => void copy(shortUrl)}>{t("marketing_short_link_copy")}</button>}<button type="button" className="rounded-lg border border-admin-border px-3 py-2 text-sm" onClick={() => void copy(fullUrl)}>{t("marketing_post_copy_full_link")}</button>{link.adid && <button type="button" className="rounded-lg border border-admin-border px-3 py-2 text-sm" onClick={() => void copy(link.adid!)}>{t("marketing_link_copy_adid")}</button>}</div>
      </>}
      {notice && <p role="status" className="text-sm">{notice}</p>}
      <div className="flex justify-end gap-2"><button type="button" className="rounded-lg border px-3 py-2 text-sm" onClick={onContinue}>{t("marketing_post_continue")}</button><button type="button" className="rounded-lg bg-cta px-4 py-2 text-sm text-white" onClick={onClose}>{t("common_done")}</button></div>
    </div>
  </Dialog>;
}
