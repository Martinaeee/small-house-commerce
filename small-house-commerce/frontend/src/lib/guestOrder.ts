/**
 * Guest order lookup client (guest-order-tracking spec §3.1/§3.2, Batch C;
 * revised 2026-10-21 — the shopper may give the order number OR the mobile
 * number, either one is enough).
 *
 * Standalone on purpose: lib/api.ts is frozen (spec §2), so track-order owns
 * this small fetch wrapper instead of extending the shared `api` object.
 * Browser-only: the relative /api/v1 path is proxied to the backend by
 * next.config.ts rewrites, so there is no CORS.
 *
 * Money fields are typed as `string`: Prisma Decimal columns serialize as
 * JSON strings (same convention as lib/admin-api.ts). Display code
 * Number()-coerces before passing to formatPrice (which takes a number).
 */

import type { OrderOptionSnapshotV1 } from "./order-options";

// --- enums (mirror backend/prisma/schema/order.prisma) -----------------------

export type OrderStatus =
  | "NEW"
  | "PENDING"
  | "QUESTION"
  | "CONFIRMED"
  | "ABNORMAL"
  | "SHIPPING"
  | "SIGNED"
  | "CANCELLED"
  | "DENIED"
  | "AFTER_SALES";

export type ConfirmationStatus =
  | "UNCONFIRMED"
  | "NEEDS_REVIEW"
  | "CONFIRMED"
  | "REJECTED";

export type PaymentStatus =
  | "COD_PENDING"
  | "COLLECTED"
  | "SETTLEMENT_PENDING"
  | "SETTLED"
  | "ONLINE_PENDING"
  | "PAID"
  | "FAILED"
  | "REFUNDED"
  | "PARTIALLY_REFUNDED";

// --- response shape (mirrors OrdersService.lookup) ---------------------------

/**
 * The customer fields are null when the order was found by its order number
 * alone: a guessable number must not hand out a name, a phone or an address.
 */
export interface GuestOrderCustomer {
  id: string | null;
  name: string | null;
  /** E.164 identity key; null while the personal details are withheld. */
  normalizedPhone: string | null;
  email: string | null;
}

export interface GuestOrderItem {
  id: string;
  productId: string | null;
  variantId: string | null;
  skuId: string;
  productNameSnapshot: string;
  skuCodeSnapshot: string;
  variantSnapshot: string;
  /** Stored order-time structured snapshot; null on pre-typed-options lines. */
  optionSnapshot: OrderOptionSnapshotV1 | null;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  /** The product photo for this line; null when the product has no image. */
  thumbnailUrl: string | null;
  /** The product page of this line; null when the product is off sale. */
  productSlug: string | null;
  createdAt: string;
}

export interface GuestOrderShippingAddress {
  id: string;
  fullName: string;
  phone: string;
  province: string;
  city: string;
  barangay: string | null;
  postalCode: string | null;
  streetAddress: string;
  landmark: string | null;
  createdAt: string;
}

export interface GuestOrderStatusHistoryEntry {
  id: string;
  statusDomain: string;
  oldStatus: string | null;
  /** Status reached by this entry — the Prisma column is `new_status`. */
  newStatus: string;
  createdAt: string;
}

/** One order as the storefront may show it (no staff fields, no costs). */
export interface GuestOrderView {
  id: string;
  orderNumber: string;
  orderStatus: OrderStatus;
  confirmationStatus: ConfirmationStatus;
  paymentStatus: PaymentStatus;
  currency: string;
  subtotal: string;
  discountTotal: string;
  shippingTotal: string;
  grandTotal: string;
  createdAt: string;
  customer: GuestOrderCustomer | null;
  items: GuestOrderItem[];
  shippingAddress: GuestOrderShippingAddress | null;
  statusHistory: GuestOrderStatusHistoryEntry[];
  /**
   * Carrier details once the parcel exists. Only carrier-facing fields are
   * sent; warehouse and operator ids stay in the admin.
   */
  shipment?: GuestOrderShipment | null;
}

export interface GuestOrderShipment {
  carrier: string;
  trackingNumber: string | null;
  shippedAt: string;
  signedAt: string | null;
  tracking: Array<{
    status: string;
    at: string;
    /** J&T's own wording; null until the shopper verifies the phone. */
    description?: string | null;
    /** Rider phone; null until the shopper verifies the phone. */
    riderPhone?: string | null;
  }>;
}

/** The guest lookup response: one or more orders and how they were found. */
export interface GuestOrderResult {
  /** How the orders were found: by the order number or by the mobile number. */
  matchedBy: "orderNumber" | "phone";
  /** False while only the (guessable) order number was given. */
  personalDetailsIncluded: boolean;
  /**
   * One order for order-number lookups; every order on the mobile number
   * (latest first) for phone lookups — the shopper opens any of them without
   * searching again.
   */
  orders: GuestOrderView[];
}

// --- request -----------------------------------------------------------------

const LOOKUP_PATH = "/api/v1/storefront/orders/lookup";

/** Every non-match (bad input or no order) surfaces this one wording. */
const NOT_FOUND_MESSAGE =
  "Order not found. Check your order number or mobile number.";

const UNEXPECTED_ERROR_MESSAGE =
  "Could not look up your order. Please try again.";

/**
 * Looks up a guest order by order number OR mobile number — either one is
 * enough (2026-10-21). Which one decides what the backend returns.
 *
 * - 404/400 → the shared "order not found" wording (the backend folds every
 *   non-match into one 404; 400 is treated the same so no existence leak).
 * - network failure / 5xx → a generic retry message.
 */
export async function lookupOrder(input: {
  orderNumber?: string | null;
  phone?: string | null;
}): Promise<GuestOrderResult> {
  const orderNumber = input.orderNumber?.trim() ?? "";
  const phone = input.phone?.trim() ?? "";
  const body: { orderNumber?: string; phone?: string } = {};
  if (orderNumber !== "") body.orderNumber = orderNumber;
  if (phone !== "") body.phone = phone;

  let res: Response;
  try {
    res = await fetch(LOOKUP_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(UNEXPECTED_ERROR_MESSAGE);
  }

  if (res.status === 400 || res.status === 404) {
    throw new Error(NOT_FOUND_MESSAGE);
  }
  if (!res.ok) {
    throw new Error(UNEXPECTED_ERROR_MESSAGE);
  }

  try {
    return (await res.json()) as GuestOrderResult;
  } catch {
    throw new Error(UNEXPECTED_ERROR_MESSAGE);
  }
}
