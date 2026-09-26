import {
  serverApiUrl,
  type Paged,
  type Product,
} from "@/lib/api";
import { STOREFRONT_TAGS } from "@/lib/cache-tags";

export function selectableAvailableInventory(product: Product): number {
  return product.variants.reduce((total, variant) => {
    const sku = variant.sku;
    if (sku?.status !== "ACTIVE" || sku.price === null) return total;
    return total + Math.max(0, sku.availableInventory);
  }, 0);
}

export function selectRelatedProducts(
  products: readonly Product[],
  currentProductId: string,
  limit = 4,
): Product[] {
  const safeLimit = Math.max(0, Math.trunc(limit));
  return products
    .filter(
      (product) =>
        product.id !== currentProductId &&
        selectableAvailableInventory(product) > 0,
    )
    .slice(0, safeLimit);
}

export async function fetchRelatedProducts(
  categoryId: string,
  currentProductId: string,
  {
    limit = 4,
    pageSize = 9,
    revalidate = 120,
  }: { limit?: number; pageSize?: number; revalidate?: number } = {},
): Promise<Product[]> {
  const safeLimit = Math.max(0, Math.trunc(limit));
  const safePageSize = Math.max(1, Math.trunc(pageSize));
  if (safeLimit === 0) return [];

  const selected: Product[] = [];
  const seenIds = new Set<string>();
  let page = 1;

  while (selected.length < safeLimit) {
    let result: Paged<Product>;
    try {
      const response = await fetch(
        serverApiUrl(
          `/api/v1/storefront/products?categoryId=${encodeURIComponent(categoryId)}&page=${page}&pageSize=${safePageSize}`,
        ),
        { next: { revalidate, tags: STOREFRONT_TAGS } },
      );
      if (!response.ok) break;
      result = (await response.json()) as Paged<Product>;
    } catch {
      break;
    }

    const unseen = result.items.filter((product) => {
      if (seenIds.has(product.id)) return false;
      seenIds.add(product.id);
      return true;
    });
    selected.push(
      ...selectRelatedProducts(
        unseen,
        currentProductId,
        safeLimit - selected.length,
      ),
    );

    const responsePage = Math.max(1, Math.trunc(result.page));
    const responsePageSize = Math.max(1, Math.trunc(result.pageSize));
    if (
      result.items.length === 0 ||
      responsePage * responsePageSize >= result.total
    ) {
      break;
    }
    page = responsePage + 1;
  }

  return selected;
}
