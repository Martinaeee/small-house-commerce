import { describe, expect, it } from 'vitest';
import type { AdminCatalogGraph } from './admin-api';
import {
  collectStockBatch,
  applyProductDimensionsToVariants,
  buildCatalogGraphPatch,
  type AdminCatalogGraphDraft,
} from './admin-product-graph';

function draft(): AdminCatalogGraphDraft {
  return {
    catalogGraphVersion: 1,
    options: [],
    media: [],
    variants: [
      {
        id: 'variant-black',
        name: 'Black',
        position: 0,
        combinationKey: 'black',
        optionValueRefs: [],
        sku: {
          id: 'sku-black',
          skuCode: 'BLACK',
          status: 'ACTIVE',
          supplierSku: null,
          supplierCost: null,
          costCurrency: null,
          landedCost: null,
          price: 10,
          compareAtPrice: null,
          productWidth: 40,
          productHeight: null,
          productDepth: null,
          productWeight: 2,
          packageWidth: 60,
          packageHeight: 20,
          packageDepth: 20,
          packageWeight: 3,
          volumetricWeight: null,
          onHand: 4,
        },
      },
      {
        id: 'variant-white',
        name: 'White',
        position: 1,
        combinationKey: 'white',
        optionValueRefs: [],
        sku: {
          id: 'sku-white',
          skuCode: 'WHITE',
          status: 'ACTIVE',
          supplierSku: null,
          supplierCost: null,
          costCurrency: null,
          landedCost: null,
          price: 12,
          compareAtPrice: null,
          productWidth: null,
          productHeight: null,
          productDepth: null,
          productWeight: 2,
          packageWidth: 70,
          packageHeight: 25,
          packageDepth: 25,
          packageWeight: 4,
          volumetricWeight: null,
          onHand: 2,
        },
      },
      {
        clientKey: 'variant-unmaterialized',
        name: 'Unmaterialized',
        position: 2,
        combinationKey: 'unmaterialized',
        optionValueRefs: [],
        sku: null,
      },
    ],
  };
}

describe('applyProductDimensionsToVariants', () => {
  it('excludes virtual Bundle SKUs from separate stock writes', () => {
    const baseline = draft();
    const value = draft();
    Object.assign(value.variants[0]!.sku!, { isBundle: true, onHand: 99 });
    value.variants[1]!.sku!.onHand = 3;
    expect(collectStockBatch(value, baseline)).toEqual([{ skuId: 'sku-white', onHand: 3 }]);
  });

  it('leaves disabled SKU dimensions untouched', () => {
    const value = draft();
    value.variants[0]!.sku!.status = 'DISABLED';
    const result = applyProductDimensionsToVariants(value, { width: 48, height: 72, depth: 50 }, 'all-materialized');
    expect(value.variants[0]?.sku?.productWidth).toBe(40);
    expect(result).toEqual({ changedCount: 1, skippedCount: 2 });
  });

  it('applies all dimensions only to materialized SKU rows', () => {
    const value = draft();

    const result = applyProductDimensionsToVariants(
      value,
      { width: 48, height: 72, depth: 50 },
      'all-materialized',
    );

    expect(result).toEqual({ changedCount: 2, skippedCount: 1 });
    expect(value.variants[0]?.sku).toMatchObject({
      productWidth: 48,
      productHeight: 72,
      productDepth: 50,
      packageWidth: 60,
      onHand: 4,
    });
    expect(value.variants[1]?.sku).toMatchObject({
      productWidth: 48,
      productHeight: 72,
      productDepth: 50,
    });
    expect(value.variants[2]?.sku).toBeNull();
  });

  it('fills only empty overrides and reports skipped populated axes', () => {
    const value = draft();

    const result = applyProductDimensionsToVariants(
      value,
      { width: 48, height: 72, depth: 50 },
      'empty-only',
    );

    expect(result).toEqual({ changedCount: 2, skippedCount: 1 });
    expect(value.variants[0]?.sku).toMatchObject({
      productWidth: 40,
      productHeight: 72,
      productDepth: 50,
    });
    expect(value.variants[1]?.sku).toMatchObject({
      productWidth: 48,
      productHeight: 72,
      productDepth: 50,
    });
  });

  it('serializes changed product dimensions without changing package or stock fields', () => {
    const value = draft();
    value.variants = [value.variants[0]!];
    value.variants[0]!.sku!.productWidth = 48;
    value.variants[0]!.sku!.productHeight = 72;
    value.variants[0]!.sku!.productDepth = 50;

    const original: AdminCatalogGraph = {
      catalogGraphVersion: 1,
      defaultDisplayVariantId: null,
      options: [],
      media: [],
      variants: [
        {
          id: 'variant-black',
          name: 'Black',
          position: 0,
          combinationKey: 'black',
          optionValues: [],
          hasReferences: false,
          sku: {
            id: 'sku-black',
            skuCode: 'BLACK',
            status: 'ACTIVE',
            supplierId: null,
            supplierSku: null,
            supplierCost: null,
            costCurrency: null,
            landedCost: null,
            price: '10',
            compareAtPrice: null,
            productWidth: 40,
            productHeight: null,
            productDepth: null,
            productWeight: 2,
            packageWidth: 60,
            packageHeight: 20,
            packageDepth: 20,
            packageWeight: 3,
            volumetricWeight: null,
            onHand: 4,
            reserved: 0,
            availableInventory: 4,
          },
        },
      ],
    };

    const patch = buildCatalogGraphPatch(original, value);

    expect(patch.variantUpserts[0]?.sku).toMatchObject({
      productWidth: 48,
      productHeight: 72,
      productDepth: 50,
      packageWidth: 60,
    });
    expect(patch.variantUpserts[0]?.sku).not.toHaveProperty('onHand');
  });
});
