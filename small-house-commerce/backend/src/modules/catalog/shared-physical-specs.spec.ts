import { describe, expect, it } from 'vitest';
import {
  PHYSICAL_FIELDS,
  physicalSpecificationGroupKey,
  planSharedPhysicalSpecUpdates,
  type PhysicalPatch,
  type PhysicalSpecRow,
  type PhysicalValues,
} from './shared-physical-specs.js';

const empty: PhysicalValues = {
  productWidth: null, productDepth: null, productHeight: null, productWeight: null,
  packageWidth: null, packageDepth: null, packageHeight: null,
  packageWeight: null, volumetricWeight: null,
};
function row(key: string, values: PhysicalPatch = {}, extra: Partial<PhysicalSpecRow> = {}): PhysicalSpecRow {
  return {
    variantKey: `variant-${key}`, skuKey: key, isBundle: false, shareable: true,
    pairs: [{ optionKey: 'color', valueKey: key, kind: 'COLOR' }],
    values: { ...empty, ...values }, ...extra,
  };
}
function changed(source: PhysicalSpecRow, patch: PhysicalPatch): PhysicalSpecRow {
  return { ...source, values: { ...source.values, ...patch } };
}
function plan(
  before: PhysicalSpecRow[], after: PhysicalSpecRow[],
  writes: Array<[string, PhysicalPatch]> = [], created: string[] = [],
  retained: PhysicalSpecRow[] = [],
) {
  return planSharedPhysicalSpecUpdates({
    before, after, requested: new Map(writes), createdSkuKeys: new Set(created),
    persistedValues: new Map([...before, ...retained].map(r => [r.skuKey, r.values])),
  });
}

const red = row('red', { packageWidth: 100 });
const blue = row('blue', { packageWidth: 100 });

describe('physical specification groups', () => {
  it('ignores only typed COLOR bindings', () => {
    expect(physicalSpecificationGroupKey(red)).toBe('["SKU"]');
    expect(physicalSpecificationGroupKey(blue)).toBe('["SKU"]');
    const legacy = { ...red, shareable: false };
    expect(physicalSpecificationGroupKey(legacy)).not.toBe(physicalSpecificationGroupKey({ ...blue, shareable: false }));
  });

  it.each(['STYLE', 'SIZE', 'MATERIAL'] as const)('keeps %s value identities separate across colors', kind => {
    const first = { optionKey: 'physical', valueKey: 'small', kind };
    const second = { ...first, valueKey: 'large' };
    expect(physicalSpecificationGroupKey({ ...red, pairs: [...red.pairs, first] })).toBe('["SKU",["physical","small"]]');
    expect(physicalSpecificationGroupKey({ ...blue, pairs: [...blue.pairs, first] })).toBe('["SKU",["physical","small"]]');
    expect(physicalSpecificationGroupKey({ ...blue, pairs: [...blue.pairs, second] })).toBe('["SKU",["physical","large"]]');
  });

  it('does not merge ordinary and Bundle groups', () => {
    expect(physicalSpecificationGroupKey({ ...blue, isBundle: true })).toBe('["BUNDLE"]');
  });

  it('is independent of binding order', () => {
    const pairs = [
      { optionKey: 'z', valueKey: 'z1', kind: 'SIZE' as const },
      { optionKey: 'a', valueKey: 'a1', kind: 'MATERIAL' as const },
    ];
    expect(physicalSpecificationGroupKey({ ...red, pairs })).toBe('["SKU",["a","a1"],["z","z1"]]');
    expect(physicalSpecificationGroupKey({ ...red, pairs: [...pairs].reverse() })).toBe('["SKU",["a","a1"],["z","z1"]]');
  });
});

