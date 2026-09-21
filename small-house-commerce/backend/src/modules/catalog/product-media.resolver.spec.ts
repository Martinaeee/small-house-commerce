import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { LandingPagesService } from './landing/landing-pages.service.js';
import { StorefrontLandingPagesController } from './landing/storefront/landing-pages.controller.js';
import {
  MEDIA_SCOPE_QUERY_ERROR,
  ProductMediaResolver,
  resolveProductMedia,
  type ProductMediaGraph,
} from './product-media.resolver.js';
import { ProductsService } from './products.service.js';
import { StorefrontProductsController } from './storefront/products.controller.js';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const FOREIGN_PRODUCT_ID = '99999999-9999-4999-8999-999999999999';
const COLOR_OPTION_ID = '22222222-2222-4222-8222-222222222222';
const SIZE_OPTION_ID = '33333333-3333-4333-8333-333333333333';
const INACTIVE_OPTION_ID = '44444444-4444-4444-8444-444444444444';
const RED_VALUE_ID = '55555555-5555-4555-8555-555555555555';
const BLUE_VALUE_ID = '66666666-6666-4666-8666-666666666666';
const LARGE_VALUE_ID = '77777777-7777-4777-8777-777777777777';
const INACTIVE_VALUE_ID = '88888888-8888-4888-8888-888888888888';
const RED_LARGE_VARIANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BLUE_LARGE_VARIANT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function media(
  id: string,
  url: string,
  sortOrder: number,
  scope: { optionValueId?: string; variantId?: string } = {},
  type: 'IMAGE' | 'VIDEO' = 'IMAGE',
) {
  return {
    id,
    url,
    type,
    altText: `${id} alt`,
    sortOrder,
    optionValueId: scope.optionValueId ?? null,
    variantId: scope.variantId ?? null,
  };
}

function graph(version = 3): ProductMediaGraph {
  return {
    id: PRODUCT_ID,
    catalogGraphVersion: version,
    options: [
      {
        id: COLOR_OPTION_ID,
        isActive: true,
        isMediaDriver: true,
        values: [
          { id: RED_VALUE_ID, isActive: true },
          { id: BLUE_VALUE_ID, isActive: true },
        ],
      },
      {
        id: SIZE_OPTION_ID,
        isActive: true,
        isMediaDriver: false,
        values: [{ id: LARGE_VALUE_ID, isActive: true }],
      },
      {
        id: INACTIVE_OPTION_ID,
        isActive: false,
        isMediaDriver: true,
        values: [{ id: INACTIVE_VALUE_ID, isActive: true }],
      },
    ],
    variants: [
      {
        id: RED_LARGE_VARIANT_ID,
        optionValues: [
          { optionId: COLOR_OPTION_ID, optionValueId: RED_VALUE_ID },
          { optionId: SIZE_OPTION_ID, optionValueId: LARGE_VALUE_ID },
        ],
      },
      {
        id: BLUE_LARGE_VARIANT_ID,
        optionValues: [
          { optionId: COLOR_OPTION_ID, optionValueId: BLUE_VALUE_ID },
          { optionId: SIZE_OPTION_ID, optionValueId: LARGE_VALUE_ID },
        ],
      },
    ],
    images: [
      media('shared-b', '/shared-b.jpg', 1),
      media('shared-a', '/shared-a.jpg', 1, {}, 'VIDEO'),
      media('red-second', '/red-second.jpg', 2, {
        optionValueId: RED_VALUE_ID,
      }),
      media('red-first-b', '/red-first-b.jpg', 1, {
        optionValueId: RED_VALUE_ID,
      }),
      media(
        'red-first-a',
        '/red-first-a.jpg',
        1,
        { optionValueId: RED_VALUE_ID },
        'VIDEO',
      ),
      media(
        'exact-red',
        '/exact-red.jpg',
        0,
        { variantId: RED_LARGE_VARIANT_ID },
        'VIDEO',
      ),
    ],
  };
}

function productRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PRODUCT_ID,
    name: 'Chair',
    slug: 'chair',
    description: null,
    tagline: null,
    categoryId: 'category-id',
    room: null,
    internalRole: null,
    solutions: [],
    width: null,
    height: null,
    depth: null,
    foldedWidth: null,
    foldedHeight: null,
    foldedDepth: null,
    materials: null,
    features: null,
    catalogGraphVersion: 3,
    defaultDisplayVariantId: RED_LARGE_VARIANT_ID,
    images: [media('shared-image', '/shared.jpg', 0)],
    detailBlocks: [],
    options: [
      {
        id: COLOR_OPTION_ID,
        kind: 'COLOR',
        name: 'Color',
        position: 0,
        presentation: 'IMAGE',
        isMediaDriver: true,
        isActive: true,
        values: [
          {
            id: RED_VALUE_ID,
            label: 'Red',
            position: 0,
            swatchHex: null,
            thumbnailUrl: null,
            thumbnailAlt: null,
            isActive: true,
          },
          {
            id: BLUE_VALUE_ID,
            label: 'Blue',
            position: 1,
            swatchHex: null,
            thumbnailUrl: '/explicit-blue-thumb.jpg',
            thumbnailAlt: null,
            isActive: true,
          },
        ],
      },
    ],
    variants: [
      {
        id: RED_LARGE_VARIANT_ID,
        name: 'Red / Large',
        position: 0,
        combinationKey: `${COLOR_OPTION_ID}:${RED_VALUE_ID}`,
        optionValues: [
          { optionId: COLOR_OPTION_ID, optionValueId: RED_VALUE_ID },
        ],
        sku: {
          id: 'red-sku',
          skuCode: 'RED',
          status: 'ACTIVE',
          price: 100,
          compareAtPrice: null,
          productWeight: null,
          packageWidth: null,
          packageHeight: null,
          packageDepth: null,
          packageWeight: null,
        },
      },
    ],
    ...overrides,
  };
}

