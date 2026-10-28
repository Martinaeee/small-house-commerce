import { describe, expect, it } from 'vitest';
import { buildSkuPayload, skuReadiness } from './qianyi-sku.mapper.js';

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

describe('buildSkuPayload', () => {
  it('uses package weight as gross and product weight as net', () => {
    const payload = buildSkuPayload(SKU, 'TB001-Wa');
    expect(payload).toMatchObject({
      sku: 'TB001-Wa',
      title: 'Console Table',
      type: 'SINGLE',
      weight: 12.5,
      netWeight: 11.2,
      weightUnit: 'KG',
      length: 120,
      width: 60,
      height: 30,
      dimensionUnit: 'cm',
      enable: 1,
    });
    expect(payload.notes).toEqual([expect.stringContaining('shelfLife')]);
  });

  it('sends KG and cm, the units our catalog stores', () => {
    const payload = buildSkuPayload(SKU, 'TB001-Wa');
    expect(payload.weightUnit).toBe('KG');
    expect(payload.dimensionUnit).toBe('cm');
    expect(payload.shelfLife).toBeGreaterThan(0);
  });

  it('maps our width/depth onto Qianyi length/width', () => {
    const payload = buildSkuPayload(SKU, 'TB001-Wa');
    // Our schema: packageWidth × packageDepth × packageHeight = L × W × H.
    expect([payload.length, payload.width, payload.height]).toEqual([120, 60, 30]);
  });
});
