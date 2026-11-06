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
import { ShortLinkTool } from "./ShortLinkTool";
import { ProductFunnel } from "./ProductFunnel";

export type MarketingWorkbenchView = "pages" | "links" | "costs" | "reports" | "shortLinks" | "compare" | "optimizers" | "funnel";

export default function MarketingWorkbench({ view, productId, ownerUserId, landingPageId, linkId, preset, from, to }: {
  view: MarketingWorkbenchView;
  productId?: string; ownerUserId?: string; landingPageId?: string; linkId?: string;
  preset?: PerformancePreset; from?: string; to?: string;
}) {
  const { t } = useAdminI18n();
  const linkParams = new URLSearchParams(productId ? { productId } : {});
  if (landingPageId) linkParams.set("landingPageId", landingPageId);
  const linksSuffix = linkParams.size ? `?${linkParams}` : "";
  const accountingParams = new URLSearchParams(linkParams);
  if (linkId) accountingParams.set("linkId", linkId);
  const accountingSuffix = accountingParams.size ? `?${accountingParams}` : "";
  const initialDates = { preset: preset ?? ("LAST_7_DAYS" as const), from, to };
  return <div className="min-w-0 space-y-4 px-4 py-6 md:px-6">
    <div><h1 className="text-xl font-semibold">{t("marketing_title")}</h1><p className="mt-1 text-sm text-admin-muted">{t("marketing_workbench_subtitle")}</p></div>
    <MarketingWorkspaceNav active={view === "compare" ? "compare" : view === "optimizers" ? "optimizers" : "pages"} productId={productId} />
    <nav aria-label={t("marketing_accounting")} className="flex gap-1 overflow-x-auto whitespace-nowrap border-b border-admin-border">
      <Link className={`border-b-2 px-4 py-3 text-sm ${view === "links" ? "border-cta font-semibold text-cta" : "border-transparent text-admin-muted"}`} aria-current={view === "links" ? "page" : undefined} href={`/admin/marketing/links${linksSuffix}`}>{t("marketing_links")}</Link>
      <Link className={`whitespace-nowrap border-b-2 px-4 py-3 text-sm ${view === "costs" ? "border-cta font-semibold text-cta" : "border-transparent text-admin-muted"}`} aria-current={view === "costs" ? "page" : undefined} href={`/admin/marketing/costs${accountingSuffix}`}>{t("marketing_costs")}</Link>
      <Link className={`border-b-2 px-4 py-3 text-sm ${view === "reports" ? "border-cta font-semibold text-cta" : "border-transparent text-admin-muted"}`} aria-current={view === "reports" ? "page" : undefined} href={`/admin/marketing/reports${accountingSuffix}`}>{t("marketing_reports")}</Link>
      <Link className={`border-b-2 px-4 py-3 text-sm ${view === "funnel" ? "border-cta font-semibold text-cta" : "border-transparent text-admin-muted"}`} aria-current={view === "funnel" ? "page" : undefined} href={`/admin/marketing/funnel${productId ? `?productId=${encodeURIComponent(productId)}` : ""}`}>{t("funnel_title")}</Link>
      <Link className={`border-b-2 px-4 py-3 text-sm ${view === "shortLinks" ? "border-cta font-semibold text-cta" : "border-transparent text-admin-muted"}`} aria-current={view === "shortLinks" ? "page" : undefined} href="/admin/marketing/short-links">{t("marketing_short_links")}</Link>
    </nav>
    {view === "pages" ? <MarketingPagesList key={productId ?? "all"} productId={productId} />
      : view === "compare" ? <MarketingPerformanceDashboard view="PRODUCT" productId={productId} initialDates={initialDates} />
      : view === "optimizers" ? <MarketingPerformanceDashboard view="OPTIMIZER" ownerUserId={ownerUserId} initialDates={initialDates} />
      : view === "links" ? <CampaignLinksList key={`${productId}:${landingPageId}`} productId={productId} landingPageId={landingPageId} workspace />
      : view === "costs" ? <AdCostsList key={`${productId}:${landingPageId}:${linkId}`} productId={productId} landingPageId={landingPageId} linkId={linkId} />
      : view === "funnel" ? <ProductFunnel key={`${productId}:${ownerUserId}`} productId={productId} ownerUserId={ownerUserId} />
      : view === "shortLinks" ? <ShortLinkTool />
      : <ReportTable key={`${productId}:${landingPageId}:${linkId}`} productId={productId} landingPageId={landingPageId} linkId={linkId} />}
  </div>;
}
