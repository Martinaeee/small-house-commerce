import type { Metadata } from "next";
import { PaymentReturnClient } from "@/components/checkout/PaymentReturnClient";

export const metadata: Metadata = {
  title: "Payment",
  // A payment page is never worth an index entry.
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Where the shopper comes back to after paying. The page itself carries
 * nothing but the order number: the state comes from the server, through the
 * capability cookie, and the URL never carries gateway parameters.
 */
export default async function PaymentReturnPage({
  params,
}: {
  params: Promise<{ orderNumber: string }>;
}) {
  const { orderNumber } = await params;
  return <PaymentReturnClient orderNumber={orderNumber} />;
}
