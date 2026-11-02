"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { QianyiSkuTable } from "@/components/admin/qianyi/QianyiSkuTable";
import { QianyiJobsTable, type QianyiJobAction } from "@/components/admin/qianyi/QianyiJobsTable";
import { Button } from "@/components/ui/Button";
import { useAdminI18n } from "@/lib/admin-i18n";
import { copyText } from "@/lib/clipboard";
import { adminApi, type AdminQianyiJob, type AdminQianyiJobFilter, type AdminQianyiSkuRow, type AdminQianyiStatus } from "@/lib/admin-api";

const WEBHOOK_URL = "https://luwag.shop/api/v1/qianyi/webhook";
const FILTERS = ["todo", "all", "pending", "failed", "review", "skipped", "sent24h"] as const;
type SkuFilter = "all" | "unmapped" | "bound" | "gaps";
const isMapped = (row: AdminQianyiSkuRow) => Boolean(row.qianyiSkuCode?.trim());

function matches(job: AdminQianyiJob, filter: AdminQianyiJobFilter) {
  switch (filter) {
    case "todo": return ["PENDING", "SENDING", "FAILED", "SKIPPED"].includes(job.status);
    case "pending": return ["PENDING", "SENDING"].includes(job.status);
    case "failed": return job.status === "FAILED";
    case "review": return job.pendingReview;
    case "skipped": return job.status === "SKIPPED";
    case "sent24h": return job.status === "SENT" && Boolean(job.sentAt) && new Date(job.sentAt!).getTime() >= Date.now() - 86400000;
    default: return true;
  }
}

