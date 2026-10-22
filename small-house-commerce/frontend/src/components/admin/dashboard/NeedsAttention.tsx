"use client";

import Link from "next/link";
import { useAdminI18n } from "@/lib/admin-i18n";
import type { AttentionItem } from "@/lib/dashboard-api";
import { CardEmpty, CardSkeleton, DashboardCard, toneSurface, toneText } from "./DashboardCard";
import { attentionHintKey, attentionLabelKey } from "./dashLabels";

/**
 * Operational backlog. Every row is a deep link into the list that is already
 * filtered for that problem — never a bare module home page. Counts are
 * current-state ("now"), not period totals: a backlog is not a date range.
 */
export function NeedsAttention({
  items,
  loading,
  canRead,
}: {
  items: AttentionItem[];
  loading: boolean;
  canRead: boolean;
}) {
  const { t } = useAdminI18n();
  const total = items.reduce((sum, item) => sum + item.count, 0);

  return (
    <DashboardCard
      title={t("dash_needs_attention")}
      action={
        total > 0 ? (
          <span className="rounded-full bg-admin-warning-soft px-2 py-0.5 text-[11px] font-semibold text-admin-warning">
            {total}
          </span>
        ) : null
      }
    >
      {!canRead ? (
        <CardEmpty title={t("dash_no_permission")} />
      ) : loading ? (
        <CardSkeleton rows={5} />
      ) : items.length === 0 || total === 0 ? (
        <CardEmpty title={t("dash_all_clear")} />
      ) : (
        <ul className="-my-1 divide-y divide-border">
          {items.map((item) => {
            const labelKey = attentionLabelKey(item.labelKey);
            const hintKey = attentionHintKey(item.hintKey);
            return (
              <li key={item.key}>
                <Link
                  href={item.href}
                  className="group flex items-center gap-3 py-2.5 transition-colors hover:bg-admin-surface-secondary/60"
                >
                  <span
                    className={`inline-flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums ${toneSurface[item.tone]} ${toneText[item.tone]}`}
                  >
                    {item.count}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink group-hover:text-cta">
                      {labelKey ? t(labelKey) : item.labelKey}
                    </span>
                    {hintKey ? (
                      <span className="block truncate text-[11px] text-ink-muted">
                        {t(hintKey)}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-xs font-medium text-cta opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                    {t("dash_view")} →
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
