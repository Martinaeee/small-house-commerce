/**
 * Thumbnail for the admin new-order picker.
 *
 * A phone order can buy any SKU, so the picker needs a picture of the exact
 * variant the operator is about to sell. The photo is resolved with the same
 * precedence the order lines use (the variant's own option value → the
 * variant → the product's shared gallery), so the operator recognises the
 * picture the customer saw.
 */

export interface SkuThumbnailImage {
  url: string;
  type: string;
  optionValueId: string | null;
  variantId: string | null;
  isScene: boolean;
}

export interface SkuThumbnailVariant {
  id: string;
  optionValues: { optionValueId: string }[];
  product: { images: SkuThumbnailImage[] };
}

/**
 * Returns the image URL to show for a variant, or null when the product has
 * no usable photo (the picker then draws a neutral placeholder).
 */
export function skuThumbnailUrl(variant: SkuThumbnailVariant): string | null {
  const images = variant.product.images.filter(
    (image) => image.type === 'IMAGE' && !image.isScene,
  );
  if (images.length === 0) return null;

  const valueIds = new Set(
    variant.optionValues.map((assignment) => assignment.optionValueId),
  );
  const byOption = images.find(
    (image) => image.optionValueId !== null && valueIds.has(image.optionValueId),
  );
  if (byOption) return byOption.url;

  const byVariant = images.find(
    (image) => image.variantId !== null && image.variantId === variant.id,
  );
  if (byVariant) return byVariant.url;

  const shared = images.find(
    (image) => image.variantId === null && image.optionValueId === null,
  );
  return shared?.url ?? null;
}
