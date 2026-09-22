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
  assignedTo: { id: string; name: string | null } | null;
  riskFlags: {
    id: string;
    flagType: string;
    reason: string | null;
    resolved: boolean;
    createdAt: string;
  }[];
}

export interface AdminRiskFlag {
  id: string;
  orderId: string;
  flagType: string;
  reason: string | null;
  resolved: boolean;
  createdBy: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface AdminOrderNote {
  id: string;
  orderId: string;
  userId: string | null;
  noteType: string;
  content: string;
  createdAt: string;
  operatorName?: string | null;
}

export interface AdminCustomerNote {
  id: string;
  customerId: string;
  orderId: string | null;
  operatorId: string | null;
  note: string;
  createdAt: string;
  operatorName?: string | null;
}

export interface AdminRiskLog {
  id: string;
  customerId: string;
  orderId: string | null;
  riskType: string;
  previousOrderId: string | null;
  reason: string | null;
  operatorId: string | null;
  createdAt: string;
  operatorName?: string | null;
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

export interface AdminShipmentItem {
  id: string;
  orderItemId: string;
  quantity: number;
  orderItem: AdminOrderItem;
}

export interface AdminShipment {
  id: string;
  carrier: string;
  trackingNumber: string | null;
  status: "SHIPPING" | "SIGNED";
  shippingCost: string | null;
  shippedAt: string;
  signedAt: string | null;
  createdAt: string;
  items: AdminShipmentItem[];
}

export interface AdminStatusHistory {
  id: string;
  statusDomain: string;
  oldStatus: string | null;
  newStatus: string;
  source: string;
  operatorId: string | null;
  operatorName?: string | null;
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
  notes: AdminOrderNote[];
  riskFlags: AdminRiskFlag[];
  assignedBy: { id: string; name: string | null } | null;
  customer: AdminOrderCustomer & {
    notes: AdminCustomerNote[];
    riskLogs: AdminRiskLog[];
  };
  mergeRecordsPrimary: {
    id: string;
    mergedOrder: { id: string; orderNumber: string } | null;
    reason: string | null;
    createdAt: string;
  }[];
  mergeRecordsMerged: {
    id: string;
    primaryOrder: { id: string; orderNumber: string } | null;
    reason: string | null;
    createdAt: string;
  }[];
  shipments: AdminShipment[];
}

// --- catalog -----------------------------------------------------------------

export interface AdminSku {
  id: string;
  skuCode: string;
  status: "ACTIVE" | "DISABLED";
  // Present on graph-aware payloads (the SKU write contract sends it); the
  // legacy product list path does not rely on it.
  supplierId?: string | null;
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
  type: "IMAGE" | "VIDEO";
  altText: string | null;
  sortOrder: number;
}

/** Description-body block (image or video) shown below the PDP gallery. */
export interface AdminDetailBlock {
  id: string;
  type: "IMAGE" | "VIDEO";
  url: string;
  altText: string | null;
  sortOrder: number;
}

export interface AdminProduct {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  /** First-screen one-line selling point under the H1; null/empty hides it. */
  tagline: string | null;
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
  /** Structured specifications; features is one entry per line. */
  materials: string | null;
  features: string | null;
  createdAt: string;
  updatedAt: string;
  // Product scalar columns are always returned (findUnique/include), even
  // though the legacy AdminVariant shape below does not expose the graph.
  catalogGraphVersion: number;
  defaultDisplayVariantId: string | null;
  images: AdminProductImage[];
  detailBlocks: AdminDetailBlock[];
  // Legacy rows use the free-form AdminVariant; graph-aware payloads carry
  // AdminGraphVariant (combinationKey + option-value assignments).
  variants: (AdminVariant | AdminGraphVariant)[];
  // Present only on graph-aware payloads: catalog-graph PATCH responses carry
  // every option/value row (including inactive) and the full scoped media set.
  options?: AdminOption[];
  media?: AdminGraphMedia[];
}

// --- typed catalog graph (served by CatalogGraphService payloads) ------------

export type AdminOptionKind = "COLOR" | "SIZE" | "MATERIAL" | "STYLE";
export type AdminOptionPresentation = "IMAGE" | "SWATCH" | "TEXT";

export interface AdminOptionValue {
  id: string;
  label: string;
  position: number;
  swatchHex: string | null;
  thumbnailUrl: string | null;
  thumbnailAlt: string | null;
  isActive: boolean;
}

export interface AdminOption {
  id: string;
  kind: AdminOptionKind;
  name: string;
  position: number;
  presentation: AdminOptionPresentation;
  isMediaDriver: boolean;
  isActive: boolean;
  values: AdminOptionValue[];
}

export interface AdminVariantAssignment {
  optionId: string;
  optionValueId: string;
}

/** SKU inside the graph snapshot: same legacy fields plus its supplier ref. */
export type AdminGraphSku = AdminSku & { supplierId: string | null };

export interface AdminGraphVariant {
  id: string;
  /** Server-derived display name (rebuilt from value labels on every save). */
  name: string;
  position: number;
  combinationKey: string | null;
  optionValues: AdminVariantAssignment[];
  sku: AdminGraphSku | null;
  /** True when carts/orders/reservations/scoped media reference the variant. */
  hasReferences?: boolean;
}

export interface AdminGraphMedia {
  id: string;
  url: string;
  type: "IMAGE" | "VIDEO";
  altText: string | null;
  sortOrder: number;
  optionValueId: string | null;
  variantId: string | null;
}

/**
 * The typed option graph embedded in graph-aware admin product payloads.
 * Mirrors the backend's CatalogGraphService snapshot (options/values include
 * inactive rows; media includes every scope).
 */
export interface AdminCatalogGraph {
  catalogGraphVersion: number;
  defaultDisplayVariantId: string | null;
  options: AdminOption[];
  variants: AdminGraphVariant[];
  media: AdminGraphMedia[];
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

/** Hero appearance payload (see the backend heroStyle input contract).
 *  `undefined` on a partial update = leave stored, `null` = clear. */
export interface HeroStyleInput {
  titleOverride?: string | null;
  titleColor?: string | null;
  titleSize?: number | null;
  titleFont?: string | null;
  backgroundType?: "SOLID" | "IMAGE";
  backgroundColor?: string | null;
  backgroundImageUrl?: string | null;
  backgroundBlur?: number;
}

/** The stored HeroStyle row as the admin API returns it (null = no custom
 *  styling, i.e. the storefront draws its default centered title). */
export interface AdminHeroStyle {
  id: string;
  titleOverride: string | null;
  titleColor: string | null;
  titleSize: number | null;
  titleFont: string | null;
  backgroundType: "SOLID" | "IMAGE";
  backgroundColor: string | null;
  backgroundImageUrl: string | null;
  backgroundBlur: number;
}

export interface AdminCategoryNode {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  sortOrder: number;
  imageUrl: string | null;
  status: "ACTIVE" | "DISABLED";
  heroStyle: AdminHeroStyle | null;
  children: AdminCategoryNode[];
}

export interface AdminCollectionRow {
  id: string;
  name: string;
  slug: string;
  type: "NAVIGATION" | "MARKETING" | "SCENARIO" | "SYSTEM";
  description: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  status: "ACTIVE" | "DISABLED";
  sortOrder: number;
  heroImage: string | null;
  heroStyle: AdminHeroStyle | null;
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
  tagline?: string | null;
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
  materials?: string | null;
  features?: string | null;
  images: { url: string; type?: "IMAGE" | "VIDEO"; altText?: string; sortOrder?: number }[];
  detailBlocks: {
    type: "IMAGE" | "VIDEO";
    url: string;
    altText?: string;
    sortOrder?: number;
  }[];
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
  heroStyle?: HeroStyleInput | null;
}

// --- product update payload (PATCH /admin/products/:id) ----------------------

/**
 * Wire patch accepted by the backend catalogGraphPatchSchema
 * (dto/catalog-graph.dto.ts). Row refs are `{id}` for persisted rows and
 * `{clientKey}` for request-created rows.
 */
export interface WireEntityRef {
  id?: string;
  clientKey?: string;
}

export interface WireSkuWrite {
  skuCode: string;
  status: "ACTIVE" | "DISABLED";
  supplierId?: string | null;
  supplierSku?: string | null;
  supplierCost?: number | null;
  costCurrency?: string | null;
  landedCost?: number | null;
  price?: number | null;
  compareAtPrice?: number | null;
  productWeight?: number | null;
  packageWidth?: number | null;
  packageHeight?: number | null;
  packageDepth?: number | null;
  packageWeight?: number | null;
  volumetricWeight?: number | null;
}

export interface WireOptionValueWrite extends WireEntityRef {
  label: string;
  position: number;
  swatchHex?: string | null;
  thumbnailUrl?: string | null;
  thumbnailAlt?: string | null;
  isActive: boolean;
}

/** Full option object per backend optionWriteSchema (entityRef + fields). */
export interface WireOptionWrite extends WireEntityRef {
  kind: AdminOptionKind;
  name: string;
  position: number;
  presentation: AdminOptionPresentation;
  isMediaDriver: boolean;
  isActive: boolean;
  values: WireOptionValueWrite[];
}

export interface WireVariantWrite extends WireEntityRef {
  position: number;
  optionValueRefs: WireEntityRef[];
  sku?: WireSkuWrite | null;
}

export interface WireMediaWrite extends WireEntityRef {
  url: string;
  type: "IMAGE" | "VIDEO";
  altText?: string | null;
  sortOrder: number;
  optionValueId?: string;
  optionValueClientKey?: string;
  variantId?: string;
  variantClientKey?: string;
}

export interface WireCatalogGraphPatch {
  options: WireOptionWrite[];
  variants: WireVariantWrite[];
  media: WireMediaWrite[];
  retirements: {
    optionIds: string[];
    optionValueIds: string[];
    variantIds: string[];
    mediaIds: string[];
  };
  defaultDisplayVariant?: WireEntityRef | null;
}

/**
 * PATCH body: the legacy create-shaped fields plus the typed catalog graph
 * patch and its optimistic revision (required whenever catalogGraph is sent).
 */
export type UpdateProductPayload = Partial<CreateProductInput> & {
  catalogGraph?: WireCatalogGraphPatch;
  catalogGraphVersion?: number;
};

/** Collection create/update payload. The admin UI only uses the hero fields
 *  today (the rest already exist server-side), so this stays minimal. */
export interface CreateCollectionInput {
  name: string;
  slug: string;
  type?: "NAVIGATION" | "MARKETING" | "SCENARIO" | "SYSTEM";
  description?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  heroImage?: string | null;
  status?: "ACTIVE" | "DISABLED";
  sortOrder?: number;
  productIds?: string[];
  heroStyle?: HeroStyleInput | null;
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
    /** Single status or comma-separated set (workbench tab buckets). */
    status?: string;
    classification?: string;
    confirmation?: string;
    assignedTo?: string;
    risk?: string;
    search?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    pageSize?: number;
  }): Promise<Paged<AdminOrderListRow>> =>
    adminAuthedFetch<Paged<AdminOrderListRow>>(
      `/api/v1/admin/orders${buildQuery({
        status: p.status,
        classification: p.classification,
        confirmation: p.confirmation,
        assignedTo: p.assignedTo,
        risk: p.risk,
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

  // --- Order shipments (ship flow) ---

  shipOrder: (
    id: string,
    input: {
      carrier: string;
      trackingNumber?: string;
      items: { orderItemId: string; quantity: number }[];
    },
  ): Promise<{ shipmentId: string; orderStatus: string; confirmationStatus: string }> =>
    adminAuthedFetch(
      `/api/v1/admin/orders/${encodeURIComponent(id)}/ship`,
      { method: "POST", body: JSON.stringify(input) },
    ),

  signShipment: (
    id: string,
    shipmentId: string,
  ): Promise<{ shipmentId: string; orderStatus: string }> =>
    adminAuthedFetch(
      `/api/v1/admin/orders/${encodeURIComponent(id)}/shipments/${encodeURIComponent(shipmentId)}/sign`,
      { method: "POST" },
    ),

  // --- Order workbench (2026-09-18 spec) ---

  confirmOrderWithDecision: (id: string, decision: { decision: "CONFIRM" | "CANCEL" | "REQUEST_INFO"; note?: string }): Promise<AdminOrderRow> =>
    adminAuthedFetch<AdminOrderRow>(
      `/api/v1/admin/orders/${encodeURIComponent(id)}/confirm`,
      { method: "POST", body: JSON.stringify(decision) },
    ),

  assignOrder: (id: string, assignedToId: string): Promise<AdminOrderRow> =>
    adminAuthedFetch<AdminOrderRow>(
      `/api/v1/admin/orders/${encodeURIComponent(id)}/assign`,
      { method: "POST", body: JSON.stringify({ assignedToId }) },
    ),

  updateOrderStatus: (id: string, status: string, comment?: string): Promise<AdminOrderRow> =>
    adminAuthedFetch<AdminOrderRow>(
      `/api/v1/admin/orders/${encodeURIComponent(id)}/status`,
      { method: "POST", body: JSON.stringify({ status, comment }) },
    ),

  editOrder: (id: string, input: { shippingAddress?: Record<string, unknown>; items?: { skuId: string; quantity: number }[]; note?: string }): Promise<AdminOrderDetail> =>
    adminAuthedFetch<AdminOrderDetail>(
      `/api/v1/admin/orders/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    ),

