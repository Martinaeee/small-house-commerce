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
 * The product-creation table is a gate, not a batch job: a row is only sent to
 * Qianyi when the operator ticks it, and rows missing weight or dimensions are
 * disabled rather than filled with guesses.
 */
export default function QianyiSettingsPage() {
  const { t } = useAdminI18n();
  const [status, setStatus] = useState<AdminQianyiStatus | null>(null);
  const [rows, setRows] = useState<AdminQianyiSkuRow[]>([]);
  const [jobs, setJobs] = useState<AdminQianyiJob[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
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

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    setBusy(true);
    try {
      const { results } = await adminApi.createQianyiSkus([...selected]);
      const ok = results.filter((result) => result.ok).length;
      setMessage(t("qianyi_created", { ok, total: results.length }));
      setSelected(new Set());
      setRows(await adminApi.qianyiSkus());
    } finally {
      setBusy(false);
    }
  };

  const retry = async (id: string) => {
    await adminApi.retryQianyiJob(id);
    setJobs(await adminApi.qianyiJobs());
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t("qianyi_title")} subtitle={t("qianyi_description")} />

      <section className="rounded-lg border border-border bg-surface p-4 text-sm">
        <p>{status?.enabled ? t("qianyi_enabled") : t("qianyi_disabled")}</p>
        <p className="text-muted">
          {t("qianyi_pending", { count: status?.pending ?? 0 })} ·{" "}
          {t("qianyi_failed", { count: status?.failed ?? 0 })} ·{" "}
          {t("qianyi_sent24h", { count: status?.sent24h ?? 0 })}
        </p>
        <p className="mt-2 break-all text-xs text-muted">
          {t("qianyi_webhook")}：{WEBHOOK_URL}
        </p>
      </section>

      <section className="rounded-lg border border-border bg-surface p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">{t("qianyi_skus_title")}</h2>
          <Button onClick={submit} disabled={busy || selected.size === 0}>
            {t("qianyi_create_selected", { count: selected.size })}
          </Button>
        </div>
        {message ? <p className="mb-2 text-xs text-primary">{message}</p> : null}
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="w-10" />
              <th>{t("qianyi_col_sku")}</th>
              <th>{t("qianyi_col_title")}</th>
              <th>{t("qianyi_col_code")}</th>
              <th>{t("qianyi_col_state")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-border/60">
                <td>
                  <input
                    type="checkbox"
                    aria-label={row.skuCode}
                    disabled={!row.ready || Boolean(row.qianyiSkuCode)}
                    checked={selected.has(row.id)}
                    onChange={() => toggle(row.id)}
                  />
                </td>
                <td>{row.skuCode}</td>
                <td>{row.title}</td>
                <td>{row.qianyiSkuCode ?? "—"}</td>
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
              {job.status === "FAILED" ? (
                <Button size="sm" onClick={() => retry(job.id)}>
                  {t("qianyi_retry")}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
