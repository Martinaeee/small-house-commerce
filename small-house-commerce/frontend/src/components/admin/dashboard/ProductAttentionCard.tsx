"use client";

import Link from "next/link";
import { useAdminI18n } from "@/lib/admin-i18n";
import type { ProductAttention as ProductSignal } from "@/lib/dashboard-api";
import { CardEmpty, CardSkeleton, DashboardCard, toneSurface, toneText } from "./DashboardCard";
import { productIssueDetailKey, productIssueLabelKey } from "./dashLabels";
import { count, ratio } from "./format";

const ISSUE_TONE = {
  LOW_CONVERSION: "amber",
  HIGH_CANCELLATION: "red",
  HIGH_REFUND: "red",
  LOW_TRAFFIC: "amber",
  OUT_OF_STOCK: "red",
} as const;

/**
 * Anomalies are computed in the dashboard service from configurable
 * thresholds (`DASHBOARD_*` env vars), not in this component — the card only
 * renders what the service decided and why.
 */
export function ProductAttentionCard({
  signals,
  loading,
  canRead,
}: {
  signals: ProductSignal[];
  loading: boolean;
  canRead: boolean;
}) {
  const { t } = useAdminI18n();

  return (
    <DashboardCard title={t("dash_product_attention")}>
      {!canRead ? (
        <CardEmpty title={t("dash_no_permission")} />
      ) : loading ? (
        <CardSkeleton rows={4} />
      ) : signals.length === 0 ? (
        <CardEmpty title={t("dash_attention_empty")} />
      ) : (
        <ul className="space-y-2">
          {signals.map((signal) => {
            const tone = ISSUE_TONE[signal.issue];
            const labelKey = productIssueLabelKey(signal.issue);
            const detailKey = productIssueDetailKey(signal.issue);
            return (
              <li key={`${signal.productId}-${signal.issue}`}>
                <Link
                  href={`/admin/products/${signal.productId}/edit`}
                  className="group flex items-center gap-3 rounded-lg px-1 py-1.5 transition-colors hover:bg-admin-surface-secondary/60"
                >
                  {signal.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={signal.imageUrl}
                      alt=""
                      loading="lazy"
                      className="h-8 w-8 shrink-0 rounded-md border border-border object-cover"
                    />
                  ) : (
                    <span className="h-8 w-8 shrink-0 rounded-md bg-admin-neutral-soft" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink group-hover:text-cta">
                      {signal.name}
                    </span>
                    <span className="block truncate text-[11px] text-ink-muted">
                      {detailKey
                        ? t(detailKey, {
                            rate: ratio(signal.value, 2),
                            views: count(signal.views ?? 0),
                            orders: count(signal.orders ?? 0),
                          })
                        : ""}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${toneSurface[tone]} ${toneText[tone]}`}
                  >
                    {labelKey ? t(labelKey) : signal.issue}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </DashboardCard>
  );
}