function createProductsHarness() {
  const row = productRow();
  const mediaGraph = graph();
  const product = {
    findMany: vi.fn(async () => [row]),
    findFirst: vi.fn(async (args: { select?: Record<string, unknown> }) =>
      args.select?.name === true ? row : mediaGraph,
    ),
    count: vi.fn(async () => 1),
  };
  const productImage = {
    findMany: vi.fn(async () => [
      {
        ...media(
          'variant-cover',
          '/variant-cover.mp4',
          0,
          {
            variantId: RED_LARGE_VARIANT_ID,
          },
          'VIDEO',
        ),
        productId: PRODUCT_ID,
      },
      {
        ...media('red-thumb', '/red-thumb.jpg', 0, {
          optionValueId: RED_VALUE_ID,
        }),
        productId: PRODUCT_ID,
      },
      {
        ...media('red-later', '/red-later.jpg', 1, {
          optionValueId: RED_VALUE_ID,
        }),
        productId: PRODUCT_ID,
      },
      {
        ...media('blue-scoped', '/blue-scoped.jpg', 0, {
          optionValueId: BLUE_VALUE_ID,
        }),
        productId: PRODUCT_ID,
      },
    ]),
  };
  const prisma = {
    product,
    productImage,
    inventory: { groupBy: vi.fn(async () => []) },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  const reviews = {
    summaryForProducts: vi.fn(async () => new Map()),
    storefrontForProduct: vi.fn(async () => ({})),
  };
  const inventory = { stockBySku: vi.fn(async () => new Map()) };
  const service = new ProductsService(
    prisma as never,
    reviews as never,
    inventory as never,
  );
  return { prisma, service };
}

describe('resolveProductMedia', () => {
  it('prefers exact variant media without merging any fallback scope', () => {
    expect(
      resolveProductMedia(graph(), { variantId: RED_LARGE_VARIANT_ID }),
    ).toEqual({
      resolvedScope: 'VARIANT',
      scopeId: RED_LARGE_VARIANT_ID,
      media: [
        expect.objectContaining({
          id: 'exact-red',
          type: 'VIDEO',
          sortOrder: 0,
        }),
      ],
      catalogGraphVersion: 3,
    });
  });

  it('falls from a variant to its active media-driver value without merging shared media', () => {
    const result = resolveProductMedia(graph(), {
      variantId: BLUE_LARGE_VARIANT_ID,
    });

    expect(result).toMatchObject({
      resolvedScope: 'SHARED',
      catalogGraphVersion: 3,
    });
    expect(result).not.toHaveProperty('scopeId');
    expect(result.media.map((item) => item.id)).toEqual([
      'shared-a',
      'shared-b',
    ]);

    const withBlue = graph();
    withBlue.images.push(
      media('blue-only', '/blue-only.jpg', 0, { optionValueId: BLUE_VALUE_ID }),
    );
    expect(
      resolveProductMedia(withBlue, { variantId: BLUE_LARGE_VARIANT_ID }),
    ).toMatchObject({
      resolvedScope: 'OPTION_VALUE',
      scopeId: BLUE_VALUE_ID,
      media: [{ id: 'blue-only' }],
    });
  });

  it('resolves a valid driver value directly and preserves stable sortOrder/id ordering and types', () => {
    const result = resolveProductMedia(graph(), {
      optionValueId: RED_VALUE_ID,
    });

    expect(result.resolvedScope).toBe('OPTION_VALUE');
    expect(result.scopeId).toBe(RED_VALUE_ID);
    expect(result.media.map(({ id, type }) => ({ id, type }))).toEqual([
      { id: 'red-first-a', type: 'VIDEO' },
      { id: 'red-first-b', type: 'IMAGE' },
      { id: 'red-second', type: 'IMAGE' },
    ]);
  });

  it('falls back to the ordered shared set and never invents a cross-value fallback', () => {
    const result = resolveProductMedia(graph(), {
      optionValueId: BLUE_VALUE_ID,
    });

    expect(result).toEqual({
      resolvedScope: 'SHARED',
      media: [
        expect.objectContaining({ id: 'shared-a', type: 'VIDEO' }),
        expect.objectContaining({ id: 'shared-b', type: 'IMAGE' }),
      ],
      catalogGraphVersion: 3,
    });
    expect(result.media).not.toContainEqual(
      expect.objectContaining({ id: 'red-first-a' }),
    );
  });

  it.each([
    ['foreign option value', { optionValueId: 'foreign-value' }],
    ['inactive-driver option value', { optionValueId: INACTIVE_VALUE_ID }],
    ['active non-driver option value', { optionValueId: LARGE_VALUE_ID }],
  ])('rejects a %s', (_label, request) => {
    expect(() => resolveProductMedia(graph(), request)).toThrowError(
      'Option value is not an active media-driver value for this product',
    );
  });

  it('rejects a variant outside this product/current graph', () => {
    expect(() =>
      resolveProductMedia(graph(), { variantId: 'foreign-variant' }),
    ).toThrowError(
      "Variant does not belong to this product's current catalog graph",
    );
  });
});

describe('ProductMediaResolver bounded versioned cache', () => {
  it('keys entries by product, graph version, and requested scope', async () => {
    let currentGraph = graph(3);
    const prisma = {
      product: { findFirst: vi.fn(async () => currentGraph) },
    };
    const resolver = new ProductMediaResolver(prisma as never, 4);

    await resolver.resolveProductMedia(PRODUCT_ID, 3, {
      optionValueId: RED_VALUE_ID,
    });
    await resolver.resolveProductMedia(PRODUCT_ID, 3, {
      optionValueId: RED_VALUE_ID,
    });
    expect(prisma.product.findFirst).toHaveBeenCalledTimes(1);

    currentGraph = graph(4);
    await resolver.resolveProductMedia(PRODUCT_ID, 4, {
      optionValueId: RED_VALUE_ID,
    });
    expect(prisma.product.findFirst).toHaveBeenCalledTimes(2);

    currentGraph = { ...graph(4), id: FOREIGN_PRODUCT_ID };
    await resolver.resolveProductMedia(FOREIGN_PRODUCT_ID, 4, {
      optionValueId: RED_VALUE_ID,
    });
    expect(prisma.product.findFirst).toHaveBeenCalledTimes(3);

    await resolver.resolveProductMedia(FOREIGN_PRODUCT_ID, 4, {
      variantId: RED_LARGE_VARIANT_ID,
    });
    expect(prisma.product.findFirst).toHaveBeenCalledTimes(4);
  });

  it('evicts the least-recently-used entry when capacity is reached', async () => {
    const prisma = {
      product: { findFirst: vi.fn(async () => graph()) },
    };
    const resolver = new ProductMediaResolver(prisma as never, 2);

    await resolver.resolveProductMedia(PRODUCT_ID, 3, {
      optionValueId: RED_VALUE_ID,
    });
    await resolver.resolveProductMedia(PRODUCT_ID, 3, {
      variantId: RED_LARGE_VARIANT_ID,
    });
    await resolver.resolveProductMedia(PRODUCT_ID, 3, {
      variantId: BLUE_LARGE_VARIANT_ID,
    });
    await resolver.resolveProductMedia(PRODUCT_ID, 3, {
      optionValueId: RED_VALUE_ID,
    });

    expect(prisma.product.findFirst).toHaveBeenCalledTimes(4);
  });

  it('does not cache rejected foreign scopes', async () => {
    const prisma = {
      product: { findFirst: vi.fn(async () => graph()) },
    };
    const resolver = new ProductMediaResolver(prisma as never, 2);

    await expect(
      resolver.resolveProductMedia(PRODUCT_ID, 3, { variantId: 'foreign' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      resolver.resolveProductMedia(PRODUCT_ID, 3, { variantId: 'foreign' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.product.findFirst).toHaveBeenCalledTimes(2);
  });
});

describe('ProductsService scoped storefront payloads', () => {
  it('uses the valid default display variant for the only initial media set and emits scope ids only', async () => {
    const { service } = createProductsHarness();

    const result = await service.storefrontGetBySlug('chair');

    expect(result.initialMediaSet).toMatchObject({
      resolvedScope: 'VARIANT',
      scopeId: RED_LARGE_VARIANT_ID,
      catalogGraphVersion: 3,
      media: [{ id: 'exact-red', type: 'VIDEO' }],
    });
    expect(result.effectiveCoverMedia).toEqual({
      id: 'exact-red',
      url: '/exact-red.jpg',
      type: 'VIDEO',
      altText: 'exact-red alt',
      sortOrder: 0,
    });
    expect(result.availableMediaScopes).toEqual({
      optionValueIds: [RED_VALUE_ID],
      variantIds: [RED_LARGE_VARIANT_ID],
    });
    expect(result).not.toHaveProperty('scopedMedia');
    expect(result).not.toHaveProperty('mediaSets');
    expect(result.options[0]).not.toHaveProperty('images');
    expect(result.variants[0]).not.toHaveProperty('images');
    expect(result.images).toEqual([
      expect.objectContaining({ id: 'shared-image' }),
    ]);
  });

  it('honors a current requested scope over the default initial variant', async () => {
    const { service } = createProductsHarness();

    const result = await service.storefrontGetBySlug('chair', {
      optionValueId: RED_VALUE_ID,
    });

    expect(result.initialMediaSet).toMatchObject({
      resolvedScope: 'OPTION_VALUE',
      scopeId: RED_VALUE_ID,
    });
  });

  it('keeps list payloads bounded while resolving cover and effective thumbnails', async () => {
    const { prisma, service } = createProductsHarness();

    const [result] = await service.storefrontByIds([PRODUCT_ID]);

    expect(result.effectiveCoverMedia).toEqual({
      id: 'variant-cover',
      url: '/variant-cover.mp4',
      type: 'VIDEO',
      altText: 'variant-cover alt',
      sortOrder: 0,
    });
    expect(result.options[0].values).toEqual([
      expect.objectContaining({
        id: RED_VALUE_ID,
        thumbnailUrl: '/red-thumb.jpg',
        thumbnailAlt: 'red-thumb alt',
      }),
      expect.objectContaining({
        id: BLUE_VALUE_ID,
        thumbnailUrl: '/explicit-blue-thumb.jpg',
        thumbnailAlt: 'Blue',
      }),
    ]);
    expect(result.images).toEqual([
      expect.objectContaining({ id: 'shared-image' }),
    ]);
    expect(result).not.toHaveProperty('initialMediaSet');
    expect(result).not.toHaveProperty('availableMediaScopes');
    expect(result.options[0].values[0]).not.toHaveProperty('images');
    expect(result.variants[0]).not.toHaveProperty('images');
    expect(prisma.productImage.findMany).toHaveBeenCalledTimes(1);
  });

  it('falls option thumbnails back to shared IMAGE media and leaves placeholders to consumers', async () => {
    const sharedHarness = createProductsHarness();
    sharedHarness.prisma.productImage.findMany.mockResolvedValueOnce([]);

    const [withShared] = await sharedHarness.service.storefrontByIds([
      PRODUCT_ID,
    ]);
    expect(withShared.options[0].values[0]).toMatchObject({
      id: RED_VALUE_ID,
      thumbnailUrl: '/shared.jpg',
      thumbnailAlt: 'shared-image alt',
    });

    const emptyHarness = createProductsHarness();
    emptyHarness.prisma.product.findMany.mockResolvedValueOnce([
      productRow({ images: [] }),
    ]);
    emptyHarness.prisma.productImage.findMany.mockResolvedValueOnce([]);

    const [withoutMedia] = await emptyHarness.service.storefrontByIds([
      PRODUCT_ID,
    ]);
    expect(withoutMedia.effectiveCoverMedia).toBeNull();
    expect(withoutMedia.options[0].values[0]).toMatchObject({
      id: RED_VALUE_ID,
      thumbnailUrl: null,
      thumbnailAlt: null,
    });
  });

  it('serves one validated requested scope from the dedicated product method', async () => {
    const { service } = createProductsHarness();

    await expect(
      service.storefrontMediaBySlug('chair', {
        variantId: RED_LARGE_VARIANT_ID,
      }),
    ).resolves.toMatchObject({
      resolvedScope: 'VARIANT',
      scopeId: RED_LARGE_VARIANT_ID,
      catalogGraphVersion: 3,
    });
  });
});

describe('StorefrontProductsController media query contract', () => {
  function harness() {
    const products = {
      storefrontList: vi.fn(),
      storefrontGetBySlug: vi.fn(),
      storefrontMediaBySlug: vi.fn(async () => ({ ok: true })),
    };
    return {
      products,
      controller: new StorefrontProductsController(products as never),
    };
  }

  it('rejects neither and both media scopes with one stable 400 message', async () => {
    const { controller } = harness();

    for (const [variantId, optionValueId] of [
      [undefined, undefined],
      [RED_LARGE_VARIANT_ID, RED_VALUE_ID],
    ] as const) {
      try {
        await controller.media('chair', variantId, optionValueId);
        throw new Error('expected media query rejection');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).message).toBe(
          MEDIA_SCOPE_QUERY_ERROR,
        );
      }
    }
  });

  it('passes exactly one scope to the dedicated service method', async () => {
    const { controller, products } = harness();

    await controller.media('chair', RED_LARGE_VARIANT_ID, undefined);

    expect(products.storefrontMediaBySlug).toHaveBeenCalledWith('chair', {
      variantId: RED_LARGE_VARIANT_ID,
    });
  });
});

describe('landing-page media override replacement', () => {
  function landingHarness() {
    const landingPage = {
      id: 'lp-1',
      name: 'Campaign',
      slug: 'campaign',
      adCode: null,
      titleOverride: null,
      imagesOverride: [
        { url: 'https://cdn.example.test/lp.jpg', altText: 'LP image' },
      ],
      seoTitle: null,
      seoDescription: null,
      promoEnabled: false,
      promoHeadline: null,
      promoSubtext: null,
      status: 'ACTIVE' as const,
      startAt: null,
      endAt: null,
      sortOrder: 0,
      product: { slug: 'chair', status: 'ACTIVE' as const },
    };
    const prisma = {
      productLandingPage: { findUnique: vi.fn(async () => landingPage) },
    };
    const products = {
      storefrontGetBySlug: vi.fn(async (_slug: string, request?: unknown) => ({
        id: PRODUCT_ID,
        initialMediaSet: request
          ? { resolvedScope: 'VARIANT', media: [{ id: 'selected' }] }
          : { resolvedScope: 'SHARED', media: [{ id: 'shared' }] },
      })),
    };
    return {
      products,
      service: new LandingPagesService(prisma as never, products as never),
    };
  }

  it('keeps the landing override only when no product scope is selected', async () => {
    const { service } = landingHarness();

    const result = await service.storefrontGetComposite('campaign');

    expect(result.landingPage.imagesOverride).toEqual([
      { url: 'https://cdn.example.test/lp.jpg', altText: 'LP image' },
    ]);
  });

  it('replaces rather than merges the landing override for a valid selected scope', async () => {
    const { service, products } = landingHarness();

    const result = await service.storefrontGetComposite('campaign', {
      variantId: RED_LARGE_VARIANT_ID,
    });

    expect(products.storefrontGetBySlug).toHaveBeenCalledWith('chair', {
      variantId: RED_LARGE_VARIANT_ID,
    });
    expect(result.landingPage.imagesOverride).toBeNull();
    expect(result.product.initialMediaSet).toEqual({
      resolvedScope: 'VARIANT',
      media: [{ id: 'selected' }],
    });
  });

  it('rejects conflicting landing scope query parameters in the controller', () => {
    const service = { storefrontGetComposite: vi.fn() };
    const controller = new StorefrontLandingPagesController(service as never);

    expect(() =>
      controller.getBySlug('campaign', RED_LARGE_VARIANT_ID, RED_VALUE_ID),
    ).toThrowError(MEDIA_SCOPE_QUERY_ERROR);
    expect(service.storefrontGetComposite).not.toHaveBeenCalled();
  });
});

it('never resolves foreign-product media even when ids collide in another graph', () => {
  const foreign = graph();
  foreign.id = FOREIGN_PRODUCT_ID;
  foreign.variants = [];

  expect(() =>
    resolveProductMedia(foreign, { variantId: RED_LARGE_VARIANT_ID }),
  ).toThrowError(
    "Variant does not belong to this product's current catalog graph",
  );
});
