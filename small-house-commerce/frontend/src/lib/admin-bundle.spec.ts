import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bundleComponentWrites, saveBundleComponentWrites, bundleDraftAvailability, bundleDraftToInput, type AdminBundleDraft } from './admin-bundle';
import type { AdminSkuDraft, AdminVariantDraft } from './admin-product-graph';

const save = vi.hoisted(() => vi.fn());
vi.mock('./admin-api', () => ({ adminApi: { setBundleComponents: save } }));
beforeEach(() => { vi.resetAllMocks(); save.mockResolvedValue({ version: 5, components: [], availableInventory: 0 }); });

const component: AdminBundleDraft = { componentSkuId: 'chair', quantity: '2', componentSkuCode: 'CHAIR', componentProductName: 'Chair', componentVariantName: 'Black', availableInventory: 9, status: 'ACTIVE', productStatus: 'ACTIVE', isBundle: false };

describe('Bundle product save phases', () => {
  function variant(skuCode = 'SET', id?: string): AdminVariantDraft {
    const sku: AdminSkuDraft = {
      ...(id ? { id } : {}), skuCode, isBundle: true, bundleVersion: 4, status: 'ACTIVE',
      supplierSku: null, supplierCost: null, costCurrency: null, landedCost: null,
      price: 2499, compareAtPrice: null, productWidth: null, productDepth: null, productHeight: null,
      productWeight: null, packageWidth: null, packageDepth: null, packageHeight: null,
      packageWeight: null, volumetricWeight: null, onHand: 0,
      bundleDraft: { version: 4, components: [component] },
    };
    return { clientKey: `row-${skuCode}`, name: skuCode, position: 0, combinationKey: '', optionValueRefs: [], sku };
  }

  it('prepares only changed virtual definitions and validates before graph writes', () => {
    const ordinary = variant('ORDINARY');
    ordinary.sku!.isBundle = false;
    const unchanged = variant('UNCHANGED');
    delete unchanged.sku!.bundleDraft;
    expect(bundleComponentWrites({ variants: [ordinary, unchanged] })).toEqual([]);
    const invalid = variant();
    invalid.sku!.bundleDraft!.components[0] = { ...component, quantity: '0' };
    expect(() => bundleComponentWrites({ variants: [invalid] })).toThrow();
    expect(save).not.toHaveBeenCalled();
  });

  it('resolves a new SKU after graph materialization and preserves the draft CAS version', async () => {
    const writes = bundleComponentWrites({ variants: [variant(' SET ')] });
    const failures = await saveBundleComponentWrites({ id: 'product', variants: [{ sku: { id: 'real-sku', skuCode: 'SET', isBundle: true } }] }, writes);
    expect(failures).toEqual([]);
    expect(save).toHaveBeenCalledWith('product', 'real-sku', { expectedVersion: 4, components: [{ componentSkuId: 'chair', quantity: 2, position: 0 }] });
  });

  it('retains the materialized SKU identity when a new definition fails', async () => {
    const writes = bundleComponentWrites({ variants: [variant('SET')] });
    const product = { id: 'product', variants: [{ sku: { id: 'real-sku', skuCode: 'SET', isBundle: true } }] };
    save.mockRejectedValueOnce(new Error('Temporary failure'));
    const failures = await saveBundleComponentWrites(product, writes);
    expect(failures).toEqual([{ write: { ...writes[0], skuId: 'real-sku' }, error: 'Temporary failure' }]);
    product.variants[0].sku.skuCode = 'RENAMED-SET';
    expect(await saveBundleComponentWrites(product, failures.map(row => row.write))).toEqual([]);
    expect(save.mock.calls[1].slice(0, 2)).toEqual(['product', 'real-sku']);
  });

  it.each(['missing', 'ordinary', 'ambiguous', 'replaced-id'])('does not guess a Bundle identity when %s', async kind => {
    const writes = bundleComponentWrites({ variants: [variant('SET', kind === 'replaced-id' ? 'old-id' : undefined)] });
    const sku = { id: 'new-id', skuCode: 'SET', isBundle: kind !== 'ordinary' };
    const variants = kind === 'missing' ? [] : kind === 'ambiguous' ? [{ sku }, { sku: { ...sku, id: 'another' } }] : [{ sku }];
    const failures = await saveBundleComponentWrites({ id: 'product', variants }, writes);
    expect(failures).toEqual([{ write: writes[0], error: 'Bundle SKU identity could not be resolved after product save.' }]);
    expect(save).not.toHaveBeenCalled();
  });

  it('keeps exact failed component drafts and retries only those definitions', async () => {
    const writes = bundleComponentWrites({ variants: [variant('SET-A', 'a'), variant('SET-B', 'b')] });
    const product = { id: 'product', variants: ['a', 'b'].map(id => ({ sku: { id, skuCode: `SET-${id.toUpperCase()}`, isBundle: true } })) };
    save.mockResolvedValueOnce({ version: 5 }).mockRejectedValueOnce(new Error('Version conflict'));
    const failures = await saveBundleComponentWrites(product, writes);
    expect(failures).toEqual([{ write: writes[1], error: 'Version conflict' }]);
    expect(failures[0].write.draft.components[0]).toEqual(component);
    save.mockClear();
    expect(await saveBundleComponentWrites(product, failures.map(row => row.write))).toEqual([]);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0].slice(0, 2)).toEqual(['product', 'b']);
  });
});

describe('Bundle editor draft', () => {
  it('serializes only exact identities, integer quantities and display order', () => {
    expect(bundleDraftToInput([component, { ...component, componentSkuId: 'table', quantity: '1' }])).toEqual([
      { componentSkuId: 'chair', quantity: 2, position: 0 },
      { componentSkuId: 'table', quantity: 1, position: 1 },
    ]);
  });

  it.each(['', '0', '-1', '1.5', '1001', 'NaN', 'Infinity'])('rejects invalid quantity %s before saving', quantity => {
    expect(() => bundleDraftToInput([{ ...component, quantity }])).toThrow();
  });

  it('rejects duplicates and empty definitions', () => {
    expect(() => bundleDraftToInput([component, component])).toThrow();
    expect(() => bundleDraftToInput([])).toThrow();
  });

  it('rejects an oversized draft even when every component is distinct', () => {
    expect(() => bundleDraftToInput(Array.from({ length: 21 }, (_, i) => ({ ...component, componentSkuId: `sku-${i}` })))).toThrow();
  });

  it('previews limiting availability without creating virtual stock', () => {
    expect(bundleDraftAvailability([component, { ...component, componentSkuId: 'table', quantity: '1', availableInventory: 3 }])).toBe(3);
  });

  it('floors partial sets and accepts valid quantity boundaries', () => {
    expect(bundleDraftAvailability([{ ...component, quantity: '1000', availableInventory: 2999 }])).toBe(2);
    expect(bundleDraftAvailability([{ ...component, quantity: '1', availableInventory: 3 }])).toBe(3);
  });

  it.each<Partial<AdminBundleDraft>>([
    { status: 'DISABLED' }, { productStatus: 'DRAFT' }, { isBundle: true },
    { availableInventory: -1 }, { availableInventory: NaN }, { availableInventory: Infinity },
    { availableInventory: 5.5 },
  ])('fails closed for an unavailable component %j', change => {
    expect(bundleDraftAvailability([{ ...component, ...change }])).toBe(0);
  });
});
