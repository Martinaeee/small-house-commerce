"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useAdminI18n } from "@/lib/admin-i18n";
import {
  adminApi,
  type AdminBackInStockSubscription,
  type BackInStockStatus,
  type Paged,
} from "@/lib/admin-api";

export interface BackInStockTableProps {
  canWrite: boolean;
}

const PAGE_SIZE = 20;

export function BackInStockTable({ canWrite }: BackInStockTableProps) {
  const { t } = useAdminI18n();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<BackInStockStatus | "">("");
  const [result, setResult] =
    useState<Paged<AdminBackInStockSubscription> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const resendLocked = useRef(false);

  useEffect(() => {
    let active = true;
    void adminApi
      .listBackInStockSubscriptions({
        page,
        pageSize: PAGE_SIZE,
        ...(status ? { status } : {}),
      })
      .then((data) => {
        if (!active) return;
        setResult(data);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setResult({ page, pageSize: PAGE_SIZE, total: 0, items: [] });
        setError(
          cause instanceof Error
            ? cause.message
            : t("newsletter_back_in_stock_load_failed"),
        );
      });
    return () => {
      active = false;
    };
  }, [page, status, t]);

  function changeStatus(nextStatus: BackInStockStatus | ""): void {
    setResult(null);
    setPage(1);
    setStatus(nextStatus);
  }

  async function resend(row: AdminBackInStockSubscription): Promise<void> {
    if (!canWrite || resendLocked.current) return;
    resendLocked.current = true;
    setBusyId(row.id);
    setError(null);
    try {
      const updated = await adminApi.resendBackInStockSubscription(row.id);
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
          : t("newsletter_back_in_stock_resend_failed"),
      );
    } finally {
      resendLocked.current = false;
      setBusyId(null);
    }
  }

  const pages = result
    ? Math.max(1, Math.ceil(result.total / result.pageSize))
    : 1;

  return (
    <div className="space-y-4">
      <label className="inline-block text-sm font-medium text-ink">
        {t("newsletter_subscriber_status")}
        <select
          aria-label={t("newsletter_back_in_stock_status_filter")}
          value={status}
          onChange={(event) =>
            changeStatus(event.target.value as BackInStockStatus | "")
          }
          className="mt-1 block h-10 rounded-lg border border-border bg-card px-3 text-sm"
        >
          <option value="">{t("newsletter_filter_all")}</option>
          <option value="PENDING">
            {t("newsletter_back_in_stock_status_PENDING")}
          </option>
          <option value="SENT">
            {t("newsletter_back_in_stock_status_SENT")}
          </option>
          <option value="CANCELLED">
            {t("newsletter_back_in_stock_status_CANCELLED")}
          </option>
        </select>
      </label>

      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </p>
      ) : null}

      {result === null ? (
        <div
          className="h-64 animate-pulse rounded-xl border border-border bg-card"
          aria-label={t("newsletter_back_in_stock_loading")}
        />
      ) : result.items.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-ink-muted">
          {t("newsletter_back_in_stock_empty")}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[1080px] text-left text-sm">
            <thead className="bg-background text-xs text-ink-muted">
              <tr>
                <th className="px-4 py-3">
                  {t("newsletter_subscriber_email")}
                </th>
                <th className="px-4 py-3">
                  {t("newsletter_back_in_stock_product")}
                </th>
                <th className="px-4 py-3">
                  {t("newsletter_back_in_stock_sku")}
                </th>
                <th className="px-4 py-3">
                  {t("newsletter_subscriber_status")}
                </th>
                <th className="px-4 py-3">
                  {t("newsletter_back_in_stock_created_at")}
                </th>
                <th className="px-4 py-3">
                  {t("newsletter_back_in_stock_notified_at")}
                </th>
                <th className="px-4 py-3">
                  {t("newsletter_back_in_stock_error")}
                </th>
                {canWrite ? (
                  <th className="px-4 py-3 text-right">
                    {t("newsletter_actions")}
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {result.items.map((row) => (
                <tr key={row.id} className="border-t border-border align-top">
                  <td className="px-4 py-3 font-medium text-ink">{row.email}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-ink">{row.productName}</p>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      {row.variantName}
                    </p>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-ink-secondary">
                    {row.skuCode}
                  </td>
                  <td className="px-4 py-3">
                    {t(`newsletter_back_in_stock_status_${row.status}`)}
                  </td>
                  <td className="px-4 py-3 text-ink-secondary">
                    {new Date(row.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-ink-secondary">
                    {row.notifiedAt
                      ? new Date(row.notifiedAt).toLocaleString()
                      : "—"}
                  </td>
                  <td className="max-w-64 px-4 py-3 text-xs text-sale">
                    {row.lastError ?? "—"}
                  </td>
                  {canWrite ? (
                    <td className="px-4 py-3 text-right">
                      {row.status === "PENDING" ? (
                        <button
                          type="button"
                          disabled={busyId !== null}
                          onClick={() => {
                            void resend(row);
                          }}
                          aria-label={t(
                            "newsletter_back_in_stock_resend_aria",
                            { email: row.email },
                          )}
                          className="text-sm font-medium text-cta hover:underline disabled:text-ink-muted"
                        >
                          {busyId === row.id
                            ? t("newsletter_processing")
                            : t("newsletter_back_in_stock_resend")}
                        </button>
                      ) : (
                        "—"
                      )}
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
