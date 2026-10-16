import { describe, expect, it } from 'vitest';
import { projectBundleComponentSpecifications, type BundleComponentSpecificationRow } from './bundle-public-specifications.js';

function component(overrides: Partial<BundleComponentSpecificationRow> = {}): BundleComponentSpecificationRow {
  return {
    componentSkuId: 'chair', quantity: 4, status: 'ACTIVE', productStatus: 'ACTIVE', isBundle: false,
    productName: 'Chair', variantName: 'Oak', skuDimensions: { width: 45, depth: null, height: 0 },
    productDimensions: { width: 40, depth: 50, height: 80 },
    foldedWidth: 20, foldedDepth: null, foldedHeight: null, productWeight: 4, materials: 'Wood', ...overrides,
  };
}

describe('projectBundleComponentSpecifications', () => {
  it('resolves axes independently, retains zero and never multiplies dimensions by quantity', () => {
    expect(projectBundleComponentSpecifications([component()])).toEqual([{
      productName: 'Chair', variantName: 'Oak', quantity: 4, width: 45, depth: 50, height: 0,
      foldedWidth: 20, foldedDepth: null, foldedHeight: null, productWeight: 4, materials: 'Wood',
    }]);
  });
  it('uses only component Product defaults when all SKU axes inherit', () => {
    expect(projectBundleComponentSpecifications([component({ skuDimensions: { width: null, depth: null, height: null } })])[0])
      .toMatchObject({ width: 40, depth: 50, height: 80 });
  });
  it('retains identity and quantity when dimensions and materials have not been provided', () => {
    expect(projectBundleComponentSpecifications([component({
      skuDimensions: { width: null, depth: null, height: null }, productDimensions: { width: null, depth: null, height: null },
      foldedWidth: null, productWeight: null, materials: null,
    })])[0]).toMatchObject({ productName: 'Chair', quantity: 4, width: null, depth: null, height: null, productWeight: null, materials: null });
  });
  it.each([
    { status: 'DISABLED' }, { productStatus: 'DRAFT' }, { productStatus: 'DISABLED' }, { isBundle: true },
    { quantity: 0 }, { quantity: -1 }, { quantity: 1.5 }, { quantity: 1001 }, { quantity: Number.NaN },
  ])('rejects the entire definition for invalid component %j', invalid => {
    expect(projectBundleComponentSpecifications([component({ componentSkuId: 'table' }), component(invalid)])).toEqual([]);
  });
  it('rejects duplicates and an empty/missing definition', () => {
    expect(projectBundleComponentSpecifications([component(), component()])).toEqual([]);
    expect(projectBundleComponentSpecifications([])).toEqual([]);
  });
  it('rejects more than twenty distinct components', () => {
    expect(projectBundleComponentSpecifications(Array.from({ length: 21 }, (_, index) => component({ componentSkuId: String(index) })))).toEqual([]);
  });
  it('publishes out-of-stock but valid component specifications using an explicit whitelist', () => {
    const row = { ...component(), availableInventory: 0, supplierId: 'PRIVATE', supplierCost: 14, landedCost: 19, inventory: { reserved: 1 }, bundleSnapshot: 'SECRET' };
    expect(Object.keys(projectBundleComponentSpecifications([row])[0]).sort()).toEqual([
      'productName', 'variantName', 'quantity', 'width', 'depth', 'height', 'foldedWidth', 'foldedDepth', 'foldedHeight', 'productWeight', 'materials',
    ].sort());
    expect(JSON.stringify(projectBundleComponentSpecifications([row]))).not.toMatch(/PRIVATE|SECRET|supplier|Cost|inventory|reserved|bundleSnapshot/);
  });
});
