import { describe, expect, it } from 'vitest';
import { aggregateRequirements, cartRequirements, computeBundleAvailability, requirementsFromBundleSnapshot, validateBundleDefinition } from './bundle-inventory.js';

const chair = { componentSkuId: 'chair', quantity: 2, availableInventory: 9, status: 'ACTIVE', productStatus: 'ACTIVE', isBundle: false };
const table = { componentSkuId: 'table', quantity: 1, availableInventory: 3, status: 'ACTIVE', productStatus: 'ACTIVE', isBundle: false };

describe('Bundle availability calculation', () => {
  it('uses the limiting physical component rather than summing component stock', () => {
    expect(computeBundleAvailability([chair, table])).toBe(3);
  });

  it('floors an indivisible component remainder', () => {
    expect(computeBundleAvailability([{ ...chair, availableInventory: 5 }])).toBe(2);
  });

  it('keeps a valid quantity of one thousand sellable', () => {
    expect(computeBundleAvailability([{ ...chair, quantity: 1000, availableInventory: 2999 }])).toBe(2);
  });

  it('fails closed for an empty definition', () => {
    expect(computeBundleAvailability([])).toBe(0);
  });

  it.each([
    { status: 'DISABLED' }, { productStatus: 'DRAFT' }, { productStatus: 'DISABLED' },
    { isBundle: true }, { availableInventory: -1 }, { availableInventory: NaN },
    { availableInventory: Infinity }, { availableInventory: 5.5 },
    { quantity: 0 }, { quantity: -1 }, { quantity: 1.5 }, { quantity: 1001 },
  ])('fails closed for an invalid component %j', change => {
    expect(computeBundleAvailability([{ ...chair, ...change }])).toBe(0);
  });

  it('rejects duplicate physical identities rather than counting independent availability twice', () => {
    expect(computeBundleAvailability([chair, { ...chair, quantity: 1 }])).toBe(0);
  });

  it('fails closed above twenty components', () => {
    const components = Array.from({ length: 21 }, (_, i) => ({ ...chair, componentSkuId: `component-${i}` }));
    expect(computeBundleAvailability(components)).toBe(0);
  });

  it('returns zero when one component has no free stock', () => {
    expect(computeBundleAvailability([chair, { ...table, availableInventory: 0 }])).toBe(0);
  });
});

const definition = { componentSkuId: 'chair', quantity: 2, status: 'ACTIVE', productStatus: 'ACTIVE', isBundle: false };

describe('Bundle definition validation', () => {
  it('accepts a distinct active ordinary definition at the quantity ceiling', () => {
    expect(validateBundleDefinition([definition])).toBeNull();
    expect(validateBundleDefinition([{ ...definition, quantity: 1000 }])).toBeNull();
    expect(validateBundleDefinition(Array.from({ length: 20 }, (_, i) => ({ ...definition, componentSkuId: `component-${i}` })))).toBeNull();
  });

  it.each([
    ['no components', []],
    ['duplicate identity', [definition, { ...definition, quantity: 1 }]],
    ['nested Bundle', [{ ...definition, isBundle: true }]],
    ['disabled component', [{ ...definition, status: 'DISABLED' }]],
    ['inactive product', [{ ...definition, productStatus: 'DRAFT' }]],
    ['disabled product', [{ ...definition, productStatus: 'DISABLED' }]],
    ['zero quantity', [{ ...definition, quantity: 0 }]],
    ['negative quantity', [{ ...definition, quantity: -1 }]],
    ['fractional quantity', [{ ...definition, quantity: 1.5 }]],
    ['oversized quantity', [{ ...definition, quantity: 1001 }]],
    ['more than twenty components', Array.from({ length: 21 }, (_, i) => ({ ...definition, componentSkuId: `component-${i}` }))],
  ])('reports %s', (_name, rows) => {
    expect(typeof validateBundleDefinition(rows)).toBe('string');
  });

  it('keeps availability zero for every definition the validator reports', () => {
    expect(computeBundleAvailability([{ ...definition, quantity: 0, availableInventory: 50 }])).toBe(0);
    expect(computeBundleAvailability([{ ...definition, availableInventory: 50 }, { ...definition, availableInventory: 50 }])).toBe(0);
  });
});

describe('Bundle requirements', () => {
  it('aggregates duplicate component demand deterministically', () => {
    expect(aggregateRequirements([
      { skuId: 'chair', quantity: 2 },
      { skuId: 'chair', quantity: 3 },
      { skuId: 'table', quantity: 1 },
    ])).toEqual([
      { skuId: 'chair', quantity: 5 },
      { skuId: 'table', quantity: 1 },
    ]);
  });

  it('expands a Bundle line into components and an ordinary line into itself', () => {
    expect(cartRequirements([
      { skuId: 'set', isBundle: true, quantity: 2, components: [{ componentSkuId: 'chair', quantity: 3 }] },
      { skuId: 'chair', isBundle: false, quantity: 1 },
    ])).toEqual([{ skuId: 'chair', quantity: 7 }]);
  });

  it('never demands the virtual SKU itself, even with a missing or empty definition', () => {
    expect(cartRequirements([{ skuId: 'set', isBundle: true, quantity: 4, components: [] }])).toEqual([]);
    expect(cartRequirements([{ skuId: 'set', isBundle: true, quantity: 4 }])).toEqual([]);
  });

  it('skips line quantities that could not have been stored as whole units', () => {
    expect(cartRequirements([
      { skuId: 'chair', isBundle: false, quantity: 0 },
      { skuId: 'table', isBundle: false, quantity: 1.5 },
      { skuId: 'shelf', isBundle: false, quantity: 2 },
    ])).toEqual([{ skuId: 'shelf', quantity: 2 }]);
  });

  it('derives demand from a saved snapshot at the ordered line quantity', () => {
    const snapshot = { components: [
      { componentSkuId: 'chair', quantity: 2 },
      { componentSkuId: 'table', quantity: 1 },
    ] };
    expect(requirementsFromBundleSnapshot(snapshot, 3)).toEqual([
      { skuId: 'chair', quantity: 6 },
      { skuId: 'table', quantity: 3 },
    ]);
    expect(requirementsFromBundleSnapshot(snapshot, 1)).toEqual([
      { skuId: 'chair', quantity: 2 },
      { skuId: 'table', quantity: 1 },
    ]);
  });

  it('demands nothing for a snapshot with no components or an unusable line quantity', () => {
    expect(requirementsFromBundleSnapshot({ components: [] }, 2)).toEqual([]);
    expect(requirementsFromBundleSnapshot({ components: [{ componentSkuId: 'chair', quantity: 2 }] }, 0)).toEqual([]);
  });
});
