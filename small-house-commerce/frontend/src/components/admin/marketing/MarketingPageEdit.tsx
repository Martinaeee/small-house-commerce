"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import type { Product } from "@/lib/api";
import { AdminApiError } from "@/lib/admin-auth";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { useAdminI18n } from "@/lib/admin-i18n";
import { canManageMarketingPage, marketingApi, type MarketingPageDetail, type MarketingPerformanceQuery } from "@/lib/marketing-api";
import { fromPuckData, toPuckData, type LandingContent } from "@/lib/marketing-content";
import { PublishBar } from "./PublishBar";
import { SyncFromProductDialog } from "./SyncFromProductDialog";
import { CampaignLinksList } from "./CampaignLinksList";
import { AdCostsList } from "./AdCostsList";
import { MarketingPerformanceDashboard } from "./MarketingPerformanceDashboard";

const MarketingCanvas = dynamic(() => import("./MarketingCanvas"), { ssr: false });
const canonical = (content: LandingContent) => fromPuckData(toPuckData(content));
const manilaInput = (iso: string | null) => iso ? new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 16) : "";
const manilaIso = (value: string) => value ? `${value}:00+08:00` : null;
const fieldClass = "w-full rounded-lg border border-admin-border bg-white px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-500";
const performanceViews = ["costs", "performance"] as const;

interface Editing {
  scopeKey: string;
  page: MarketingPageDetail;
  content: LandingContent;
  name: string;
  product: Product | null;
  previewReady: boolean;
  uploading: boolean;
}

