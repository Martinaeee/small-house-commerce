"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { useAdminI18n } from "@/lib/admin-i18n";
import type { DashboardRangePreset, ProductPerformanceSort } from "@/lib/dashboard-api";
import { ActiveCampaigns } from "./ActiveCampaigns";
import { CodMetricsCard } from "./CodMetricsCard";
import { CustomerSnapshotCard } from "./CustomerSnapshotCard";
import { dataNoteKey } from "./dashLabels";
import { DashboardKpis } from "./DashboardKpis";
import { DashboardToolbar } from "./DashboardToolbar";
import { HomepagePerformance } from "./HomepagePerformance";
import { InventoryAlertsCard } from "./InventoryAlertsCard";
import { NeedsAttention } from "./NeedsAttention";
import { OrdersByLocation } from "./OrdersByLocation";
import { OrdersOverview } from "./OrdersOverview";
import { ProductAttentionCard } from "./ProductAttentionCard";
import { ProductPerformanceTable } from "./ProductPerformanceTable";
import { RecentOrders } from "./RecentOrders";
import { SalesOverview } from "./SalesOverview";
import { ScheduledContent } from "./ScheduledContent";
import { manilaToday } from "./format";
import { useDashboard } from "./useDashboard";

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

const RANGE_PRESETS: DashboardRangePreset[] = [
  "TODAY",
  "YESTERDAY",
  "LAST_7_DAYS",
  "LAST_30_DAYS",
  "THIS_MONTH",
  "LAST_MONTH",
  "CUSTOM",
];

function parseRange(value: string | null): DashboardRangePreset {
  return RANGE_PRESETS.includes(value as DashboardRangePreset)
    ? (value as DashboardRangePreset)
    : "LAST_7_DAYS";
}

function greetingKey(): "dash_greeting" | "dash_greeting_afternoon" | "dash_greeting_evening" {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Manila",
      hour: "numeric",
      hour12: false,
    }).format(new Date()),
  );
  if (hour < 12) return "dash_greeting";
  if (hour < 18) return "dash_greeting_afternoon";
  return "dash_greeting_evening";
}

/**
 * Operator workbench.
 *
 * One period control drives every card. The three API groups load in
 * parallel and fail independently, so a broken campaign report never blanks
 * the sales numbers.
 */
