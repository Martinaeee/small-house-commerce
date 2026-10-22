"use client";

import { useAdminI18n } from "@/lib/admin-i18n";
import type { HomepageSectionPerformance } from "@/lib/dashboard-api";
import { CardEmpty, CardSkeleton, DashboardCard } from "./DashboardCard";
import { count, ratio } from "./format";

/**
 * Section-level homepage performance from first-party impression/click
 * events. Impressions are recorded only when a section actually enters the
 * viewport (IntersectionObserver) and are deduped per session per section per
 * Manila day, so scrolling back up cannot inflate CTR.
 */
export function HomepagePerformance({
  sections,
  totals,
  trackingSince,
  loading,
  canRead,
}: {
  sections: HomepageSectionPerformance[];
  totals: { impressions: number; clicks: number; ctr: number | null };
  trackingSince: string | null;
  loading: boolean;
  canRead: boolean;
}) {
  const { t } = useAdminI18n();

  return (
    <DashboardCard
      title={t("dash_homepage_performance")}
      subtitle={trackingSince ? t("dash_tracking_since", { date: trackingSince }) : undefined}
      action={
        totals.impressions > 0 ? (
          <span className="text-[11px] text-ink-muted">
            {count(totals.impressions)} {t("dash_impressions")} · {ratio(totals.ctr)}
          </span>
        ) : null
      }
    >
      {!canRead ? (
        <CardEmpty title={t("dash_no_permission")} />
      ) : loading ? (
        <CardSkeleton rows={5} />
      ) : sections.length === 0 ? (
        <CardEmpty title={t("dash_homepage_empty")} />
      ) : (
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-ink-muted">
                <th className="px-1 pb-2 font-medium">{t("dash_section")}</th>
                <th className="px-1 pb-2 text-right font-medium">{t("dash_impressions")}</th>
                <th className="px-1 pb-2 text-right font-medium">{t("dash_clicks")}</th>
                <th className="px-1 pb-2 text-right font-medium">{t("dash_ctr")}</th>
              </tr>
            </thead>
            <tbody>
              {sections.map((section) => (
                <tr key={section.sectionId} className="border-t border-border">
                  <td className="px-1 py-2">
                    <span className="block truncate text-ink">
                      {section.title ?? section.sectionType}
                    </span>
                    {section.title ? (
                      <span className="block text-[10px] uppercase tracking-wide text-ink-muted">
                        {section.sectionType}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-1 py-2 text-right tabular-nums text-ink-secondary">
                    {count(section.impressions)}
                  </td>
                  <td className="px-1 py-2 text-right tabular-nums text-ink-secondary">
                    {count(section.clicks)}
                  </td>
                  <td className="px-1 py-2 text-right font-medium tabular-nums text-ink">
                    {ratio(section.ctr)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DashboardCard>
  );
}
