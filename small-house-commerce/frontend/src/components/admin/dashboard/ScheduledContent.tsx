"use client";

import Link from "next/link";
import { useAdminI18n } from "@/lib/admin-i18n";
import { Badge } from "@/components/admin/Badge";
import type { ScheduledItem } from "@/lib/dashboard-api";
import { CardEmpty, CardSkeleton, DashboardCard } from "./DashboardCard";
import { manilaDateTime, untilLabel } from "./format";

const KIND_LABEL = {
  HOMEPAGE_VERSION: "dash_kind_homepage_version",
  HOMEPAGE_SECTION: "dash_kind_homepage_section",
  LANDING_PAGE: "dash_kind_landing_page",
  PROMOTION: "dash_kind_promotion",
} as const;

/**
 * Future publishing, read from the rows that actually drive it — homepage
 * version windows, section schedules inside the document, landing-page start
 * dates and promo validity. There is no separate dashboard schedule table.
 */
export function ScheduledContent({
  items,
  loading,
  canRead,
}: {
  items: ScheduledItem[];
  loading: boolean;
  canRead: boolean;
}) {
  const { t } = useAdminI18n();

  return (
    <DashboardCard title={t("dash_scheduled")}>
      {!canRead ? (
        <CardEmpty title={t("dash_no_permission")} />
      ) : loading ? (
        <CardSkeleton rows={3} />
      ) : items.length === 0 ? (
        <CardEmpty title={t("dash_scheduled_empty")} />
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => {
            const remaining = untilLabel(item.scheduledFor);
            return (
              <li key={item.id}>
                <Link
                  href={item.href}
                  className="group flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
                >
                  <div className="w-16 shrink-0 text-[11px] tabular-nums text-ink-muted">
                    {item.scheduledFor ? manilaDateTime(item.scheduledFor) : "—"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink group-hover:text-cta">{item.title}</p>
                    <p className="truncate text-[11px] text-ink-muted">
                      {t(KIND_LABEL[item.kind as keyof typeof KIND_LABEL] ?? "dash_kind_homepage_section")}
                      {remaining ? ` · ${remaining}` : ""}
                    </p>
                  </div>
                  <Badge value={item.status} tone="amber" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </DashboardCard>
  );
}
