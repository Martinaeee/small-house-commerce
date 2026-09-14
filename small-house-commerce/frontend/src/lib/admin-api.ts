/**
 * Admin panel API client.
 *
 * Every call goes through adminAuthedFetch (in-memory admin bearer token,
 * single-flight 401 refresh + retry). Types mirror the raw Prisma rows the
 * admin controllers return.
 *
 * MONEY TYPES: the admin controllers return raw Prisma rows, so every Decimal
 * field arrives over the wire as a STRING (Prisma Decimal.toJSON() -> string).
 * The storefront paths convert with Number() — admin does NOT. Render through
 * formatAmount() below. Int fields (quantity, sortOrder, onHand, reserved,
 * available) are JSON numbers.
 */

import { adminAuthedFetch } from "./admin-auth";
import { formatPrice } from "@/components/ui/PriceBox";

// --- enums -------------------------------------------------------------------

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

export type ProductStatus = "DRAFT" | "ACTIVE" | "DISABLED";

export type SourceType =
  | "FB_POST"
  | "META_AD"
  | "ORGANIC"
  | "DIRECT"
  | "EMAIL"
  | "OTHER";

// --- paging ------------------------------------------------------------------

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// --- money formatting --------------------------------------------------------

/**
 * Renders a Decimal-as-string money field. null/"" render an em dash (the
 * column exists but the value is absent, e.g. nullable SKU price); otherwise
 * the value is Number()-coerced and formatted like storefront prices.
 */
export function formatAmount(
  value: string | number | null,
  currency = "₱",
): string {
  if (value === null || value === "") return "—";
  return formatPrice(Number(value), currency);
}

// --- orders ------------------------------------------------------------------

/**
 * Every Order scalar. confirm/cancel return the BARE updated Order row (no
 * includes), and the order-level attribution columns live on the Order row
 * itself, NOT on the OrderAttribution relation.
 */
export interface AdminOrderRow {
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
}

export interface AdminOrderCustomer {
  id: string;
  name: string | null;
  // Customer has no "phone" column — normalizedPhone is the E.164 identity key.
  normalizedPhone: string;
  email: string | null;
  currentRiskLevel: string;
}

export interface AdminOrderListRow extends AdminOrderRow {
  customer: AdminOrderCustomer;
  items: {
    id: string;
    skuCodeSnapshot: string;
    productNameSnapshot: string;
    quantity: number;
    lineTotal: string;
  }[];
}

export interface AdminOrderItem {
  id: string;
  productNameSnapshot: string;
  skuCodeSnapshot: string;
  variantSnapshot: string;
  quantity: number;
  unitPrice: string;
  unitDiscount: string;
  unitCostSnapshot: string | null;
  lineTotal: string;
}

export interface AdminStatusHistory {
  id: string;
  statusDomain: string;
  oldStatus: string | null;
  newStatus: string;
  source: string;
  operatorId: string | null;
  comment: string | null;
  createdAt: string;
}

export interface AdminOrderDetail extends AdminOrderListRow {
  items: AdminOrderItem[];
  shippingAddress: {
    fullName: string;
    phone: string;
    province: string;
    city: string;
    barangay: string | null;
    postalCode: string | null;
    streetAddress: string;
    landmark: string | null;
  } | null;
  attribution: {
    sourceType: SourceType;
    aidSnapshot: string | null;
    optimizerId: string | null;
    facebookPageId: string | null;
    facebookPostId: string | null;
    facebookPostTrackingCode: string | null;
    campaignId: string | null;
    adsetId: string | null;
    adId: string | null;
    landingPageId: string | null;
    utmSource: string | null;
    utmMedium: string | null;
    utmCampaign: string | null;
    utmContent: string | null;
    utmTerm: string | null;
    fbclid: string | null;
    attributedAt: string;
  } | null;
  payments: {
    id: string;
    method: string;
    status: PaymentStatus;
    amount: string;
    reference: string | null;
    paidAt: string | null;
  }[];
  statusHistory: AdminStatusHistory[];
  reservations: {
    id: string;
    skuId: string;
    warehouseId: string;
    quantity: number;
    status: string;
    createdAt: string;
  }[];
}

// --- catalog -----------------------------------------------------------------

export interface AdminSku {
  id: string;
  skuCode: string;
  status: "ACTIVE" | "DISABLED";
  price: string | null;
  compareAtPrice: string | null;
  supplierSku: string | null;
  supplierCost: string | null;
  costCurrency: string | null;
  landedCost: string | null;
  productWeight: number | null;
  packageWidth: number | null;
  packageHeight: number | null;
  packageDepth: number | null;
  packageWeight: number | null;
  volumetricWeight: number | null;
}

