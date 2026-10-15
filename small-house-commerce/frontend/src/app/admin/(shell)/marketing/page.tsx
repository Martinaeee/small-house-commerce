import type { Metadata } from "next";
import MarketingWorkbench from "@/components/admin/marketing/MarketingWorkbench";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export default async function MarketingPage({ searchParams }: { searchParams: Promise<{ productId?: string }> }) {
  const { productId } = await searchParams;
  return <MarketingWorkbench view="pages" productId={typeof productId === "string" ? productId : undefined} />;
}
