/**
 * Storefront API client.
 *
 * Browser code calls the relative /api/v1 paths (proxied by next.config.ts
 * rewrites, so there is no CORS). Server Components must use an absolute URL
 * because rewrites only apply to browser requests.
 */

import type { Attribution } from "./tracking";
import { STOREFRONT_TAGS } from "./cache-tags";

export const serverApiUrl = (path: string): string => {
  const target = process.env.API_TARGET ?? "http://localhost:3000";
  return `${target}${path}`;
};

// --- types (mirror the backend storefront responses) -------------------------

/**
 * Per-page hero appearance, shared by category and collection landing pages
 * (they render through the same component). Absent/null = the default:
 * a centered name on the page background.
 */
export interface HeroStyle {
  /** Replaces the category/collection name when set. */
  titleOverride: string | null;
  /** #rrggbb, or null for the theme ink colour. */
  titleColor: string | null;
  /** Desktop px (the component clamps it), or null for the default size. */
  titleSize: number | null;
  /** 'brand' | 'sans' | 'serif', or null for the default. */
  titleFont: string | null;
  backgroundType: "SOLID" | "IMAGE";
  /** #rrggbb for SOLID; null = transparent. */
  backgroundColor: string | null;
  backgroundImageUrl: string | null;
  /** 0–24 px blur on the background LAYER (text stays sharp). */
  backgroundBlur: number;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  heroStyle?: HeroStyle | null;
  children: Category[];
}

export type ProductOptionKind = "COLOR" | "SIZE" | "MATERIAL" | "STYLE";
export type ProductOptionPresentation = "IMAGE" | "SWATCH" | "TEXT";

/** Public media fields only; scope foreign keys never leave the backend. */
export interface ProductMedia {
  id: string;
  url: string;
  type: "IMAGE" | "VIDEO";
  altText: string | null;
  sortOrder: number;
}

export interface StorefrontSku {
  id: string;
  skuCode: string;
  status: "ACTIVE" | "DISABLED";
  price: number | null;
  compareAtPrice: number | null;
  availableInventory: number;
  productWeight?: number | null;
  packageWidth?: number | null;
  packageHeight?: number | null;
  packageDepth?: number | null;
  packageWeight?: number | null;
}

export type Sku = StorefrontSku;

export interface StorefrontOptionValue {
  id: string;
  label: string;
  position: number;
  swatchHex: string | null;
  thumbnailUrl: string | null;
  thumbnailAlt: string | null;
}

export interface StorefrontProductOption {
  id: string;
  kind: ProductOptionKind;
  name: string;
  position: number;
  presentation: ProductOptionPresentation;
  isMediaDriver: boolean;
  values: StorefrontOptionValue[];
}

export interface StorefrontProductVariant {
  id: string;
  name: string;
  position: number;
  combinationKey: string;
  optionValueIds: string[];
  sku: StorefrontSku | null;
}

export type ProductVariant = StorefrontProductVariant;
export type ProductImage = ProductMedia;

export interface ProductMediaSet {
  resolvedScope: "SHARED" | "OPTION_VALUE" | "VARIANT";
  /** Omitted, rather than null, for shared media. */
  scopeId?: string;
  media: ProductMedia[];
  catalogGraphVersion: number;
}

export interface AvailableMediaScopes {
  optionValueIds: string[];
  variantIds: string[];
}

/**
 * One block of the PDP description body, rendered below the gallery: the
 * supplier detail decks are image/video led, so blocks are media-only.
 */
export interface ProductDetailBlock {
  id: string;
  type: "IMAGE" | "VIDEO";
  url: string;
  altText: string | null;
  sortOrder: number;
}

export type Room = "BEDROOM" | "STORAGE" | "DINING_LIVING" | "HOME_OFFICE";
export type Solution =
  | "FOLDABLE"
  | "NARROW_SPACE"
  | "MOBILE"
  | "MULTIFUNCTIONAL"
  | "HIDDEN_STORAGE"
  | "RENTAL_FRIENDLY";

export interface Review {
  id: string;
  authorName: string;
  location: string | null;
  rating: number;
  title: string | null;
  comment: string;
  photos: string[];
  createdAt: string;
  /** Merchant-entered option descriptor ("Color: … | Size: …"), or null. */
  variant: string | null;
  helpfulCount: number;
  /** True only for reviews backed by a real order — never admin-entered. */
  verifiedPurchase: boolean;
}

