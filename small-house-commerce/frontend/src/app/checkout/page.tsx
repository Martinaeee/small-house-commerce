import type { Metadata } from "next";
import { CheckoutForm } from "@/components/checkout/CheckoutForm";

export const metadata: Metadata = { title: "Secure Checkout" };

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ skuId?: string; qty?: string }>;
}) {
  const { skuId, qty } = await searchParams;
  return <CheckoutForm skuId={skuId} qty={qty} />;
}