  addOrderNote: (id: string, content: string, noteType?: string): Promise<AdminOrderNote> =>
    adminAuthedFetch<AdminOrderNote>(
      `/api/v1/admin/orders/${encodeURIComponent(id)}/notes`,
      { method: "POST", body: JSON.stringify({ content, noteType: noteType ?? "CUSTOMER_SERVICE" }) },
    ),

  addCustomerNote: (customerId: string, note: string, orderId?: string | null): Promise<AdminCustomerNote> =>
    adminAuthedFetch<AdminCustomerNote>(
      `/api/v1/admin/customers/${encodeURIComponent(customerId)}/notes`,
      { method: "POST", body: JSON.stringify({ note, orderId: orderId ?? null }) },
    ),

  addRiskFlag: (id: string, flagType: string, reason?: string): Promise<AdminRiskFlag> =>
    adminAuthedFetch<AdminRiskFlag>(
      `/api/v1/admin/orders/${encodeURIComponent(id)}/risk-flags`,
      { method: "POST", body: JSON.stringify({ flagType, reason }) },
    ),

  resolveRiskFlag: (flagId: string): Promise<AdminRiskFlag> =>
    adminAuthedFetch<AdminRiskFlag>(
      `/api/v1/admin/orders/risk-flags/${encodeURIComponent(flagId)}/resolve`,
      { method: "PATCH" },
    ),

