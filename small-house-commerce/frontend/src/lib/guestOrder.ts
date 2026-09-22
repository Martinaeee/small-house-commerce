/**
 * Guest order lookup client (guest-order-tracking spec §3.1/§3.2, Batch C).
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

// --- response shape (mirrors OrdersService.lookup via ORDER_DETAIL_INCLUDE) ---

export interface GuestOrderCustomer {
  id: string;
  name: string | null;
  // Customer has no "phone" column — normalizedPhone is the E.164 identity key.
  normalizedPhone: string;
  email: string | null;
  currentRiskLevel: string;
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
  unitDiscount: string;
  unitCostSnapshot: string | null;
  lineTotal: string;
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
  /** Status reached by this entry — the Prisma column is `new_status`; the timeline maps this value. */
  newStatus: string;
  source: string;
  operatorId: string | null;
  comment: string | null;
  createdAt: string;
}

export interface GuestOrderResult {
  id: string;
  orderNumber: string;
  customerId: string;
  orderStatus: OrderStatus;
  confirmationStatus: ConfirmationStatus;
  paymentStatus: PaymentStatus;
  currency: string;
  subtotal: string;
  discountTotal: string;
  shippingTotal: string;
  grandTotal: string;
  optimizerId: string | null;
  optimizerAidSnapshot: string | null;
  optimizerNameSnapshot: string | null;
  customerClassification: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  confirmationNote: string | null;
  createdAt: string;
  updatedAt: string;
  customer: GuestOrderCustomer;
  items: GuestOrderItem[];
  shippingAddress: GuestOrderShippingAddress | null;
  statusHistory: GuestOrderStatusHistoryEntry[];
}

// --- request -----------------------------------------------------------------

const LOOKUP_PATH = "/api/v1/storefront/orders/lookup";

/** Every non-match (bad input or phone mismatch) surfaces this one wording. */
const NOT_FOUND_MESSAGE =
  "Order not found. Check your order number and mobile number.";

const UNEXPECTED_ERROR_MESSAGE =
  "Could not look up your order. Please try again.";

/**
 * Looks up a guest order by order number + mobile number (spec §3.1).
 *
 * - 404/400 → the shared "order not found" wording (the backend folds every
 *   non-match into one 404; 400 is treated the same so no existence leak).
 * - network failure / 5xx → a generic retry message.
 */
export async function lookupOrder(
  orderNumber: string,
  phone: string,
): Promise<GuestOrderResult> {
  let res: Response;
  try {
    res = await fetch(LOOKUP_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderNumber, phone }),
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
