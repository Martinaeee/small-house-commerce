import { describe, expect, it } from 'vitest';
import {
  buildBundleSnapshot,
  buildOrderItemSnapshot,
  readBundleSnapshot,
  sameBundleSnapshot,
  type SkuWithVariantProductAndOptionAssignments,
} from './order-item-snapshot.js';

// Stable graph identities (uuid v7 in production; values here are opaque).
const COLOR_OPTION_ID = '10000000-0000-4000-8000-000000000001';
const RED_VALUE_ID = '20000000-0000-4000-8000-000000000001';
const SIZE_OPTION_ID = '30000000-0000-4000-8000-000000000001';
const LARGE_VALUE_ID = '40000000-0000-4000-8000-000000000001';

function assignmentFixture() {
  return [
    {
      optionId: COLOR_OPTION_ID,
      optionValueId: RED_VALUE_ID,
      option: { name: 'Color', position: 1 },
      optionValue: { label: 'Red' },
    },
    {
      optionId: SIZE_OPTION_ID,
      optionValueId: LARGE_VALUE_ID,
      option: { name: 'Size', position: 0 },
      optionValue: { label: 'Large' },
    },
  ];
}

function skuFixture(
  overrides: Partial<SkuWithVariantProductAndOptionAssignments['variant']> = {},
): SkuWithVariantProductAndOptionAssignments {
  return {
    variant: {
      name: 'Red / Large',
      optionValues: assignmentFixture(),
      ...overrides,
    },
  };
}

describe('buildOrderItemSnapshot', () => {
  // Plan Task 17 Step 1: the exact brief test.
  it('sorts options by option position and preserves stable IDs', () => {
    // Deliberately supplied out of positional order (color pos 1 before
    // size pos 0): the snapshot must re-sort by the option's position.
    expect(buildOrderItemSnapshot(skuFixture()).optionSnapshot).toEqual({
      version: 1,
      options: [
        { optionId: SIZE_OPTION_ID, optionValueId: LARGE_VALUE_ID, label: 'Size', value: 'Large' },
        { optionId: COLOR_OPTION_ID, optionValueId: RED_VALUE_ID, label: 'Color', value: 'Red' },
      ],
    });
  });

  it('captures names at order time so later option renames cannot mutate history', () => {
    const sku = skuFixture();
    const snapshot = buildOrderItemSnapshot(sku);

    // An admin renames the option/value after the order is placed.
    sku.variant.optionValues = [
      {
        optionId: COLOR_OPTION_ID,
        optionValueId: RED_VALUE_ID,
        option: { name: 'Colour (renamed)', position: 1 },
        optionValue: { label: 'Crimson (renamed)' },
      },
      {
        optionId: SIZE_OPTION_ID,
        optionValueId: LARGE_VALUE_ID,
        option: { name: 'Size (renamed)', position: 0 },
        optionValue: { label: 'Extra Large (renamed)' },
      },
    ];

    // The already-built snapshot still holds the order-time names.
    expect(snapshot.optionSnapshot).toEqual({
      version: 1,
      options: [
        { optionId: SIZE_OPTION_ID, optionValueId: LARGE_VALUE_ID, label: 'Size', value: 'Large' },
        { optionId: COLOR_OPTION_ID, optionValueId: RED_VALUE_ID, label: 'Color', value: 'Red' },
      ],
    });
  });

  it('keeps the legacy variant text alongside the structured snapshot', () => {
    const write = buildOrderItemSnapshot(skuFixture());
    expect(write.variantSnapshot).toBe('Red / Large');
    expect(write.optionSnapshot).not.toBeNull();
  });

  it('falls back to legacy variant text with a null snapshot for variants without a typed graph', () => {
    // Legacy variants predate options; the empty graph must snapshot as
    // null so readers fall back to the variantSnapshot text.
    expect(
      buildOrderItemSnapshot(skuFixture({ name: 'Single', optionValues: [] })),
    ).toEqual({
      variantSnapshot: 'Single',
      optionSnapshot: null,
    });
  });

  it('treats an unloaded option graph like an empty one', () => {
    // Rows fetched without the optionValues include (or mocked sparsely)
    // must never crash checkout; they snapshot as the legacy text only.
    expect(
      buildOrderItemSnapshot(skuFixture({ name: 'Single', optionValues: undefined })),
    ).toEqual({
      variantSnapshot: 'Single',
      optionSnapshot: null,
    });
  });
});

const CHAIR_SKU_ID = '50000000-0000-4000-8000-000000000001';
const TABLE_SKU_ID = '50000000-0000-4000-8000-000000000002';
const BUNDLE_SKU_ID = '50000000-0000-4000-8000-000000000003';

function bundleComponentsFixture() {
  return [
    {
      componentSkuId: TABLE_SKU_ID,
      quantity: 1,
      position: 1,
      componentSku: { skuCode: 'TABLE', variant: { name: 'Oak', product: { name: 'Table' } } },
    },
    {
      componentSkuId: CHAIR_SKU_ID,
      quantity: 2,
      position: 0,
      componentSku: { skuCode: 'CHAIR', variant: { name: 'Black', product: { name: 'Chair' } } },
    },
  ];
}

