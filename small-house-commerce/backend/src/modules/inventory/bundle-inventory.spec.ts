import { describe, expect, it, vi } from 'vitest';
import { computeBundleAvailability, requirementsFromBundleSnapshot, aggregateRequirements, getBundleAvailabilityForSkus, expandBundleRequirements } from './bundle-inventory.js';

const components = [
  { componentSkuId: 'chair', quantity: 2, availableInventory: 9, status: 'ACTIVE', productStatus: 'ACTIVE', isBundle: false },
  { componentSkuId: 'table', quantity: 1, availableInventory: 3, status: 'ACTIVE', productStatus: 'ACTIVE', isBundle: false },
];

describe('Bundle inventory calculation', () => {
  const bundle = {
    id: 'bundle', isBundle: true, status: 'ACTIVE',
    bundleComponents: [{ componentSkuId: 'chair', quantity: 2, position: 0, componentSku: {
      id: 'chair', isBundle: false, status: 'ACTIVE', skuCode: 'CHAIR',
      variant: { name: 'Black', product: { name: 'Chair', status: 'ACTIVE' } },
      inventory: [{ onHand: 9, reserved: 1 }],
    } }],
  };
  it('computes virtual availability without a Bundle inventory row', async () => {
    const db = { sku: { findMany: vi.fn(async () => [bundle]) } };
    expect(await getBundleAvailabilityForSkus(db as never, ['bundle'])).toEqual(new Map([['bundle', 4]]));
  });
  it('expands a locked definition into component requirements and a versioned snapshot', async () => {
    const tx = { $queryRaw: vi.fn(async () => [{ id: 'bundle' }]), sku: { findUnique: vi.fn(async () => bundle) } };
    expect(await expandBundleRequirements('bundle', 3, tx as never)).toMatchObject({
      requirements: [{ skuId: 'chair', quantity: 6 }],
      snapshot: { version: 1, components: [{ componentSkuId: 'chair', quantityPerBundle: 2, totalQuantity: 6, skuCode: 'CHAIR' }] },
    });
  });
  it('rejects checkout of a Bundle with no valid components', async () => {
    const tx = { $queryRaw: vi.fn(async () => [{ id: 'bundle' }]), sku: { findUnique: vi.fn(async () => ({ ...bundle, bundleComponents: [] })) } };
    await expect(expandBundleRequirements('bundle', 1, tx as never)).rejects.toThrow();
  });

  it('uses the limiting component and rounds down', () => {
    expect(computeBundleAvailability(components)).toBe(3);
    expect(computeBundleAvailability([{ ...components[0], availableInventory: 5 }])).toBe(2);
  });
  it('fails closed for empty, disabled, nested or unavailable components', () => {
    expect(computeBundleAvailability([])).toBe(0);
    for (const change of [{ status: 'DISABLED' }, { productStatus: 'DRAFT' }, { isBundle: true }, { availableInventory: -1 }, { quantity: 0 }]) {
      expect(computeBundleAvailability([{ ...components[0], ...change }])).toBe(0);
    }
  });
  it('aggregates shared components across Bundle and ordinary lines', () => {
    expect(aggregateRequirements([
      { skuId: 'chair', quantity: 4 }, { skuId: 'table', quantity: 2 }, { skuId: 'chair', quantity: 1 },
    ])).toEqual([{ skuId: 'chair', quantity: 5 }, { skuId: 'table', quantity: 2 }]);
  });
  it('ships the ordered definition rather than a later catalog definition', () => {
    const snapshot = { version: 1, components: [
      { componentSkuId: 'chair', quantityPerBundle: 2, totalQuantity: 6, position: 0, skuCode: 'OLD-CHAIR', productName: 'Chair', variantName: 'Black' },
      { componentSkuId: 'table', quantityPerBundle: 1, totalQuantity: 3, position: 1, skuCode: 'TABLE', productName: 'Table', variantName: 'Small' },
    ] };
    expect(requirementsFromBundleSnapshot('bundle', 2, snapshot)).toEqual([
      { skuId: 'chair', quantity: 4 }, { skuId: 'table', quantity: 2 },
    ]);
    expect(requirementsFromBundleSnapshot('ordinary', 2, null)).toEqual([{ skuId: 'ordinary', quantity: 2 }]);
  });
});
