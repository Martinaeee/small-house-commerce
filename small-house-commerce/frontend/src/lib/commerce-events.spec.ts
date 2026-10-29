import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addToCartEvent,
  consumePurchasePayload,
  emitCommerceEvent,
  initiateCheckoutEvent,
  optionSelectEvent,
  purchaseEvent,
  storePurchasePayload,
  variantConfirmEvent,
  variantUnavailableEvent,
  viewContentEvent,
  type CommerceEvent,
} from "./commerce-events";

/**
 * Task 19: one commerce-event adapter keyed by final SKU IDs (design spec
 * §12.3). Every conversion payload carries the FINAL SKU id; the custom
 * funnel events (option_select / variant_confirm / variant_unavailable) are
 * Meta custom events; the standard funnel (ViewContent / AddToCart /
 * InitiateCheckout / Purchase) goes through the standard track channel.
 * Builders that cannot honestly name a final SKU return null — the caller
 * then emits nothing (no unconfirmed / unidentifiable events).
 */

const tracking = vi.hoisted(() => ({ track: vi.fn(), trackCustom: vi.fn() }));
vi.mock("@/lib/tracking", () => ({
  track: tracking.track,
  trackCustom: tracking.trackCustom,
}));

const analytics = vi.hoisted(() => ({ trackFirstParty: vi.fn() }));
vi.mock("@/lib/analytics", () => ({
  trackFirstParty: analytics.trackFirstParty,
}));

const metaCapi = vi.hoisted(() => ({ sendMetaServerEvent: vi.fn() }));
vi.mock("./meta-capi", () => metaCapi);

function eventNames(events: CommerceEvent[]): string[] {
  return events.map((event) => event.name);
}

describe("standard events keyed by the final SKU", () => {
  beforeEach(() => {
    tracking.track.mockReset();
    tracking.trackCustom.mockReset();
  });

  it("builds ViewContent from the displayed SKU (deep link or default display)", () => {
    const event = viewContentEvent({
      productId: "prod-1",
      productName: "Rattan Chair",
      skuId: "sku-blue",
      price: 1299,
    });
    expect(event.name).toBe("ViewContent");
    expect(event.custom).toBe(false);
    expect(event.data).toEqual({
      content_ids: ["sku-blue"],
      content_name: "Rattan Chair",
      content_type: "product",
      value: 1299,
      currency: "PHP",
    });
  });

  it("falls back to the product id for ViewContent only when no SKU is displayed", () => {
    const event = viewContentEvent({
      productId: "prod-1",
      productName: "Rattan Chair",
      skuId: null,
      price: null,
    });
    expect(event.data.content_ids).toEqual(["prod-1"]);
    expect(event.data.value).toBeUndefined();
  });

  it("builds AddToCart from the actually added SKU and quantity", () => {
    const event = addToCartEvent({
      productId: "prod-1",
      productName: "Rattan Chair",
      skuId: "sku-blue",
      quantity: 2,
      price: 1299,
    });
    expect(event).not.toBeNull();
    expect(event?.name).toBe("AddToCart");
    expect(event?.custom).toBe(false);
    expect(event?.data).toEqual({
      content_ids: ["sku-blue"],
      content_name: "Rattan Chair",
      content_type: "product",
      contents: [{ id: "sku-blue", quantity: 2 }],
      value: 2598,
      currency: "PHP",
    });
  });

  it("refuses AddToCart without a final SKU or a positive quantity", () => {
    expect(
      addToCartEvent({
        productId: "prod-1",
        productName: "Rattan Chair",
        skuId: null,
        quantity: 1,
        price: 1299,
      }),
    ).toBeNull();
    expect(
      addToCartEvent({
        productId: "prod-1",
        productName: "Rattan Chair",
        skuId: "sku-blue",
        quantity: 0,
        price: 1299,
      }),
    ).toBeNull();
  });

  it("builds InitiateCheckout from the checkout SKU list", () => {
    const event = initiateCheckoutEvent({
      items: [
        { skuId: "sku-a", quantity: 1 },
        { skuId: "sku-b", quantity: 3 },
      ],
      value: 4597,
    });
    expect(event).not.toBeNull();
    expect(event?.name).toBe("InitiateCheckout");
    expect(event?.custom).toBe(false);
    expect(event?.data).toEqual({
      content_ids: ["sku-a", "sku-b"],
      content_type: "product",
      contents: [
        { id: "sku-a", quantity: 1 },
        { id: "sku-b", quantity: 3 },
      ],
      value: 4597,
      currency: "PHP",
    });
  });

  it("refuses InitiateCheckout without any SKU", () => {
    expect(initiateCheckoutEvent({ items: [], value: 100 })).toBeNull();
  });

  it("builds Purchase from the order SKU list and order number", () => {
    const event = purchaseEvent({
      orderId: "LW-1001",
      items: [{ skuId: "sku-a", quantity: 2 }],
      value: 2598,
    });
    expect(event.name).toBe("Purchase");
    expect(event.custom).toBe(false);
    expect(event.data).toEqual({
      content_type: "product",
      order_id: "LW-1001",
      content_ids: ["sku-a"],
      contents: [{ id: "sku-a", quantity: 2 }],
      value: 2598,
      currency: "PHP",
    });
  });

  it("still builds a fail-open Purchase without items or value", () => {
    // Order creation IS the purchase event (TRACKING_SPEC §12); a lost
    // tab-scoped payload degrades to order_id only, never to no event.
    const event = purchaseEvent({ orderId: "LW-1002", items: [], value: null });
    expect(event.data.order_id).toBe("LW-1002");
    expect(event.data.contents).toEqual([]);
    expect(event.data.value).toBeUndefined();
  });
});