export function DashboardClient() {
  const { admin } = useAdminAuth();
  const { t } = useAdminI18n();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [range, setRange] = useState<DashboardRangePreset>(() =>
    parseRange(searchParams.get("range")),
  );
  const [from, setFrom] = useState(() => searchParams.get("from") ?? daysAgo(6));
  const [to, setTo] = useState(() => searchParams.get("to") ?? manilaToday());
  const [sort, setSort] = useState<ProductPerformanceSort>("revenue");

  const query = useMemo(() => {
    if (range !== "CUSTOM") return { range };
    if (!from || !to || from > to) return null;
    return { range, from, to };
  }, [range, from, to]);

  const { overview, products, marketing, loading, errors, reload } = useDashboard(query, sort);

  function applyRange(next: { range: DashboardRangePreset; from: string; to: string }) {
    setRange(next.range);
    if (next.range === "CUSTOM") {
      setFrom(next.from);
      setTo(next.to);
    }

    const params = new URLSearchParams(searchParams.toString());
    params.set("range", next.range);
    if (next.range === "CUSTOM") {
      params.set("from", next.from);
      params.set("to", next.to);
    } else {
      params.delete("from");
      params.delete("to");
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  const rangeLabel = overview
    ? `${overview.range.fromDate} → ${overview.range.toDate}`
    : null;
  const errorList = [errors.overview, errors.products, errors.marketing].filter(Boolean);

  return (
    <div className="mx-auto max-w-[1500px] space-y-4 px-4 py-6 md:px-8">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{t("dash_title")}</h1>
          <p className="mt-1 text-sm text-ink-secondary">
            {t(greetingKey(), { name: admin?.name ?? "Admin" })}
            {rangeLabel ? <span className="text-ink-muted"> · {rangeLabel}</span> : null}
          </p>
        </div>
        <DashboardToolbar
          range={range}
          from={from}
          to={to}
          onRangeChange={applyRange}
          quickCreate={overview?.quickCreate ?? []}
          onRefresh={reload}
          refreshing={loading}
        />
      </div>

      {errorList.length > 0 ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-admin-error bg-admin-error-soft px-3 py-2 text-sm text-admin-error"
        >
          <span>{t("dash_error")}</span>
          <button
            type="button"
            onClick={reload}
            className="rounded-lg border border-admin-error px-3 py-1 text-xs font-semibold"
          >
            {t("dash_retry")}
          </button>
        </div>
      ) : null}

      {overview && overview.dataNotes.length > 0 ? (
        <ul className="flex flex-wrap gap-x-5 gap-y-1 rounded-lg border border-border bg-admin-surface-secondary px-3 py-2 text-[11px] text-ink-muted">
          {overview.dataNotes.map((note) => {
            const key = dataNoteKey(note.key);
            return (
              <li key={note.key} className="min-w-0">
                {key ? t(key, note.params ?? {}) : note.key}
              </li>
            );
          })}
        </ul>
      ) : null}

      {overview ? (
        <DashboardKpis kpis={overview.kpis} />
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" aria-hidden>
          {Array.from({ length: 6 }).map((_, index) => (
            <div
              key={index}
              className="h-[86px] animate-pulse rounded-xl border border-border bg-admin-neutral-soft"
            />
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <SalesOverview
            series={overview?.salesSeries ?? []}
            totals={
              overview?.salesTotals ?? {
                totalSales: 0,
                orders: 0,
                averageOrderValue: null,
                customers: 0,
              }
            }
            canRead={overview?.capabilities.sales ?? false}
            loading={loading || !overview}
          />
        </div>
        <div className="min-w-0">
          <NeedsAttention
            items={overview?.needsAttention ?? []}
            loading={loading || !overview}
            canRead={Boolean(
              overview &&
                (overview.capabilities.sales ||
                  overview.capabilities.inventory ||
                  overview.capabilities.content ||
                  overview.capabilities.marketing),
            )}
          />
        </div>

        <div className="min-w-0 lg:col-span-2">
          <OrdersOverview
            tiles={overview?.ordersOverview.tiles ?? []}
            total={overview?.ordersOverview.total ?? 0}
            loading={loading || !overview}
            canRead={overview?.capabilities.sales ?? false}
          />
        </div>
        <div className="min-w-0">
          <OrdersByLocation
            rows={overview?.ordersByLocation.rows ?? []}
            total={overview?.ordersByLocation.total ?? 0}
            loading={loading || !overview}
            canRead={overview?.capabilities.sales ?? false}
          />
        </div>

        <div className="min-w-0 lg:col-span-2">
          <CodMetricsCard
            metrics={products?.codMetrics ?? null}
            loading={loading || !products}
            canRead={products?.capabilities.products ?? false}
          />
        </div>
        <div className="min-w-0">
          <ProductAttentionCard
            signals={products?.productAttention ?? []}
            loading={loading || !products}
            canRead={products?.capabilities.products ?? false}
          />
        </div>

        <div className="min-w-0 lg:col-span-2">
          <ProductPerformanceTable
            products={products?.topProducts ?? []}
            loading={loading || !products}
            canRead={products?.capabilities.products ?? false}
            sort={sort}
            onSortChange={setSort}
          />
        </div>
        <div className="min-w-0">
          <InventoryAlertsCard
            alerts={products?.inventoryAlerts ?? []}
            loading={loading || !products}
            canRead={products?.capabilities.inventory ?? false}
            velocityWindowDays={products?.thresholds.velocityWindowDays ?? 7}
          />
        </div>

        <div className="min-w-0 lg:col-span-2">
          <HomepagePerformance
            sections={marketing?.homepage.sections ?? []}
            totals={marketing?.homepage.totals ?? { impressions: 0, clicks: 0, ctr: null }}
            trackingSince={marketing?.homepage.trackingSince ?? null}
            loading={loading || !marketing}
            canRead={marketing?.capabilities.content ?? false}
          />
        </div>
        <div className="min-w-0">
          <CustomerSnapshotCard
            snapshot={overview?.customerSnapshot ?? null}
            loading={loading || !overview}
            canRead={overview?.capabilities.customers ?? false}
          />
        </div>

        <div className="min-w-0 lg:col-span-2">
          <ActiveCampaigns
            campaigns={marketing?.campaigns ?? []}
            loading={loading || !marketing}
            canRead={marketing?.capabilities.marketing ?? false}
          />
        </div>
        <div className="min-w-0">
          <ScheduledContent
            items={overview?.scheduledContent ?? []}
            loading={loading || !overview}
            canRead={overview?.capabilities.content ?? overview?.capabilities.marketing ?? false}
          />
        </div>

        <div className="min-w-0 lg:col-span-2 xl:col-span-3">
          <RecentOrders
            orders={overview?.recentOrders ?? []}
            loading={loading || !overview}
            canRead={overview?.capabilities.sales ?? false}
          />
        </div>
      </div>
    </div>
  );
}
