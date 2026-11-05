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
  const [busy, setBusy] = useState(true);
  const [origin] = useState(() => typeof window === "undefined" ? "" : window.location.origin);
  useEffect(() => {
    let alive = true;
    marketingApi.createShortLink({ url: link.path }).then(result => { if (alive) setShortPath(result.path); }).catch(() => { if (alive) setFailed(true); }).finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [link.path, attempt]);
  const fullUrl = origin ? new URL(link.path, origin).href : link.path;
  const shortUrl = shortPath ? (origin ? new URL(shortPath, origin).href : shortPath) : "";
  async function copy(value: string) {
    let ok = false;
    try { ok = await copyText(value); } catch { /* keep the selectable URL */ }
    setNotice(t(ok ? "link_builder_copied" : "common_copy_failed_manual"));
  }
  return <Dialog open initialFocus="first" onClose={onClose} title={t("marketing_post_create_result")}>
    <div className="space-y-4">
      <p className="font-medium">{link.name}</p>
      <p className="text-sm text-admin-muted">{t("marketing_post_create_result_hint")}</p>
      {link.adid && <label className="block space-y-1 text-sm">{t("marketing_link_adid")}<input readOnly onFocus={e => e.currentTarget.select()} className={fieldClass} value={link.adid} /></label>}
      <label className="block space-y-1 text-sm">{t("marketing_post_short_link")}<input readOnly onFocus={e => e.currentTarget.select()} className={fieldClass} value={shortUrl} /></label>
      {busy && <p role="status" className="text-xs">{t("common_loading")}</p>}
      {failed && <p role="alert" className="text-xs text-red-700">{t("marketing_post_short_failed")} <button type="button" disabled={busy} className="underline" onClick={() => { setBusy(true); setFailed(false); setAttempt(v => v + 1); }}>{t("marketing_post_retry_short")}</button></p>}
      <label className="block space-y-1 text-sm">{t("marketing_post_full_link")}<input readOnly onFocus={e => e.currentTarget.select()} className={fieldClass} value={fullUrl} /></label>
      <div className="flex flex-wrap gap-2"><button type="button" className="rounded-lg bg-cta px-3 py-2 text-sm text-white disabled:opacity-40" disabled={!shortUrl} onClick={() => void copy(shortUrl)}>{t("marketing_short_link_copy")}</button><button type="button" className="rounded-lg border border-admin-border px-3 py-2 text-sm" onClick={() => void copy(fullUrl)}>{t("marketing_post_copy_full_link")}</button>{link.adid && <button type="button" className="rounded-lg border border-admin-border px-3 py-2 text-sm" onClick={() => void copy(link.adid!)}>{t("marketing_link_copy_adid")}</button>}</div>
      {notice && <p role="status" className="text-sm">{notice}</p>}
      <div className="flex justify-end gap-2"><button type="button" className="rounded-lg border px-3 py-2 text-sm" onClick={onContinue}>{t("marketing_post_continue")}</button><button type="button" className="rounded-lg bg-cta px-4 py-2 text-sm text-white" onClick={onClose}>{t("common_done")}</button></div>
    </div>
  </Dialog>;
}
