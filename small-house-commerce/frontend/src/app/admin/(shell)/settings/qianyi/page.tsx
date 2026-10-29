"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { Button } from "@/components/ui/Button";
import { useAdminI18n } from "@/lib/admin-i18n";
import {
  adminApi,
  type AdminQianyiJob,
  type AdminQianyiSkuRow,
  type AdminQianyiStatus,
} from "@/lib/admin-api";

const WEBHOOK_URL = "https://luwag.shop/api/v1/qianyi/webhook";

/**
 * Qianyi integration console.
 *
 * SKUs are created in Qianyi by staff; this page only binds an existing code
 * to a local SKU, and the backend verifies that code against the catalog.
 */
export default function QianyiSettingsPage() {
  const { t } = useAdminI18n();
  const [status, setStatus] = useState<AdminQianyiStatus | null>(null);
  const [rows, setRows] = useState<AdminQianyiSkuRow[]>([]);
  const [jobs, setJobs] = useState<AdminQianyiJob[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([
      adminApi.qianyiStatus(),
      adminApi.qianyiSkus(),
      adminApi.qianyiJobs(),
    ])
      .then(([nextStatus, nextRows, nextJobs]) => {
        setStatus(nextStatus);
        setRows(nextRows);
        setJobs(nextJobs);
      })
      .catch(() => setMessage("load failed"));
  }, []);

  const retry = async (id: string) => {
    const result = await adminApi.retryQianyiJob(id);
    setMessage(
      result.ok ? t("qianyi_retried") : t("qianyi_retry_blocked", { reason: result.reason ?? "" }),
    );
    setJobs(await adminApi.qianyiJobs());
  };

  // A job whose create may already have reached Qianyi. The operator must
  // check the ERP first; the backend records who authorized the second create.
  const authorizeRetry = async (id: string) => {
    if (!window.confirm(t("qianyi_authorize_hint"))) return;
    const result = await adminApi.authorizeQianyiCreateRetry(id);
    setMessage(
      result.ok ? t("qianyi_retried") : t("qianyi_retry_blocked", { reason: result.reason ?? "" }),
    );
    setJobs(await adminApi.qianyiJobs());
  };

  // Only valid once every line has a code; the backend refuses otherwise and
  // names the SKUs that are still missing.
  const requeue = async (id: string) => {
    const result = await adminApi.requeueQianyiJob(id);
    setMessage(
      result.ok
        ? t("qianyi_requeued")
        : t("qianyi_requeue_blocked", {
            skus: (result.missing ?? []).join(", ") || (result.reason ?? ""),
          }),
    );
    setJobs(await adminApi.qianyiJobs());
    setRows(await adminApi.qianyiSkus());
  };

  // The only place a mapping can be set: without it a SKU never reaches Qianyi.
  // The backend verifies the code against the catalog while the integration is on.
  const saveMapping = async (id: string, current: string | null, next: string) => {
    const value = next.trim();
    if (value === (current ?? "")) return true;
    try {
      await adminApi.setQianyiMapping(id, value || null);
      setMessage(value ? t("qianyi_mapping_saved", { code: value }) : null);
      setRows(await adminApi.qianyiSkus());
      return true;
    } catch {
      setMessage(t("qianyi_mapping_failed", { code: value }));
      return false;
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t("qianyi_title")} subtitle={t("qianyi_description")} />

      <section className="rounded-lg border border-border bg-surface p-4 text-sm">
        <p>{status?.enabled ? t("qianyi_enabled") : t("qianyi_disabled")}</p>
        <p className="text-muted">
          {t("qianyi_pending", { count: status?.pending ?? 0 })} ·{" "}
          {t("qianyi_failed", { count: status?.failed ?? 0 })} ·{" "}
          {t("qianyi_review", { count: status?.review ?? 0 })} ·{" "}
          {t("qianyi_sent24h", { count: status?.sent24h ?? 0 })}
        </p>
        <p className="mt-2 break-all text-xs text-muted">
          {t("qianyi_webhook")}：{WEBHOOK_URL}
        </p>
      </section>

      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-3 text-sm font-semibold">{t("qianyi_skus_title")}</h2>
        {message ? <p className="mb-2 text-xs text-primary">{message}</p> : null}
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th>{t("qianyi_col_sku")}</th>
              <th>{t("qianyi_col_title")}</th>
              <th>{t("qianyi_col_code")}</th>
              <th>{t("qianyi_col_state")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-border/60">
                <td>{row.skuCode}</td>
                <td>{row.title}</td>
                <td>
                  <input
                    aria-label={`qianyi code for ${row.skuCode}`}
                    defaultValue={row.qianyiSkuCode ?? ""}
                    placeholder="—"
                    onBlur={async (event) => {
                      const input = event.currentTarget;
                      if (!(await saveMapping(row.id, row.qianyiSkuCode, input.value))) {
                        input.value = row.qianyiSkuCode ?? "";
                      }
                    }}
                    className="w-36 rounded border border-border bg-surface px-2 py-1 text-sm"
                  />
                </td>
                <td className={row.ready ? "text-primary" : "text-red-600"}>
                  {row.ready ? t("qianyi_ready") : t("qianyi_missing", { gaps: row.gaps.join(", ") })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-3 text-sm font-semibold">{t("qianyi_jobs_title")}</h2>
        <ul className="space-y-2 text-sm">
          {jobs.map((job) => (
            <li key={job.id} className="flex items-center justify-between gap-3 border-t border-border/60 pt-2">
              <div>
                <p>{t("qianyi_job_status", { kind: job.kind, status: job.status })}</p>
                <p className="text-xs text-muted">
                  {job.order?.orderNumber ?? "—"}
                  {job.lastError ? ` · ${job.lastError}` : ""}
                </p>
              </div>
              {job.status === "FAILED" && job.pendingReview ? (
                <Button size="sm" variant="secondary" onClick={() => authorizeRetry(job.id)}>
                  {t("qianyi_authorize_retry")}
                </Button>
              ) : null}
              {job.status === "FAILED" && !job.pendingReview ? (
                <Button size="sm" onClick={() => retry(job.id)}>
                  {t("qianyi_retry")}
                </Button>
              ) : null}
              {job.status === "SKIPPED" ? (
                <Button size="sm" onClick={() => requeue(job.id)}>
                  {t("qianyi_requeue")}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
