"use client";

import { useEffect } from "react";
import { track } from "@/lib/tracking";

/**
 * TRACKING_SPEC §12 Purchase: COD order creation IS the purchase event.
 * The order total was stashed in sessionStorage at place-order time because
 * the success page only receives the order number.
 */
export function PurchaseTracking({ orderNumber }: { orderNumber: string }) {
  useEffect(() => {
    const value = Number(sessionStorage.getItem("lastOrderTotal") ?? 0);
    track("Purchase", {
      content_type: "product",
      order_id: orderNumber,
      value: value || undefined,
      currency: "PHP",
    });
    sessionStorage.removeItem("lastOrderTotal");
  }, [orderNumber]);

  return null;
}