describe('shared physical specification writes', () => {
  it.each(PHYSICAL_FIELDS)('fans out an explicit %s change without unrelated fields', field => {
    const next = changed(red, { [field]: 120 });
    const result = plan([red, blue], [next, blue], [[red.skuKey, { [field]: 120 }]]);
    expect(result.conflicts).toEqual([]);
    expect(result.updates.get(blue.skuKey)).toEqual({ [field]: 120 });
    expect(result.updates.get(blue.skuKey)).not.toHaveProperty('price');
    expect(blue.values.packageWidth).toBe(100);
  });

  it('does not cross a different non-color combination', () => {
    const other = { ...blue, pairs: [...blue.pairs, { optionKey: 'size', valueKey: 'large', kind: 'SIZE' as const }] };
    const result = plan([red, other], [changed(red, { packageWeight: 8 }), other], [['red', { packageWeight: 8 }]]);
    expect(result.conflicts).toEqual([]);
    expect(result.updates.has('blue')).toBe(false);
  });

  it('does not infer COLOR from a legacy row or a STYLE value label', () => {
    const legacyRed = { ...red, shareable: false };
    const legacyBlue = { ...blue, shareable: false };
    const result = plan([legacyRed, legacyBlue], [changed(legacyRed, { packageWeight: 8 }), legacyBlue], [['red', { packageWeight: 8 }]]);
    expect(result.updates.has('blue')).toBe(false);
  });

  it('ignores unchanged physical fields in a price-only full SKU payload', () => {
    const conflictingBlue = changed(blue, { packageWidth: 90 });
    const result = plan([red, conflictingBlue], [red, conflictingBlue], [
      ['red', { ...red.values }], ['blue', { ...conflictingBlue.values }],
    ]);
    expect(result.conflicts).toEqual([]);
    expect(result.updates.size).toBe(0);
  });

  it('preserves conflicts in fields other than the one explicitly edited', () => {
    const conflictingBlue = changed(blue, { packageWidth: 90 });
    const result = plan([red, conflictingBlue], [changed(red, { packageWeight: 8 }), conflictingBlue], [['red', { packageWeight: 8 }]]);
    expect(result.conflicts).toEqual([]);
    expect(result.updates.get('blue')).toEqual({ packageWeight: 8 });
  });

  it('rejects competing new values independent of request order', () => {
    const after = [changed(red, { packageWidth: 120 }), changed(blue, { packageWidth: 140 })];
    for (const writes of [
      [['red', { packageWidth: 120 }], ['blue', { packageWidth: 140 }]],
      [['blue', { packageWidth: 140 }], ['red', { packageWidth: 120 }]],
    ] as Array<Array<[string, PhysicalPatch]>>) {
      const result = plan([red, blue], after, writes);
      expect(result.conflicts).toEqual([{ groupKey: '["SKU"]', field: 'packageWidth', skuKeys: ['red', 'blue'] }]);
    }
  });

  it('propagates zero as an explicit value', () => {
    const result = plan([red, blue], [changed(red, { packageWidth: 0 }), blue], [['red', { packageWidth: 0 }]]);
    expect(result.updates.get('blue')).toEqual({ packageWidth: 0 });
  });

  it('clears ordinary overrides back to group-wide Product inheritance', () => {
    const a = changed(red, { productWidth: 120 });
    const b = changed(blue, { productWidth: 120 });
    const result = plan([a, b], [changed(a, { productWidth: null }), b], [['red', { productWidth: null }]]);
    expect(result.conflicts).toEqual([]);
    expect(result.updates.get('blue')).toEqual({ productWidth: null });
  });

  it('does not normalize null and zero without an explicit change', () => {
    const a = changed(red, { productWidth: 0 });
    const result = plan([a, blue], [a, blue], [['red', { ...a.values }]]);
    expect(result.conflicts).toEqual([]);
    expect(result.updates.size).toBe(0);
  });

  it('inherits a consistent existing group into a new color SKU', () => {
    const first = changed(red, { productWidth: 120, productWeight: 4, packageWeight: 5 });
    const fresh = row('green');
    const result = plan([first], [first, fresh], [['green', { ...fresh.values }]], ['green']);
    expect(result.conflicts).toEqual([]);
    expect(result.updates.get('green')).toEqual({ productWidth: 120, productWeight: 4, packageWidth: 100, packageWeight: 5 });
  });

  it('does not choose a source for a new color in a conflicting old group', () => {
    const other = changed(blue, { packageWidth: 90 });
    const fresh = row('green');
    const result = plan([red, other], [red, other, fresh], [['green', fresh.values]], ['green']);
    expect(result.conflicts).toContainEqual({ groupKey: '["SKU"]', field: 'packageWidth', skuKeys: ['red', 'blue', 'green'] });
  });

  it('rejects a new color whose supplied value would rewrite an existing group', () => {
    const fresh = row('green', { packageWidth: 140 });
    const result = plan([red], [red, fresh], [['green', fresh.values]], ['green']);
    expect(result.conflicts.map(r => r.field)).toContain('packageWidth');
  });

  it('accepts a new color after the same request explicitly resolves the group', () => {
    const other = changed(blue, { packageWidth: 90 });
    const fresh = row('green', { packageWidth: 100 });
    const result = plan([red, other], [red, changed(other, { packageWidth: 100 }), fresh], [
      ['blue', { packageWidth: 100 }], ['green', fresh.values],
    ], ['green']);
    expect(result.conflicts).toEqual([]);
  });

  it('initializes new-only colors from one consistent supplied value', () => {
    const a = row('red', { packageWeight: 5 });
    const b = row('blue');
    const result = plan([], [a, b], [['red', a.values], ['blue', b.values]], ['red', 'blue']);
    expect(result.conflicts).toEqual([]);
    expect(result.updates.get('blue')).toEqual({ packageWeight: 5 });
  });

  it('rejects competing new-only color specifications', () => {
    const a = row('red', { packageWeight: 5 });
    const b = row('blue', { packageWeight: 7 });
    expect(plan([], [a, b], [['red', a.values], ['blue', b.values]], ['red', 'blue']).conflicts.map(r => r.field)).toContain('packageWeight');
  });

  it('does not overwrite a different retained value when a SKU is reactivated', () => {
    const retained = changed(blue, { packageWidth: 90 });
    const result = plan([red], [red, retained], [['blue', retained.values]], [], [retained]);
    expect(result.conflicts.map(r => r.field)).toContain('packageWidth');
  });

  it('checks old specifications when non-color groups merge into COLOR', () => {
    const beforeRed = { ...red, pairs: [{ optionKey: 'kind', valueKey: 'r', kind: 'SIZE' as const }] };
    const beforeBlue = { ...changed(blue, { packageWidth: 90 }), pairs: [{ optionKey: 'kind', valueKey: 'b', kind: 'SIZE' as const }] };
    const afterRed = { ...beforeRed, pairs: [{ ...beforeRed.pairs[0], kind: 'COLOR' as const }] };
    const afterBlue = { ...beforeBlue, pairs: [{ ...beforeBlue.pairs[0], kind: 'COLOR' as const }] };
    expect(plan([beforeRed, beforeBlue], [afterRed, afterBlue]).conflicts.map(r => r.field)).toContain('packageWidth');
  });

  it('never fans out product dimensions across Bundle colors', () => {
    const a = { ...red, isBundle: true };
    const b = { ...blue, isBundle: true };
    const result = plan([a, b], [changed(a, { productWidth: 999, packageWeight: 8 }), b], [['red', { productWidth: 999, packageWeight: 8 }]]);
    expect(result.conflicts).toEqual([]);
    expect(result.updates.get('blue')).toEqual({ packageWeight: 8 });
  });

  it('leaves removed and non-materialized candidates out of fanout', () => {
    const result = plan([red, blue], [changed(red, { packageWeight: 8 })], [['red', { packageWeight: 8 }]]);
    expect(result.conflicts).toEqual([]);
    expect(result.updates.has('blue')).toBe(false);
    expect(result.updates.has('candidate')).toBe(false);
  });
});
