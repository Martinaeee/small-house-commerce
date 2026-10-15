import type { Metadata } from "next";
import MarketingWorkbench from "@/components/admin/marketing/MarketingWorkbench";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export default async function MarketingLinksPage({ searchParams }: { searchParams: Promise<{ productId?: string; landingPageId?: string }> }) {
  const { productId, landingPageId } = await searchParams;
  return <MarketingWorkbench view="links" productId={typeof productId === "string" ? productId : undefined} landingPageId={typeof landingPageId === "string" ? landingPageId : undefined} />;
}
