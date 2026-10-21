import { describe, expect, it } from 'vitest';
import { skuWriteSchema } from './dto/catalog-graph.dto.js';
import { resolveProductDimensions } from './products.service.js';

describe('SKU product dimensions', () => {
  it('retains the explicit virtual Bundle marker in typed SKU writes', () => {
    expect(skuWriteSchema.parse({ skuCode: 'BUNDLE', isBundle: true })).toHaveProperty('isBundle', true);
    expect(() => skuWriteSchema.parse({ skuCode: 'BUNDLE', isBundle: 'true' })).toThrow();
  });

  it('accepts nullable product-dimension overrides so an override can be cleared', () => {
    const parsed = skuWriteSchema.parse({
      skuCode: 'CHAIR-BLACK',
      productWidth: 48,
      productHeight: null,
      productDepth: 52,
    });

    expect(parsed).toMatchObject({
      productWidth: 48,
      productHeight: null,
      productDepth: 52,
    });
  });

  it('rejects negative product-dimension overrides', () => {
    expect(() =>
      skuWriteSchema.parse({ skuCode: 'CHAIR-BLACK', productWidth: -1 }),
    ).toThrow();
  });

  it('uses an SKU override before the product default for each dimension', () => {
    expect(
      resolveProductDimensions(
        { width: 40, height: 70, depth: 45 },
        { productWidth: 48, productHeight: null, productDepth: 52 },
      ),
    ).toEqual({ width: 48, height: 70, depth: 52 });
  });

  it('falls back to product dimensions when the SKU is missing or has no overrides', () => {
    const product = { width: 40, height: 70, depth: 45 };

    expect(resolveProductDimensions(product, null)).toEqual(product);
    expect(
      resolveProductDimensions(product, {
        productWidth: null,
        productHeight: null,
        productDepth: null,
      }),
    ).toEqual(product);
  });
});