export interface Product {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  /** First-screen one-line selling point under the H1; null/empty hides it. */
  tagline: string | null;
  categoryId: string;
  ratingAverage: number | null;
  reviewCount: number;
  /** Present only on the single-product detail response. */
  reviews?: Review[];
  room: Room | null;
  internalRole: string | null;
  solutions: Solution[];
  width: number | null;
  height: number | null;
  depth: number | null;
  foldedWidth: number | null;
  foldedHeight: number | null;
  foldedDepth: number | null;
  /**
   * Structured specifications; only the PDP endpoint selects them.
   * `features` is one entry per line.
   */
  materials?: string | null;
  features?: string | null;
  catalogGraphVersion: number;
  options: StorefrontProductOption[];
  defaultDisplayVariantId: string | null;
  effectiveCoverMedia: ProductMedia | null;
  images: ProductImage[];
  /** Present only on the single-product detail response. */
  initialMediaSet?: ProductMediaSet;
  /** Present only on the single-product detail response. */
  availableMediaScopes?: AvailableMediaScopes;
  /**
   * Description-body blocks. Only the PDP endpoint selects them (list routes
   * skip the media deck), so they are absent everywhere else.
   */
  detailBlocks?: ProductDetailBlock[];
  variants: StorefrontProductVariant[];
}

// --- homepage CMS (storefront composition) ----------------------------------

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

export interface HomepageCategoryTile {
  id: string;
  name: string;
  slug: string;
  imageUrl: string;
}

/** A full storefront Product plus its per-section badge. */
export type HomepageSectionProduct = Product & { badge: string | null };

// --- room scene hotspots (ROOM_INSPIRATION payload) --------------------------

/** Admin/input shape: a dot positioned by percentage over its scene image. */
export interface RoomSceneHotspotInput {
  productId: string;
  xPct: number;
  yPct: number;
}

/** Admin-persisted scene (payload.scenes[n] before storefront hydration). */
export interface RoomScene {
  id: string;
  imageUrl: string;
  alt?: string;
  hotspots: RoomSceneHotspotInput[];
}

/** Storefront shape: backend replaces productId with the hydrated product. */
export interface RoomSceneHotspot extends RoomSceneHotspotInput {
  product: Product;
}

export interface HydratedRoomScene extends Omit<RoomScene, "hotspots"> {
  hotspots: RoomSceneHotspot[];
}

export interface HomepageSection {
  id: string;
  type: HomepageSectionType;
  title: string | null;
  subtitle: string | null;
  sortOrder: number;
  payload: Record<string, unknown>;
  // Present only on the types hydrated by the backend.
  products?: HomepageSectionProduct[];
  categories?: HomepageCategoryTile[];
}

export interface HomepageResponse {
  sections: HomepageSection[];
}

export interface Collection {
  id: string;
  name: string;
  slug: string;
  type: "NAVIGATION" | "MARKETING" | "SCENARIO" | "SYSTEM";
  description: string | null;
  heroImage: string | null;
  heroStyle?: HeroStyle | null;
  sortOrder: number;
  seoTitle?: string | null;
  seoDescription?: string | null;
  /** Admin-set promo chip text (e.g. "9.9 Sale"); absent until backend phase 2. */
  badgeLabel?: string | null;
}

export interface CollectionSection {
  sectionType: string;
  contentJson: unknown;
  sortOrder: number;
}

export interface CartItem {
  itemId: string;
  skuId: string;
  skuCode: string;
  productName: string;
  productSlug: string;
  variantName: string;
  quantity: number;
  unitPrice: number | null;
  compareAtPrice: number | null;
  lineTotal: number;
  availableInventory: number;
  unavailable: boolean;
}

export interface CartSummary {
  cartId: string;
  expiresAt: string;
  items: CartItem[];
  subtotal: number;
  discount: number;
  shipping: number;
  total: number;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface LandingImageOverride {
  url: string;
  altText?: string | null;
}

export interface LandingPageInfo {
  id: string;
  name: string;
  slug: string;
  titleOverride: string | null;
  imagesOverride: LandingImageOverride[] | null;
  seoTitle: string | null;
  seoDescription: string | null;
  promoEnabled: boolean;
  promoHeadline: string | null;
  promoSubtext: string | null;
}

export interface LandingPageComposite {
  landingPage: LandingPageInfo;
  product: Product;
}

// --- browser client (relative paths, proxied) --------------------------------

async function assertOk(res: Response): Promise<void> {
  if (res.ok) return;
  let message = `Request failed: ${res.status}`;
  try {
    const body = (await res.json()) as { message?: string };
    if (body.message) message = body.message;
  } catch {
    /* keep default message */
  }
  throw new Error(message);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  await assertOk(res);
  return res.json() as Promise<T>;
}

// View beacons return 204 No Content.
async function requestVoid(path: string, init?: RequestInit): Promise<void> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  await assertOk(res);
}

// Homepage composition. Server Components only (absolute URL + ISR tags);
// the browser reads sections through server-rendered markup.
export async function getHomepage(): Promise<HomepageResponse> {
  const res = await fetch(serverApiUrl("/api/v1/storefront/homepage"), {
    next: { revalidate: 120, tags: STOREFRONT_TAGS },
  });
  await assertOk(res);
  return res.json() as Promise<HomepageResponse>;
}

