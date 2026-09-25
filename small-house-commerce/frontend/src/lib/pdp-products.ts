import type { Product } from "@/lib/api";

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
