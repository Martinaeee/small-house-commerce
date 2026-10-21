import type { Metadata } from "next";
import { TrackOrderForm } from "@/components/track-order/TrackOrderForm";

export const metadata: Metadata = { title: "Track Your Order" };

export default async function TrackOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  const { order } = await searchParams;
  // The heading and the lookup form live inside the client component: once an
  // order is open the page shows the order details and nothing else.
  return (
    <div className="mx-auto max-w-[600px] px-4 py-12 sm:px-6">
      <TrackOrderForm prefillOrder={order} />
    </div>
  );
}