describe("custom funnel events", () => {
  beforeEach(() => {
    tracking.track.mockReset();
    tracking.trackCustom.mockReset();
  });

  it("builds option_select with the design-spec payload", () => {
    const event = optionSelectEvent({
      productId: "prod-1",
      optionKind: "COLOR",
      optionValueId: "value-red",
      selectionSource: "USER",
    });
    expect(event.name).toBe("option_select");
    expect(event.custom).toBe(true);
    expect(event.data).toEqual({
      product_id: "prod-1",
      option_kind: "COLOR",
      option_value_id: "value-red",
      selection_source: "USER",
    });
  });

  it("builds variant_confirm only for a resolved final SKU", () => {
    const event = variantConfirmEvent({
      productId: "prod-1",
      variantId: "variant-blue",
      skuId: "sku-blue",
      source: "PDP",
    });
    expect(event?.name).toBe("variant_confirm");
    expect(event?.custom).toBe(true);
    expect(event?.data).toEqual({
      product_id: "prod-1",
      variant_id: "variant-blue",
      sku_id: "sku-blue",
      source: "PDP",
    });
    expect(
      variantConfirmEvent({
        productId: "prod-1",
        variantId: "variant-blue",
        skuId: null,
        source: "PDP",
      }),
    ).toBeNull();
    expect(
      variantConfirmEvent({
        productId: "prod-1",
        variantId: "",
        skuId: "sku-blue",
        source: "PDP",
      }),
    ).toBeNull();
  });

  it("builds variant_unavailable with the selected values and reason", () => {
    const missing = variantUnavailableEvent({
      productId: "prod-1",
      selectedValueIds: { color: "value-red" },
      reason: "MISSING",
    });
    expect(missing.name).toBe("variant_unavailable");
    expect(missing.custom).toBe(true);
    expect(missing.data).toEqual({
      product_id: "prod-1",
      selected_value_ids: { color: "value-red" },
      missing_or_oos: "MISSING",
    });
    const oos = variantUnavailableEvent({
      productId: "prod-1",
      selectedValueIds: {},
      reason: "OOS",
    });
    expect(oos.data.missing_or_oos).toBe("OOS");
  });
});

