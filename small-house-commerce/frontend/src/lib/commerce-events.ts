/**
 * One commerce-event adapter keyed by FINAL SKU IDs (design spec §12.3,
 * TRACKING_SPEC §12). Every surface — PDP, Quick Add, cart, checkout —
 * builds its events here so payloads stay identical funnel-wide.
 *
 * Channels: the four Meta standard events (ViewContent / AddToCart /
 * InitiateCheckout / Purchase) go through `track`; the custom funnel events
 * (option_select / variant_confirm / variant_unavailable) go through
 * `trackCustom`. Builders that cannot honestly name a final SKU return
 * null and the caller emits nothing — option browsing, picker opens and
 * cancellations never produce conversion events, and a conversion is only
 * emitted after the underlying action succeeded.
 */

import { track, trackCustom } from "./tracking";

export interface CommerceEvent {
  name: string;
  data: Record<string, unknown>;
  /** true → Meta custom event (trackCustom); false → standard event (track). */
  custom: boolean;
}

export interface CommerceCheckoutItem {
  skuId: string;
  quantity: number;
}

export type VariantUnavailableReason = "MISSING" | "OOS";

/** sessionStorage key for the purchase payload stashed before navigation. */
export const PURCHASE_PAYLOAD_STORAGE_KEY = "luwag_purchase_payload";

/** ViewContent for the SKU actually displayed (deep link or default display). */
export function viewContentEvent(input: {
  productId: string;
  productName: string;
  skuId: string | null;
  price: number | null;
}): CommerceEvent {
  return {
    name: "ViewContent",
    custom: false,
    data: {
      content_ids: [input.skuId ?? input.productId],
      content_name: input.productName,
      content_type: "product",
      value: input.price ?? undefined,
      currency: "PHP",
    },
  };
}

/** AddToCart for the SKU actually added; null without a final SKU/quantity. */
export function addToCartEvent(input: {
  productId: string;
  productName: string;
  skuId: string | null;
  quantity: number;
  price: number | null;
}): CommerceEvent | null {
  if (input.skuId === null || !(input.quantity > 0)) return null;
  return {
    name: "AddToCart",
    custom: false,
    data: {
      content_ids: [input.skuId],
      content_name: input.productName,
      content_type: "product",
      contents: [{ id: input.skuId, quantity: input.quantity }],
      value:
        input.price !== null ? input.price * input.quantity : undefined,
      currency: "PHP",
    },
  };
}

/** InitiateCheckout for the checkout SKU list; null when it holds no SKU. */
export function initiateCheckoutEvent(input: {
  items: readonly CommerceCheckoutItem[];
  value: number | null;
}): CommerceEvent | null {
  if (input.items.length === 0) return null;
  return {
    name: "InitiateCheckout",
    custom: false,
    data: {
      content_ids: input.items.map((item) => item.skuId),
      content_type: "product",
      contents: input.items.map((item) => ({
        id: item.skuId,
        quantity: item.quantity,
      })),
      value: input.value ?? undefined,
      currency: "PHP",
    },
  };
}

/**
 * Purchase for the order SKU list. Order creation IS the purchase event
 * (TRACKING_SPEC §12), so this builder never returns null: a lost or
 * unavailable payload degrades to order_id only.
 */
export function purchaseEvent(input: {
  orderId: string;
  items: readonly CommerceCheckoutItem[];
  value: number | null;
}): CommerceEvent {
  return {
    name: "Purchase",
    custom: false,
    data: {
      content_type: "product",
      order_id: input.orderId,
      content_ids: input.items.map((item) => item.skuId),
      contents: input.items.map((item) => ({
        id: item.skuId,
        quantity: item.quantity,
      })),
      value: input.value ?? undefined,
      currency: "PHP",
    },
  };
}

/** option_select: the shopper picked an option value (design spec §12.3). */
export function optionSelectEvent(input: {
  productId: string;
  optionKind: string;
  optionValueId: string;
  selectionSource: string;
}): CommerceEvent {
  return {
    name: "option_select",
    custom: true,
    data: {
      product_id: input.productId,
      option_kind: input.optionKind,
      option_value_id: input.optionValueId,
      selection_source: input.selectionSource,
    },
  };
}

/** variant_confirm: a combination was confirmed for purchase; null otherwise. */
export function variantConfirmEvent(input: {
  productId: string;
  variantId: string | null;
  skuId: string | null;
  source: string;
}): CommerceEvent | null {
  if (input.variantId === null || input.variantId === "") return null;
  if (input.skuId === null || input.skuId === "") return null;
  return {
    name: "variant_confirm",
    custom: true,
    data: {
      product_id: input.productId,
      variant_id: input.variantId,
      sku_id: input.skuId,
      source: input.source,
    },
  };
}

/** variant_unavailable: a purchase attempt hit a missing or sold-out SKU. */
export function variantUnavailableEvent(input: {
  productId: string;
  selectedValueIds: Readonly<Record<string, string>>;
  reason: VariantUnavailableReason;
}): CommerceEvent {
  return {
    name: "variant_unavailable",
    custom: true,
    data: {
      product_id: input.productId,
      selected_value_ids: { ...input.selectedValueIds },
      missing_or_oos: input.reason,
    },
  };
}

/** Fires through the right Meta channel; null-safe so callers can pass builders' refusals. */
export function emitCommerceEvent(event: CommerceEvent | null): void {
  if (event === null) return;
  if (event.custom) trackCustom(event.name, event.data);
  else track(event.name, event.data);
}

/**
 * Stashes the successful Purchase event tab-scoped (sessionStorage) BEFORE
 * the success-page navigation, because the success page only receives the
 * order number. Storage failures are swallowed: the success page still
 * fires a fail-open Purchase keyed by the order number.
 */
export function storePurchasePayload(event: CommerceEvent): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.sessionStorage.setItem(
      PURCHASE_PAYLOAD_STORAGE_KEY,
      JSON.stringify({ name: event.name, data: event.data }),
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Consumes the stashed Purchase payload exactly once: it is removed before
 * it is parsed, so a refresh can never re-attribute the same payload. A
 * payload naming a different order is refused (and still consumed) — the
 * page's own order number must never inherit another order's value.
 */
export function consumePurchasePayload(orderId: string): CommerceEvent | null {
  if (typeof window === "undefined") return null;
  let raw: string | null;
  try {
    raw = window.sessionStorage.getItem(PURCHASE_PAYLOAD_STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    window.sessionStorage.removeItem(PURCHASE_PAYLOAD_STORAGE_KEY);
  } catch {
    // Consume-once is best effort; a leftover payload is refused by order id.
  }
  try {
    const parsed = JSON.parse(raw) as { name?: unknown; data?: unknown };
    if (parsed.name !== "Purchase") return null;
    if (typeof parsed.data !== "object" || parsed.data === null) return null;
    const data = parsed.data as Record<string, unknown>;
    if (data.order_id !== orderId) return null;
    return { name: "Purchase", custom: false, data };
  } catch {
    return null;
  }
}
