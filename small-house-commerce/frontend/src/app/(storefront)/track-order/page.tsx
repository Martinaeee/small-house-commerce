import type { Metadata } from "next";
import { TrackOrderForm } from "@/components/track-order/TrackOrderForm";

export const metadata: Metadata = { title: "Track Your Order" };

export default async function TrackOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  const { order } = await searchParams;
  return (
    <div className="mx-auto max-w-[600px] px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-semibold text-ink">Track Your Order</h1>
      <p className="mt-2 text-ink-secondary">
        Check the status of your order using the order number and the mobile
        number you used at checkout.
      </p>
      <div className="mt-8">
        <TrackOrderForm prefillOrder={order} />
      </div>
    </div>
  );
}