/** Staff create SKUs in Qianyi; this console only binds codes and handles sync exceptions. */
export default function QianyiSettingsPage() {
  const { t } = useAdminI18n();
  const [status, setStatus] = useState<AdminQianyiStatus | null>(null);
  const [rows, setRows] = useState<AdminQianyiSkuRow[]>([]);
  const [jobs, setJobs] = useState<AdminQianyiJob[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState(false);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [jobsError, setJobsError] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const actionInFlight = useRef(false);
  const catalogRequest = useRef(0);
  const jobsRequest = useRef(0);
  const [search, setSearch] = useState("");
  const [skuFilter, setSkuFilter] = useState<SkuFilter>("all");
  const [jobFilter, setJobFilter] = useState<AdminQianyiJobFilter>("todo");

  const loadCatalog = useCallback(() => {
    const request = ++catalogRequest.current;
    return Promise.all([adminApi.qianyiSkus(), adminApi.qianyiStatus()])
      .then(([nextRows, nextStatus]) => {
        if (request === catalogRequest.current) { setRows(nextRows); setStatus(nextStatus); setCatalogError(false); }
      })
      .catch(() => { if (request === catalogRequest.current) setCatalogError(true); })
      .finally(() => { if (request === catalogRequest.current) setCatalogLoading(false); });
  }, []);

  const loadJobs = useCallback((filter: AdminQianyiJobFilter) => {
    const request = ++jobsRequest.current;
    return adminApi.qianyiJobs(filter)
      .then((nextJobs) => {
        if (request === jobsRequest.current) { setJobs(nextJobs); setJobsError(false); }
      })
      .catch(() => { if (request === jobsRequest.current) setJobsError(true); })
      .finally(() => { if (request === jobsRequest.current) setJobsLoading(false); });
  }, []);

  useEffect(() => {
    const requests = catalogRequest;
    void loadCatalog();
    return () => { requests.current++; };
  }, [loadCatalog]);

  useEffect(() => {
    const requests = jobsRequest;
    void loadJobs(jobFilter);
    return () => { requests.current++; };
  }, [jobFilter, loadJobs]);

  const unmapped = rows.filter((row) => !isMapped(row));
  const visibleRows = useMemo(() => rows.filter((row) => {
    if (skuFilter === "unmapped" && isMapped(row)) return false;
    if (skuFilter === "bound" && !isMapped(row)) return false;
    if (skuFilter === "gaps" && row.ready) return false;
    const term = search.trim().toLowerCase();
    return !term || [row.skuCode, row.title, row.variantName ?? "", row.qianyiSkuCode ?? ""]
      .some((value) => value.toLowerCase().includes(term));
  }), [rows, search, skuFilter]);
  const visibleJobs = jobs.filter((job) => matches(job, jobFilter));

  const copy = async (text: string, success: string) => {
    setMessage(await copyText(text) ? success : t("qianyi_copy_failed"));
  };

  const selectJobs = (filter: AdminQianyiJobFilter) => {
    if (actionInFlight.current) return;
    if (filter !== jobFilter) { setJobsLoading(true); setJobFilter(filter); }
    document.getElementById("qianyi-jobs")?.scrollIntoView?.({ block: "start" });
  };

  const runAction = async (action: QianyiJobAction, id: string, number?: string) => {
    if (actionInFlight.current) return false;
    if (action === "authorize" && !window.confirm(t("qianyi_authorize_hint"))) return false;
    actionInFlight.current = true;
    setBusyId(id);
    setActionMessage(null);
    try {
      let ok = false;
      if (action === "adopt") {
        const result = await adminApi.adoptQianyiJob(id, number!);
        ok = result.ok;
        setActionMessage(ok ? t("qianyi_adopted", { number: number! }) : t("qianyi_adopt_blocked", { reason: result.reason ?? "" }));
      } else if (action === "requeue") {
        const result = await adminApi.requeueQianyiJob(id);
        ok = result.ok;
        setActionMessage(ok ? t("qianyi_requeued") : t("qianyi_requeue_blocked", { skus: result.missing?.join(", ") || result.reason || "" }));
      } else {
        const result = action === "authorize" ? await adminApi.authorizeQianyiCreateRetry(id) : await adminApi.retryQianyiJob(id);
        ok = result.ok;
        setActionMessage(ok ? t("qianyi_retried") : t("qianyi_retry_blocked", { reason: result.reason ?? "" }));
      }
      if (ok) {
        setJobsLoading(true);
        await loadJobs(jobFilter);
        // Refresh counts independently: a failed read is not a failed mutation.
        await adminApi.qianyiStatus().then(setStatus).catch(() => setCatalogError(true));
      }
      return ok;
    } catch {
      setActionMessage(t("qianyi_action_failed"));
      return false;
    } finally {
      actionInFlight.current = false;
      setBusyId(null);
    }
  };

  return (
    <div className="min-w-0 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title={t("qianyi_title")} subtitle={t("qianyi_description")} />
        <Button size="sm" variant="secondary" disabled={catalogLoading || jobsLoading || busyId !== null}
          onClick={() => { setCatalogLoading(true); setJobsLoading(true); void loadCatalog(); void loadJobs(jobFilter); }}>{t("qianyi_refresh")}</Button>
      </div>

      <section className="rounded-lg border border-border bg-surface p-4 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${status?.enabled ? "bg-emerald-100 text-emerald-800" : "bg-stone-100 text-stone-600"}`}>
            {status === null ? t("qianyi_loading") : t(status.enabled ? "qianyi_enabled" : "qianyi_disabled")}
          </span>
          {status ? <span className="font-medium">{t("qianyi_bound_progress", { bound: rows.length - unmapped.length, total: rows.length })}</span> : null}
          <span className="text-xs text-muted">{t("qianyi_auto_push_hint")}</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {(["pending", "failed", "review", "skipped", "sent24h"] as const).map((filter) => (
            <button key={filter} type="button" disabled={!status} aria-pressed={jobFilter === filter}
              onClick={() => selectJobs(filter)} className={`rounded border px-3 py-2 text-xs disabled:opacity-50 ${jobFilter === filter ? "border-cta bg-cta text-cta-foreground" : "border-border hover:bg-border/20"}`}>
              {t(`qianyi_${filter}`, { count: status?.[filter] ?? 0 })}
            </button>
          ))}
        </div>
        {(status?.callbacks ?? 0) > 0 ? <p className="mt-3 text-xs text-red-700">{t("qianyi_callbacks", { count: status!.callbacks })}</p> : null}
        <details className="mt-4 border-t border-border/60 pt-3 text-xs text-muted">
          <summary className="cursor-pointer select-none font-medium">{t("qianyi_guide_title")}</summary>
          <p className="mt-2 max-w-3xl leading-relaxed">{t("qianyi_guide_body")}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="break-all">{t("qianyi_webhook")}：{WEBHOOK_URL}</span>
            <Button size="sm" variant="secondary" onClick={() => void copy(WEBHOOK_URL, t("qianyi_copied"))}>{t("qianyi_copy_webhook")}</Button>
          </div>
        </details>
      </section>

      {message ? <p role="status" className="text-sm text-primary">{message}</p> : null}
      {catalogError ? <p role="alert" className="text-sm text-red-700">{t("qianyi_load_failed")}</p> : null}

      <section className="min-w-0 rounded-lg border border-border bg-surface p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{t("qianyi_skus_title")}</h2>
          <span className="text-xs text-muted">{t("qianyi_save_hint")}</span>
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input value={search} onChange={(event) => setSearch(event.target.value)}
            aria-label={t("qianyi_search_placeholder")} placeholder={t("qianyi_search_placeholder")}
            className="h-9 w-full rounded border border-border bg-surface px-3 text-sm sm:w-64" />
          {(["all", "unmapped", "bound", "gaps"] as const).map((filter) => (
            <button key={filter} type="button" aria-pressed={skuFilter === filter} onClick={() => setSkuFilter(filter)}
              className={`rounded-full border px-3 py-1.5 text-xs ${skuFilter === filter ? "border-cta bg-cta text-cta-foreground" : "border-border text-muted hover:text-ink"}`}>
              {t(`qianyi_filter_${filter}`)}
            </button>
          ))}
          <div className="sm:ml-auto">
            <Button size="sm" variant="secondary" disabled={!unmapped.length || catalogLoading}
              onClick={() => void copy(unmapped.map((row) => [row.skuCode, row.title, row.variantName].filter(Boolean).join(" — ")).join("\n"), t("qianyi_copied_unmapped", { count: unmapped.length }))}>
              {t("qianyi_copy_unmapped")}
            </Button>
          </div>
        </div>
        <p className="mb-3 text-xs text-muted">{t("qianyi_rows_count", { count: visibleRows.length, total: rows.length })}</p>
        {catalogLoading ? <p role="status" className="py-6 text-sm text-muted">{t("qianyi_loading")}</p> : (
          visibleRows.length ? <QianyiSkuTable rows={visibleRows} onMapped={(id, code) => {
            // Invalidate any older catalogue read before applying this successful write.
            catalogRequest.current++;
            setRows((current) => current.map((row) => row.id === id ? { ...row, qianyiSkuCode: code } : row));
          }} /> : <p className="py-6 text-sm text-muted">{t("qianyi_no_rows")}</p>
        )}
      </section>

      <section id="qianyi-jobs" className="min-w-0 scroll-mt-24 rounded-lg border border-border bg-surface p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{t("qianyi_jobs_title")}</h2>
          <span className="text-xs text-muted">{t("qianyi_jobs_limit")}</span>
        </div>
        <div className="mb-4 flex flex-wrap gap-2">
          {FILTERS.map((filter) => (
            <button key={filter} type="button" disabled={busyId !== null} aria-pressed={jobFilter === filter}
              onClick={() => selectJobs(filter)} className={`rounded-full border px-3 py-1.5 text-xs ${jobFilter === filter ? "border-cta bg-cta text-cta-foreground" : "border-border text-muted hover:text-ink"}`}>
              {t(`qianyi_jobs_filter_${filter}`)}
            </button>
          ))}
        </div>
        {actionMessage ? <p role="status" className="mb-3 text-sm">{actionMessage}</p> : null}
        {jobsError ? <p role="alert" className="mb-3 text-sm text-red-700">{t("qianyi_jobs_load_failed")}</p> : null}
        {jobsLoading ? <p role="status" className="py-6 text-sm text-muted">{t("qianyi_loading")}</p> : jobsError ? null : visibleJobs.length ? (
          <QianyiJobsTable jobs={visibleJobs} busyId={busyId} onAction={runAction} />
        ) : <p className="py-6 text-sm text-muted">{t(jobs.length === 0 && !(status?.pending || status?.failed || status?.review || status?.skipped || status?.sent24h) ? "qianyi_jobs_empty" : "qianyi_jobs_none_todo")}</p>}
      </section>
    </div>
  );
}
