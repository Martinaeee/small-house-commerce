import { describe, expect, it } from 'vitest';
import { updateProductSchema } from './product.dto.js';
import {
  CatalogGraphVersionMismatchError,
  CatalogGraphVersionRequiredError,
  catalogGraphPatchSchema,
  entityRefSchema,
  mediaWriteSchema,
} from './catalog-graph.dto.js';

const IDS = {
  option: '00000000-0000-4000-8000-000000000001',
  value: '00000000-0000-4000-8000-000000000003',
  variant: '00000000-0000-4000-8000-000000000005',
} as const;

interface ValueFixture {
  clientKey: string;
  label: string;
  position: number;
  isActive: boolean;
  thumbnailUrl?: string;
}

function value(
  clientKey: string,
  label: string,
  position: number,
): ValueFixture {
  return {
    clientKey,
    label,
    position,
    isActive: true,
  };
}

function option(
  clientKey: string,
  name: string,
  position: number,
  values: ValueFixture[] = [value(`${clientKey}-value`, `${name} value`, 0)],
) {
  return {
    clientKey,
    kind: 'STYLE' as const,
    name,
    position,
    presentation: 'TEXT' as const,
    isMediaDriver: false,
    isActive: true,
    values,
  };
}

function patch(overrides: Record<string, unknown> = {}) {
  return {
    options: [option('option-style', 'Style', 0)],
    variants: [
      {
        clientKey: 'variant-default',
        position: 0,
        optionValueRefs: [{ clientKey: 'option-style-value' }],
        sku: { skuCode: 'STYLE-DEFAULT', status: 'ACTIVE' as const },
      },
    ],
    media: [],
    retirements: {
      optionIds: [],
      optionValueIds: [],
      variantIds: [],
      mediaIds: [],
    },
    ...overrides,
  };
}

