import type { Metadata } from "next";
import MarketingWorkbench from "@/components/admin/marketing/MarketingWorkbench";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export default async function MarketingShortLinksPage() {
  return <MarketingWorkbench view="shortLinks" />;
}
