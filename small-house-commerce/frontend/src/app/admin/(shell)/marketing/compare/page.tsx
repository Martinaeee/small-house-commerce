import type { Metadata } from "next";
import MarketingWorkbench from "@/components/admin/marketing/MarketingWorkbench";
import type { PerformancePreset } from "@/lib/marketing-api";

export const metadata: Metadata = { robots: { index: false, follow: false } };
const presets: PerformancePreset[] = ["LAST_7_DAYS", "LAST_30_DAYS", "THIS_WEEK", "LAST_WEEK", "CUSTOM"];

export default async function MarketingComparePage({ searchParams }: { searchParams: Promise<{ productId?: string; owner?: string; preset?: string; from?: string; to?: string }> }) {
  const { productId, preset, from, to } = await searchParams;
  const validPreset = presets.includes(preset as PerformancePreset) ? preset as PerformancePreset : "LAST_7_DAYS";
  return <MarketingWorkbench view="compare" productId={typeof productId === "string" ? productId : undefined} preset={validPreset} from={typeof from === "string" ? from : undefined} to={typeof to === "string" ? to : undefined} />;
}
