import type { Product, ProductImage, ProductVariant } from "@/lib/api";

/** Product images in backend display order (copy — never mutates props). */
export function sortedProductImages(product: Product): ProductImage[] {
  return [...product.images].sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Positional variant→image mapping used by PLP cards and the quick-add
 * drawer: variant array index N maps to the N-th image; out-of-range falls
 * back to the first image. This mirrors the legacy card behavior until the
 * backend links images to variants directly (ProductImage.variantId, a
 * future nullable migration).
 */
export function variantImage(
  product: Product,
  index: number,
): ProductImage | null {
  const images = sortedProductImages(product);
  return images[index] ?? images[0] ?? null;
}

/** Variants bound to a priced SKU — the styles that can be offered. */
export function sellableVariants(product: Product): ProductVariant[] {
  return product.variants.filter((v) => v.sku !== null && v.sku.price !== null);
}