export interface AdminVariant {
  id: string;
  name: string;
  position: number;
  sku: AdminSku | null;
}

export interface AdminProductImage {
  id: string;
  url: string;
  altText: string | null;
  sortOrder: number;
}

export interface AdminProduct {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  categoryId: string;
  status: ProductStatus;
  room: string | null;
  internalRole: string | null;
  solutions: string[];
  width: number | null;
  height: number | null;
  depth: number | null;
  foldedWidth: number | null;
  foldedHeight: number | null;
  foldedDepth: number | null;
  createdAt: string;
  updatedAt: string;
  images: AdminProductImage[];
  variants: AdminVariant[];
}

/** Raw ProductReview row (admin endpoints return the unscoped Prisma row). */
export interface AdminReview {
  id: string;
  productId: string;
  source: "ADMIN" | "CUSTOMER";
  authorName: string;
  location: string | null;
  rating: number;
  title: string | null;
  comment: string;
  photos: string[];
  isVisible: boolean;
  verifiedOrderItemId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAdminReviewInput {
  authorName: string;
  location?: string;
  rating: number;
  title?: string;
  comment: string;
  photos: string[];
  isVisible: boolean;
}

// PATCH mirrors updateAdminReviewSchema: every field optional; location/title
// may be explicitly null to clear them.
export type UpdateAdminReviewInput = Partial<Omit<CreateAdminReviewInput, "location" | "title">> & {
  location?: string | null;
  title?: string | null;
};

export interface AdminCategoryNode {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  sortOrder: number;
  imageUrl: string | null;
  status: "ACTIVE" | "DISABLED";
  children: AdminCategoryNode[];
}

export interface AdminCollectionRow {
  id: string;
  name: string;
  slug: string;
  type: "NAVIGATION" | "MARKETING" | "SCENARIO" | "SYSTEM";
  description: string | null;
  status: "ACTIVE" | "DISABLED";
  sortOrder: number;
  _count: { products: number };
}

// --- request DTOs (Decimal fields send as JSON numbers; zod z.number()) ------

export interface CreateProductInput {
  name: string;
  slug: string;
  description: string | null;
  categoryId: string;
  status: ProductStatus;
  room: string | null;
  internalRole: string | null;
  solutions: string[];
  width: number | null;
  height: number | null;
  depth: number | null;
  foldedWidth: number | null;
  foldedHeight: number | null;
  foldedDepth: number | null;
  images: { url: string; altText?: string; sortOrder?: number }[];
  variants: {
    name: string;
    position?: number;
    sku?: {
      skuCode: string;
      status?: "ACTIVE" | "DISABLED";
      price?: number;
      compareAtPrice?: number;
      supplierSku?: string;
      supplierCost?: number;
      costCurrency?: string;
      landedCost?: number;
      productWeight?: number;
      packageWidth?: number;
      packageHeight?: number;
      packageDepth?: number;
      packageWeight?: number;
      volumetricWeight?: number;
    };
  }[];
}

export interface CreateCategoryInput {
  name: string;
  slug: string;
  parentId?: string | null;
  sortOrder?: number;
  imageUrl?: string | null;
  status?: "ACTIVE" | "DISABLED";
}

// --- client ------------------------------------------------------------------

function buildQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    // Never send undefined/empty params; the server defaults page/pageSize.
    if (value !== undefined) search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export const adminApi = {
  listOrders: (p: {
    status?: OrderStatus;
    search?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    pageSize?: number;
  }): Promise<Paged<AdminOrderListRow>> =>
    adminAuthedFetch<Paged<AdminOrderListRow>>(
      `/api/v1/admin/orders${buildQuery({
        status: p.status,
        search: p.search,
        dateFrom: p.dateFrom,
        dateTo: p.dateTo,
        page: p.page,
        pageSize: p.pageSize,
      })}`,
    ),

  getOrder: (id: string): Promise<AdminOrderDetail> =>
    adminAuthedFetch<AdminOrderDetail>(
      `/api/v1/admin/orders/${encodeURIComponent(id)}`,
    ),

  // Bare updated Order row (no customer/items includes).
  confirmOrder: (id: string): Promise<AdminOrderRow> =>
    adminAuthedFetch<AdminOrderRow>(
      `/api/v1/admin/orders/${encodeURIComponent(id)}/confirm`,
      { method: "POST" },
    ),

  cancelOrder: (id: string): Promise<AdminOrderRow> =>
    adminAuthedFetch<AdminOrderRow>(
      `/api/v1/admin/orders/${encodeURIComponent(id)}/cancel`,
      { method: "POST" },
    ),

  listProducts: (p: {
    search?: string;
    status?: ProductStatus;
    categoryId?: string;
    page?: number;
    pageSize?: number;
  }): Promise<Paged<AdminProduct>> =>
    adminAuthedFetch<Paged<AdminProduct>>(
      `/api/v1/admin/products${buildQuery({
        search: p.search,
        status: p.status,
        categoryId: p.categoryId,
        page: p.page,
        pageSize: p.pageSize,
      })}`,
    ),

  getProduct: (id: string): Promise<AdminProduct> =>
    adminAuthedFetch<AdminProduct>(
      `/api/v1/admin/products/${encodeURIComponent(id)}`,
    ),

  createProduct: (input: CreateProductInput): Promise<AdminProduct> =>
    adminAuthedFetch<AdminProduct>("/api/v1/admin/products", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  updateProduct: (
    id: string,
    input: Partial<CreateProductInput>,
  ): Promise<AdminProduct> =>
    adminAuthedFetch<AdminProduct>(
      `/api/v1/admin/products/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    ),

  deleteProduct: (id: string): Promise<{ ok: boolean }> =>
    adminAuthedFetch<{ ok: boolean }>(
      `/api/v1/admin/products/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),

  // --- product reviews (cold-start admin moderation) ----------------------

  listProductReviews: (productId: string): Promise<AdminReview[]> =>
    adminAuthedFetch<AdminReview[]>(
      `/api/v1/admin/products/${encodeURIComponent(productId)}/reviews`,
    ),

  createProductReview: (
    productId: string,
    input: CreateAdminReviewInput,
  ): Promise<AdminReview> =>
    adminAuthedFetch<AdminReview>(
      `/api/v1/admin/products/${encodeURIComponent(productId)}/reviews`,
      { method: "POST", body: JSON.stringify(input) },
    ),

  updateReview: (id: string, input: UpdateAdminReviewInput): Promise<AdminReview> =>
    adminAuthedFetch<AdminReview>(
      `/api/v1/admin/reviews/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    ),

  // Backend returns 2xx with an empty body (adminRemove resolves void).
  deleteReview: (id: string): Promise<void> =>
    adminAuthedFetch<void>(
      `/api/v1/admin/reviews/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),

  listCategories: (): Promise<AdminCategoryNode[]> =>
    adminAuthedFetch<AdminCategoryNode[]>("/api/v1/admin/categories"),

  createCategory: (input: CreateCategoryInput): Promise<AdminCategoryNode> =>
    adminAuthedFetch<AdminCategoryNode>("/api/v1/admin/categories", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  updateCategory: (
    id: string,
    input: Partial<CreateCategoryInput>,
  ): Promise<AdminCategoryNode> =>
    adminAuthedFetch<AdminCategoryNode>(
      `/api/v1/admin/categories/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    ),

  deleteCategory: (id: string): Promise<{ ok: boolean }> =>
    adminAuthedFetch<{ ok: boolean }>(
      `/api/v1/admin/categories/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),

  adjustStock: (input: {
    skuId: string;
    quantity: number;
    reason?: string | null;
  }): Promise<{ onHand: number; reserved: number; available: number }> =>
    adminAuthedFetch<{ onHand: number; reserved: number; available: number }>(
      "/api/v1/admin/inventory/adjust",
      { method: "POST", body: JSON.stringify(input) },
    ),

  // --- collections (membership management) --------------------------------
  // PATCH /admin/collections/:id { productIds } REPLACES the full membership
  // (service deleteMany + createMany, sortOrder = array index), so callers
  // must always submit the complete ordered id list.

  listCollections: (): Promise<Paged<AdminCollectionRow>> =>
    adminAuthedFetch<Paged<AdminCollectionRow>>(
      "/api/v1/admin/collections?page=1&pageSize=100",
    ),

  setCollectionProducts: (
    id: string,
    productIds: string[],
  ): Promise<AdminCollectionRow> =>
    adminAuthedFetch<AdminCollectionRow>(
      `/api/v1/admin/collections/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify({ productIds }) },
    ),
};