  mergeOrders: (primaryOrderId: string, mergedOrderId: string, reason?: string): Promise<AdminOrderDetail> =>
    adminAuthedFetch<AdminOrderDetail>(
      `/api/v1/admin/orders/merge`,
      { method: "POST", body: JSON.stringify({ primaryOrderId, mergedOrderId, reason }) },
    ),

  listAssignees: (): Promise<{ id: string; name: string }[]> =>
    adminAuthedFetch<{ id: string; name: string }[]>(
      `/api/v1/admin/orders/assignees`,
    ),

  /** SKU search for manual order entry (sellable SKUs only). */
  skuSearch: (
    q: string,
  ): Promise<{ skuId: string; label: string; price: string | null; skuCode: string }[]> =>
    adminAuthedFetch(
      `/api/v1/admin/orders/sku-search${q ? `?q=${encodeURIComponent(q)}` : ""}`,
    ),

  orderCounts: (): Promise<{
    total: number;
    byStatus: Record<string, number>;
    needsReview: number;
    duplicate: number;
  }> => adminAuthedFetch(`/api/v1/admin/orders/counts`),

  /** Manual order entry (phone orders) — reuses the storefront checkout payload. */
  createOrder: (input: {
    customer: {
      name: string;
      phone: string;
      province: string;
      city: string;
      barangay?: string | null;
      postalCode?: string | null;
      streetAddress: string;
      landmark?: string | null;
    };
    items: { skuId: string; quantity: number }[];
    preferredDeliveryDate?: string | null;
  }): Promise<AdminOrderRow> =>
    adminAuthedFetch<AdminOrderRow>(`/api/v1/admin/orders`, {
      method: "POST",
      body: JSON.stringify({
        ...input,
        attribution: { sourceType: "OTHER" },
      }),
    }),

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
    input: UpdateProductPayload,
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

  /** Partial update; `heroStyle: null` clears the stored style, omitting it
   *  leaves it untouched. */
  updateCollection: (
    id: string,
    input: Partial<CreateCollectionInput>,
  ): Promise<AdminCollectionRow> =>
    adminAuthedFetch<AdminCollectionRow>(
      `/api/v1/admin/collections/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(input) },
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

  /**
   * Local-disk media upload: the raw file bytes ARE the request body
   * (Content-Type carries the media type; no multipart, no multer). The
   * backend returns the site-relative URL, e.g. /uploads/catalog/2026/….mp4.
   * Caller-supplied Content-Type overrides adminAuthedFetch's JSON default.
   *
   * `contentType` is resolved by the caller (resolveUploadType) because
   * File.type is empty for files the OS has no extension mapping for — the
   * backend keys the stored extension off this header.
   */
  uploadImage: (
    file: File,
    contentType: string,
  ): Promise<{ url: string; key: string }> =>
    adminAuthedFetch<{ url: string; key: string }>("/api/v1/admin/uploads", {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: file,
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
