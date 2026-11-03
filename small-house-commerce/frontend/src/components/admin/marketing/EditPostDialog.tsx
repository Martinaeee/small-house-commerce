"use client";

import { useState } from "react";
import { Dialog } from "@/components/admin/Dialog";
import { useAdminI18n } from "@/lib/admin-i18n";
import { AdminApiError } from "@/lib/admin-auth";
import { marketingApi, type CampaignLinkRow } from "@/lib/marketing-api";

const fieldClass = "w-full min-w-0 rounded-lg border border-admin-border bg-white px-3 py-2 text-sm";

export function EditPostDialog({ link, onClose, onSaved }: { link: CampaignLinkRow; onClose: () => void; onSaved: (row: CampaignLinkRow) => void }) {
  const { t } = useAdminI18n();
  const [name, setName] = useState(link.name);
  const [postDate, setPostDate] = useState(link.postDate ?? "");
  const [postUrl, setPostUrl] = useState(link.postUrl ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (busy || !name.trim()) return;
    setBusy(true); setError(null);
    try {
      onSaved(await marketingApi.updateLink(link.id, {
        name: name.trim(),
        ...(link.sourceType === "FB_POST" ? { postDate: postDate || null, postUrl: postUrl.trim() || null } : {}),
        expectedVersion: link.version,
      }));
    } catch (reason) {
      setError(reason instanceof AdminApiError && reason.status === 409 ? t("marketing_post_conflict") : reason instanceof Error ? reason.message : String(reason));
    } finally { setBusy(false); }
  }

  return <Dialog open initialFocus="first" onClose={() => { if (!busy) onClose(); }} title={t("marketing_post_edit")}>
    <form className="space-y-3" onSubmit={event => { event.preventDefault(); void save(); }}>
      <p className="text-xs text-admin-muted">{t("marketing_post_edit_hint")}</p>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <label className="block space-y-1 text-sm">{t("marketing_internal_name")}<input required maxLength={120} className={fieldClass} value={name} onChange={event => setName(event.target.value)} /></label>
      {link.sourceType === "FB_POST" && <>
        <label className="block space-y-1 text-sm">{t("marketing_post_date")}<input type="date" className={fieldClass} value={postDate} onChange={event => setPostDate(event.target.value)} /></label>
        <label className="block space-y-1 text-sm">{t("marketing_post_url")}<input type="url" maxLength={2048} className={fieldClass} value={postUrl} onChange={event => setPostUrl(event.target.value)} /></label>
      </>}
      <div className="flex justify-end gap-2"><button type="button" className={fieldClass + " w-auto"} disabled={busy} onClick={onClose}>{t("common_cancel")}</button><button type="submit" className="rounded-lg bg-cta px-4 py-2 text-sm font-semibold text-white disabled:opacity-40" disabled={busy || !name.trim()}>{t("common_save")}</button></div>
    </form>
  </Dialog>;
}