describe("emitCommerceEvent", () => {
  beforeEach(() => {
    tracking.track.mockReset();
    tracking.trackCustom.mockReset();
    analytics.trackFirstParty.mockReset();
    metaCapi.sendMetaServerEvent.mockReset();
  });

  it("routes standard events through track with the shared event id", () => {
    emitCommerceEvent(purchaseEvent({ orderId: "LW-1", items: [], value: null }));
    expect(tracking.track).toHaveBeenCalledTimes(1);
    expect(tracking.track).toHaveBeenCalledWith("Purchase", expect.any(Object), {
      eventID: "purchase-LW-1",
    });
    expect(tracking.trackCustom).not.toHaveBeenCalled();
  });

  it("routes custom events through trackCustom", () => {
    emitCommerceEvent(
      optionSelectEvent({
        productId: "prod-1",
        optionKind: "COLOR",
        optionValueId: "value-red",
        selectionSource: "USER",
      }),
    );
    expect(tracking.trackCustom).toHaveBeenCalledTimes(1);
    expect(tracking.trackCustom).toHaveBeenCalledWith(
      "option_select",
      expect.any(Object),
    );
    expect(tracking.track).not.toHaveBeenCalled();
  });

  it("is a no-op for a refused (null) event", () => {
    emitCommerceEvent(null);
    expect(tracking.track).not.toHaveBeenCalled();
    expect(tracking.trackCustom).not.toHaveBeenCalled();
    expect(analytics.trackFirstParty).not.toHaveBeenCalled();
  });

  it("records a product view in first-party analytics with the product id", () => {
    emitCommerceEvent(
      viewContentEvent({
        productId: "prod-1",
        productName: "Oak Chair",
        skuId: "sku-1",
        price: 100,
      }),
    );
    expect(analytics.trackFirstParty).toHaveBeenCalledWith("PRODUCT_VIEW", {
      productId: "prod-1",
    });
  });

  it("records an add to cart in first-party analytics with the product id and final SKU", () => {
    emitCommerceEvent(
      addToCartEvent({
        productId: "prod-1",
        productName: "Oak Chair",
        skuId: "sku-1",
        quantity: 2,
        price: 100,
      }),
    );
    expect(analytics.trackFirstParty).toHaveBeenCalledWith("ADD_TO_CART", {
      productId: "prod-1",
      entityId: "sku-1",
    });
  });

  it("records the start of checkout in first-party analytics with the SKU list", () => {
    emitCommerceEvent(
      initiateCheckoutEvent({
        items: [
          { skuId: "sku-1", quantity: 1 },
          { skuId: "sku-2", quantity: 3 },
        ],
        value: 100,
      }),
    );
    expect(analytics.trackFirstParty).toHaveBeenCalledWith("BEGIN_CHECKOUT", {
      productId: null,
      entityId: "sku-1,sku-2",
    });
  });

  it("truncates a long checkout SKU list to the 120-character entity bound", () => {
    emitCommerceEvent(
      initiateCheckoutEvent({ items: [{ skuId: "s".repeat(300), quantity: 1 }], value: null }),
    );
    const payload = analytics.trackFirstParty.mock.calls[0][1] as {
      entityId: string | null;
    };
    expect(payload.entityId).toHaveLength(120);
  });

  it("records an empty checkout basket with a null entityId", () => {
    emitCommerceEvent(initiateCheckoutEvent({ items: [], value: null }));
    // A zero-item basket is refused by the builder; nothing reaches the funnel.
    expect(analytics.trackFirstParty).not.toHaveBeenCalled();
  });

  it("records a purchase in first-party analytics keyed by order number", () => {
    emitCommerceEvent(purchaseEvent({ orderId: "LW-1", items: [], value: null }));
    expect(analytics.trackFirstParty).toHaveBeenCalledWith("PURCHASE", {
      entityId: "LW-1",
    });
  });

  it("does not record custom funnel events in the first-party funnel", () => {
    emitCommerceEvent(
      variantConfirmEvent({
        productId: "prod-1",
        variantId: "var-1",
        skuId: "sku-1",
        source: "PDP",
      }),
    );
    expect(analytics.trackFirstParty).not.toHaveBeenCalled();
  });

  it("mirrors the upper funnel to the server-side API with the same event id", () => {
    const event = viewContentEvent({
      productId: "prod-1",
      productName: "Oak Chair",
      skuId: "sku-1",
      price: 100,
    });
    emitCommerceEvent(event);
    expect(metaCapi.sendMetaServerEvent).toHaveBeenCalledWith({
      name: "ViewContent",
      eventId: event.eventId,
      data: event.data,
    });
  });

  it("leaves Purchase to the backend outbox instead of the browser bridge", () => {
    emitCommerceEvent(purchaseEvent({ orderId: "LW-9", items: [], value: null }));
    expect(metaCapi.sendMetaServerEvent).not.toHaveBeenCalled();
  });

  it("keeps custom funnel events pixel-only", () => {
    emitCommerceEvent(
      optionSelectEvent({
        productId: "prod-1",
        optionKind: "COLOR",
        optionValueId: "value-red",
        selectionSource: "USER",
      }),
    );
    expect(metaCapi.sendMetaServerEvent).not.toHaveBeenCalled();
  });
});

