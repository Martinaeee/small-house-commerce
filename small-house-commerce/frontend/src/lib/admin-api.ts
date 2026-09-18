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
  preferredDeliveryDate: string | null;
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
  // Live stock from the inventory table (read-only; written via setStock).
  onHand: number;
  reserved: number;
  availableInventory: number;
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
  variant: string | null;
  photos: string[];
  isVisible: boolean;
  verifiedOrderItemId: string | null;
  createdAt: string;
  updatedAt: string;
  // Present on the list endpoint (include _count); absent on create/update.
  _count?: { helpfulVotes: number; reports: number };
}

export interface CreateAdminReviewInput {
  authorName: string;
  location?: string;
  rating: number;
  title?: string;
  comment: string;
  // Amazon-style option descriptor, e.g. "Color: Walnut Brown | Size: S".
  variant?: string;
  photos: string[];
  isVisible: boolean;
  // ISO 8601; omit to stamp "now". Backend rejects future dates.
  createdAt?: string;
}

// PATCH mirrors updateAdminReviewSchema: every field optional; location/title/
// variant may be explicitly null to clear them.
export type UpdateAdminReviewInput = Partial<
  Omit<CreateAdminReviewInput, "location" | "title" | "variant">
> & {
  location?: string | null;
  title?: string | null;
  variant?: string | null;
};

export interface AdminReviewReport {
  id: string;
  reason: string | null;
  createdAt: string;
}

// --- landing pages ("Single Pages") ------------------------------------------

export type LandingStatus = "ACTIVE" | "DISABLED";
export type LandingEffectiveStatus = "LIVE" | "SCHEDULED" | "ENDED" | "DISABLED";

export interface AdminLandingPageRow {
  id: string;
  name: string;
  adCode: string | null;
  slug: string;
  productId: string;
  productName: string;
  titleOverride: string | null;
  status: LandingStatus;
  effectiveStatus: LandingEffectiveStatus;
  startAt: string | null;
  endAt: string | null;
  sortOrder: number;
  updatedAt: string;
  views: number;
  orders: number;
  conversionRate: number;
}

export interface LandingImageOverrideInput {
  url: string;
  altText?: string | null;
}

export interface AdminLandingPageDetail extends AdminLandingPageRow {
  imagesOverride: LandingImageOverrideInput[] | null;
  seoTitle: string | null;
  seoDescription: string | null;
  promoEnabled: boolean;
  promoHeadline: string | null;
  promoSubtext: string | null;
  createdAt: string;
}

export interface LandingPageInput {
  name: string;
  slug?: string;
  titleOverride?: string | null;
  adCode?: string | null;
  imagesOverride?: LandingImageOverrideInput[] | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  promoEnabled?: boolean;
  promoHeadline?: string | null;
  promoSubtext?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  status?: LandingStatus;
  sortOrder?: number;
}

export interface PresignUploadResult {
  uploadUrl: string;
  publicUrl: string;
  key: string;
  expiresIn: number;
}

// Mirrors createAdminReviewSchema (backend): optional text fields are
// omitted, not null — the batch endpoint rejects null with a zod 400.
export interface BatchReviewInput {
  authorName: string;
  location?: string;
  rating: number;
  title?: string;
  comment: string;
  variant?: string;
  photos?: string[];
  isVisible?: boolean;
  // ISO 8601; omit to stamp "now". Rejected by the backend if in the future.
  createdAt?: string;
}

export interface BatchLineError {
  row: number;
  field: string;
  message: string;
}

export interface AdminSiteSettings {
  id: string;
  messengerUrl: string;
  supportEmail: string;
  supportHours: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateSiteSettingsInput {
  messengerUrl: string;
  supportEmail: string;
  supportHours: string;
}

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

// --- homepage CMS ------------------------------------------------------------

export type HomepageSectionType =
  | "HERO"
  | "USP"
  | "CATEGORY_TILES"
  | "PRODUCT_GRID"
  | "SOLUTIONS"
  | "PRODUCT_STORY"
  | "ROOM_INSPIRATION"
  | "UGC"
  | "BRAND_STORY"
  | "CONFIDENCE";

export interface AdminHomepageSectionProduct {
  id: string;
  productId: string;
  sortOrder: number;
  badge: string | null;
  product: {
    id: string;
    name: string;
    slug: string;
    status: ProductStatus;
  };
}

/** Raw admin row: payload is the unvalidated Json blob the per-type editors read/write. */
export interface AdminHomepageSection {
  id: string;
  type: HomepageSectionType;
  title: string | null;
  subtitle: string | null;
  enabled: boolean;
  sortOrder: number;
  payload: Record<string, unknown> | null;
  products: AdminHomepageSectionProduct[];
}

export interface SaveHomepageSectionInput {
  id?: string;
  type?: HomepageSectionType;
  title?: string | null;
  subtitle?: string | null;
  enabled: boolean;
  sortOrder: number;
  payload?: unknown;
}

export interface SetHomepageProductsRow {
  productId: string;
  sortOrder: number;
  badge?: string | null;
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

  listReviewReports: (id: string): Promise<AdminReviewReport[]> =>
    adminAuthedFetch<AdminReviewReport[]>(
      `/api/v1/admin/reviews/${encodeURIComponent(id)}/reports`,
    ),