export const api = {
  // Recently Viewed batch lookup; backend preserves the requested id order.
  getProductsByIds: (ids: string[]) =>
    request<Paged<Product>>(
      `/api/v1/storefront/products?ids=${ids.map((id) => encodeURIComponent(id)).join(",")}`,
    ),
  getCategories: () => request<Category[]>("/api/v1/storefront/categories"),
  getProducts: (params?: {
    categoryId?: string;
    search?: string;
    room?: Room;
    solution?: Solution;
    minPrice?: number;
    maxPrice?: number;
    page?: number;
    pageSize?: number;
  }) => {
    const q = new URLSearchParams();
    if (params?.categoryId) q.set("categoryId", params.categoryId);
    if (params?.search) q.set("search", params.search);
    if (params?.room) q.set("room", params.room);
    if (params?.solution) q.set("solution", params.solution);
    if (params?.minPrice !== undefined) q.set("minPrice", String(params.minPrice));
    if (params?.maxPrice !== undefined) q.set("maxPrice", String(params.maxPrice));
    if (params?.page) q.set("page", String(params.page));
    if (params?.pageSize) q.set("pageSize", String(params.pageSize));
    return request<Paged<Product>>(`/api/v1/storefront/products?${q.toString()}`);
  },
  getProductBySlug: (slug: string) => request<Product>(`/api/v1/storefront/products/${slug}`),
  markReviewHelpful: (reviewId: string) =>
    request<{ helpfulCount: number; voted: boolean }>(
      `/api/v1/storefront/reviews/${reviewId}/helpful`,
      { method: "POST", body: "{}" },
    ),
  reportReview: (reviewId: string, reason?: string) =>
    request<{ ok: boolean }>(`/api/v1/storefront/reviews/${reviewId}/report`, {
      method: "POST",
      body: JSON.stringify(reason ? { reason } : {}),
    }),
  getLandingPage: (slug: string) =>
    request<LandingPageComposite>(
      `/api/v1/storefront/lp/${encodeURIComponent(slug)}`,
    ),
  recordLandingPageView: (slug: string, visitKey: string) =>
    requestVoid(`/api/v1/storefront/lp/${encodeURIComponent(slug)}/view`, {
      method: "POST",
      body: JSON.stringify({ visitKey }),
    }),
  getCollections: (type?: string) =>
    request<{ items: Collection[]; total: number }>(
      `/api/v1/storefront/collections${type ? `?type=${type}` : ""}`,
    ),
  getCollectionBySlug: (slug: string) =>
    request<Collection & { sections: CollectionSection[] }>(`/api/v1/storefront/collections/${slug}`),
  getCollectionProducts: (slug: string, page = 1) =>
    request<Paged<Product>>(`/api/v1/storefront/collections/${slug}/products?page=${page}`),
  getCart: (cartId: string) => request<CartSummary>(`/api/v1/storefront/cart/${cartId}/summary`),
  updateCartItem: (cartId: string, itemId: string, quantity: number) =>
    request<CartSummary>(`/api/v1/storefront/cart/${cartId}/items/${itemId}`, {
      method: "PUT",
      body: JSON.stringify({ quantity }),
    }),
  removeCartItem: (cartId: string, itemId: string) =>
    request<CartSummary>(`/api/v1/storefront/cart/${cartId}/items/${itemId}`, {
      method: "DELETE",
    }),
  /**
   * Adds a SKU to the cart. Omit cartId for a fresh cart (the response
   * carries the cartId to persist in localStorage). The backend allows
   * out-of-stock SKUs in carts; checkout is where stock is enforced.
   */
  addToCart: (input: { cartId?: string; skuId: string; quantity: number }) =>
    request<CartSummary & { created: boolean }>("/api/v1/storefront/cart/items", {
      method: "POST",
      body: JSON.stringify(input),
    }),
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
    attribution?: Attribution;
    preferredDeliveryDate?: string | null;
  }) =>
    request<{ orderNumber: string; orderStatus: string; confirmationStatus: string }>(
      "/api/v1/storefront/orders",
      {
        method: "POST",
        body: JSON.stringify({
          attribution: input.attribution ?? { sourceType: "ORGANIC" },
          customer: input.customer,
          items: input.items,
          preferredDeliveryDate: input.preferredDeliveryDate ?? null,
        }),
      },
    ),
};

/** Cart id lives in localStorage on the client. */
export const cartStorage = {
  get: (): string | undefined => {
    if (typeof window === "undefined") return undefined;
    const value = window.localStorage.getItem("cartId");
    // An empty string means "no cart" (cleared after placing an order).
    return value && value !== "" ? value : undefined;
  },
  set: (cartId: string) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("cartId", cartId);
    }
  },
};
