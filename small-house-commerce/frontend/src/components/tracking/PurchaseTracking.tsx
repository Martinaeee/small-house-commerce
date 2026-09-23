"use client";

import { useEffect } from "react";
import {
  consumePurchasePayload,
  emitCommerceEvent,
  markPurchaseFired,
  purchaseAlreadyFired,
  purchaseEvent,
} from "@/lib/commerce-events";

/**
 * TRACKING_SPEC §12 Purchase: COD order creation IS the purchase event.
 * CheckoutConfirmView stashes the full event payload (final SKU list + order
 * value) tab-scoped in sessionStorage BEFORE navigating here, because the
 * success page only receives the order number. That payload is consumed
 * exactly once; when it is absent (storage unavailable, a refreshed older
 * success page, a different order's payload) the event still fires, keyed
 * by this page's order number alone.
 *
 * The emit is once per order number per tab: a refresh consumes no payload
 * and must not re-fire a valueless Purchase, so the fail-open emit is
 * guarded by a per-order marker. Storage-unavailable stays fully fail-open.
 */
export function PurchaseTracking({ orderNumber }: { orderNumber: string }) {
  useEffect(() => {
    const stored = consumePurchasePayload(orderNumber);
    if (purchaseAlreadyFired(orderNumber)) return;
    emitCommerceEvent(
      stored ??
        purchaseEvent({ orderId: orderNumber, items: [], value: null }),
    );
    markPurchaseFired(orderNumber);
  }, [orderNumber]);

  return null;
}
