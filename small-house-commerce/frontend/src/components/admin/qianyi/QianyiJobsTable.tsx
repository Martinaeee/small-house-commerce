"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { useAdminI18n } from "@/lib/admin-i18n";
import type { AdminQianyiJob } from "@/lib/admin-api";

const STATUS_CLASS: Record<AdminQianyiJob["status"], string> = {
  PENDING: "bg-amber-100 text-amber-800",
  SENDING: "bg-amber-100 text-amber-800",
  SENT: "bg-emerald-100 text-emerald-800",
  FAILED: "bg-red-100 text-red-700",
  SKIPPED: "bg-stone-100 text-stone-700",
  CANCELLED: "bg-stone-100 text-stone-500",
};

export type QianyiJobAction = "retry" | "authorize" | "adopt" | "requeue";

export function QianyiJobsTable({ jobs, busyId, onAction }: {
  jobs: AdminQianyiJob[];
  busyId: string | null;
  onAction: (action: QianyiJobAction, id: string, number?: string) => Promise<boolean>;
}) {
  const { t, lang } = useAdminI18n();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [adoptFor, setAdoptFor] = useState<string | null>(null);
  const [number, setNumber] = useState("");
  const locked = busyId !== null;

  const adopt = async (id: string) => {
    if (!number.trim() || locked) return;
    if (await onAction("adopt", id, number.trim())) {
      setAdoptFor(null);
      setNumber("");
    }
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[850px] text-left text-sm">
        <thead className="bg-border/10 text-xs text-muted">
          <tr>
            <th scope="col" className="px-3 py-3">{t("qianyi_col_time")}</th>
            <th scope="col" className="px-3 py-3">{t("qianyi_col_kind")}</th>
            <th scope="col" className="px-3 py-3">{t("qianyi_col_order")}</th>
            <th scope="col" className="px-3 py-3">{t("qianyi_col_status")}</th>
            <th scope="col" className="px-3 py-3">{t("qianyi_col_error")}</th>
            <th scope="col" className="px-3 py-3 text-right">{t("qianyi_col_actions")}</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <Fragment key={job.id}>
              <tr className="border-t border-border/60 hover:bg-border/10" aria-busy={busyId === job.id}>
                <td className="whitespace-nowrap px-3 py-3 text-xs text-muted">
                  <time dateTime={job.updatedAt}>{new Date(job.updatedAt).toLocaleString(lang === "zh" ? "zh-CN" : "en-GB", {
                    timeZone: "Asia/Manila", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
                  })}</time>
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-xs">{t(job.kind === "PUSH_ORDER" ? "qianyi_kind_push" : "qianyi_kind_close")}</td>
                <td className="px-3 py-3 text-xs font-medium">
                  {job.order?.id ? (
                    <Link href={`/admin/orders/${job.order.id}`} prefetch={false} className="text-primary underline-offset-4 hover:underline">
                      {job.order.orderNumber}
                    </Link>
                  ) : (job.order?.orderNumber ?? "—")}
                  {job.externalOrderNumber ? <p className="mt-1 text-xs font-normal text-muted">{job.externalOrderNumber}</p> : null}
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-xs">
                  <span className={`rounded-full px-2 py-1 font-medium ${STATUS_CLASS[job.status]}`}>{t(`qianyi_job_${job.status}`)}</span>
                  {job.pendingReview ? <span className="mt-1 block text-red-700">{t("qianyi_job_needs_review")}</span> : null}
                </td>
                <td className="max-w-64 px-3 py-3 text-xs text-muted">
                  {job.lastError ? (
                    <button type="button" aria-label={t("qianyi_col_error")} aria-expanded={expanded === job.id}
                      aria-controls={`job-error-${job.id}`} onClick={() => setExpanded(expanded === job.id ? null : job.id)}
                      className="block max-w-64 truncate text-left hover:text-ink" title={job.lastError}>
                      {job.lastError.length > 40 ? `${job.lastError.slice(0, 40)}…` : job.lastError}
                    </button>
                  ) : "—"}
                </td>
                <td className="px-3 py-3 text-right text-xs">
                  <div className="flex justify-end gap-2 whitespace-nowrap">
                    {job.status === "FAILED" && job.pendingReview && job.kind === "PUSH_ORDER" ? (
                      <>
                        <Button size="sm" variant="secondary" disabled={locked} onClick={() => {
                          setAdoptFor(adoptFor === job.id ? null : job.id); setNumber("");
                        }}>{t("qianyi_adopt")}</Button>
                        <Button size="sm" variant="secondary" disabled={locked}
                          onClick={() => void onAction("authorize", job.id)}>{t("qianyi_authorize_retry")}</Button>
                      </>
                    ) : null}
                    {job.status === "FAILED" && !job.pendingReview ? (
                      <Button size="sm" disabled={locked} onClick={() => void onAction("retry", job.id)}>{t("qianyi_retry")}</Button>
                    ) : null}
                    {job.status === "SKIPPED" ? (
                      <Button size="sm" disabled={locked} onClick={() => void onAction("requeue", job.id)}>{t("qianyi_requeue")}</Button>
                    ) : null}
                    {job.kind === "CLOSE_ORDER" && job.status === "FAILED" && job.pendingReview ? (
                      <span className="max-w-48 whitespace-normal text-muted">{t("qianyi_close_review")}</span>
                    ) : null}
                  </div>
                  {busyId === job.id ? <p role="status" className="mt-1 text-muted">{t("qianyi_processing")}</p> : null}
                </td>
              </tr>
              {expanded === job.id && job.lastError ? (
                <tr id={`job-error-${job.id}`} className="bg-red-50/50">
                  <td colSpan={6} className="break-all px-4 py-3 text-xs leading-relaxed text-red-800">{job.lastError}</td>
                </tr>
              ) : null}
              {adoptFor === job.id ? (
                <tr className="bg-border/10">
                  <td colSpan={6} className="px-4 py-3">
                    <form onSubmit={(event) => { event.preventDefault(); void adopt(job.id); }}>
                      <label htmlFor={`adopt-${job.id}`} className="mb-2 block text-xs text-muted">{t("qianyi_adopt_hint")}</label>
                      <div className="flex flex-wrap gap-2">
                        <input id={`adopt-${job.id}`} value={number} onChange={(event) => setNumber(event.target.value)}
                          placeholder={t("qianyi_adopt_placeholder")} disabled={locked} maxLength={64}
                          className="h-9 w-52 rounded border border-border bg-surface px-2 text-sm" />
                        <Button type="submit" size="sm" disabled={locked || !number.trim()}>{t("qianyi_adopt_submit")}</Button>
                        <Button size="sm" variant="secondary" disabled={locked} onClick={() => { setAdoptFor(null); setNumber(""); }}>
                          {t("qianyi_dismiss")}
                        </Button>
                      </div>
                    </form>
                  </td>
                </tr>
              ) : null}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
