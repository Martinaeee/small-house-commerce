"use client";

import { useState, type ReactNode } from "react";
import { useAdminI18n, type TKey } from "@/lib/admin-i18n";
import { groupLinksBySource, type LinkGroupKey } from "@/lib/marketing-link-groups";
import type { CampaignLinkRow } from "@/lib/marketing-api";

const titles: Record<LinkGroupKey, TKey> = {
  FB_POST: "marketing_post_section_fb",
  META_AD: "marketing_post_section_meta",
  OTHER: "marketing_post_section_other",
};

/** Splits records by source into collapsible flat sections; each caller renders its own rows. */
export function SourceSections({ rows, renderRow }: { rows: CampaignLinkRow[]; renderRow: (row: CampaignLinkRow) => ReactNode }) {
  const { t } = useAdminI18n();
  const [collapsed, setCollapsed] = useState<Partial<Record<LinkGroupKey, boolean>>>({});
  return <div className="divide-y divide-admin-border">
    {groupLinksBySource(rows).map(group => {
      const title = t(titles[group.key]);
      const open = !collapsed[group.key];
      return <section key={group.key} role="region" aria-label={title} className="border-b border-admin-border last:border-b-0">
        <h3>
          <button type="button" aria-expanded={open} onClick={() => setCollapsed(current => ({ ...current, [group.key]: !current[group.key] }))} className="flex w-full items-center justify-between gap-2 bg-slate-50 px-3 py-2 text-left text-sm font-semibold hover:bg-slate-100">
            <span className="flex items-center gap-1.5">
              <svg aria-hidden="true" viewBox="0 0 12 12" className={`h-3 w-3 shrink-0 text-admin-muted transition-transform ${open ? "rotate-90" : ""}`}><path d="M3 1.5 8.5 6 3 10.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              {title}
            </span>
            <span className="text-xs font-normal text-admin-muted">{t("marketing_post_section_count", { count: String(group.rows.length) })}</span>
          </button>
        </h3>
        {open && group.rows.map(renderRow)}
      </section>;
    })}
  </div>;
}
