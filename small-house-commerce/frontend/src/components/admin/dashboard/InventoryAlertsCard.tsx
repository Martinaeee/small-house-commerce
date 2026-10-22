"use client";

import Link from "next/link";
import { useAdminI18n } from "@/lib/admin-i18n";
import type { InventoryAlert } from "@/lib/dashboard-api";
import { CardEmpty, CardSkeleton, DashboardCard, toneText } from "./DashboardCard";

/**
 * "Estimated stockout" = remaining units ÷ average daily units sold over the
 * configured velocity window. When the SKU has no recent sales, is newer than
 * the window, or is already empty, the card says so instead of printing a
 * number derived from nothing.
 */
export function InventoryAlertsCard({
  alerts,
  loading,
  canRead,
  velocityWindowDays,
}: {
  alerts: InventoryAlert[];
  loading: boolean;
  canRead: boolean;
  velocityWindowDays: number;
}) {
  const { t } = useAdminI18n();

  return (
    <DashboardCard
      title={t("dash_inventory_alerts")}
      subtitle={`${t("dash_stockout_est")} · ${velocityWindowDays}d`}
    >
      {!canRead ? (
        <CardEmpty title={t("dash_no_permission")} />
      ) : loading ? (
        <CardSkeleton rows={4} />
      ) : alerts.length === 0 ? (
        <CardEmpty title={t("dash_inventory_empty")} />
      ) : (
        <ul className="divide-y divide-border">
          {alerts.map((alert) => {
            const stockout =
              alert.status === "OUT_OF_STOCK"
                ? t("dash_issue_out_of_stock")
                : alert.stockoutDays === null
                  ? t("dash_stockout_unknown")
                  : t("dash_stockout_days", { days: alert.stockoutDays });
            const stockoutTone =
              alert.status === "OUT_OF_STOCK"
                ? "red"
                : alert.stockoutDays !== null && alert.stockoutDays <= 7
                  ? "amber"
                  : "neutral";
            return (
              <li key={alert.skuId} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                {alert.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={alert.imageUrl}
                    alt=""
                    loading="lazy"
                    className="h-9 w-9 shrink-0 rounded-md border border-border object-cover"
                  />
                ) : (
                  <span className="h-9 w-9 shrink-0 rounded-md bg-admin-neutral-soft" aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink">{alert.productName}</p>
                  <p className="truncate text-[11px] text-ink-muted">
                    {alert.variantName} · <span className="font-mono">{alert.skuCode}</span>
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold tabular-nums text-ink">
                    {alert.available} <span className="text-[11px] font-normal text-ink-muted">{t("dash_remaining")}</span>
                  </p>
                  <p className={`text-[11px] ${toneText[stockoutTone]}`}>{stockout}</p>
                </div>
                <Link
                  href={alert.restockHref}
                  className="shrink-0 rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium text-cta transition-colors hover:border-primary"
                >
                  {t("dash_restock")}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </DashboardCard>
  );
}
