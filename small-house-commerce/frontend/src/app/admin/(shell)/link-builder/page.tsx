import { redirect } from "next/navigation";

export default async function LegacyCampaignLinks({ searchParams }: { searchParams: Promise<{ productId?: string; landingPageId?: string }> }) {
  const { productId, landingPageId } = await searchParams;
  const query = new URLSearchParams();
  if (typeof productId === "string") query.set("productId", productId);
  if (typeof landingPageId === "string") query.set("landingPageId", landingPageId);
  redirect(`/admin/marketing/links${query.size ? `?${query}` : ""}`);
}
