import type { Metadata } from "next";
import { CheckoutConfirmView } from "@/components/checkout/CheckoutConfirmView";

export const metadata: Metadata = { title: "Confirm Your Order" };

export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ skuId?: string; qty?: string; items?: string; slug?: string }>;
}) {
  const { skuId, qty, items, slug } = await searchParams;
  return <CheckoutConfirmView skuId={skuId} qty={qty} itemsParam={items} slug={slug} />;
}
