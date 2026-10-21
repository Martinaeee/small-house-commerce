import type { Metadata } from "next";
import MarketingWorkbench from "@/components/admin/marketing/MarketingWorkbench";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export default async function MarketingReportsPage({ searchParams }: { searchParams: Promise<{ productId?: string; landingPageId?: string; linkId?: string }> }) {
  const { productId, landingPageId, linkId } = await searchParams;
  return <MarketingWorkbench view="reports" productId={typeof productId === "string" ? productId : undefined} landingPageId={typeof landingPageId === "string" ? landingPageId : undefined} linkId={typeof linkId === "string" ? linkId : undefined} />;
}