export default function MarketingPageEdit({ pageId }: { pageId: string }) {
  const { admin } = useAdminAuth();
  const { t } = useAdminI18n();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [step, setStep] = useState<"CONTENT" | "PUBLISH" | "LINKS" | "PERFORMANCE">("CONTENT");
  const [moreSettings, setMoreSettings] = useState(false);
  const [accountView, setAccountView] = useState<"costs" | "performance">("costs");
  const [linksCount, setLinksCount] = useState<number | null>(null);
  const [performanceQuery, setPerformanceQuery] = useState<MarketingPerformanceQuery | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [loadVersion, setLoadVersion] = useState(0);
  const [validation, setValidation] = useState<{ scopeKey: string; input: string; content: LandingContent | null } | null>(null);
  const scopeKey = JSON.stringify([pageId, admin?.id, admin?.permissions ?? []]);
  const operation = useRef<object | null>(null);
  const legacyDraftMessage = useEffectEvent(() => t("marketing_legacy_draft"));
  const onUploadingChange = useCallback((uploading: boolean) => setEditing(current => current?.scopeKey === scopeKey ? { ...current, uploading } : current), [scopeKey]);

  useEffect(() => {
    let alive = true;
    operation.current = null;
    void (async () => {
      const page = await marketingApi.getPage(pageId);
      if (!alive) return;
      setBusy(false); setError(null); setNotice(null); setSyncOpen(false); setAccountView("costs");
      setValidation(null); setPreviewError(false); setMoreSettings(false); setLinksCount(null); setPerformanceQuery(null);
      if (!page.draftContent) { setEditing(null); setError(legacyDraftMessage()); return; }
      setEditing({ scopeKey, page, content: canonical(page.draftContent), name: page.name, product: null, previewReady: false, uploading: false });
      if (page.productStatus !== "ACTIVE") return;
      try {
        const preview = await marketingApi.getPreview(pageId);
        if (alive) setEditing((current) => current?.scopeKey === scopeKey ? { ...current, product: preview.product, previewReady: true } : current);
      } catch {
        if (alive) setPreviewError(true);
      }
    })().catch((reason: unknown) => { if (alive) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { alive = false; };
  }, [pageId, loadVersion, scopeKey]);

  const currentEditing = editing?.scopeKey === scopeKey ? editing : null;
  const locked = busy || Boolean(currentEditing?.uploading);
  const canManage = currentEditing ? canManageMarketingPage(admin, currentEditing.page.ownerUserId) : false;
  const contentInput = currentEditing ? JSON.stringify(currentEditing.content) : null;
  const contentChanged = currentEditing ? contentInput !== JSON.stringify(canonical(currentEditing.page.draftContent!)) : false;
  const unsaved = currentEditing ? currentEditing.name !== currentEditing.page.name || contentChanged : false;
  const needsValidation = canManage && contentChanged;
  const currentValidation = validation?.scopeKey === scopeKey && validation.input === contentInput ? validation : null;

  useEffect(() => {
    if (!needsValidation || !contentInput) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      void marketingApi.validate(pageId, JSON.parse(contentInput) as LandingContent).then((content) => {
        if (alive) setValidation({ scopeKey, input: contentInput, content });
      }).catch(() => {
        if (alive) setValidation({ scopeKey, input: contentInput, content: null });
      });
    }, 250);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [pageId, scopeKey, contentInput, needsValidation]);

  async function mutate(action: "save" | "publish" | "disable" | { sourceKeys: string[]; insertBeforeId?: string | null }) {
    if (!editing || editing.scopeKey !== scopeKey || editing.uploading || !canManage || operation.current) return;
    const request = {};
    operation.current = request;
    setBusy(true); setError(null); setNotice(null);
    try {
      const page = typeof action === "object"
        ? await marketingApi.sync(pageId, action.sourceKeys, editing.page.version, action.insertBeforeId)
        : action === "save"
          ? await marketingApi.saveDraft(pageId, editing.content, editing.page.version, editing.name)
          : action === "publish"
            ? await marketingApi.publish(pageId, editing.page.version)
            : await marketingApi.disable(pageId, editing.page.version);
      if (operation.current !== request) return;
      setEditing((current) => current?.scopeKey === scopeKey ? action === "disable" ? { ...current, page } : { ...current, page, name: page.name, content: canonical(page.draftContent!) } : current);
      setSyncOpen(false);
      setNotice(t(typeof action === "object" ? "marketing_sync_done" : action === "save" ? "marketing_saved" : action === "publish" ? "marketing_published" : "marketing_disabled"));
    } catch (reason) {
      if (operation.current === request) setError(reason instanceof AdminApiError && reason.status === 409 ? t("marketing_conflict") : reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (operation.current === request) { operation.current = null; setBusy(false); }
    }
  }

  function reload() {
    if (unsaved && !window.confirm(t("marketing_discard_confirm"))) return;
    setEditing(null); setNotice(null); setLoadVersion((value) => value + 1);
  }

  if (!editing || editing.scopeKey !== scopeKey) return <div className="p-6">{error ? <><p role="alert">{error}</p><button type="button" onClick={reload}>{t("marketing_reload")}</button></> : <p>{t("marketing_loading")}</p>}</div>;
  const { page, content, product } = editing;
  const input = (key: "seoTitle" | "seoDescription" | "startAt" | "endAt", value: string | null) => setEditing((current) => current ? { ...current, content: { ...current.content, [key]: value } } : current);
  const steps = [
    { id: "CONTENT", label: t("marketing_step_content") },
    { id: "PUBLISH", label: t("marketing_step_publish") },
    { id: "LINKS", label: t("marketing_step_links") },
    { id: "PERFORMANCE", label: t("marketing_step_performance") },
  ] as const;
  const scopeParams = new URLSearchParams({ productId: page.productId });
  const optimizerParams = new URLSearchParams();
  if (page.ownerUserId) optimizerParams.set("owner", page.ownerUserId);
  if (performanceQuery) {
    const dateParams = { preset: performanceQuery.preset, from: performanceQuery.from, to: performanceQuery.to };
    for (const [key, value] of Object.entries(dateParams)) if (value) { scopeParams.set(key, value); optimizerParams.set(key, value); }
  }
  const compareHref = `/admin/marketing/compare?${scopeParams}`;
  const optimizersHref = `/admin/marketing/optimizers?${optimizerParams}`;

  return <div className="min-w-0 px-4 pb-6 md:px-6">
    <PublishBar page={page} canManage={canManage} busy={locked} unsaved={unsaved} canPublish={page.productStatus === "ACTIVE" && editing.previewReady} onSave={() => void mutate("save")} onPublish={() => void mutate("publish")} onDisable={() => void mutate("disable")} />
    <div className="my-3 space-y-2 text-sm">
      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800"><p>{error}</p><button type="button" className="mt-2 underline" disabled={locked} onClick={reload}>{t("marketing_reload")}</button></div>}
      {notice && <p role="status" className="text-emerald-700">{notice}</p>}
      {page.productStatus !== "ACTIVE" && <p className="rounded-lg bg-amber-50 p-3 text-amber-800">{t("marketing_inactive_parent")}</p>}
      {previewError && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-amber-800">{t("marketing_product_error")}</p>}
      {!canManage && <p className="text-admin-muted">{t("marketing_read_only")}</p>}
      {editing.uploading && <p role="status" className="text-amber-700">{t("marketing_media_pending")}</p>}
      {unsaved && <p className="text-amber-700">{t("marketing_save_first")}</p>}
    </div>
    <nav aria-label={t("marketing_steps")} className="mb-3 flex gap-1 overflow-x-auto whitespace-nowrap border-b border-admin-border">
      {steps.map((item, index) => <button key={item.id} type="button" aria-current={step === item.id ? "step" : undefined} disabled={locked} className={`border-b-2 px-4 py-3 text-sm disabled:opacity-40 ${step === item.id ? "border-cta font-semibold text-cta" : "border-transparent text-admin-muted"}`} onClick={() => setStep(item.id)}>{index + 1} {item.label}</button>)}
    </nav>
    {editing.uploading && <p role="status" className="mb-3 text-xs text-amber-700">{t("marketing_step_locked_uploading")}</p>}
    {step === "CONTENT" && <>
      <fieldset disabled={!canManage || locked} className="mb-3 grid max-w-3xl gap-4 rounded-xl border border-admin-border bg-white p-4 md:grid-cols-2">
        <label className="space-y-1 text-sm md:col-span-2">{t("marketing_internal_name")}<input className={fieldClass} maxLength={120} value={editing.name} onChange={(event) => setEditing((current) => current ? { ...current, name: event.target.value } : current)} /></label>
      </fieldset>
      <div className="mb-3 max-w-3xl">
        <button type="button" aria-expanded={moreSettings} className="rounded-lg border border-admin-border px-3 py-2 text-sm" onClick={() => setMoreSettings((value) => !value)}>{t("marketing_more_settings")}</button>
        {moreSettings && <fieldset disabled={!canManage || locked} className="mt-2 grid gap-4 rounded-xl border border-admin-border bg-white p-4 md:grid-cols-2">
          <label className="space-y-1 text-sm md:col-span-2">{t("marketing_seo_title")}<input className={fieldClass} maxLength={200} value={content.seoTitle ?? ""} onChange={(event) => input("seoTitle", event.target.value || null)} /></label>
          <label className="space-y-1 text-sm md:col-span-2">{t("marketing_seo_description")}<textarea className={fieldClass} rows={3} maxLength={300} value={content.seoDescription ?? ""} onChange={(event) => input("seoDescription", event.target.value || null)} /></label>
          <label className="space-y-1 text-sm">{t("marketing_start_at")}<input className={fieldClass} type="datetime-local" value={manilaInput(content.startAt)} onChange={(event) => input("startAt", manilaIso(event.target.value))} /></label>
          <label className="space-y-1 text-sm">{t("marketing_end_at")}<input className={fieldClass} type="datetime-local" value={manilaInput(content.endAt)} onChange={(event) => input("endAt", manilaIso(event.target.value))} /></label>
          <p className="text-xs text-admin-muted md:col-span-2">{t("marketing_schedule_hint")}</p>
        </fieldset>}
      </div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-amber-700">{t("marketing_preview_notice")}</p>
        {needsValidation && !currentValidation && <p role="status" className="text-xs text-admin-muted">{t("marketing_preview_validating")}</p>}
        {needsValidation && currentValidation?.content === null && <p role="alert" className="text-xs text-amber-700">{t("marketing_preview_validation_error")}</p>}
        {canManage && <button type="button" className="rounded-lg border border-admin-border px-3 py-2 text-xs disabled:opacity-40" disabled={locked || unsaved} onClick={() => { setError(null); setSyncOpen(true); }}>{t("marketing_sync")}</button>}
      </div>
      <h2 className="text-sm font-medium">{t("marketing_canvas_preview")}</h2>
      <p className="mb-2 text-xs text-admin-muted">{t("marketing_canvas_empty_hint")}</p>
      <div inert={locked}><MarketingCanvas pageId={pageId} onUploadingChange={onUploadingChange} key={`${scopeKey}:${page.version}`} content={content} approvedContent={page.draftContent!} validatedPreview={needsValidation ? currentValidation?.content ?? null : null} product={product} readOnly={!canManage} onChange={(next) => setEditing((current) => current?.scopeKey === scopeKey ? { ...current, content: next } : current)} /></div>
    </>}
    {step === "PUBLISH" && <section className="max-w-3xl space-y-3">
      <div className="rounded-xl border border-admin-border bg-white p-4 text-sm">
        <p className={unsaved ? "font-medium text-amber-700" : "font-medium"}>{t(unsaved ? "marketing_local_unsaved" : "marketing_step_publish_local_clean")}</p>
      </div>
      <div className="rounded-xl border border-admin-border bg-white p-4 text-sm">
        <p className="font-medium">{t("marketing_saved_preview")}</p>
        <p className="mt-1 text-admin-muted">{t("marketing_step_publish_saved")}</p>
        <a className="mt-2 inline-block rounded-lg border border-admin-border px-3 py-2 text-xs" href={`/admin/marketing/${encodeURIComponent(page.id)}/preview`} target="_blank" rel="noopener noreferrer">{t("marketing_saved_preview")}</a>
      </div>
      <div className="rounded-xl border border-admin-border bg-white p-4 text-sm">
        <p className="font-medium">{t("marketing_public_preview")}</p>
        <p className="mt-1 text-admin-muted">{t("marketing_step_publish_published")}</p>
        {page.publishedRevision > 0
          ? <a className="mt-2 inline-block rounded-lg border border-admin-border px-3 py-2 text-xs" href={`/lp/${encodeURIComponent(page.slug)}`} target="_blank" rel="noopener noreferrer">{t("marketing_public_preview")}</a>
          : <p className="mt-1 text-admin-muted">{t("marketing_step_publish_not_yet")}</p>}
      </div>
    </section>}
    {step === "LINKS" && <section className="space-y-3">
      {page.effectiveStatus === "SCHEDULED" && page.startAt && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{t("marketing_step_links_scheduled", { time: new Date(page.startAt).toLocaleString("en-PH", { timeZone: "Asia/Manila", hour12: false }) })}</p>}
      <CampaignLinksList productId={page.productId} landingPageId={page.id} onLoaded={setLinksCount} />
      {linksCount === 0 && <div className="rounded-xl border border-admin-border bg-white p-4 text-sm">
        <p>{t(page.publishedRevision > 0 ? "marketing_step_links_empty" : "marketing_step_links_empty_draft")}</p>
        <button type="button" className="mt-2 rounded-lg border border-admin-border px-3 py-2 text-xs" onClick={() => setStep("PERFORMANCE")}>{t("marketing_next_performance")}</button>
      </div>}
    </section>}
    {step === "PERFORMANCE" && <section className="space-y-4">
      <p className="text-xs text-admin-muted">{t("marketing_performance_step_hint")}</p>
      <div className="flex flex-wrap gap-2">
        <Link className="rounded-lg border border-admin-border px-3 py-2 text-xs" href={compareHref}>{t("marketing_nav_compare")}</Link>
        <Link className="rounded-lg border border-admin-border px-3 py-2 text-xs" href={optimizersHref}>{t("marketing_nav_optimizers")}</Link>
      </div>
      <div role="tablist" aria-label={t("marketing_step_performance")} className="flex gap-1 border-b border-admin-border">
        {performanceViews.map((view, index) => <button key={view} id={`performance-${view}`} type="button" role="tab" aria-selected={accountView === view} aria-controls="performance-panel" tabIndex={accountView === view ? 0 : -1} className={`border-b-2 px-3 py-2 text-sm ${accountView === view ? "border-cta font-semibold text-cta" : "border-transparent text-admin-muted"}`} onClick={() => setAccountView(view)} onKeyDown={event => {
          const move = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
          const target = event.key === "Home" ? 0 : event.key === "End" ? performanceViews.length - 1 : move ? (index + move + performanceViews.length) % performanceViews.length : null;
          if (target === null) return;
          event.preventDefault(); setAccountView(performanceViews[target]); document.getElementById(`performance-${performanceViews[target]}`)?.focus();
        }}>{t(view === "costs" ? "marketing_costs" : "marketing_performance_heading_page")}</button>)}
      </div>
      <div key={`${scopeKey}:${accountView}`} id="performance-panel" role="tabpanel" aria-labelledby={`performance-${accountView}`}>
        {accountView === "costs" && <AdCostsList productId={page.productId} landingPageId={page.id} />}
        {accountView === "performance" && <MarketingPerformanceDashboard view="PRODUCT" productId={page.productId} landingPageId={page.id} embedded onSelectionChange={setPerformanceQuery} />}
      </div>
    </section>}
    {syncOpen && <SyncFromProductDialog pageId={pageId} content={content} busy={locked} error={error} onClose={() => setSyncOpen(false)} onSync={(sourceKeys, insertBeforeId) => void mutate({ sourceKeys, insertBeforeId })} />}
  </div>;
}
