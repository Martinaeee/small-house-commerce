import type { Metadata } from "next";
import { TrackOrderForm } from "@/components/track-order/TrackOrderForm";
import { TrackRecommendations } from "@/components/track-order/TrackRecommendations";
import { fetchTrackRecommendations } from "@/lib/track-order-products";

export const metadata: Metadata = { title: "Track Your Order" };

/**
 * The order-tracking page. The lookup form and the order details share the
 * narrow column (the shopper reads one order at a time); the product row
 * underneath is full width, like the related row on a product page.
 *
 * The products are the store's own published products - not a personalised
 * pick: this page knows nothing about the shopper until they look something
 * up, and even then it never uses the order to choose them.
 */
export default async function TrackOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  const { order } = await searchParams;
  const recommendations = await fetchTrackRecommendations();
  return (
    <>
      {/* The heading and the lookup form live inside the client component:
          once an order is open the column shows the order details. */}
      <div className="mx-auto max-w-[600px] px-4 py-12 sm:px-6">
        <TrackOrderForm prefillOrder={order} />
      </div>
      <TrackRecommendations products={recommendations} />
    </>
  );
}
