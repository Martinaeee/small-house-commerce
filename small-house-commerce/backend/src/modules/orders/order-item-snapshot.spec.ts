import { describe, expect, it } from 'vitest';
import {
  buildOrderItemSnapshot,
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
