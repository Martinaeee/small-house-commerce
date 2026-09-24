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
  cased: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
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

function expectIssuePath(
  result: ReturnType<typeof catalogGraphPatchSchema.safeParse>,
  expectedPath: (string | number)[],
): void {
  expect(result.success).toBe(false);
  if (result.success) return;
  expect(
    result.error.issues.some(
      ({ path }) =>
        path.length === expectedPath.length &&
        path.every((part, index) => part === expectedPath[index]),
    ),
  ).toBe(true);
}

describe('catalog graph write DTO', () => {
  it('requires exactly one stable reference form', () => {
    const both = entityRefSchema.safeParse({
      id: IDS.option,
      clientKey: 'option-color',
    });

    expect(both.success).toBe(false);
    if (!both.success) {
      expect(both.error.format()).toHaveProperty('id');
      expect(both.error.format()).toHaveProperty('clientKey');
    }
    expect(entityRefSchema.safeParse({}).success).toBe(false);
    expect(entityRefSchema.safeParse({ id: IDS.option }).success).toBe(true);
    expect(
      entityRefSchema.safeParse({ clientKey: 'option-color' }).success,
    ).toBe(true);
  });

  it('accepts unbounded client keys without normalizing their identity', () => {
    expect(
      entityRefSchema.safeParse({ clientKey: 'k'.repeat(121) }).success,
    ).toBe(true);
    expect(entityRefSchema.parse({ clientKey: ' Key ' })).toEqual({
      clientKey: ' Key ',
    });
  });

  it('accepts the md5-minted ids the legacy compat projection stores', () => {
    // These are real ids minted by 20260921100000_backfill_variant_options:
    // `md5(namespace || ':' || source_id)::uuid` (catalog-compat.ts mirrors the
    // same formula). PostgreSQL accepts them as uuid, but the hash leaves the
    // RFC 4122 version/variant bits unconstrained, so `z.string().uuid()`
    // rejected every graph the backfill touched — the admin could no longer
    // save those products.
    const compatOptionId = '2be07dba-7f8d-f101-fb99-864bb94f90bf';
    const compatValueId = '7f44714c-79b3-62b0-e06c-1005ecbbb2e6';
    const compatVariantId = '01a0b305-bd7e-70be-a715-99e7f2ade0d9';

    const result = catalogGraphPatchSchema.safeParse(
      patch({
        options: [
          {
            id: compatOptionId,
            kind: 'STYLE',
            name: 'Style',
            position: 0,
            presentation: 'TEXT',
            isMediaDriver: false,
            isActive: true,
            values: [
              {
                id: compatValueId,
                label: 'default',
                position: 0,
                isActive: true,
              },
            ],
          },
        ],
        variants: [
          {
            id: compatVariantId,
            position: 0,
            optionValueRefs: [{ id: compatValueId }],
          },
        ],
      }),
    );

    expect(result.success).toBe(true);
  });

  it('still rejects ids that are not uuid-shaped', () => {
    expect(entityRefSchema.safeParse({ id: 'legacy-option-1' }).success).toBe(
      false,
    );
    expect(entityRefSchema.safeParse({ id: 'not-a-uuid' }).success).toBe(false);
    expect(
      entityRefSchema.safeParse({ id: '2be07dba-7f8d-f101-fb99' }).success,
    ).toBe(false);
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

  it('rejects a dangling variant option-value client key at its source path', () => {
    expectIssuePath(
      catalogGraphPatchSchema.safeParse(
        patch({
          variants: [
            {
              clientKey: 'variant-default',
              position: 0,
              optionValueRefs: [{ clientKey: 'missing-value' }],
              sku: { skuCode: 'STYLE-DEFAULT', status: 'ACTIVE' as const },
            },
          ],
        }),
      ),
      ['variants', 0, 'optionValueRefs', 0, 'clientKey'],
    );
  });

  it('rejects dangling media client-key scopes at their source paths', () => {
    expectIssuePath(
      catalogGraphPatchSchema.safeParse(
        patch({
          media: [
            {
              clientKey: 'option-media',
              url: '/uploads/option.webp',
              optionValueClientKey: 'missing-value',
            },
          ],
        }),
      ),
      ['media', 0, 'optionValueClientKey'],
    );
    expectIssuePath(
      catalogGraphPatchSchema.safeParse(
        patch({
          media: [
            {
              clientKey: 'variant-media',
              url: '/uploads/variant.webp',
              variantClientKey: 'missing-variant',
            },
          ],
        }),
      ),
      ['media', 0, 'variantClientKey'],
    );
  });

  it('rejects a dangling default-display client key at its source path', () => {
    expectIssuePath(
      catalogGraphPatchSchema.safeParse(
        patch({ defaultDisplayVariant: { clientKey: 'missing-variant' } }),
      ),
      ['defaultDisplayVariant', 'clientKey'],
    );
  });

  it('accepts defined client-key refs and leaves UUID refs to the service', () => {
    expect(
      catalogGraphPatchSchema.safeParse(
        patch({
          variants: [
            {
              clientKey: 'variant-default',
              position: 0,
              optionValueRefs: [
                { clientKey: 'option-style-value' },
                { id: IDS.value },
              ],
              sku: { skuCode: 'STYLE-DEFAULT', status: 'ACTIVE' as const },
            },
          ],
          media: [
            {
              clientKey: 'option-media',
              url: '/uploads/option.webp',
              optionValueClientKey: 'option-style-value',
            },
            {
              clientKey: 'variant-media',
              url: '/uploads/variant.webp',
              variantClientKey: 'variant-default',
            },
            {
              clientKey: 'persisted-media',
              url: '/uploads/persisted.webp',
              variantId: IDS.variant,
            },
          ],
          defaultDisplayVariant: { id: IDS.variant },
        }),
      ).success,
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

  it('normalizes UUID casing when detecting duplicate changed rows', () => {
    const result = catalogGraphPatchSchema.safeParse(
      patch({
        options: [
          {
            ...option('first', 'Color', 0),
            id: IDS.cased,
            clientKey: undefined,
          },
          {
            ...option('second', 'Size', 1),
            id: IDS.cased.toUpperCase(),
            clientKey: undefined,
          },
        ],
        variants: [],
      }),
    );

    expectIssuePath(result, ['options', 1]);
    if (!result.success) {
      expect(
        result.error.issues.every(({ message }) => /duplicate/i.test(message)),
      ).toBe(true);
    }
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

  it('reports duplicate active value positions at original array indices', () => {
    expectIssuePath(
      catalogGraphPatchSchema.safeParse(
        patch({
          options: [
            option('color', 'Color', 0, [
              value('red', 'Red', 0),
              { ...value('retired', 'Retired', 9), isActive: false },
              value('blue', 'Blue', 0),
            ]),
          ],
        }),
      ),
      ['options', 0, 'values', 2, 'position'],
    );
  });

  it('reports duplicate active value labels at original array indices', () => {
    expectIssuePath(
      catalogGraphPatchSchema.safeParse(
        patch({
          options: [
            option('color', 'Color', 0, [
              value('red', 'Red', 0),
              { ...value('retired', 'Retired', 9), isActive: false },
              value('red-duplicate', ' red ', 1),
            ]),
          ],
        }),
      ),
      ['options', 0, 'values', 2, 'label'],
    );
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

  it('normalizes UUID casing when detecting duplicate retirement ids', () => {
    expect(
      catalogGraphPatchSchema.safeParse(
        patch({
          retirements: {
            optionIds: [IDS.cased, IDS.cased.toUpperCase()],
            optionValueIds: [],
            variantIds: [],
            mediaIds: [],
          },
        }),
      ).success,
    ).toBe(false);
  });

  it('creates fresh retirement defaults for every parse', () => {
    const first = catalogGraphPatchSchema.parse({});
    first.retirements.optionIds.push(IDS.option, IDS.option);

    const second = catalogGraphPatchSchema.parse({});
    expect(second.retirements).toEqual({
      optionIds: [],
      optionValueIds: [],
      variantIds: [],
      mediaIds: [],
    });

    const partialFirst = catalogGraphPatchSchema.parse({ retirements: {} });
    partialFirst.retirements.mediaIds.push(IDS.option, IDS.option);

    const partialSecond = catalogGraphPatchSchema.parse({ retirements: {} });
    expect(partialSecond.retirements).toEqual({
      optionIds: [],
      optionValueIds: [],
      variantIds: [],
      mediaIds: [],
    });
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
