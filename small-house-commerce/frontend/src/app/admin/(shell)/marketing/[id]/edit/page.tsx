import type { Metadata } from "next";
import MarketingPageEdit from "@/components/admin/marketing/MarketingPageEdit";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MarketingPageEdit pageId={id} />;
}