describe("event identity", () => {
  it("gives every occurrence its own id so Pixel and CAPI dedupe by event", () => {
    const first = viewContentEvent({
      productId: "prod-1",
      productName: "Rattan Chair",
      skuId: "sku-blue",
      price: 1299,
    });
    const second = viewContentEvent({
      productId: "prod-1",
      productName: "Rattan Chair",
      skuId: "sku-blue",
      price: 1299,
    });
    expect(first.eventId).toMatch(/^[A-Za-z0-9_-]{8,100}$/);
    expect(second.eventId).toMatch(/^[A-Za-z0-9_-]{8,100}$/);
    expect(first.eventId).not.toBe(second.eventId);
  });

  it("keys Purchase by order number so the browser and the backend agree", () => {
    expect(
      purchaseEvent({ orderId: "LW-1001", items: [], value: null }).eventId,
    ).toBe("purchase-LW-1001");
  });
});

describe("tab-scoped purchase payload", () => {
  beforeEach(() => {
    tracking.track.mockReset();
    tracking.trackCustom.mockReset();
    analytics.trackFirstParty.mockReset();
    window.sessionStorage.clear();
  });

  it("stores the Purchase event before navigation and consumes it exactly once", () => {
    const event = purchaseEvent({
      orderId: "LW-1003",
      items: [{ skuId: "sku-a", quantity: 1 }],
      value: 1299,
    });
    expect(storePurchasePayload(event)).toBe(true);
    const consumed = consumePurchasePayload("LW-1003");
    expect(consumed).toEqual(event);
    expect(consumed?.eventId).toBe("purchase-LW-1003");
    // Consumed once: a second read (page refresh) finds nothing.
    expect(consumePurchasePayload("LW-1003")).toBeNull();
    expect(window.sessionStorage.getItem("luwag_purchase_payload")).toBeNull();
  });

  it("restores a legacy payload without an id under the order-keyed id", () => {
    window.sessionStorage.setItem(
      "luwag_purchase_payload",
      JSON.stringify({ name: "Purchase", data: { order_id: "LW-2002" } }),
    );
    const consumed = consumePurchasePayload("LW-2002");
    expect(consumed?.eventId).toBe("purchase-LW-2002");
  });

  it("refuses a payload that belongs to a different order", () => {
    storePurchasePayload(purchaseEvent({ orderId: "LW-1", items: [], value: 99 }));
    expect(consumePurchasePayload("LW-OTHER")).toBeNull();
    expect(window.sessionStorage.getItem("luwag_purchase_payload")).toBeNull();
  });

  it("returns null for corrupted payloads instead of throwing", () => {
    window.sessionStorage.setItem("luwag_purchase_payload", "{not json");
    expect(consumePurchasePayload("LW-1")).toBeNull();
    window.sessionStorage.setItem(
      "luwag_purchase_payload",
      JSON.stringify({ name: "ViewContent", data: {} }),
    );
    expect(consumePurchasePayload("LW-1")).toBeNull();
  });

  it("survives unavailable storage when storing", () => {
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota");
      });
    expect(
      storePurchasePayload(purchaseEvent({ orderId: "LW-1", items: [], value: null })),
    ).toBe(false);
    setItem.mockRestore();
  });
});

describe("event inventory", () => {
  it("keeps the design-spec event names stable", () => {
    const events = [
      viewContentEvent({
        productId: "p",
        productName: "n",
        skuId: "s",
        price: 1,
      }),
      addToCartEvent({
        productId: "p",
        productName: "n",
        skuId: "s",
        quantity: 1,
        price: 1,
      }),
      initiateCheckoutEvent({ items: [{ skuId: "s", quantity: 1 }], value: 1 }),
      purchaseEvent({ orderId: "o", items: [], value: null }),
      optionSelectEvent({
        productId: "p",
        optionKind: "COLOR",
        optionValueId: "v",
        selectionSource: "USER",
      }),
      variantConfirmEvent({
        productId: "p",
        variantId: "v",
        skuId: "s",
        source: "PDP",
      }),
      variantUnavailableEvent({
        productId: "p",
        selectedValueIds: {},
        reason: "OOS",
      }),
    ].filter((event): event is CommerceEvent => event !== null);
    expect(eventNames(events)).toEqual([
      "ViewContent",
      "AddToCart",
      "InitiateCheckout",
      "Purchase",
      "option_select",
      "variant_confirm",
      "variant_unavailable",
    ]);
  });
});
