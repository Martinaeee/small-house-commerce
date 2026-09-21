import type { ProductMediaSet } from "./api";

export type ProductMediaScope =
  | { variantId: string; optionValueId?: never }
  | { optionValueId: string; variantId?: never };

export interface ProductMediaIdentity {
  id: string;
  slug: string;
  catalogGraphVersion: number;
}

type MediaFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const mediaCache = new Map<string, Promise<ProductMediaSet>>();

export function productMediaCacheKey(
  productId: string,
  catalogGraphVersion: number,
  scope: ProductMediaScope,
): string {
  const scopeKey =
    scope.variantId !== undefined
      ? `variant:${scope.variantId}`
      : `option-value:${scope.optionValueId}`;
  return JSON.stringify([productId, catalogGraphVersion, scopeKey]);
}

function mediaUrl(slug: string, scope: ProductMediaScope): string {
  const params = new URLSearchParams();
  if (scope.variantId !== undefined) params.set("variantId", scope.variantId);
  else params.set("optionValueId", scope.optionValueId);
  return `/api/v1/storefront/products/${encodeURIComponent(slug)}/media?${params.toString()}`;
}

export function loadProductMedia(
  product: ProductMediaIdentity,
  scope: ProductMediaScope,
  fetcher: MediaFetcher = fetch,
): Promise<ProductMediaSet> {
  const key = productMediaCacheKey(
    product.id,
    product.catalogGraphVersion,
    scope,
  );
  const cached = mediaCache.get(key);
  if (cached) return cached;

  const request = fetcher(mediaUrl(product.slug, scope), {
    headers: { Accept: "application/json" },
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Request failed: ${response.status}`);
      const mediaSet = (await response.json()) as ProductMediaSet;
      if (mediaSet.catalogGraphVersion !== product.catalogGraphVersion) {
        throw new Error("Product catalog graph changed while loading media");
      }
      return mediaSet;
    })
    .catch((error: unknown) => {
      if (mediaCache.get(key) === request) mediaCache.delete(key);
      throw error;
    });

  mediaCache.set(key, request);
  return request;
}

export function clearProductMediaCacheForTests(): void {
  mediaCache.clear();
}
