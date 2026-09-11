/**
 * Storefront API client.
 *
 * Browser code calls the relative /api/v1 paths (proxied by next.config.ts
 * rewrites, so there is no CORS). Server Components must use an absolute URL
 * because rewrites only apply to browser requests.
 */

export const serverApiUrl = (path: string): string => {
  const target = process.env.API_TARGET ?? "http://localhost:3000";
  return `${target}${path}`;
};

// --- types (mirror the backend storefront responses) -------------------------

export interface Category {
  id: string;
  name: string;
  slug: string;
  children: Category[];
}

export interface Sku {
  id: string;
  skuCode: string;
  price: number | null;
  compareAtPrice: number | null;
  availableInventory: number;
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

export interface Product {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  images: ProductImage[];
  variants: ProductVariant[];
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

// --- browser client (relative paths, proxied) --------------------------------

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });

  if (!res.ok) {
    let message = `Request failed: ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      /* keep default message */
    }
    throw new Error(message);
  }

  return res.json() as Promise<T>;
}

export const api = {
  getCategories: () => request<Category[]>("/api/v1/storefront/categories"),
  getProducts: (params?: { categoryId?: string; search?: string; page?: number; pageSize?: number }) => {
    const q = new URLSearchParams();
    if (params?.categoryId) q.set("categoryId", params.categoryId);
    if (params?.search) q.set("search", params.search);
    if (params?.page) q.set("page", String(params.page));
    if (params?.pageSize) q.set("pageSize", String(params.pageSize));
    return request<Paged<Product>>(`/api/v1/storefront/products?${q.toString()}`);
  },
  getProductBySlug: (slug: string) => request<Product>(`/api/v1/storefront/products/${slug}`),
  getCollections: (type?: string) =>
    request<{ items: Collection[]; total: number }>(
      `/api/v1/storefront/collections${type ? `?type=${type}` : ""}`,
    ),
  getCollectionBySlug: (slug: string) =>
    request<Collection & { sections: CollectionSection[] }>(`/api/v1/storefront/collections/${slug}`),
  getCollectionProducts: (slug: string, page = 1) =>
    request<Paged<Product>>(`/api/v1/storefront/collections/${slug}/products?page=${page}`),
  getCart: (cartId: string) => request<CartSummary>(`/api/v1/storefront/cart/${cartId}/summary`),
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
    attribution?: { sourceType?: string; aid?: string | null };
  }) =>
    request<{ orderNumber: string; orderStatus: string; confirmationStatus: string }>(
      "/api/v1/storefront/orders",
      { method: "POST", body: JSON.stringify(input) },
    ),
};

/** Cart id lives in localStorage on the client. */
export const cartStorage = {
  get: (): string | undefined => {
    if (typeof window === "undefined") return undefined;
    return window.localStorage.getItem("cartId") ?? undefined;
  },
  set: (cartId: string) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("cartId", cartId);
    }
  },
};
