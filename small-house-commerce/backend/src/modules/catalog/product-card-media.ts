import type { ProductMediaItem } from './product-media.resolver.js';
import type { VariantCardMedia } from './variant-card-media.js';

export type ProductCardImage = ProductMediaItem & { type: 'IMAGE' };

export interface ProductCardVariantInput {
  id: string;
  cardMedia?: VariantCardMedia | null;
}

export interface ProductCardMediaPair {
  cover: ProductCardImage | null;
  scene: ProductCardImage | null;
}

export interface ProductCardMedia {
  displayVariantId: string | null;
  unselected: ProductCardMediaPair;
  variants: Array<ProductCardMediaPair & { variantId: string }>;
}

function pair(variant: ProductCardVariantInput | undefined): ProductCardMediaPair {
  const cover = variant?.cardMedia?.cover;
  if (!cover) return { cover: null, scene: null };
  const hover = variant.cardMedia?.hover;
  return {
    cover: {
      id: `card:${variant.id}:cover`, type: 'IMAGE', url: cover.url,
      altText: cover.altText, sortOrder: 0,
    },
    scene: hover ? {
      id: `card:${variant.id}:hover`, type: 'IMAGE', url: hover.url,
      altText: hover.altText, sortOrder: 0,
    } : null,
  };
}

export function buildProductCardMedia(
  variants: readonly ProductCardVariantInput[],
  selectableVariantIds: readonly string[],
  storedDisplayVariantId: string | null,
): ProductCardMedia {
  const byId = new Map(variants.map(variant => [variant.id, variant]));
  const displayVariantId = storedDisplayVariantId !== null &&
    selectableVariantIds.includes(storedDisplayVariantId) && byId.has(storedDisplayVariantId)
    ? storedDisplayVariantId : null;
  return {
    displayVariantId,
    unselected: pair(displayVariantId === null ? undefined : byId.get(displayVariantId)),
    variants: selectableVariantIds.map(variantId => ({ variantId, ...pair(byId.get(variantId)) })),
  };
}