  clearReviewReports: (id: string): Promise<{ cleared: number }> =>
    adminAuthedFetch<{ cleared: number }>(
      `/api/v1/admin/reviews/${encodeURIComponent(id)}/reports`,
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

  /**
   * Absolute stock set used by the product form. Idempotent: the service turns
   * the target into the same MANUAL_ADJUSTMENT movement the delta endpoint
   * writes, so a stale form value cannot corrupt the count the way a
   * client-computed delta would.
   */
  setStock: (input: {
    skuId: string;
    onHand: number;
    reason?: string | null;
  }): Promise<{ onHand: number; reserved: number; available: number }> =>
    adminAuthedFetch<{ onHand: number; reserved: number; available: number }>(
      "/api/v1/admin/inventory/stock",
      { method: "PUT", body: JSON.stringify(input) },
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

  // --- product landing pages ("Single Pages") -----------------------------

  listLandingPages: (p: {
    search?: string;
    status?: LandingStatus;
    effectiveStatus?: LandingEffectiveStatus;
    productId?: string;
    dateFrom?: string;
    dateTo?: string;
    sortBy?: "updatedAt" | "title";
    sortDir?: "asc" | "desc";
    page?: number;
    pageSize?: number;
  }): Promise<Paged<AdminLandingPageRow>> =>
    adminAuthedFetch<Paged<AdminLandingPageRow>>(
      `/api/v1/admin/landing-pages${buildQuery({
        search: p.search,
        status: p.status,
        effectiveStatus: p.effectiveStatus,
        productId: p.productId,
        dateFrom: p.dateFrom,
        dateTo: p.dateTo,
        sortBy: p.sortBy,
        sortDir: p.sortDir,
        page: p.page,
        pageSize: p.pageSize,
      })}`,
    ),

  listProductLandingPages: (productId: string): Promise<AdminLandingPageDetail[]> =>
    adminAuthedFetch<AdminLandingPageDetail[]>(
      `/api/v1/admin/products/${encodeURIComponent(productId)}/landing-pages`,
    ),

  createLandingPage: (
    productId: string,
    input: LandingPageInput,
  ): Promise<AdminLandingPageDetail> =>
    adminAuthedFetch<AdminLandingPageDetail>(
      `/api/v1/admin/products/${encodeURIComponent(productId)}/landing-pages`,
      { method: "POST", body: JSON.stringify(input) },
    ),

  updateLandingPage: (
    id: string,
    input: Partial<LandingPageInput>,
  ): Promise<AdminLandingPageDetail> =>
    adminAuthedFetch<AdminLandingPageDetail>(
      `/api/v1/admin/landing-pages/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    ),

  deleteLandingPage: (id: string): Promise<void> =>
    adminAuthedFetch<void>(`/api/v1/admin/landing-pages/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),

  bulkTitleLandingPages: (
    ids: string[],
    titleOverride: string,
  ): Promise<{ updated: number }> =>
    adminAuthedFetch<{ updated: number }>("/api/v1/admin/landing-pages/bulk-title", {
      method: "POST",
      body: JSON.stringify({ ids, titleOverride }),
    }),

  batchCreateReviews: (
    productId: string,
    items: BatchReviewInput[],
  ): Promise<{ created: number }> =>
    adminAuthedFetch<{ created: number }>(
      `/api/v1/admin/products/${encodeURIComponent(productId)}/reviews/batch`,
      { method: "POST", body: JSON.stringify({ items }) },
    ),

  // --- site settings (singleton, SYSTEM_SETTINGS_EDIT = SUPER_ADMIN) ------

  getSettings: (): Promise<AdminSiteSettings> =>
    adminAuthedFetch<AdminSiteSettings>("/api/v1/admin/settings"),

  updateSettings: (
    input: UpdateSiteSettingsInput,
  ): Promise<AdminSiteSettings> =>
    adminAuthedFetch<AdminSiteSettings>("/api/v1/admin/settings", {
      method: "PATCH",
      body: JSON.stringify(input),
    }),

  presignUpload: (
    contentType: string,
    fileName: string,
  ): Promise<PresignUploadResult> =>
    adminAuthedFetch<PresignUploadResult>("/api/v1/admin/uploads/presign", {
      method: "POST",
      body: JSON.stringify({ contentType, fileName }),
    }),

  // --- homepage CMS ---------------------------------------------------------

  listHomepageSections: (): Promise<AdminHomepageSection[]> =>
    adminAuthedFetch<AdminHomepageSection[]>("/api/v1/admin/homepage/sections"),

  saveHomepageSections: (
    sections: SaveHomepageSectionInput[],
  ): Promise<AdminHomepageSection[]> =>
    adminAuthedFetch<AdminHomepageSection[]>("/api/v1/admin/homepage/sections", {
      method: "PATCH",
      body: JSON.stringify({ sections }),
    }),

  setHomepageSectionProducts: (
    id: string,
    rows: SetHomepageProductsRow[],
  ): Promise<{ ok: boolean; count: number }> =>
    adminAuthedFetch<{ ok: boolean; count: number }>(
      `/api/v1/admin/homepage/sections/${encodeURIComponent(id)}/products`,
      { method: "PUT", body: JSON.stringify({ rows }) },
    ),
};
