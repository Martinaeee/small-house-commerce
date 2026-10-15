import { redirect } from "next/navigation";

export default async function LegacyLandingPages({ searchParams }: { searchParams: Promise<{ productId?: string }> }) {
  const { productId } = await searchParams;
  const query = new URLSearchParams(typeof productId === "string" ? { productId } : {});
  redirect(`/admin/marketing${query.size ? `?${query}` : ""}`);
}
