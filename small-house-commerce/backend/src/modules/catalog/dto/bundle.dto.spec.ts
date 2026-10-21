import { describe, expect, it } from 'vitest';
import { bundleComponentsSchema } from './bundle.dto.js';

const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';

describe('bundleComponentsSchema', () => {
  it('accepts exact component SKU identities and positive quantities', () => {
    expect(bundleComponentsSchema.parse([{ componentSkuId: A, quantity: 2, position: 0 }])).toEqual([
      { componentSkuId: A, quantity: 2, position: 0 },
    ]);
  });
  it.each([0, -1, 1.5, 1001, Infinity])('rejects invalid quantity %s', (quantity) => {
    expect(() => bundleComponentsSchema.parse([{ componentSkuId: A, quantity, position: 0 }])).toThrow();
  });
  it('rejects duplicate SKU bindings', () => {
    expect(() => bundleComponentsSchema.parse([
      { componentSkuId: A, quantity: 1, position: 0 },
      { componentSkuId: A, quantity: 2, position: 1 },
    ])).toThrow();
  });
  it('rejects empty and oversized definitions', () => {
    expect(() => bundleComponentsSchema.parse([])).toThrow();
    expect(() => bundleComponentsSchema.parse(Array.from({ length: 21 }, (_, position) => ({ componentSkuId: position ? A : B, quantity: 1, position })))).toThrow();
  });
});
