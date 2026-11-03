import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { purchaseEvent, storePurchasePayload } from "@/lib/commerce-events";
import { PurchaseTracking } from "./PurchaseTracking";

const tracking = vi.hoisted(() => ({ track: vi.fn(), trackCustom: vi.fn() }));
vi.mock("@/lib/tracking", () => ({
  currentMarketingCredential: vi.fn(() => null),
  track: tracking.track,
  trackCustom: tracking.trackCustom,
}));

const analytics = vi.hoisted(() => ({ trackFirstParty: vi.fn() }));
vi.mock("@/lib/analytics", () => ({
  trackFirstParty: analytics.trackFirstParty,
}));

const consent = vi.hoisted(() => ({ hasAdsConsent: vi.fn(() => true) }));
vi.mock("@/lib/consent", () => ({ hasAdsConsent: consent.hasAdsConsent }));

/**
 * Task C: the success page only sends a Meta Purchase when it still holds the
 * payload stashed at submit — the server outbox is the authoritative copy for
 * every consented order. A success page without that payload (refresh after
 * consumption, another tab, unavailable storage, a link opened later) must
 * never emit a valueless Purchase under the same event id; it only records
 * the first-party PURCHASE, which must never be lost. The stashed payload
 * also carries the submit-time consent: Meta is only reached when the
 * shopper accepted then AND still accepts now.
 */

beforeEach(() => {
  tracking.track.mockReset();
  tracking.trackCustom.mockReset();
  analytics.trackFirstParty.mockReset();
  consent.hasAdsConsent.mockReset();
  consent.hasAdsConsent.mockReturnValue(true);
  window.sessionStorage.clear();
});

function stash(orderNumber: string, stashedConsent: boolean, value = 200) {
  storePurchasePayload(
    purchaseEvent({
      orderId: orderNumber,
      items: [{ skuId: "sku-red-small", quantity: 2 }],
      value,
    }),
    stashedConsent,
  );
}

describe("PurchaseTracking", () => {
  it("fires the stashed payload Purchase once with the server value", () => {
    stash("ORD-1", true);

    render(<PurchaseTracking orderNumber="ORD-1" />);

    expect(tracking.track).toHaveBeenCalledTimes(1);
    expect(tracking.track).toHaveBeenCalledWith(
      "Purchase",
      expect.objectContaining({ order_id: "ORD-1", value: 200 }),
      { eventID: "purchase-ORD-1" },
    );
    expect(analytics.trackFirstParty).toHaveBeenCalledTimes(1);
    expect(analytics.trackFirstParty).toHaveBeenCalledWith("PURCHASE", {
      entityId: "ORD-1",
    });
  });

  it("a refresh after the payload load never re-fires the Purchase", () => {
    stash("ORD-1", true);

    const first = render(<PurchaseTracking orderNumber="ORD-1" />);
    first.unmount();
    // Refresh simulation: the payload was consumed, the page remounts empty.
    render(<PurchaseTracking orderNumber="ORD-1" />);
    render(<PurchaseTracking orderNumber="ORD-1" />);

    expect(tracking.track).toHaveBeenCalledTimes(1);
    expect(analytics.trackFirstParty).toHaveBeenCalledTimes(1);
  });

  it("without a stashed payload records first-party only and never sends a valueless Meta twin", () => {
    render(<PurchaseTracking orderNumber="ORD-1" />);
    render(<PurchaseTracking orderNumber="ORD-1" />);

    expect(tracking.track).not.toHaveBeenCalled();
    expect(analytics.trackFirstParty).toHaveBeenCalledTimes(1);
    expect(analytics.trackFirstParty).toHaveBeenCalledWith("PURCHASE", {
      entityId: "ORD-1",
    });
  });

  it("a payload stashed without consent never reaches Meta, even when consent was granted later", () => {
    stash("ORD-1", false);
    consent.hasAdsConsent.mockReturnValue(true);

    render(<PurchaseTracking orderNumber="ORD-1" />);

    expect(tracking.track).not.toHaveBeenCalled();
    expect(analytics.trackFirstParty).toHaveBeenCalledTimes(1);
  });

  it("a payload stashed with consent stays off Meta after the shopper withdrew", () => {
    stash("ORD-1", true);
    consent.hasAdsConsent.mockReturnValue(false);

    render(<PurchaseTracking orderNumber="ORD-1" />);

    expect(tracking.track).not.toHaveBeenCalled();
    expect(analytics.trackFirstParty).toHaveBeenCalledTimes(1);
  });

  it("a legacy payload without a consent snapshot follows the live choice", () => {
    window.sessionStorage.setItem(
      "luwag_purchase_payload",
      JSON.stringify({
        name: "Purchase",
        eventId: "purchase-ORD-1",
        data: { order_id: "ORD-1", value: 200, currency: "PHP" },
      }),
    );

    render(<PurchaseTracking orderNumber="ORD-1" />);

    expect(tracking.track).toHaveBeenCalledTimes(1);
    expect(tracking.track).toHaveBeenCalledWith(
      "Purchase",
      expect.objectContaining({ order_id: "ORD-1", value: 200 }),
      { eventID: "purchase-ORD-1" },
    );
  });

  it("another tab (empty sessionStorage) never re-sends the Meta Purchase", () => {
    stash("ORD-1", true);
    render(<PurchaseTracking orderNumber="ORD-1" />);
    expect(tracking.track).toHaveBeenCalledTimes(1);

    // A new tab has its own sessionStorage: no payload, no fired marker.
    window.sessionStorage.clear();
    render(<PurchaseTracking orderNumber="ORD-1" />);

    expect(tracking.track).toHaveBeenCalledTimes(1);
    // First-party still records the order in that tab (never lost).
    expect(analytics.trackFirstParty).toHaveBeenCalledTimes(2);
  });

  it("a second order in the same tab is not blocked by the first order's marker", () => {
    stash("ORD-1", true);
    render(<PurchaseTracking orderNumber="ORD-1" />);
    expect(tracking.track).toHaveBeenCalledTimes(1);

    // The tab checks out again: the confirm view stashes a fresh payload
    // under the same single storage key.
    stash("ORD-2", true);
    render(<PurchaseTracking orderNumber="ORD-2" />);

    expect(tracking.track).toHaveBeenCalledTimes(2);
    expect(tracking.track).toHaveBeenLastCalledWith(
      "Purchase",
      expect.objectContaining({ order_id: "ORD-2" }),
      { eventID: "purchase-ORD-2" },
    );
  });
});
