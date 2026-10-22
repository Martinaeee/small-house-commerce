"use client";

import dynamic from "next/dynamic";
import { useAdminI18n } from "@/lib/admin-i18n";
import type { DailyPoint } from "@/lib/dashboard-api";
import { CardEmpty, CardSkeleton, DashboardCard } from "./DashboardCard";
import { count, money, ratio } from "./format";

const SalesChart = dynamic(() => import("./SalesChart"), {
  ssr: false,
  loading: () => <div className="h-64 animate-pulse rounded-lg bg-admin-neutral-soft" />,
});

export function SalesOverview({
  series,
  totals,
  canRead,
  loading,
}: {
  series: DailyPoint[];
  totals: {
    totalSales: number;
    orders: number;
    averageOrderValue: number | null;
    customers: number;
  };
  canRead: boolean;
  loading: boolean;
}) {
  const { t } = useAdminI18n();
  const hasSales = series.some((point) => point.revenue > 0 || point.orders > 0);

  return (
    <DashboardCard
      title={t("dash_sales_overview")}
      action={
        <div className="flex items-center gap-3 text-[11px] text-ink-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-sm bg-admin-primary" aria-hidden />
            {t("dash_revenue")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-3 rounded bg-admin-warning" aria-hidden />
            {t("dash_orders_series")}
          </span>
        </div>
      }
    >
      {!canRead ? (
        <CardEmpty title={t("dash_no_permission")} />
      ) : loading ? (
        <CardSkeleton rows={6} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_176px]">
          <div className="min-w-0">
            {hasSales ? (
              <SalesChart
                points={series}
                revenueLabel={t("dash_revenue")}
                ordersLabel={t("dash_orders_series")}
              />
            ) : (
              <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-border text-sm text-ink-muted">
                {t("dash_recent_empty")}
              </div>
            )}
          </div>
          <dl className="grid grid-cols-2 gap-3 self-start lg:grid-cols-1">
            <div>
              <dt className="text-xs text-ink-muted">{t("dash_sales_total")}</dt>
              <dd className="mt-0.5 text-base font-semibold tabular-nums text-ink">
                {money(totals.totalSales)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">{t("dash_sales_orders")}</dt>
              <dd className="mt-0.5 text-base font-semibold tabular-nums text-ink">
                {count(totals.orders)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">{t("dash_sales_aov")}</dt>
              <dd className="mt-0.5 text-base font-semibold tabular-nums text-ink">
                {totals.averageOrderValue === null ? "—" : money(totals.averageOrderValue, true)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">{t("dash_sales_customers")}</dt>
              <dd className="mt-0.5 text-base font-semibold tabular-nums text-ink">
                {count(totals.customers)}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </DashboardCard>
  );
}

/** Small helper reused by the location card for its share column. */
export function share(orderCount: number, total: number): string {
  if (!total) return ratio(null);
  return ratio(orderCount / total, 1);
}
