import { describe, expect, it } from 'vitest';
import { skuReadiness } from './qianyi-sku.mapper.js';

const SKU = {
  id: 'sku-1',
  skuCode: 'TB001-Wa',
  qianyiSkuCode: null,
  packageWeight: 12.5,
  packageWidth: 120,
  packageHeight: 30,
  packageDepth: 60,
  productWeight: 11.2,
  product: { name: 'Console Table', description: 'Walnut console table' },
  images: [{ url: 'https://luwag.shop/img/table.jpg' }],
};

describe('skuReadiness', () => {
  it('is ready when weight and package dimensions are present', () => {
    expect(skuReadiness(SKU)).toEqual({ ready: true, gaps: [] });
  });

  it('names the missing fields instead of guessing them', () => {
    expect(skuReadiness({ ...SKU, packageWidth: null, packageHeight: null })).toEqual({
      ready: false,
      gaps: ['packageWidth', 'packageHeight'],
    });
  });
  it('is not ready when the net weight is missing, rather than guessing it', () => {
    const readiness = skuReadiness({ ...SKU, productWeight: null });
    expect(readiness).toEqual({ ready: false, gaps: ['productWeight'] });
  });
});