describe('catalog graph write DTO', () => {
  it('requires exactly one stable reference form', () => {
    expect(entityRefSchema.safeParse({ id: 'a', clientKey: 'b' }).success).toBe(
      false,
    );
    expect(entityRefSchema.safeParse({}).success).toBe(false);
    expect(entityRefSchema.safeParse({ id: IDS.option }).success).toBe(true);
    expect(
      entityRefSchema.safeParse({ clientKey: 'option-color' }).success,
    ).toBe(true);
  });

  it('rejects media with two scopes', () => {
    expect(
      mediaWriteSchema.safeParse({
        clientKey: 'm1',
        url: '/uploads/a.webp',
        optionValueId: IDS.value,
        variantId: IDS.variant,
      }).success,
    ).toBe(false);
  });

  it('accepts shared, option-value, and variant media with one scope', () => {
    expect(
      mediaWriteSchema.safeParse({
        clientKey: 'shared',
        url: '/uploads/shared.webp',
      }).success,
    ).toBe(true);
    expect(
      mediaWriteSchema.safeParse({
        clientKey: 'option-media',
        url: '/uploads/option.webp',
        optionValueClientKey: 'value-red',
      }).success,
    ).toBe(true);
    expect(
      mediaWriteSchema.safeParse({
        clientKey: 'variant-media',
        url: '/uploads/variant.webp',
        variantId: IDS.variant,
      }).success,
    ).toBe(true);
  });

  it('rejects duplicate row refs and client keys', () => {
    const duplicateIds = patch({
      options: [
        {
          ...option('first', 'Color', 0),
          id: IDS.option,
          clientKey: undefined,
        },
        {
          ...option('second', 'Size', 1),
          id: IDS.option,
          clientKey: undefined,
        },
      ],
    });
    expect(catalogGraphPatchSchema.safeParse(duplicateIds).success).toBe(false);

    const duplicateClientKeys = patch({
      options: [
        {
          ...option('same-key', 'Color', 0),
          values: [value('same-key', 'Red', 0)],
        },
      ],
    });
    expect(catalogGraphPatchSchema.safeParse(duplicateClientKeys).success).toBe(
      false,
    );
  });

  it('rejects duplicate active positions and labels', () => {
    expect(
      catalogGraphPatchSchema.safeParse(
        patch({
          options: [option('color', 'Color', 0), option('size', 'Size', 0)],
        }),
      ).success,
    ).toBe(false);

    expect(
      catalogGraphPatchSchema.safeParse(
        patch({
          options: [
            option('color', 'Color', 0),
            option('colour', ' color ', 1),
          ],
        }),
      ).success,
    ).toBe(false);

    expect(
      catalogGraphPatchSchema.safeParse(
        patch({
          options: [
            option('color', 'Color', 0, [
              value('red', 'Red', 0),
              value('blue', 'Blue', 0),
            ]),
          ],
        }),
      ).success,
    ).toBe(false);

    expect(
      catalogGraphPatchSchema.safeParse(
        patch({
          options: [
            option('color', 'Color', 0, [
              value('red', 'Red', 0),
              value('red-duplicate', ' red ', 1),
            ]),
          ],
        }),
      ).success,
    ).toBe(false);
  });

  it('rejects duplicate variant positions', () => {
    expect(
      catalogGraphPatchSchema.safeParse(
        patch({
          variants: [
            {
              clientKey: 'variant-one',
              position: 0,
              optionValueRefs: [{ clientKey: 'option-style-value' }],
              sku: { skuCode: 'FIRST', status: 'ACTIVE' as const },
            },
            {
              clientKey: 'variant-two',
              position: 0,
              optionValueRefs: [{ clientKey: 'option-style-value' }],
              sku: { skuCode: 'SECOND', status: 'ACTIVE' as const },
            },
          ],
        }),
      ).success,
    ).toBe(false);
  });

  it('rejects duplicate SKU codes', () => {
    expect(
      catalogGraphPatchSchema.safeParse(
        patch({
          variants: [
            {
              clientKey: 'variant-one',
              position: 0,
              optionValueRefs: [{ clientKey: 'option-style-value' }],
              sku: { skuCode: 'DUPLICATE', status: 'ACTIVE' as const },
            },
            {
              clientKey: 'variant-two',
              position: 1,
              optionValueRefs: [{ clientKey: 'option-style-value' }],
              sku: { skuCode: ' duplicate ', status: 'ACTIVE' as const },
            },
          ],
        }),
      ).success,
    ).toBe(false);
  });

  it('rejects more than two active options', () => {
    expect(
      catalogGraphPatchSchema.safeParse(
        patch({
          options: [
            option('color', 'Color', 0),
            option('size', 'Size', 1),
            option('style', 'Style', 2),
          ],
        }),
      ).success,
    ).toBe(false);
  });

  it('rejects more than one hundred active candidates', () => {
    const colors = Array.from({ length: 11 }, (_, index) =>
      value(`color-${index}`, `Color ${index}`, index),
    );
    const sizes = Array.from({ length: 10 }, (_, index) =>
      value(`size-${index}`, `Size ${index}`, index),
    );

    expect(
      catalogGraphPatchSchema.safeParse(
        patch({
          options: [
            option('color', 'Color', 0, colors),
            option('size', 'Size', 1, sizes),
          ],
        }),
      ).success,
    ).toBe(false);
  });

  it('distinguishes omitted, set, and cleared default display intent', () => {
    const omitted = catalogGraphPatchSchema.parse(patch());
    expect(Object.hasOwn(omitted, 'defaultDisplayVariant')).toBe(false);

    expect(
      catalogGraphPatchSchema.safeParse(
        patch({ defaultDisplayVariant: { clientKey: 'variant-default' } }),
      ).success,
    ).toBe(true);
    expect(
      catalogGraphPatchSchema.safeParse(patch({ defaultDisplayVariant: null }))
        .success,
    ).toBe(true);
  });

  it('uses siteMediaUrl validation for graph media and value thumbnails', () => {
    expect(
      mediaWriteSchema.safeParse({
        clientKey: 'm1',
        url: '//cdn.example/a.webp',
      }).success,
    ).toBe(false);
    expect(
      catalogGraphPatchSchema.safeParse(
        patch({
          options: [
            option('color', 'Color', 0, [
              {
                clientKey: 'red',
                label: 'Red',
                position: 0,
                isActive: true,
                thumbnailUrl: 'uploads/red.webp',
              },
            ]),
          ],
        }),
      ).success,
    ).toBe(false);
  });

  it('rejects duplicate retirement ids', () => {
    expect(
      catalogGraphPatchSchema.safeParse(
        patch({
          retirements: {
            optionIds: [IDS.option, IDS.option],
            optionValueIds: [],
            variantIds: [],
            mediaIds: [],
          },
        }),
      ).success,
    ).toBe(false);
  });

  it('is retained by the product update DTO with an independent expected version', () => {
    const graph = patch({ defaultDisplayVariant: null });
    expect(
      updateProductSchema.parse({
        catalogGraphVersion: 4,
        catalogGraph: graph,
      }),
    ).toMatchObject({ catalogGraphVersion: 4, catalogGraph: graph });
  });

  it('provides named revision errors for the persistence layer', () => {
    expect(new CatalogGraphVersionRequiredError()).toMatchObject({
      name: 'CatalogGraphVersionRequiredError',
      code: 'CATALOG_GRAPH_VERSION_REQUIRED',
    });
    expect(new CatalogGraphVersionMismatchError(4, 5)).toMatchObject({
      name: 'CatalogGraphVersionMismatchError',
      code: 'CATALOG_GRAPH_VERSION_MISMATCH',
      expectedVersion: 4,
      actualVersion: 5,
    });
  });
});
