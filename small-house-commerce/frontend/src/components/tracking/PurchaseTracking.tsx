"use client";

import { useEffect } from "react";
import {
  consumePurchasePayload,
  emitCommerceEvent,
  markPurchaseFired,
  purchaseAlreadyFired,
  recordPurchaseFirstParty,
} from "@/lib/commerce-events";
import { hasAdsConsent } from "@/lib/consent";

/**
 * TRACKING_SPEC §12 Purchase: COD order creation IS the purchase event.
 * CheckoutConfirmView stashes the full event payload (final SKU list, server
 * value and the submit-time consent) tab-scoped in sessionStorage BEFORE
 * navigating here, because the success page only receives the order number.
 * That payload is consumed exactly once.
 *
 * The Meta event only fires while that payload is held and both the stashed
 * and the live consent say yes: the backend outbox already sent its copy
 * under the same event id for every consented order, and a payload-less
 * fire would add a valueless twin (a refresh after consumption, another
 * tab, unavailable storage, or a success link opened later all land here).
 * The first-party PURCHASE is recorded either way — it must never depend on
 * the ad channels.
 *
 * The emit is once per order number per tab: a refresh consumes no payload
 * and must not re-record the order, so both branches are guarded by a
 * per-order marker.
 */
export function PurchaseTracking({ orderNumber }: { orderNumber: string }) {
  useEffect(() => {
    const stashed = consumePurchasePayload(orderNumber);
    if (purchaseAlreadyFired(orderNumber)) return;
    try {
      if (stashed !== null && stashed.consent !== false && hasAdsConsent()) {
        emitCommerceEvent(stashed.event);
      } else {
        recordPurchaseFirstParty(orderNumber);
      }
    } finally {
      markPurchaseFired(orderNumber);
    }
  }, [orderNumber]);

  return null;
}
