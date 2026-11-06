import type { Metadata } from "next";
import MarketingWorkbench from "@/components/admin/marketing/MarketingWorkbench";
export const metadata: Metadata = { robots: { index: false, follow: false } };
export default async function MarketingFunnelPage({ searchParams }: { searchParams: Promise<{ productId?: string; ownerUserId?: string }> }) {
  const { productId, ownerUserId } = await searchParams;
  return <MarketingWorkbench view="funnel" productId={typeof productId === "string" ? productId : undefined} ownerUserId={typeof ownerUserId === "string" ? ownerUserId : undefined} />;
}