describe('Bundle order-line snapshots', () => {
  it('freezes identity, per-Bundle and total quantities in position order', () => {
    expect(buildBundleSnapshot({
      skuId: BUNDLE_SKU_ID,
      skuCode: 'SET',
      quantity: 3,
      components: bundleComponentsFixture(),
    })).toEqual({
      version: 1,
      bundleSkuId: BUNDLE_SKU_ID,
      bundleSkuCode: 'SET',
      components: [
        { componentSkuId: CHAIR_SKU_ID, skuCode: 'CHAIR', productName: 'Chair', variantName: 'Black', quantity: 2, totalQuantity: 6, position: 0 },
        { componentSkuId: TABLE_SKU_ID, skuCode: 'TABLE', productName: 'Table', variantName: 'Oak', quantity: 1, totalQuantity: 3, position: 1 },
      ],
    });
  });

  it('reads back a written snapshot unchanged', () => {
    const written = buildBundleSnapshot({
      skuId: BUNDLE_SKU_ID, skuCode: 'SET', quantity: 2, components: bundleComponentsFixture(),
    });
    expect(readBundleSnapshot(JSON.parse(JSON.stringify(written)))).toEqual(written);
  });

  it.each([
    ['null', null],
    ['a string', 'v1'],
    ['an unknown version', { version: 2, bundleSkuId: BUNDLE_SKU_ID, bundleSkuCode: 'SET', components: [] }],
    ['a missing identity', { version: 1, bundleSkuCode: 'SET', components: [] }],
    ['no components', { version: 1, bundleSkuId: BUNDLE_SKU_ID, bundleSkuCode: 'SET', components: [] }],
    ['a non-object component', { version: 1, bundleSkuId: BUNDLE_SKU_ID, bundleSkuCode: 'SET', components: ['chair'] }],
    ['a fractional quantity', { version: 1, bundleSkuId: BUNDLE_SKU_ID, bundleSkuCode: 'SET', components: [
      { componentSkuId: CHAIR_SKU_ID, skuCode: 'CHAIR', productName: 'Chair', variantName: 'Black', quantity: 1.5, totalQuantity: 3, position: 0 },
    ] }],
    ['a negative total', { version: 1, bundleSkuId: BUNDLE_SKU_ID, bundleSkuCode: 'SET', components: [
      { componentSkuId: CHAIR_SKU_ID, skuCode: 'CHAIR', productName: 'Chair', variantName: 'Black', quantity: 2, totalQuantity: -4, position: 0 },
    ] }],
    ['a negative position', { version: 1, bundleSkuId: BUNDLE_SKU_ID, bundleSkuCode: 'SET', components: [
      { componentSkuId: CHAIR_SKU_ID, skuCode: 'CHAIR', productName: 'Chair', variantName: 'Black', quantity: 2, totalQuantity: 4, position: -1 },
    ] }],
  ])('fails closed on %s', (_name, value) => {
    expect(readBundleSnapshot(value)).toBeNull();
  });

  it.each([
    'duplicate components', 'self component', 'too many components',
    'oversized quantity', 'unsafe total', 'zero total', 'inconsistent line totals',
    'fractional line quantity', 'unsafe position',
  ])('rejects a corrupt snapshot with %s', (mode) => {
    const snapshot = buildBundleSnapshot({
      skuId: BUNDLE_SKU_ID, skuCode: 'SET', quantity: 2, components: bundleComponentsFixture(),
    });
    const first = snapshot.components[0]!;
    if (mode === 'duplicate components') snapshot.components.push({ ...first, position: 2 });
    if (mode === 'self component') first.componentSkuId = BUNDLE_SKU_ID;
    if (mode === 'too many components') snapshot.components = Array.from({ length: 21 }, (_, index) => ({ ...first, componentSkuId: `component-${index}`, position: index }));
    if (mode === 'oversized quantity') { first.quantity = 1001; first.totalQuantity = 2002; }
    if (mode === 'unsafe total') first.totalQuantity = Number.MAX_SAFE_INTEGER + 1;
    if (mode === 'zero total') first.totalQuantity = 0;
    if (mode === 'inconsistent line totals') first.totalQuantity = 6;
    if (mode === 'fractional line quantity') first.totalQuantity = 3;
    if (mode === 'unsafe position') first.position = Number.MAX_SAFE_INTEGER + 1;

    expect(readBundleSnapshot(snapshot)).toBeNull();
  });

  it('compares identity and per-Bundle quantities, not display labels', () => {
    const written = buildBundleSnapshot({
      skuId: BUNDLE_SKU_ID, skuCode: 'SET', quantity: 1, components: bundleComponentsFixture(),
    });
    expect(sameBundleSnapshot(written, structuredClone(written))).toBe(true);
    expect(sameBundleSnapshot(null, null)).toBe(true);
    expect(sameBundleSnapshot(written, null)).toBe(false);
    const renamed = structuredClone(written);
    renamed.components[0].productName = 'Chair (new name)';
    expect(sameBundleSnapshot(written, renamed)).toBe(true);
    const redefined = structuredClone(written);
    redefined.components[0].quantity = 3;
    expect(sameBundleSnapshot(written, redefined)).toBe(false);
  });
});
