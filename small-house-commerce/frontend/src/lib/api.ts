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

export interface Category {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  children: Category[];
}

export interface Sku {
  id: string;
  skuCode: string;
  price: number | null;
  compareAtPrice: number | null;
  availableInventory: number;
  productWeight?: number | null;
  packageWidth?: number | null;
  packageHeight?: number | null;
  packageDepth?: number | null;
  packageWeight?: number | null;
}

export interface ProductVariant {
  id: string;
  name: string;
  position: number;
  sku: Sku | null;
}

export interface ProductImage {
  id: string;
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
  images: ProductImage[];
  variants: ProductVariant[];
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
  sortOrder: number;
  seoTitle?: string | null;
  seoDescription?: string | null;
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
  }) =>
    request<{ orderNumber: string; orderStatus: string; confirmationStatus: string }>(
      "/api/v1/storefront/orders",
      {
        method: "POST",
        body: JSON.stringify({
          attribution: input.attribution ?? { sourceType: "ORGANIC" },
          customer: input.customer,
          items: input.items,
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
