"use client";

import Link from "next/link";
import { useAdminI18n } from "@/lib/admin-i18n";
import type { OrderTile } from "@/lib/dashboard-api";
import { CardEmpty, CardSkeleton, DashboardCard, toneText } from "./DashboardCard";
import { tileLabelKey } from "./dashLabels";
import { count } from "./format";

/**
 * Order pipeline for the selected period. Each count links to the order list
 * pre-filtered to that status set — the numbers are read live from the orders
 * table, so the dashboard can never drift from the list it opens.
 */
export function OrdersOverview({
  tiles,
  total,
  loading,
  canRead,
}: {
  tiles: OrderTile[];
  total: number;
  loading: boolean;
  canRead: boolean;
}) {
  const { t } = useAdminI18n();

  return (
    <DashboardCard
      title={t("dash_orders_overview")}
      action={
        <Link href="/admin/orders" className="text-xs font-medium text-cta hover:underline">
          {t("dash_see_all")}
        </Link>
      }
    >
      {!canRead ? (
        <CardEmpty title={t("dash_no_permission")} />
      ) : loading ? (
        <CardSkeleton rows={2} />
      ) : tiles.length === 0 ? (
        <CardEmpty title={t("dash_recent_empty")} />
      ) : (
        <div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
            {tiles.map((tile) => {
              const labelKey = tileLabelKey(tile.key);
              return (
                <Link
                  key={tile.key}
                  href={tile.href}
                  title={labelKey ? t(labelKey) : tile.key}
                  className="rounded-lg border border-border px-3 py-2.5 transition-colors hover:border-primary hover:bg-admin-surface-secondary/60"
                >
                  <span className="block text-lg font-semibold tabular-nums text-ink">
                    {count(tile.count)}
                  </span>
                  <span className={`mt-0.5 block truncate text-[11px] ${toneText[tile.tone]}`}>
                    {labelKey ? t(labelKey) : tile.key}
                  </span>
                </Link>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-ink-muted">
            {t("dash_orders_total")}: {count(total)}
          </p>
        </div>
      )}
    </DashboardCard>
  );
}
