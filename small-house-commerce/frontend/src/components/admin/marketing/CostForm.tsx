"use client";

import { useRef, useState } from "react";
import { Dialog } from "@/components/admin/Dialog";
import { useAdminI18n } from "@/lib/admin-i18n";
import { AdminApiError } from "@/lib/admin-auth";
import { marketingApi, type AdCostRow, type CampaignLinkRow } from "@/lib/marketing-api";

type CostLink = Pick<CampaignLinkRow, "id" | "name" | "ownerName" | "aid" | "productName" | "productCode"> & { createdAt?: string };
const fieldClass = "w-full min-w-0 rounded-lg border border-admin-border bg-white px-3 py-2 text-sm disabled:bg-slate-50";
const dateFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" });
const usdPattern = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;
const fxPattern = /^(?:0|[1-9]\d{0,5})(?:\.\d{1,6})?$/;

export function CostForm({ link, entry, onClose, onSaved }: { link: CostLink; entry?: AdCostRow; onClose: () => void; onSaved: (row: AdCostRow) => void }) {
  const { t } = useAdminI18n();
  const [saved, setSaved] = useState(entry ?? null);
  const [costDate, setDate] = useState(entry?.costDate ?? dateFormat.format(new Date()));
  const [amountUsd, setUsd] = useState(entry?.amountUsd ?? "");
  const [phpPerUsd, setFx] = useState(entry?.phpPerUsd ?? "");
  const [note, setNote] = useState(entry?.note ?? "");
  const [zero, setZero] = useState(entry?.amountUsd === "0.00");
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const operation = useRef(false);

  async function save() {
    if (operation.current) return;
    const usd = zero ? "0.00" : amountUsd.trim();
    const fx = zero ? null : phpPerUsd.trim();
    if (!costDate || !usdPattern.test(usd) || (!zero && (!/[1-9]/.test(usd) || !fxPattern.test(fx!) || !/[1-9]/.test(fx!)))) {
      setError(t("marketing_cost_invalid")); return;
    }
    operation.current = true; setBusy(true); setError(null);
    try {
      const row = await marketingApi.saveCost({ linkId: link.id, costDate, amountUsd: usd, phpPerUsd: fx, note: note.trim() || null, ...(saved ? { expectedVersion: saved.version } : {}) });
      onSaved(row);
    } catch (reason) {
      const changed = reason instanceof AdminApiError && reason.status === 409;
      setConflict(changed);
      setError(changed ? t("marketing_cost_conflict") : reason instanceof Error ? reason.message : String(reason));
    } finally { operation.current = false; setBusy(false); }
  }

  async function reload() {
    if (operation.current) return;
    operation.current = true; setBusy(true);
    try {
      const { items } = await marketingApi.listCosts({ linkId: link.id, dateFrom: costDate, dateTo: costDate, includeVoided: true, page: 1, pageSize: 1 });
      const row = items[0];
      setSaved(row ?? null); setConflict(false);
      if (row) { setUsd(row.amountUsd); setFx(row.phpPerUsd ?? ""); setNote(row.note ?? ""); setZero(row.amountUsd === "0.00"); setError(null); }
      else setError(t("marketing_cost_missing"));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { operation.current = false; setBusy(false); }
  }

  return <Dialog open initialFocus="first" title={t(saved ? "marketing_cost_save" : "marketing_cost_create")} onClose={() => { if (!operation.current) onClose(); }}>
    <form className="min-w-0 space-y-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div className="rounded-lg bg-slate-50 p-3 text-sm"><p className="font-medium">{link.name}</p><p className="text-xs text-admin-muted">{link.productName} · {link.productCode ?? "—"}</p><p className="mt-1">{link.ownerName} · {link.aid}</p></div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {saved?.voidedAt && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{t("marketing_cost_reactivate")}</p>}
      <fieldset disabled={busy} className="grid min-w-0 gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm sm:col-span-2">{t("marketing_cost_date")}<input required type="date" className={fieldClass} min={link.createdAt ? dateFormat.format(new Date(link.createdAt)) : undefined} max={dateFormat.format(new Date())} disabled={Boolean(saved)} value={costDate} onChange={(event) => { setDate(event.target.value); setConflict(false); }} /></label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={zero} onChange={(event) => setZero(event.target.checked)} />{t("marketing_cost_zero")}</label>
        <label className="space-y-1 text-sm">{t("marketing_cost_usd")}<input className={fieldClass} inputMode="decimal" required={!zero} pattern={usdPattern.source} disabled={zero} value={zero ? "0.00" : amountUsd} onChange={(event) => setUsd(event.target.value)} /></label>
        <label className="space-y-1 text-sm">{t("marketing_cost_fx")}<input className={fieldClass} inputMode="decimal" required={!zero} pattern={fxPattern.source} disabled={zero} value={zero ? "" : phpPerUsd} onChange={(event) => setFx(event.target.value)} /></label>
        <label className="space-y-1 text-sm sm:col-span-2">{t("marketing_cost_note")}<textarea className={fieldClass} rows={2} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} /></label>
      </fieldset>
      {saved && <p className="text-sm">{t("marketing_cost_php")}: PHP {saved.amountPhp}</p>}
      <p className="text-xs text-admin-muted">{t("marketing_cost_server_hint")}</p>
      <div className="flex flex-wrap justify-end gap-2">{conflict && <button type="button" className="rounded-lg border border-admin-border px-3 py-2 text-sm" disabled={busy} onClick={() => void reload()}>{t("marketing_reload")}</button>}<button type="button" className="rounded-lg border border-admin-border px-3 py-2 text-sm" disabled={busy} onClick={onClose}>{t("common_cancel")}</button><button type="submit" className="rounded-lg bg-cta px-4 py-2 text-sm font-semibold text-white disabled:opacity-40" disabled={busy}>{t("marketing_cost_save")}</button></div>
    </form>
  </Dialog>;
}
