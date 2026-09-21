import { describe, expect, it } from 'vitest';
import {
  presentCatalogGraph,
  projectLegacyCatalogGraph,
  projectLegacyImages,
  type CatalogProductRow,
} from './catalog-compat.js';

const legacyProductFixture = {
  id: '11111111-1111-1111-1111-111111111111',
  catalogGraphVersion: 0,
  defaultDisplayVariantId: null,
  images: [
    {
      id: 'shared-image',
      url: '/shared.jpg',
      type: 'IMAGE',
      altText: 'Shared image',
      sortOrder: 0,
      optionValueId: null,
      variantId: null,
    },
  ],
  options: [],
  variants: [
    {
      id: '22222222-2222-2222-2222-222222222222',
      name: 'Disabled style',
      position: 0,
      combinationKey: null,
      optionValues: [],
      sku: {
        id: 'sku-disabled',
        skuCode: 'DISABLED',
        status: 'DISABLED',
        price: 100,
        compareAtPrice: null,
        availableInventory: 8,
      },
    },
    {
      id: '33333333-3333-3333-3333-333333333333',
      name: 'Unpriced style',
      position: 1,
      combinationKey: null,
      optionValues: [],
      sku: {
        id: 'sku-unpriced',
        skuCode: 'UNPRICED',
        status: 'ACTIVE',
        price: null,
        compareAtPrice: null,
        availableInventory: 12,
      },
    },
    {
      id: '44444444-4444-4444-4444-444444444444',
      name: 'Sold-out display style',
      position: 2,
      combinationKey: null,
      optionValues: [],
      sku: {
        id: 'sku-display',
        skuCode: 'DISPLAY',
        status: 'ACTIVE',
        price: 899,
        compareAtPrice: 999,
        availableInventory: 0,
      },
    },
  ],
} satisfies CatalogProductRow;

describe('legacy catalog compatibility projection', () => {
  it('projects a version-zero product as one Style option without replacing variant or SKU identities', () => {
    const graph = projectLegacyCatalogGraph(legacyProductFixture);

    expect(graph.options).toHaveLength(1);
    expect(graph.options[0]).toMatchObject({
      name: 'Style',
      kind: 'STYLE',
      position: 0,
      presentation: 'TEXT',
    });
    expect(graph.variants.map((variant) => variant.id)).toEqual(
      legacyProductFixture.variants.map((variant) => variant.id),
    );
    expect(graph.variants.map((variant) => variant.name)).toEqual(
      legacyProductFixture.variants.map((variant) => variant.name),
    );
    expect(graph.variants.map((variant) => variant.sku?.id)).toEqual([
      'sku-disabled',
      'sku-unpriced',
      'sku-display',
    ]);
  });

  it('uses the namespaced PostgreSQL-md5-compatible UUID formula for synthetic IDs', () => {
    const graph = projectLegacyCatalogGraph(legacyProductFixture);

    expect(graph.options[0]?.id).toBe('0c2d1cb8-069c-c4e0-a33d-548be39e0f9e');
    expect(graph.options[0]?.values.map((value) => value.id)).toEqual([
      '4cc42cf1-05f4-81d1-9f03-2aaa78691a1a',
      'b9670246-7918-0f70-fc51-066b33c81423',
      '4302abb4-d78f-17b6-485d-de9bb5df96f8',
    ]);
    expect(graph.variants[0]?.combinationKey).toBe(
      '0c2d1cb8-069c-c4e0-a33d-548be39e0f9e:4cc42cf1-05f4-81d1-9f03-2aaa78691a1a',
    );
  });

  it('uses the first positioned ACTIVE priced SKU as display even when stock is zero', () => {
    const graph = projectLegacyCatalogGraph(legacyProductFixture);

    expect(graph.defaultDisplayVariantId).toBe(
      '44444444-4444-4444-4444-444444444444',
    );
    expect(graph.variants[0]?.sku?.status).toBe('DISABLED');
    expect(graph.variants[1]?.sku).toMatchObject({
      status: 'ACTIVE',
      price: null,
    });
    expect(graph.variants[2]?.sku).toMatchObject({
      status: 'ACTIVE',
      price: 899,
      availableInventory: 0,
    });
  });

  it('keeps scoped rows out of legacy images and derives the shared cover', () => {
    const productWithScopedMedia = {
      ...legacyProductFixture,
      images: [
        ...legacyProductFixture.images,
        {
          ...legacyProductFixture.images[0],
          id: 'option-image',
          optionValueId: 'value-id',
        },
        {
          ...legacyProductFixture.images[0],
          id: 'variant-image',
          variantId: legacyProductFixture.variants[2].id,
        },
      ],
    } satisfies CatalogProductRow;

    const images = projectLegacyImages(productWithScopedMedia);
    const graph = projectLegacyCatalogGraph(productWithScopedMedia);

    expect(images.map((image) => image.id)).toEqual(['shared-image']);
    expect(
      images.every(
        (image) => image.optionValueId === null && image.variantId === null,
      ),
    ).toBe(true);
    expect(graph.images).toEqual(images);
    expect(graph.effectiveCoverMedia?.id).toBe('shared-image');
  });

  it('presents a persisted graph for graph-version-positive products', () => {
    const persisted = {
      ...legacyProductFixture,
      catalogGraphVersion: 2,
      defaultDisplayVariantId: legacyProductFixture.variants[2].id,
      options: [
        {
          id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          kind: 'COLOR',
          name: 'Color',
          position: 0,
          presentation: 'SWATCH',
          isMediaDriver: true,
          isActive: true,
          values: [
            {
              id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
              label: 'Sand',
              position: 0,
              swatchHex: '#c2b280',
              thumbnailUrl: null,
              thumbnailAlt: null,
              isActive: true,
            },
          ],
        },
      ],
      variants: [
        {
          ...legacyProductFixture.variants[2],
          combinationKey: 'persisted-key',
          optionValues: [
            {
              optionId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
              optionValueId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
            },
          ],
        },
      ],
    } satisfies CatalogProductRow;

    const graph = presentCatalogGraph(persisted);

    expect(graph.catalogGraphVersion).toBe(2);
    expect(graph.options).toEqual([
      expect.objectContaining({
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        kind: 'COLOR',
      }),
    ]);
    expect(graph.variants[0]).toMatchObject({
      id: legacyProductFixture.variants[2].id,
      combinationKey: 'persisted-key',
      optionValueIds: ['bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'],
      sku: { id: 'sku-display', status: 'ACTIVE' },
    });
    expect(graph.defaultDisplayVariantId).toBe(
      legacyProductFixture.variants[2].id,
    );
  });
});
