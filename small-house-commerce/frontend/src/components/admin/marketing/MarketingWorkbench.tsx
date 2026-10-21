"use client";

import Link from "next/link";
import { useAdminI18n } from "@/lib/admin-i18n";
import type { PerformancePreset } from "@/lib/marketing-api";
import { MarketingPagesList } from "./MarketingPagesList";
import { MarketingWorkspaceNav } from "./MarketingWorkspaceNav";
import { MarketingPerformanceDashboard } from "./MarketingPerformanceDashboard";
import { CampaignLinksList } from "./CampaignLinksList";
import { AdCostsList } from "./AdCostsList";
import { ReportTable } from "./ReportTable";

export type MarketingWorkbenchView = "pages" | "links" | "costs" | "reports" | "compare" | "optimizers";

export default function MarketingWorkbench({ view, productId, ownerUserId, landingPageId, linkId, preset, from, to }: {
  view: MarketingWorkbenchView;
  productId?: string; ownerUserId?: string; landingPageId?: string; linkId?: string;
  preset?: PerformancePreset; from?: string; to?: string;
}) {
  const { t } = useAdminI18n();
  const params = new URLSearchParams(productId ? { productId } : {});
  const suffix = params.size ? `?${params}` : "";
  if (landingPageId) params.set("landingPageId", landingPageId);
  if (linkId) params.set("linkId", linkId);
  const costSuffix = params.size ? `?${params}` : "";
  const initialDates = { preset: preset ?? ("LAST_7_DAYS" as const), from, to };
  return <div className="min-w-0 space-y-4 px-4 py-6 md:px-6">
    <div><h1 className="text-xl font-semibold">{t("marketing_title")}</h1><p className="mt-1 text-sm text-admin-muted">{t("marketing_workbench_subtitle")}</p></div>
    <MarketingWorkspaceNav active={view === "compare" ? "compare" : view === "optimizers" ? "optimizers" : "pages"} productId={productId} />
    <nav aria-label={t("marketing_accounting")} className="flex gap-1 overflow-x-auto whitespace-nowrap border-b border-admin-border">
      <Link className={`border-b-2 px-4 py-3 text-sm ${view === "links" ? "border-cta font-semibold text-cta" : "border-transparent text-admin-muted"}`} aria-current={view === "links" ? "page" : undefined} href={`/admin/marketing/links${suffix}`}>{t("marketing_links")}</Link>
      <Link className={`whitespace-nowrap border-b-2 px-4 py-3 text-sm ${view === "costs" ? "border-cta font-semibold text-cta" : "border-transparent text-admin-muted"}`} aria-current={view === "costs" ? "page" : undefined} href={`/admin/marketing/costs${costSuffix}`}>{t("marketing_costs")}</Link>
      <Link className={`border-b-2 px-4 py-3 text-sm ${view === "reports" ? "border-cta font-semibold text-cta" : "border-transparent text-admin-muted"}`} aria-current={view === "reports" ? "page" : undefined} href={`/admin/marketing/reports${costSuffix}`}>{t("marketing_reports")}</Link>
    </nav>
    {view === "pages" ? <MarketingPagesList key={productId ?? "all"} productId={productId} />
      : view === "compare" ? <MarketingPerformanceDashboard view="PRODUCT" productId={productId} initialDates={initialDates} />
      : view === "optimizers" ? <MarketingPerformanceDashboard view="OPTIMIZER" ownerUserId={ownerUserId} initialDates={initialDates} />
      : view === "links" ? <CampaignLinksList key={`${productId}:${landingPageId}`} productId={productId} landingPageId={landingPageId} />
      : view === "costs" ? <AdCostsList key={`${productId}:${landingPageId}:${linkId}`} productId={productId} landingPageId={landingPageId} linkId={linkId} />
      : <ReportTable key={`${productId}:${landingPageId}:${linkId}`} productId={productId} landingPageId={landingPageId} linkId={linkId} />}
  </div>;
}
