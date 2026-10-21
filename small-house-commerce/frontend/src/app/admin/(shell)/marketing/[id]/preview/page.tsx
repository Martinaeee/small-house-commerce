import type { Metadata } from "next";
import MarketingPreview from "@/components/admin/marketing/MarketingPreview";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export default async function PreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MarketingPreview pageId={id} />;
}
