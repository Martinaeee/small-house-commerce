"use client";

import type { ReactNode } from "react";
import { useAdminI18n, type TKey } from "@/lib/admin-i18n";
import { groupLinksBySource, type LinkGroupKey } from "@/lib/marketing-link-groups";
import type { CampaignLinkRow } from "@/lib/marketing-api";

const titles: Record<LinkGroupKey, TKey> = {
  FB_POST: "marketing_post_section_fb",
  META_AD: "marketing_post_section_meta",
  OTHER: "marketing_post_section_other",
};

/** Splits records by source into flat sections; each caller renders its own rows. */
export function SourceSections({ rows, renderRow }: { rows: CampaignLinkRow[]; renderRow: (row: CampaignLinkRow) => ReactNode }) {
  const { t } = useAdminI18n();
  return <div className="divide-y divide-admin-border">
    {groupLinksBySource(rows).map(group => <section key={group.key} role="region" aria-label={t(titles[group.key])} className="border-b border-admin-border last:border-b-0">
      <h3 className="flex items-baseline justify-between bg-slate-50 px-3 py-2 text-sm font-semibold">
        <span>{t(titles[group.key])}</span>
        <span className="text-xs font-normal text-admin-muted">{t("marketing_post_section_count", { count: String(group.rows.length) })}</span>
      </h3>
      {group.rows.map(renderRow)}
    </section>)}
  </div>;
}
