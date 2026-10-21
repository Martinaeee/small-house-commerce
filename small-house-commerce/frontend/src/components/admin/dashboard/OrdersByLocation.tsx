"use client";

import Link from "next/link";
import { useAdminI18n } from "@/lib/admin-i18n";
import type { LocationRow } from "@/lib/dashboard-api";
import { CardEmpty, CardSkeleton, DashboardCard } from "./DashboardCard";
import { count, ratio } from "./format";

/**
 * Orders by province, aggregated from the order's own shipping-address
 * snapshot (DATABASE.md §90) — never guessed from carrier text. Provinces are
 * normalised only where spellings mean the same place (the NCR variants).
 */
export function OrdersByLocation({
  rows,
  total,
  loading,
  canRead,
}: {
  rows: LocationRow[];
  total: number;
  loading: boolean;
  canRead: boolean;
}) {
  const { t } = useAdminI18n();
  const max = Math.max(1, ...rows.map((row) => row.orders));

  return (
    <DashboardCard title={t("dash_orders_by_location")}>
      {!canRead ? (
        <CardEmpty title={t("dash_no_permission")} />
      ) : loading ? (
        <CardSkeleton rows={5} />
      ) : rows.length === 0 ? (
        <CardEmpty title={t("dash_locations_empty")} />
      ) : (
        <ul className="space-y-2.5">
          {rows.map((row) => (
            <li key={row.province}>
              <Link
                href={`/admin/orders?search=${encodeURIComponent(row.province === "Others" ? "" : row.province)}`}
                className="group block"
                aria-label={`${row.province}: ${row.orders}`}
              >
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="truncate text-ink-secondary group-hover:text-cta">
                    {row.province}
                  </span>
                  <span className="shrink-0 tabular-nums text-ink-muted">
                    {count(row.orders)} · {ratio(total ? row.orders / total : null, 1)}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-admin-neutral-soft">
                  <div
                    className="h-full rounded-full bg-admin-primary/70 transition-colors group-hover:bg-admin-primary"
                    style={{ width: `${Math.max(4, (row.orders / max) * 100)}%` }}
                  />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </DashboardCard>
  );
}
