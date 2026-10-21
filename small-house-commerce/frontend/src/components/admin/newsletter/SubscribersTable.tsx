"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useAdminI18n } from "@/lib/admin-i18n";
import {
  adminApi,
  type AdminNewsletterSubscriber,
  type NewsletterSubscriberStatus,
  type NewsletterSubscribeSource,
  type Paged,
} from "@/lib/admin-api";

interface SubscribersTableProps {
  canWrite: boolean;
}

export function SubscribersTable({ canWrite }: SubscribersTableProps) {
  const { t } = useAdminI18n();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<NewsletterSubscriberStatus | "">("");
  const [source, setSource] = useState<NewsletterSubscribeSource | "">("");
  const [result, setResult] = useState<Paged<AdminNewsletterSubscriber> | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let active = true;
    void adminApi
      .listNewsletterSubscribers({
        page,
        pageSize: 20,
        ...(status ? { status } : {}),
        ...(source ? { source } : {}),
      })
      .then((data) => {
        if (!active) return;
        setResult(data);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setResult({ page, pageSize: 20, total: 0, items: [] });
        setError(
          cause instanceof Error
            ? cause.message
            : t("newsletter_subscribers_load_failed"),
        );
      });
    return () => {
      active = false;
    };
  }, [page, source, status, t]);

  function changeFilter(
    nextStatus: NewsletterSubscriberStatus | "",
    nextSource: NewsletterSubscribeSource | "",
  ): void {
    setResult(null);
    setPage(1);
    setStatus(nextStatus);
    setSource(nextSource);
  }

  async function changeStatus(
    row: AdminNewsletterSubscriber,
    next: NewsletterSubscriberStatus,
  ): Promise<void> {
    if (!canWrite || busyId) return;
    setBusyId(row.id);
    setError(null);
    try {
      const updated = await adminApi.updateNewsletterSubscriber(row.id, next);
      setResult((current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) =>
                item.id === updated.id ? updated : item,
              ),
            }
          : current,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("newsletter_subscriber_update_failed"),
      );
    } finally {
      setBusyId(null);
    }
  }

  async function exportCsv(): Promise<void> {
    if (exporting) return;
    setExporting(true);
    setError(null);
    try {
      const csv = await adminApi.exportNewsletterSubscribers();
      const url = URL.createObjectURL(
        new Blob([csv], { type: "text/csv;charset=utf-8" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "newsletter-subscribers.csv";
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t("newsletter_export_failed"),
      );
    } finally {
      setExporting(false);
    }
  }

  const pages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm font-medium text-ink">
          {t("newsletter_subscriber_status")}
          <select
            aria-label={t("newsletter_status_filter")}
            value={status}
            onChange={(event) =>
              changeFilter(
                event.target.value as NewsletterSubscriberStatus | "",
                source,
              )
            }
            className="mt-1 block h-10 rounded-lg border border-border bg-card px-3 text-sm"
          >
            <option value="">{t("newsletter_filter_all")}</option>
            <option value="SUBSCRIBED">{t("newsletter_status_subscribed")}</option>
            <option value="UNSUBSCRIBED">{t("newsletter_status_unsubscribed")}</option>
          </select>
        </label>
        <label className="text-sm font-medium text-ink">
          {t("newsletter_subscriber_source")}
          <select
            aria-label={t("newsletter_source_filter")}
            value={source}
            onChange={(event) =>
              changeFilter(
                status,
                event.target.value as NewsletterSubscribeSource | "",
              )
            }
            className="mt-1 block h-10 rounded-lg border border-border bg-card px-3 text-sm"
          >
            <option value="">{t("newsletter_filter_all")}</option>
            <option value="POPUP">{t("newsletter_source_popup")}</option>
            <option value="FOOTER">{t("newsletter_source_footer")}</option>
          </select>
        </label>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            void exportCsv();
          }}
          disabled={exporting}
        >
          {exporting
            ? t("newsletter_exporting")
            : t("newsletter_export_csv")}
        </Button>
      </div>

      {error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {result === null ? (
        <div
          className="h-64 animate-pulse rounded-xl border border-border bg-card"
          aria-label={t("newsletter_subscribers_loading")}
        />
      ) : result.items.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-ink-muted">
          {t("newsletter_subscribers_empty")}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="min-w-[760px] w-full text-left text-sm">
            <thead className="bg-background text-xs text-ink-muted">
              <tr>
                <th className="px-4 py-3">{t("newsletter_subscriber_email")}</th>
                <th className="px-4 py-3">{t("newsletter_subscriber_status")}</th>
                <th className="px-4 py-3">{t("newsletter_subscriber_source")}</th>
                <th className="px-4 py-3">{t("newsletter_subscribed_at")}</th>
                {canWrite ? (
                  <th className="px-4 py-3 text-right">
                    {t("newsletter_actions")}
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {result.items.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="px-4 py-3 font-medium text-ink">{row.email}</td>
                  <td className="px-4 py-3">
                    {row.status === "SUBSCRIBED"
                      ? t("newsletter_status_subscribed")
                      : t("newsletter_status_unsubscribed")}
                  </td>
                  <td className="px-4 py-3">
                    {row.source === "POPUP"
                      ? t("newsletter_source_popup")
                      : t("newsletter_source_footer")}
                  </td>
                  <td className="px-4 py-3 text-ink-secondary">
                    {new Date(row.createdAt).toLocaleString()}
                  </td>
                  {canWrite ? (
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        disabled={busyId !== null}
                        onClick={() => {
                          void changeStatus(
                            row,
                            row.status === "SUBSCRIBED"
                              ? "UNSUBSCRIBED"
                              : "SUBSCRIBED",
                          );
                        }}
                        className="text-sm font-medium text-cta hover:underline disabled:text-ink-muted"
                        aria-label={t(
                          row.status === "SUBSCRIBED"
                            ? "newsletter_unsubscribe_aria"
                            : "newsletter_restore_aria",
                          { email: row.email },
                        )}
                      >
                        {busyId === row.id
                          ? t("newsletter_processing")
                          : row.status === "SUBSCRIBED"
                            ? t("newsletter_unsubscribe")
                            : t("newsletter_restore")}
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {result ? (
        <div className="flex items-center justify-between text-sm text-ink-secondary">
          <span>
            {t("newsletter_total_page", {
              total: result.total,
              page: result.page,
              pages,
            })}
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              size="md"
              disabled={page <= 1}
              onClick={() => {
                setResult(null);
                setPage((current) => Math.max(1, current - 1));
              }}
            >
              {t("newsletter_previous")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="md"
              disabled={page >= pages}
              onClick={() => {
                setResult(null);
                setPage((current) => current + 1);
              }}
            >
              {t("newsletter_next")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
