import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { purchaseEvent, storePurchasePayload } from "@/lib/commerce-events";
import { PurchaseTracking } from "./PurchaseTracking";

const tracking = vi.hoisted(() => ({ track: vi.fn(), trackCustom: vi.fn() }));
vi.mock("@/lib/tracking", () => ({
  track: tracking.track,
  trackCustom: tracking.trackCustom,
}));

/**
 * Final review fix wave: the success-page Purchase fires at most once per
 * order number per tab. The stashed payload is consumed exactly once, but
 * the fail-open path (payload absent) used to re-fire a valueless Purchase
 * on every refresh; a per-order sessionStorage marker now guards the emit.
 */

beforeEach(() => {
  tracking.track.mockReset();
  tracking.trackCustom.mockReset();
  window.sessionStorage.clear();
});

function stashedPurchase(orderNumber: string) {
  return purchaseEvent({
    orderId: orderNumber,
    items: [{ skuId: "sku-red-small", quantity: 2 }],
    value: 200,
  });
}

describe("PurchaseTracking", () => {
  it("fires the stashed payload Purchase on the first load", () => {
    storePurchasePayload(stashedPurchase("ORD-1"));

    render(<PurchaseTracking orderNumber="ORD-1" />);

    expect(tracking.track).toHaveBeenCalledTimes(1);
    expect(tracking.track).toHaveBeenCalledWith(
      "Purchase",
      expect.objectContaining({ order_id: "ORD-1", value: 200 }),
    );
  });

  it("a refresh after the payload load never re-fires the Purchase", () => {
    storePurchasePayload(stashedPurchase("ORD-1"));

    const first = render(<PurchaseTracking orderNumber="ORD-1" />);
    first.unmount();
    // Refresh simulation: the payload was consumed, the page remounts empty.
    render(<PurchaseTracking orderNumber="ORD-1" />);
    render(<PurchaseTracking orderNumber="ORD-1" />);

    expect(tracking.track).toHaveBeenCalledTimes(1);
  });

  it("a valueless first load (payload lost) still fires at most once per order number", () => {
    render(<PurchaseTracking orderNumber="ORD-1" />);
    render(<PurchaseTracking orderNumber="ORD-1" />);

    expect(tracking.track).toHaveBeenCalledTimes(1);
    expect(tracking.track).toHaveBeenCalledWith(
      "Purchase",
      expect.objectContaining({ order_id: "ORD-1", content_ids: [] }),
    );
  });

  it("a different order number still fires (fail-open stays per order)", () => {
    render(<PurchaseTracking orderNumber="ORD-1" />);

    render(<PurchaseTracking orderNumber="ORD-2" />);

    expect(tracking.track).toHaveBeenCalledTimes(2);
    expect(tracking.track).toHaveBeenLastCalledWith(
      "Purchase",
      expect.objectContaining({ order_id: "ORD-2" }),
    );
  });
});
