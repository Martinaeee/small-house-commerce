"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/admin/EmptyState";
import { PageHeader } from "@/components/admin/PageHeader";
import { Pagination } from "@/components/admin/Pagination";
import { TableSkeleton } from "@/components/admin/Skeleton";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { useAdminI18n } from "@/lib/admin-i18n";
import { adminApi, type AdminCheckoutDraftSummary, type CheckoutDraftFollowUpStatus } from "@/lib/admin-api";

const PAGE_SIZE = 20;

export default function CheckoutDraftsPage() {
  const { hasPermission } = useAdminAuth();
  const { t } = useAdminI18n();
  const canView = hasPermission("ORDER_VIEW_ALL");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"" | "OPEN" | "CONVERTED">("");
  const [followUp, setFollowUp] = useState<"" | "UNFOLLOWED" | CheckoutDraftFollowUpStatus>("");
  const [dueOnly, setDueOnly] = useState(false);
  const [page, setPage] = useState(1);
  // Mount time, so the "no update for 30 minutes" hint is a render-time
  // comparison instead of an impure Date.now() call inside render.
  const [now] = useState(() => Date.now());
  const [data, setData] = useState<{
    items: AdminCheckoutDraftSummary[];
    total: number;
  } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!canView) return;
    let alive = true;
    adminApi
      .listCheckoutDrafts({
        search: search.trim() || undefined,
        status: status || undefined,
        followUpStatus: followUp || undefined,
        dueOnly: dueOnly || undefined,
        page,
        pageSize: PAGE_SIZE,
      })
      .then((result) => {
        if (alive) {
          setData({ items: result.items, total: result.total });
          setError(false);
        }
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, [canView, search, status, followUp, dueOnly, page]);

  if (!canView) {
    return (
      <p className="px-4 py-6 text-sm text-ink-secondary md:px-8">
        {t("checkout_drafts_no_permission")}
      </p>
    );
  }

  return (
    <div className="w-full max-w-none px-4 py-5 md:px-8">
      <PageHeader
        title={t("checkout_drafts_title")}
        count={data?.total}
        subtitle={t("checkout_drafts_subtitle")}
        actions={
          <Link
            href="/admin/orders"
            className="text-sm font-medium text-cta hover:underline"
          >
            {t("checkout_drafts_detail_back")}
          </Link>
        }
      />
      <div className="mt-4 flex flex-wrap gap-2">
        <input
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          placeholder={t("checkout_drafts_search")}
          aria-label={t("checkout_drafts_search")}
          className="h-9 w-full max-w-xs rounded-lg border border-border bg-card px-3 text-sm"
        />
        <select
          value={status}
          aria-label={t("checkout_drafts_col_status")}
          onChange={(event) => {
            setStatus(event.target.value as typeof status);
            setPage(1);
          }}
          className="h-9 rounded-lg border border-border bg-card px-3 text-sm"
        >
          <option value="">{t("checkout_drafts_status_all")}</option>
          <option value="OPEN">{t("checkout_drafts_status_open")}</option>
          <option value="CONVERTED">{t("checkout_drafts_status_converted")}</option>
        </select>
        <select
          value={followUp}
          aria-label={t("checkout_drafts_followup_status")}
          onChange={(event) => {
            setFollowUp(event.target.value as typeof followUp);
            setPage(1);
          }}
          className="h-9 rounded-lg border border-border bg-card px-3 text-sm"
        >
          <option value="">{t("checkout_drafts_followup_all")}</option>
          <option value="UNFOLLOWED">{t("checkout_drafts_followup_none")}</option>
          {(["TO_CONTACT", "NO_ANSWER", "FOLLOW_UP_LATER", "WANTS_TO_BUY", "DECLINED"] as CheckoutDraftFollowUpStatus[]).map(
            (value) => (
              <option key={value} value={value}>
                {t(`checkout_drafts_followup_status_${value}`)}
              </option>
            ),
          )}
        </select>
        <label className="flex items-center gap-2 text-sm text-ink-secondary">
          <input
            type="checkbox"
            checked={dueOnly}
            onChange={(event) => {
              setDueOnly(event.target.checked);
              setPage(1);
            }}
          />
          {t("checkout_drafts_followup_due")}
        </label>
      </div>
      {error ? (
        <p role="alert" className="mt-4 text-sm text-sale">{t("checkout_drafts_load_error")}</p>
      ) : !data ? (
        <div className="mt-4">
          <TableSkeleton />
        </div>
      ) : data.items.length === 0 ? (
        <div className="mt-4">
          <EmptyState title={t("checkout_drafts_empty")} />
        </div>
      ) : (
        <table className="mt-4 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-ink-muted">
              <th className="py-2 pr-3">{t("checkout_drafts_col_contact")}</th>
              <th className="py-2 pr-3">{t("checkout_drafts_col_items")}</th>
              <th className="py-2 pr-3">{t("checkout_drafts_col_status")}</th>
              <th className="py-2 pr-3">{t("checkout_drafts_followup_status")}</th>
              <th className="py-2 pr-3">{t("checkout_drafts_followup_assignee")}</th>
              <th className="py-2 pr-3">{t("checkout_drafts_followup_next")}</th>
              <th className="py-2 pr-3">{t("checkout_drafts_col_updated")}</th>
              <th className="py-2">{t("checkout_drafts_col_order")}</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((row) => (
              <tr key={row.id} className="border-b border-border/60">
                <td className="py-2 pr-3">
                  <Link
                    href={`/admin/orders/drafts/${row.id}`}
                    className="font-medium text-cta hover:underline"
                  >
                    {row.contactName || t("checkout_drafts_not_filled")}
                  </Link>
                  <div className="text-xs text-ink-muted">
                    {row.contactPhone || "—"}
                  </div>
                </td>
                <td className="py-2 pr-3">
                  {row.firstItemName || t("checkout_drafts_not_filled_yet")}
                  <div className="text-xs text-ink-muted">
                    {t("checkout_drafts_item_count").replace(
                      "{count}",
                      String(row.itemCount),
                    )}
                  </div>
                </td>
                <td className="py-2 pr-3">
                  {row.status === "CONVERTED"
                    ? t("checkout_drafts_status_converted")
                    : t("checkout_drafts_status_open")}
                  {row.status === "OPEN" &&
                  now - Date.parse(row.updatedAt) >= 30 * 60_000 ? (
                    <div className="text-xs text-ink-muted">
                      {t("checkout_drafts_stale")}
                    </div>
                  ) : null}
                </td>
                <td className="py-2 pr-3">
                  {row.followUpStatus ? (
                    <Link href={`/admin/orders/drafts/${row.id}`} className="text-cta hover:underline">
                      {t(`checkout_drafts_followup_status_${row.followUpStatus}`)}
                    </Link>
                  ) : (
                    <Link href={`/admin/orders/drafts/${row.id}`} className="text-ink-muted hover:underline">
                      {t("checkout_drafts_followup_none")}
                    </Link>
                  )}
                </td>
                <td className="py-2 pr-3 text-xs text-ink-secondary">
                  {row.assignee?.name ?? t("checkout_drafts_followup_unassigned")}
                </td>
                <td className="py-2 pr-3 text-xs text-ink-muted">
                  {row.nextFollowUpAt ? new Date(row.nextFollowUpAt).toLocaleString() : "—"}
                </td>
                <td className="py-2 pr-3 text-xs text-ink-muted">
                  {new Date(row.updatedAt).toLocaleString()}
                </td>
                <td className="py-2">
                  {row.orderNumber ? (
                    <Link
                      href={`/admin/orders/${row.orderId ?? ""}`}
                      className="text-cta hover:underline"
                    >
                      {row.orderNumber}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="mt-4">
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={data?.total ?? 0}
          onChange={setPage}
        />
      </div>
    </div>
  );
}
