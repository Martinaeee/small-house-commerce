"use client";

import Link from "next/link";
import { useAdminI18n } from "@/lib/admin-i18n";
import { Badge } from "@/components/admin/Badge";
import type { CampaignRow } from "@/lib/dashboard-api";
import { CardEmpty, CardSkeleton, DashboardCard } from "./DashboardCard";
import { count, manilaDateTime, money, ratio, untilLabel } from "./format";

const TONE = { LIVE: "green", SCHEDULED: "amber", ENDED: "neutral" } as const;

/**
 * Campaigns reuse the marketing report's own visit/order/conversion numbers,
 * so a campaign card and the marketing report can never disagree. Campaign
 * links carry no date window of their own, so LIVE/SCHEDULED/ENDED comes from
 * the linked landing page's start/end (and a disabled link is ENDED).
 */
export function ActiveCampaigns({
  campaigns,
  loading,
  canRead,
}: {
  campaigns: CampaignRow[];
  loading: boolean;
  canRead: boolean;
}) {
  const { t } = useAdminI18n();

  return (
    <DashboardCard
      title={t("dash_active_campaigns")}
      action={
        <Link href="/admin/marketing" className="text-xs font-medium text-cta hover:underline">
          {t("dash_see_all")}
        </Link>
      }
    >
      {!canRead ? (
        <CardEmpty title={t("dash_no_permission")} />
      ) : loading ? (
        <CardSkeleton rows={3} />
      ) : campaigns.length === 0 ? (
        <CardEmpty
          title={t("dash_campaigns_empty")}
          action={
            <Link href="/admin/link-builder" className="text-xs font-medium text-cta hover:underline">
              {t("dash_campaigns_cta")} →
            </Link>
          }
        />
      ) : (
        <ul className="space-y-2">
          {campaigns.map((campaign) => {
            const remaining = untilLabel(campaign.endsAt);
            const timeLabel =
              campaign.status === "SCHEDULED" && campaign.startsAt
                ? t("dash_campaign_starts", { date: manilaDateTime(campaign.startsAt) })
                : campaign.endsAt
                  ? `${t("dash_campaign_ends", { date: manilaDateTime(campaign.endsAt) })}${remaining ? ` · ${remaining}` : ""}`
                  : t("dash_campaign_no_end");
            return (
              <li key={campaign.id}>
                <Link
                  href={campaign.href}
                  className="block rounded-lg border border-border px-3 py-2.5 transition-colors hover:border-primary hover:bg-admin-surface-secondary/50"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-ink">{campaign.name}</span>
                    <Badge value={campaign.status} tone={TONE[campaign.status]} />
                  </div>
                  {campaign.productName ? (
                    <p className="mt-0.5 truncate text-[11px] text-ink-muted">
                      {campaign.productName}
                    </p>
                  ) : null}
                  <dl className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                    <div>
                      <dt className="text-ink-muted">{t("dash_campaign_sales")}</dt>
                      <dd className="font-semibold tabular-nums text-ink">{money(campaign.sales)}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-muted">{t("dash_campaign_orders")}</dt>
                      <dd className="font-semibold tabular-nums text-ink">{count(campaign.orders)}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-muted">{t("dash_campaign_conversion")}</dt>
                      <dd className="font-semibold tabular-nums text-ink">
                        {ratio(campaign.conversionRate)}
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-1.5 text-[11px] text-ink-muted">{timeLabel}</p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </DashboardCard>
  );
}
