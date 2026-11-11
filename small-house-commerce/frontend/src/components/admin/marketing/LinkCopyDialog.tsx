"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Dialog } from "@/components/admin/Dialog";
import { useAdminI18n } from "@/lib/admin-i18n";
import { copyText } from "@/lib/clipboard";
import { marketingApi, type CampaignLinkRow } from "@/lib/marketing-api";

const fieldClass = "w-full min-w-0 rounded-lg border border-admin-border bg-gray-50 px-3 py-2 text-sm";
const buttonClass = "shrink-0 rounded-md border border-admin-border px-2 py-1.5 text-xs disabled:opacity-40";

function Field({ label, value, onCopy, copyLabel, children }: {
  label: string;
  value?: string;
  onCopy?: () => void;
  copyLabel?: string;
  children?: ReactNode;
}) {
  return <div className="space-y-1 text-sm">
    <p className="text-xs text-admin-muted">{label}</p>
    <div className="flex items-start gap-2">
      {children ?? <input readOnly value={value ?? ""} onFocus={event => event.currentTarget.select()} className={fieldClass} />}
      {onCopy && <button type="button" className={buttonClass} onClick={onCopy}>{copyLabel}</button>}
    </div>
  </div>;
}

/** All copyable values for one campaign link, titled by the link name. */
export function LinkCopyDialog({ link, onClose }: { link: CampaignLinkRow; onClose: () => void }) {
  const { t } = useAdminI18n();
  const [shortPath, setShortPath] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [origin] = useState(() => typeof window === "undefined" ? "" : window.location.origin);

  useEffect(() => {
    let alive = true;
    marketingApi.createShortLink({ url: link.path })
      .then(result => { if (alive) setShortPath(result.path); })
      .catch(() => { if (alive) setFailed(true); })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [link.path, attempt]);

  const absolute = (path: string) => origin ? new URL(path, origin).href : path;
  const cl = link.cl ?? link.code;
  const cleanUrl = link.cleanPath ? absolute(link.cleanPath) : null;
  const metaParameters = link.metaUrlParameters ?? null;
  const fullUrl = absolute(link.path);
  const shortUrl = shortPath ? absolute(shortPath) : null;

  async function copy(value: string) {
    let ok = false;
    try { ok = await copyText(value); } catch { /* keep selectable */ }
    setNotice(t(ok ? "link_builder_copied" : "common_copy_failed_manual"));
  }

  return <Dialog open title={link.name} onClose={onClose}>
    <div className="space-y-3">
      <p className="text-sm text-admin-muted">{t("marketing_link_copy_dialog_subtitle")}</p>
      {cleanUrl && <Field label={t("link_result_landing_url")} value={cleanUrl} copyLabel={t("link_result_copy_url")} onCopy={() => void copy(cleanUrl)} />}
      <Field label={t("link_result_cl")} value={cl} copyLabel={t("link_result_copy_cl")} onCopy={() => void copy(cl)} />
      <Field label={t("link_result_aid")} value={link.aid} copyLabel={t("link_result_copy_aid")} onCopy={() => void copy(link.aid)} />
      {metaParameters && <Field label={t("link_result_meta_params")} copyLabel={t("link_result_copy_meta")} onCopy={() => void copy(metaParameters)}>
        <textarea readOnly rows={2} onFocus={event => event.currentTarget.select()} className={fieldClass} value={metaParameters} />
      </Field>}
      <Field label={t("marketing_link_full_path")} value={fullUrl} copyLabel={t("marketing_link_copy_url")} onCopy={() => void copy(fullUrl)} />
      <Field
        label={t("marketing_link_short_link")}
        copyLabel={t("marketing_short_link_copy")}
        onCopy={shortUrl ? () => void copy(shortUrl) : undefined}
      >
        {busy
          ? <p role="status" className="text-xs">{t("common_loading")}</p>
          : failed
            ? <div className="flex items-center gap-2"><p role="alert" className="text-xs text-red-700">{t("marketing_post_short_failed")}</p><button type="button" className={buttonClass} onClick={() => { setBusy(true); setFailed(false); setAttempt(value => value + 1); }}>{t("marketing_post_retry_short")}</button></div>
            : <input readOnly value={shortUrl ?? ""} onFocus={event => event.currentTarget.select()} className={fieldClass} />}
      </Field>
      {link.adid && <Field label={t("marketing_link_adid")} value={link.adid} copyLabel={t("marketing_link_copy_adid")} onCopy={() => void copy(link.adid!)} />}
      {metaParameters && <p className="text-xs text-admin-muted">{t("link_result_meta_params_hint")}</p>}
      {notice && <p role="status" className="text-sm">{notice}</p>}
      <div className="flex justify-end"><button type="button" className="rounded-lg bg-cta px-4 py-2 text-sm text-white" onClick={onClose}>{t("common_close")}</button></div>
    </div>
  </Dialog>;
}
