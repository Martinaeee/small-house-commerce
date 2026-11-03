import { describe, expect, it } from 'vitest';
import {
  skuThumbnailUrl,
  type SkuThumbnailImage,
  type SkuThumbnailVariant,
} from './sku-thumbnail.js';

/**
 * The new-order picker must show the operator the photo of the exact SKU
 * they are about to sell, so the cover is resolved with the same precedence
 * the order lines use: the variant's option value, then the variant, then
 * the product's shared gallery.
 */

const image = (
  overrides: Partial<SkuThumbnailImage> & { url: string },
): SkuThumbnailImage => ({
  type: 'IMAGE',
  optionValueId: null,
  variantId: null,
  isScene: false,
  ...overrides,
});

const variant = (
  overrides: Partial<SkuThumbnailVariant> & {
    id: string;
    optionValues: { optionValueId: string }[];
    product: { images: SkuThumbnailImage[] };
  },
): SkuThumbnailVariant => ({
  ...overrides,
});

describe('skuThumbnailUrl', () => {
  it('prefers the image of the option value the variant carries', () => {
    const result = skuThumbnailUrl(
      variant({
        id: 'variant-1',
        optionValues: [{ optionValueId: 'value-black' }],
        product: {
          images: [
            image({ url: '/shared.png' }),
            image({ url: '/black.png', optionValueId: 'value-black' }),
            image({ url: '/variant.png', variantId: 'variant-1' }),
          ],
        },
      }),
    );

    expect(result).toBe('/black.png');
  });

  it('falls back to the variant image when the option value has none', () => {
    const result = skuThumbnailUrl(
      variant({
        id: 'variant-1',
        optionValues: [{ optionValueId: 'value-black' }],
        product: {
          images: [
            image({ url: '/shared.png' }),
            image({ url: '/variant.png', variantId: 'variant-1' }),
          ],
        },
      }),
    );

    expect(result).toBe('/variant.png');
  });

  it('falls back to the shared gallery image', () => {
    const result = skuThumbnailUrl(
      variant({
        id: 'variant-1',
        optionValues: [{ optionValueId: 'value-black' }],
        product: { images: [image({ url: '/shared.png' })] },
      }),
    );

    expect(result).toBe('/shared.png');
  });

  it('never uses a scene photo — those are room scenes, not product shots', () => {
    const result = skuThumbnailUrl(
      variant({
        id: 'variant-1',
        optionValues: [{ optionValueId: 'value-black' }],
        product: {
          images: [
            image({ url: '/scene.png', optionValueId: 'value-black', isScene: true }),
            image({ url: '/shared.png' }),
          ],
        },
      }),
    );

    expect(result).toBe('/shared.png');
  });

  it('returns null when the product has no image at all', () => {
    const result = skuThumbnailUrl(
      variant({
        id: 'variant-1',
        optionValues: [{ optionValueId: 'value-black' }],
        product: { images: [] },
      }),
    );

    expect(result).toBeNull();
  });
});
