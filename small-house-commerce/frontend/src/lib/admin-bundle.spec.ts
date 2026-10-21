import { describe, expect, it } from 'vitest';
import { bundleDraftToInput, bundleDraftAvailability } from './admin-bundle';

const component = { componentSkuId: 'chair', quantity: '2', componentSkuCode: 'CHAIR', componentProductName: 'Chair', componentVariantName: 'Black', availableInventory: 9, status: 'ACTIVE', productStatus: 'ACTIVE', isBundle: false };

describe('Bundle editor draft', () => {
  it('serializes only exact identities, integer quantities and display order', () => {
    expect(bundleDraftToInput([component, { ...component, componentSkuId: 'table', quantity: '1' }])).toEqual([
      { componentSkuId: 'chair', quantity: 2, position: 0 },
      { componentSkuId: 'table', quantity: 1, position: 1 },
    ]);
  });
  it.each(['', '0', '-1', '1.5', '1001', 'NaN'])('rejects invalid quantity %s before saving', (quantity) => {
    expect(() => bundleDraftToInput([{ ...component, quantity }])).toThrow();
  });
  it('rejects duplicates and empty definitions', () => {
    expect(() => bundleDraftToInput([component, component])).toThrow();
    expect(() => bundleDraftToInput([])).toThrow();
  });
  it('previews limiting availability without creating virtual stock', () => {
    expect(bundleDraftAvailability([component, { ...component, componentSkuId: 'table', quantity: '1', availableInventory: 3 }])).toBe(3);
    expect(bundleDraftAvailability([{ ...component, status: 'DISABLED' }])).toBe(0);
  });
});
