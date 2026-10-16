import { describe, expect, it } from 'vitest';
import { bundleComponentsSchema, setBundleComponentsSchema } from './bundle.dto.js';

const component = {
  componentSkuId: '00000000-0000-4000-8000-000000000001',
  quantity: 2,
  position: 0,
};

describe('Bundle component input', () => {
  it('preserves concrete SKU identity, quantity and order without price fields', () => {
    expect(setBundleComponentsSchema.parse({ expectedVersion: 4, components: [component] })).toEqual({
      expectedVersion: 4,
      components: [{ componentSkuId: '00000000-0000-4000-8000-000000000001', quantity: 2, position: 0 }],
    });
  });

  it.each([1, 1000])('accepts boundary quantity %s', quantity => {
    expect(bundleComponentsSchema.parse([{ ...component, quantity }])[0].quantity).toBe(quantity);
  });

  it.each([0, -1, 1.5, 1001, Infinity, NaN, '2', null])('rejects invalid quantity %s', quantity => {
    expect(bundleComponentsSchema.safeParse([{ ...component, quantity }]).success).toBe(false);
  });

  it.each([-1, 0.5, Infinity, NaN, '0', null])('rejects invalid position %s', position => {
    expect(bundleComponentsSchema.safeParse([{ ...component, position }]).success).toBe(false);
  });

  it('accepts nonnegative integer positions without imposing a quantity bound on ordering', () => {
    expect(bundleComponentsSchema.parse([{ ...component, position: 1001 }])[0].position).toBe(1001);
  });

  it.each(['', 'not-a-sku', '00000000-0000-4000-8000', null])('rejects malformed component identity %s', componentSkuId => {
    expect(bundleComponentsSchema.safeParse([{ ...component, componentSkuId }]).success).toBe(false);
  });

  it('rejects a duplicate identity even when its quantity and position differ', () => {
    const result = bundleComponentsSchema.safeParse([component, { ...component, quantity: 3, position: 1 }]);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toContainEqual(expect.objectContaining({ path: [1, 'componentSkuId'] }));
  });

  it('accepts twenty distinct concrete SKUs', () => {
    const components = Array.from({ length: 20 }, (_, position) => ({
      componentSkuId: `00000000-0000-4000-8000-${String(position + 1).padStart(12, '0')}`,
      quantity: 1,
      position,
    }));
    expect(bundleComponentsSchema.parse(components)).toHaveLength(20);
  });

  it('rejects an empty definition', () => {
    expect(bundleComponentsSchema.safeParse([]).success).toBe(false);
  });

  it('rejects twenty-one distinct components rather than relying on duplicate rejection', () => {
    const components = Array.from({ length: 21 }, (_, position) => ({
      componentSkuId: `00000000-0000-4000-8000-${String(position + 1).padStart(12, '0')}`,
      quantity: 1,
      position,
    }));
    expect(bundleComponentsSchema.safeParse(components).success).toBe(false);
  });

  it.each([-1, 1.5, Infinity, NaN, '1', null, undefined])('rejects invalid expected version %s', expectedVersion => {
    expect(setBundleComponentsSchema.safeParse({ expectedVersion, components: [component] }).success).toBe(false);
  });

  it('accepts initial version zero', () => {
    expect(setBundleComponentsSchema.parse({ expectedVersion: 0, components: [component] }).expectedVersion).toBe(0);
  });

  it.each(['price', 'onHand', 'isBundle', 'supplierCost'])('rejects injected component field %s', field => {
    expect(bundleComponentsSchema.safeParse([{ ...component, [field]: 1 }]).success).toBe(false);
  });

  it('rejects unexpected definition-level inventory fields', () => {
    expect(setBundleComponentsSchema.safeParse({ expectedVersion: 0, components: [component], stock: 99 }).success).toBe(false);
  });
});
