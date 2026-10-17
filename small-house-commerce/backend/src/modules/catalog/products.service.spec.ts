import { describe, expect, it, vi } from 'vitest';
import { legacyUnmappedCombinationKey } from './catalog-graph.js';
import type {
  AdminProductQuery,
  StorefrontProductQuery,
} from './dto/product.dto.js';
import { ProductsService, formatProductCode } from './products.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { revalidateCache } from '../../common/revalidation.js';
import type { ProductMediaGraph } from './product-media.resolver.js';
import type { VariantCardMedia } from './variant-card-media.js';

vi.mock('../../common/revalidation.js', () => ({
  CACHE_TAGS: { STOREFRONT: 'storefront' },
  revalidateCache: vi.fn(async () => undefined),
}));

type MockProductRow = { id: string; [key: string]: unknown };

type MockSharedFaq = { items: unknown } | null;
type MockScopedMedia = ProductMediaGraph['images'][number] & { productId: string };

function createPrismaMock(
  rows: MockProductRow[],
  sharedFaq: MockSharedFaq = null,
  scopedMedia: MockScopedMedia[] = [],
) {
  const hydratedRows = rows.map((row) => ({
    catalogGraphVersion: 0,
    defaultDisplayVariantId: null,
    images: [],
    options: [],
    variants: [],
    ...row,
  }));

  return {
    product: {
      // The query forces ACTIVE + id-in; echo rows in the (deliberately
      // shuffled) order the mock holds, so the service must re-sort itself.
      findMany: vi.fn<(query: Prisma.ProductFindManyArgs) => Promise<typeof hydratedRows>>(async () => [...hydratedRows].reverse()),
      findFirst: vi.fn(async () => hydratedRows[0] ?? null),
      count: vi.fn(async () => rows.length),
      groupBy: vi.fn(async () => [] as unknown[]),
    },
    productImage: {
      findMany: vi.fn(async () => structuredClone(scopedMedia)),
    },
    productOption: {
      findMany: vi.fn<(query: Prisma.ProductOptionFindManyArgs) => Promise<unknown[]>>(async () => []),
    },
    category: {
      findMany: vi.fn(async () => []),
    },
    inventory: {
      groupBy: vi.fn(async (): Promise<Array<{ skuId: string; _sum: { onHand: number; reserved: number } }>> => []),
    },
    productFaq: {
      findMany: vi.fn(async () => [] as unknown[]),
    },
    sku: {
      // Bundle definitions of the requested virtual SKUs; no rows by default.
      findMany: vi.fn(async () => [] as unknown[]),
    },
    sharedFaqSet: {
      findUnique: vi.fn(async () => sharedFaq),
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
}

const reviewsStub = {
  summaryForProducts: vi.fn(async () => new Map()),
  storefrontForProduct: vi.fn(async () => ({})),
} as never;

const inventoryStub = {
  stockBySku: vi.fn(async () => new Map()),
} as never;

function createService(prisma: ReturnType<typeof createPrismaMock>) {
  return new ProductsService(prisma as never, reviewsStub, inventoryStub);
}

describe('ProductsService.storefrontByIds', () => {
  it('queries ACTIVE products by id and returns them in the requested order', async () => {
    const prisma = createPrismaMock([{ id: 'p1' }, { id: 'p2' }]);
    const service = createService(prisma);

    const result = await service.storefrontByIds(['p1', 'p2']);

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['p1', 'p2'] }, status: 'ACTIVE' },
      }),
    );
    expect(result.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(result[0]).toMatchObject({ reviewCount: 0, ratingAverage: null });
  });

  it('returns an empty list without querying when given no ids', async () => {
    const prisma = createPrismaMock([]);
    const service = createService(prisma);

    const result = await service.storefrontByIds([]);

    expect(result).toEqual([]);
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });

  it('serializes the compatibility graph and never leaks scoped galleries', async () => {
    const prisma = createPrismaMock([
      {
        id: '11111111-1111-1111-1111-111111111111',
        images: [
          {
            id: 'shared',
            url: '/shared.jpg',
            type: 'IMAGE',
            altText: null,
            sortOrder: 0,
            optionValueId: null,
            variantId: null,
          },
          {
            id: 'scoped',
            url: '/scoped.jpg',
            type: 'IMAGE',
            altText: null,
            sortOrder: 1,
            optionValueId: 'value-id',
            variantId: null,
          },
        ],
        variants: [
          {
            id: '22222222-2222-2222-2222-222222222222',
            name: 'Disabled',
            position: 0,
            combinationKey: null,
            optionValues: [],
            sku: {
              id: 'disabled-sku',
              skuCode: 'DISABLED',
              status: 'DISABLED',
              price: 500,
              compareAtPrice: null,
            },
          },
          {
            id: '33333333-3333-3333-3333-333333333333',
            name: 'Display',
            position: 1,
            combinationKey: null,
            optionValues: [],
            sku: {
              id: 'display-sku',
              skuCode: 'DISPLAY',
              status: 'ACTIVE',
              price: 600,
              compareAtPrice: null,
            },
          },
        ],
      },
    ]);
    const service = createService(prisma);

    const [result] = await service.storefrontByIds([
      '11111111-1111-1111-1111-111111111111',
    ]);

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          catalogGraphVersion: true,
          defaultDisplayVariantId: true,
          images: expect.objectContaining({
            where: { optionValueId: null, variantId: null },
            orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          }),
          options: expect.any(Object),
          variants: expect.objectContaining({
            orderBy: [{ position: 'asc' }, { id: 'asc' }],
            select: expect.objectContaining({
              combinationKey: true,
              optionValues: expect.any(Object),
              sku: expect.objectContaining({
                select: expect.objectContaining({ status: true }),
              }),
            }),
          }),
        }),
      }),
    );
    expect(result).toMatchObject({
      catalogGraphVersion: 0,
      defaultDisplayVariantId: '33333333-3333-3333-3333-333333333333',
      effectiveCoverMedia: { id: 'shared' },
      images: [{ id: 'shared' }],
      options: [
        expect.objectContaining({
          kind: 'STYLE',
          values: [
            expect.objectContaining({ label: 'Disabled' }),
            expect.objectContaining({ label: 'Display' }),
          ],
        }),
      ],
      variants: [
        expect.objectContaining({
          id: '22222222-2222-2222-2222-222222222222',
          optionValueIds: [expect.any(String)],
          sku: expect.objectContaining({ status: 'DISABLED' }),
        }),
        expect.objectContaining({
          id: '33333333-3333-3333-3333-333333333333',
          optionValueIds: [expect.any(String)],
          sku: expect.objectContaining({
            status: 'ACTIVE',
            availableInventory: 0,
          }),
        }),
      ],
    });
  });
});

function cardProduct(id: string): MockProductRow {
  return {
    id,
    catalogGraphVersion: 2,
    defaultDisplayVariantId: `${id}-red`,
    images: [{ id: `${id}-shared`, url: '/shared.webp', type: 'IMAGE', altText: null,
      sortOrder: 0, optionValueId: null, variantId: null, isScene: false }],
    options: [{ id: `${id}-color`, name: 'Color', kind: 'COLOR', presentation: 'IMAGE',
      position: 0, isActive: true, isMediaDriver: true, values: ['red', 'blue'].map((color, position) => ({
        id: `${id}-${color}-value`, label: color, position, isActive: true,
        swatchHex: null, thumbnailUrl: null, thumbnailAlt: null,
      })) }],
    variants: ['red', 'blue', 'unpriced', 'disabled'].map((color, position) => ({
      id: `${id}-${color}`, name: color, position, combinationKey: color,
      cardMedia: {
        cover: { type: 'IMAGE', url: `/uploads/${id}-${color}-card.webp`, altText: `${color} card` },
        hover: color === 'red' ? null : { type: 'IMAGE', url: `/uploads/${id}-${color}-hover.webp`, altText: `${color} room` },
      },
      optionValues: color === 'red' || color === 'blue'
        ? [{ optionId: `${id}-color`, optionValueId: `${id}-${color}-value` }] : [],
      sku: { id: `${id}-${color}-sku`, skuCode: color, status: color === 'disabled' ? 'DISABLED' : 'ACTIVE',
        price: color === 'unpriced' ? null : 1199, compareAtPrice: 1499 },
    })),
  };
}

function cardScopedMedia(id: string): MockScopedMedia[] {
  return [
    { productId: id, id: `${id}-red-cover`, url: '/red.webp', type: 'IMAGE', altText: 'Red',
      sortOrder: 0, optionValueId: null, variantId: `${id}-red`, isScene: false },
    { productId: id, id: `${id}-red-option-scene`, url: '/red-scene.webp', type: 'IMAGE', altText: 'Red room',
      sortOrder: 1, optionValueId: `${id}-red-value`, variantId: null, isScene: true },
    { productId: id, id: `${id}-blue-cover`, url: '/blue.webp', type: 'IMAGE', altText: 'Blue',
      sortOrder: 0, optionValueId: `${id}-blue-value`, variantId: null, isScene: false },
    { productId: id, id: `${id}-blue-scene`, url: '/blue-scene.webp', type: 'IMAGE', altText: 'Blue room',
      sortOrder: 1, optionValueId: `${id}-blue-value`, variantId: null, isScene: true },
  ];
}

function expectCardMedia(product: { id: string; [key: string]: unknown }): void {
  expect(product.cardMedia).toMatchObject({
    displayVariantId: `${product.id}-red`,
    unselected: { cover: { id: `card:${product.id}-red:cover`, url: `/uploads/${product.id}-red-card.webp` }, scene: null },
    variants: [
      { variantId: `${product.id}-red`, cover: { id: `card:${product.id}-red:cover`, url: `/uploads/${product.id}-red-card.webp` }, scene: null },
      { variantId: `${product.id}-blue`, cover: { id: `card:${product.id}-blue:cover`, url: `/uploads/${product.id}-blue-card.webp` },
        scene: { id: `card:${product.id}-blue:hover`, url: `/uploads/${product.id}-blue-hover.webp` } },
    ],
  });
  expect(product).not.toHaveProperty('detailBlocks');
  expect(product).not.toHaveProperty('effectiveFaq');
  expect(product).not.toHaveProperty('media');
  const serialized = JSON.stringify(product.cardMedia);
  expect(serialized).not.toMatch(/isScene|optionValueId|productId|supplierCost|internalSecret/);
  for (const variant of product.variants as Array<object>) expect(variant).not.toHaveProperty('cardMedia');
  expect(product.effectiveCoverMedia).toMatchObject({ id: `${product.id}-red-cover`, url: '/red.webp' });
  expect(Object.keys((product.images as Array<object>)[0]!).sort()).toEqual(['altText', 'id', 'sortOrder', 'type', 'url']);
}

describe('ProductsService card media batches', () => {
  it.each([1, 20])('presents every selectable variant with one media query for %i products', async (count) => {
    const ids = Array.from({ length: count }, (_, index) => `card-${index}`);
    const prisma = createPrismaMock(ids.map(cardProduct), null, ids.flatMap(cardScopedMedia));
    const result = await createService(prisma).storefrontByIds(ids);
    expect(result.map(product => product.id)).toEqual(ids);
    result.forEach(expectCardMedia);
    expect(prisma.productImage.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.productImage.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        productId: { in: ids },
        OR: [
          { optionValueId: { in: ids.flatMap(id => [`${id}-red-value`, `${id}-blue-value`]) } },
          { variantId: { in: ids.flatMap(id => ['red', 'blue', 'unpriced', 'disabled'].map(color => `${id}-${color}`)) } },
        ],
      },
      select: expect.objectContaining({ isScene: true }),
    }));
    expect(prisma.product.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        images: expect.objectContaining({ select: expect.objectContaining({ isScene: true }) }),
        variants: expect.objectContaining({ select: expect.objectContaining({ cardMedia: true }) }),
      }),
    }));
    expect(prisma.product.findFirst).not.toHaveBeenCalled();
  });

  it('keeps the same card projection in normal, search and ids listings', async () => {
    const prisma = {
      ...createPrismaMock([cardProduct('card')], null, cardScopedMedia('card')),
      $queryRaw: vi.fn()
        .mockResolvedValueOnce([{ id: 'card', rank: 1 }])
        .mockResolvedValueOnce([{ total: 1n }]),
    };
    const service = createService(prisma);
    for (const query of [
      { page: 1, pageSize: 20 },
      { page: 1, pageSize: 20, search: 'chair' },
      { ids: ['card'] },
    ]) {
      const result = await service.storefrontList(query as StorefrontProductQuery);
      expectCardMedia(result.items[0]!);
    }
    expect(prisma.productImage.findMany).toHaveBeenCalledTimes(3);
  });

  it('keeps legacy PDP inference separate from an absent operator card default', async () => {
    const prisma = createPrismaMock([{ id: 'legacy', images: [
      { id: 'shared', url: '/shared.webp', type: 'IMAGE', altText: null, sortOrder: 0,
        optionValueId: null, variantId: null, isScene: true },
    ], variants: [{ id: 'legacy-v', name: 'Standard', position: 0, optionValues: [],
      cardMedia: { cover: { type: 'IMAGE', url: '/uploads/legacy-cover.webp', altText: null }, hover: null },
      sku: { id: 'legacy-sku', status: 'ACTIVE', skuCode: 'LEGACY', price: 0, compareAtPrice: null } }] }]);
    const [result] = await createService(prisma).storefrontByIds(['legacy']);
    expect(result.defaultDisplayVariantId).toBe('legacy-v');
    expect(result.cardMedia).toEqual({
      displayVariantId: null,
      unselected: { cover: null, scene: null },
      variants: [{ variantId: 'legacy-v', cover: {
        id: 'card:legacy-v:cover', type: 'IMAGE', url: '/uploads/legacy-cover.webp', altText: null, sortOrder: 0,
      }, scene: null }],
    });
    expect(result.variants[0]).not.toHaveProperty('cardMedia');
    expect(prisma.productImage.findMany).not.toHaveBeenCalled();
    expect(JSON.stringify(result.images)).not.toContain('isScene');
  });

  it.each([null, 'unknown', 'card-disabled', 'card-unpriced'])('rejects stored card default %s without borrowing the PDP fallback', async defaultDisplayVariantId => {
    const row = { ...cardProduct('card'), defaultDisplayVariantId };
    const [result] = await createService(createPrismaMock([row], null, cardScopedMedia('card'))).storefrontByIds(['card']);
    expect(result.cardMedia).toMatchObject({ displayVariantId: null, unselected: { cover: null, scene: null } });
    expect(result.effectiveCoverMedia).toMatchObject({ id: defaultDisplayVariantId === 'card-unpriced' ? 'card-shared' : 'card-red-cover' });
  });

  it('retains an explicitly chosen zero-price out-of-stock variant and never leaks raw JSON', async () => {
    const row = cardProduct('card');
    const variants = row.variants as Array<{ id: string; sku: { price: number | null }; cardMedia: VariantCardMedia }>;
    variants[1]!.sku.price = 0;
    Object.assign(variants[1]!.cardMedia.cover!, { supplierCost: 999, internalSecret: { secret: true } });
    row.defaultDisplayVariantId = 'card-blue';
    const [result] = await createService(createPrismaMock([row], null, cardScopedMedia('card'))).storefrontByIds(['card']);
    expect(result.cardMedia).toMatchObject({
      displayVariantId: 'card-blue', unselected: { cover: { url: '/uploads/card-blue-card.webp' } },
    });
    expect(result.variants[1]!.sku).toMatchObject({ price: 0, availableInventory: 0 });
    expect(JSON.stringify(result)).not.toMatch(/supplierCost|internalSecret/);
    expect(result.variants[1]).not.toHaveProperty('cardMedia');
  });

  it('strips editing snapshots from PDP variants while keeping the PDP gallery response', async () => {
    const row = cardProduct('pdp');
    row.images = [...row.images as MockScopedMedia[], ...cardScopedMedia('pdp')];
    const prisma = createPrismaMock([row]);
    const result = await createService(prisma).storefrontGetBySlug('pdp');
    expect(result.initialMediaSet).toEqual({
      resolvedScope: 'VARIANT', scopeId: 'pdp-red', catalogGraphVersion: 2, media: [
        { id: 'pdp-red-cover', url: '/red.webp', type: 'IMAGE', altText: 'Red', sortOrder: 0 },
      ],
    });
    expect(result.effectiveCoverMedia).toEqual(result.initialMediaSet.media[0]);
    expect(result.images).toEqual([{ id: 'pdp-shared', url: '/shared.webp', type: 'IMAGE', altText: null, sortOrder: 0 }]);
    expect(result.options[0]!.values[0]!.thumbnailUrl).toBeNull();
    for (const variant of result.variants) expect(variant).not.toHaveProperty('cardMedia');
    expect(result).toHaveProperty('cardMedia.displayVariantId', 'pdp-red');
    expect(result).toHaveProperty('cardMedia.unselected.cover.url', '/uploads/pdp-red-card.webp');
  });

  it('does not query media for an empty page', async () => {
    const prisma = createPrismaMock([]);
    await createService(prisma).storefrontByIds([]);
    expect(prisma.productImage.findMany).not.toHaveBeenCalled();
  });
});

describe('ProductsService storefront image query contracts', () => {
  it('restricts the PDP legacy images relation to shared media', async () => {
    const prisma = createPrismaMock([{ id: 'pdp-product' }]);
    const service = createService(prisma);

    await service.storefrontGetBySlug('pdp-product');

    expect(prisma.product.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          images: expect.objectContaining({
            where: { optionValueId: null, variantId: null },
            orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          }),
          detailBlocks: expect.objectContaining({
            orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          }),
        }),
      }),
    );
  });

  it('restricts admin legacy images to shared media', async () => {
    const prisma = createPrismaMock([{ id: 'admin-product' }]);
    const service = createService(prisma);

    await service.list({ page: 1, pageSize: 20 } as AdminProductQuery);

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          images: expect.objectContaining({
            where: { optionValueId: null, variantId: null },
            orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          }),
          detailBlocks: expect.objectContaining({
            orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          }),
          variants: expect.objectContaining({
            orderBy: [{ position: 'asc' }, { id: 'asc' }],
          }),
        }),
      }),
    );
  });
});

describe('ProductsService admin Bundle availability', () => {
  it('shows component-derived availability without physical stock on a virtual SKU', async () => {
    const prisma = createPrismaMock([{
      id: 'product-1',
      variants: [
        { id: 'v-set', sku: { id: 'bundle-sku', isBundle: true, price: '2499' } },
        { id: 'v-chair', sku: { id: 'chair-sku', isBundle: false, price: '999' } },
      ],
    }]);
    prisma.sku.findMany.mockResolvedValue([{
      id: 'bundle-sku', status: 'ACTIVE', product: { status: 'ACTIVE' },
      bundleComponents: [{
        componentSkuId: 'chair-sku', quantity: 2,
        componentSku: { status: 'ACTIVE', isBundle: false, variant: { product: { status: 'ACTIVE' } } },
      }],
    }]);
    prisma.inventory.groupBy.mockResolvedValue([
      { skuId: 'chair-sku', _sum: { onHand: 11, reserved: 2 } },
    ]);
    const inventory = {
      stockBySku: vi.fn(async () => new Map([
        ['bundle-sku', { onHand: 99, reserved: 7, available: 92 }],
        ['chair-sku', { onHand: 11, reserved: 2, available: 9 }],
      ])),
    };
    const service = new ProductsService(prisma as never, reviewsStub, inventory as never);

    const result = await service.list({ page: 1, pageSize: 20 });

    expect(result.items[0]!.variants).toEqual([
      expect.objectContaining({ sku: expect.objectContaining({ id: 'bundle-sku', onHand: 0, reserved: 0, availableInventory: 4, price: '2499' }) }),
      expect.objectContaining({ sku: expect.objectContaining({ id: 'chair-sku', onHand: 11, reserved: 2, availableInventory: 9, price: '999' }) }),
    ]);
  });
});

describe('ProductsService storefront Bundle availability', () => {
  it('projects derived Bundle availability and leaves ordinary SKU stock untouched', async () => {
    const prisma = createPrismaMock([{
      id: '11111111-1111-1111-1111-111111111111',
      variants: [
        { id: 'v-set', name: 'Set', position: 0, combinationKey: null, optionValues: [], sku: { id: 'bundle-sku', skuCode: 'SET', status: 'ACTIVE', price: 2499, compareAtPrice: null } },
        { id: 'v-chair', name: 'Chair', position: 1, combinationKey: null, optionValues: [], sku: { id: 'chair-sku', skuCode: 'CHAIR', status: 'ACTIVE', price: 999, compareAtPrice: null } },
      ],
    }]);
    prisma.sku.findMany.mockResolvedValue([{
      id: 'bundle-sku',
      status: 'ACTIVE',
      product: { status: 'ACTIVE' },
      bundleComponents: [{
        componentSkuId: 'chair-sku', quantity: 2,
        componentSku: { status: 'ACTIVE', isBundle: false, variant: { product: { status: 'ACTIVE' } } },
      }],
    }]);
    prisma.inventory.groupBy.mockResolvedValue([
      { skuId: 'chair-sku', _sum: { onHand: 11, reserved: 1 } },
      // A stray inventory row on the virtual SKU must never be advertised.
      { skuId: 'bundle-sku', _sum: { onHand: 40, reserved: 0 } },
    ]);
    const service = createService(prisma);

    const [result] = await service.storefrontByIds(['11111111-1111-1111-1111-111111111111']);

    expect(result).toMatchObject({
      variants: [
        { sku: { skuCode: 'SET', availableInventory: 5 } },
        { sku: { skuCode: 'CHAIR', availableInventory: 10 } },
      ],
    });
  });
});

describe('ProductsService.storefrontList ids branch', () => {
  it('returns an empty page and runs no catalog queries when ids is present but empty', async () => {
    // `?ids=` preprocesses to [] (the schema enforces no min length): the
    // mere presence of the parameter must short-circuit to an empty page,
    // never fall through to the full paginated catalog.
    const prisma = createPrismaMock([]);
    const service = createService(prisma);

    const result = await service.storefrontList({
      ids: [],
    } as unknown as StorefrontProductQuery);

    expect(result).toEqual({ items: [], total: 0, page: 1, pageSize: 0 });
    expect(prisma.product.findMany).not.toHaveBeenCalled();
    expect(prisma.product.count).not.toHaveBeenCalled();
    expect(prisma.inventory.groupBy).not.toHaveBeenCalled();
  });

  it('returns order-preserved presented items with the ids-shaped paging envelope', async () => {
    const prisma = createPrismaMock([{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }]);
    const service = createService(prisma);

    const result = await service.storefrontList({
      ids: ['p3', 'p1'],
    } as unknown as StorefrontProductQuery);

    expect(prisma.product.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['p3', 'p1'] }, status: 'ACTIVE' },
      }),
    );
    expect(result.items.map((p) => p.id)).toEqual(['p3', 'p1']);
    expect(result).toMatchObject({ total: 2, page: 1, pageSize: 2 });
    expect(result.items[0]).toMatchObject({
      reviewCount: 0,
      ratingAverage: null,
    });
  });
});

const LEGACY_PRODUCT_ID = '00000000-0000-4000-8000-000000000701';
const EXISTING_VARIANT_ID = '00000000-0000-4000-8000-000000000702';
const EXISTING_SKU_ID = '00000000-0000-4000-8000-000000000703';

interface LegacyVariantRow {
  id: string;
  productId: string;
  name: string;
  position: number;
  combinationKey: string;
  cardMedia?: VariantCardMedia | null;
  sku: {
    id: string;
    skuCode: string;
    status: 'ACTIVE' | 'DISABLED';
    isBundle: boolean;
    price?: number | null;
  } | null;
}

interface BundleDefinitionRow {
  componentSkuId: string;
  quantity: number;
  position: number;
  componentSku: {
    status: string;
    isBundle: boolean;
    variant: { product: { status: string } };
  };
}

function bundleDefinitionRow(
  componentSkuId = 'component-1',
  quantity = 2,
  componentSku: Partial<BundleDefinitionRow['componentSku']> = {},
): BundleDefinitionRow {
  return {
    componentSkuId,
    quantity,
    position: 0,
    componentSku: { status: 'ACTIVE', isBundle: false, variant: { product: { status: 'ACTIVE' } }, ...componentSku },
  };
}

function createLegacyWriteHarness(
  initialVariants: LegacyVariantRow[] = [],
  bundleDefinitions: Record<string, BundleDefinitionRow[]> = {},
) {
  const variants = structuredClone(initialVariants);
  const product = { id: LEGACY_PRODUCT_ID, name: 'Card product', status: 'DRAFT', defaultDisplayVariantId: null };
  const currentProduct = () => ({ ...product, variants: structuredClone(variants) });
  let committed = false;
  type CardWrite = { cardMedia?: VariantCardMedia | null | typeof Prisma.DbNull };
  const productVariantCreate = vi.fn(
    async ({ data }: { data: Omit<LegacyVariantRow, 'sku' | 'cardMedia'> & CardWrite }) => {
      const row: LegacyVariantRow = { ...data, sku: null,
        cardMedia: data.cardMedia instanceof Prisma.NullTypes.DbNull ? null : structuredClone(data.cardMedia ?? null),
      };
      variants.push(row);
      return structuredClone(row);
    },
  );
  const productVariantUpdate = vi.fn(
    async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Omit<Partial<LegacyVariantRow>, 'cardMedia'> & CardWrite;
    }) => {
      const row = variants.find(({ id }) => id === where.id);
      if (!row) throw new Error(`missing variant ${where.id}`);
      const { cardMedia, ...columns } = data;
      Object.assign(row, structuredClone(columns));
      if (cardMedia !== undefined) row.cardMedia = cardMedia instanceof Prisma.NullTypes.DbNull ? null : structuredClone(cardMedia);
      return structuredClone(row);
    },
  );
  const skuCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    const row = variants.find(row => row.id === data.variantId)!;
    row.sku = {
      ...data, id: `sku-${row.id}`, skuCode: data.skuCode as string,
      status: (data.status ?? 'ACTIVE') as 'ACTIVE' | 'DISABLED', isBundle: data.isBundle === true,
      price: (data.price as number | undefined) ?? null,
    };
    return structuredClone(row.sku);
  });
  const skuUpdate = vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
    const row = variants.find(row => row.sku?.id === where.id)!;
    Object.assign(row.sku!, structuredClone(data));
    return structuredClone(row.sku);
  });
  const tx = {
    // product_code_seq lookup; the value only has to be renderable.
    $queryRaw: vi.fn(async () => [{ value: 7n }]),
    product: {
      create: vi.fn(async ({ data }: Prisma.ProductCreateArgs) => {
        product.name = data.name;
        product.status = typeof data.status === 'string' ? data.status : 'DRAFT';
        return { id: LEGACY_PRODUCT_ID };
      }),
      update: vi.fn(async ({ data }: Prisma.ProductUpdateArgs) => {
        if (typeof data.status === 'string') product.status = data.status;
        if (typeof data.name === 'string') product.name = data.name;
        return currentProduct();
      }),
      findUniqueOrThrow: vi.fn(async () => currentProduct()),
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] }; status?: string } }) =>
        where.id.in.includes(product.id) && (!where.status || product.status === where.status) ? [currentProduct()] : [],
      ),
    },
    productVariant: {
      create: productVariantCreate,
      findMany: vi.fn(async () => structuredClone(variants)),
      update: productVariantUpdate,
      delete: vi.fn(async () => undefined),
    },
    sku: {
      // Publish readiness reads the active virtual SKUs of the product under
      // write; definitions are keyed by SKU code so a SKU created during this
      // save is findable before its generated id is known.
      findMany: vi.fn(async ({ where }: { where: { productId: { in: string[] }; isBundle: boolean; status: string } }) =>
        variants
          .filter((row) => row.sku && row.sku.isBundle === where.isBundle && row.sku.status === where.status && where.productId.in.includes(LEGACY_PRODUCT_ID))
          .map((row) => ({
            id: row.sku!.id,
            skuCode: row.sku!.skuCode,
            productId: LEGACY_PRODUCT_ID,
            product: { name: product.name },
            bundleComponents: structuredClone(bundleDefinitions[row.sku!.skuCode] ?? []),
          })),
      ),
      create: skuCreate,
      update: skuUpdate,
      delete: vi.fn(async () => undefined),
    },
  };
  const prisma = {
    category: {
      findUnique: vi.fn(async () => ({ id: 'category-id' })),
    },
    product: {
      findUnique: vi.fn(async () => ({
        id: LEGACY_PRODUCT_ID,
        catalogGraphVersion: 0,
      })),
    },
    sku: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] }; isBundle: boolean } }) => variants
        .filter((row) => row.sku?.isBundle === where.isBundle && where.id.in.includes(row.sku.id))
        .map((row) => ({
          id: row.sku!.id,
          status: row.sku!.status,
          product: { status: product.status },
          bundleComponents: structuredClone(bundleDefinitions[row.sku!.skuCode] ?? []),
        }))),
    },
    inventory: { groupBy: vi.fn(async () => []) },
    productFaq: {
      findMany: vi.fn(async () => [] as unknown[]),
    },
    $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => {
      const beforeVariants = structuredClone(variants);
      const beforeProduct = structuredClone(product);
      committed = false;
      try {
        const result = await callback(tx);
        committed = true;
        return result;
      } catch (error) {
        variants.splice(0, variants.length, ...beforeVariants);
        Object.assign(product, beforeProduct);
        throw error;
      }
    }),
  };
  return {
    service: new ProductsService(prisma as never, reviewsStub, inventoryStub),
    tx,
    variants,
    product,
    get committed() { return committed; },
  };
}

describe('ProductsService immutable SKU inventory mode', () => {
  it.each([false, true])('rolls back a legacy save that converts persisted mode %s', async isBundle => {
    const harness = createLegacyWriteHarness([{
      id: EXISTING_VARIANT_ID, productId: LEGACY_PRODUCT_ID, name: 'Red', position: 0,
      combinationKey: legacyUnmappedCombinationKey(EXISTING_VARIANT_ID),
      sku: { id: EXISTING_SKU_ID, skuCode: 'LEGACY-RED', status: 'ACTIVE', isBundle, price: 100 },
    }]);
    const before = structuredClone(harness.variants);
    await expect(harness.service.update(LEGACY_PRODUCT_ID, { variants: [{
      name: 'Red', position: 0, sku: { skuCode: 'LEGACY-RED', status: 'ACTIVE', isBundle: !isBundle, price: 777 },
    }] })).rejects.toThrow(/inventory mode.*immutable/i);
    expect(harness.variants).toEqual(before);
    expect(harness.committed).toBe(false);
  });
});

describe('ProductsService final legacy card publish check', () => {
  const pair: VariantCardMedia = {
    cover: { type: 'IMAGE', url: '/uploads/own-cover.webp', altText: null }, hover: null,
  };
  const input = () => ({
    name: 'Card product', slug: 'card-product', categoryId: 'category-id', status: 'ACTIVE' as const,
    solutions: [], images: [], detailBlocks: [],
    variants: [{ name: 'Single', position: 0, sku: { skuCode: 'SINGLE', status: 'ACTIVE' as const, price: 0 } }],
  });

  it('rejects legacy ACTIVE creation without a cover and leaves no created variants', async () => {
    const harness = createLegacyWriteHarness();
    await expect(harness.service.create(input())).rejects.toMatchObject({ response: {
      code: 'PRODUCT_CARD_MEDIA_INCOMPLETE', products: [expect.objectContaining({
        missingCoverVariants: [expect.objectContaining({ name: 'Single' })],
      })],
    } });
    expect(harness.variants).toEqual([]);
    expect(harness.committed).toBe(false);
    expect(harness.product.status).toBe('DRAFT');
  });

  it('validates the created zero-price single SKU only after its independent cover is saved', async () => {
    const harness = createLegacyWriteHarness();
    const write = input();
    Object.assign(write.variants[0]!, { cardMedia: pair });
    const saved = await harness.service.create(write);
    expect(saved).toMatchObject({ status: 'ACTIVE', variants: [expect.objectContaining({ cardMedia: pair })] });
    expect(harness.committed).toBe(true);
  });

  it('rolls back an ACTIVE legacy cover clear without replacing its real SKU', async () => {
    const harness = createLegacyWriteHarness();
    const write = input();
    Object.assign(write.variants[0]!, { cardMedia: pair });
    await harness.service.create(write);
    const before = structuredClone(harness.variants);
    await expect(harness.service.update(LEGACY_PRODUCT_ID, { variants: [
      { name: 'Single', position: 0, cardMedia: null, sku: { skuCode: 'SINGLE', status: 'ACTIVE', price: 0 } },
    ] })).rejects.toMatchObject({ response: { code: 'PRODUCT_CARD_MEDIA_INCOMPLETE' } });
    expect(harness.variants).toEqual(before);
    expect(harness.product.status).toBe('ACTIVE');
    expect(harness.committed).toBe(false);
  });

  it('allows incomplete legacy DRAFT creation', async () => {
    const harness = createLegacyWriteHarness();
    const saved = await harness.service.create({ ...input(), status: 'DRAFT' });
    expect(saved).toMatchObject({ status: 'DRAFT' });
    expect(harness.variants[0]!.cardMedia).toBeNull();
  });
});

describe('ProductsService Bundle publish readiness', () => {
  const pair: VariantCardMedia = {
    cover: { type: 'IMAGE', url: '/uploads/set-cover.webp', altText: null }, hover: null,
  };
  const virtualInput = (status: 'ACTIVE' | 'DRAFT' = 'ACTIVE') => ({
    name: 'Set product', slug: 'set-product', categoryId: 'category-id', status,
    solutions: [], images: [], detailBlocks: [],
    variants: [{ name: 'Single', position: 0, cardMedia: pair, sku: { skuCode: 'SET', status: 'ACTIVE' as const, isBundle: true, price: 2499 } }],
  });

  it('refuses to publish a newly created virtual SKU before its definition exists', async () => {
    const harness = createLegacyWriteHarness();
    await expect(harness.service.create(virtualInput())).rejects.toMatchObject({ response: {
      code: 'PRODUCT_BUNDLE_DEFINITION_INCOMPLETE',
      products: [expect.objectContaining({ productId: LEGACY_PRODUCT_ID, skus: [expect.objectContaining({ skuCode: 'SET' })] })],
    } });
    expect(harness.variants).toEqual([]);
    expect(harness.committed).toBe(false);
    expect(harness.product.status).toBe('DRAFT');
  });

  it('publishes a virtual SKU whose saved definition is valid', async () => {
    const harness = createLegacyWriteHarness([], { SET: [bundleDefinitionRow()] });
    const saved = await harness.service.create(virtualInput());
    expect(saved).toMatchObject({ status: 'ACTIVE' });
    expect(harness.committed).toBe(true);
  });

  it('rolls back publishing when the saved definition is unusable', async () => {
    const harness = createLegacyWriteHarness([{
      id: EXISTING_VARIANT_ID, productId: LEGACY_PRODUCT_ID, name: 'Single', position: 0,
      combinationKey: legacyUnmappedCombinationKey(EXISTING_VARIANT_ID), cardMedia: pair,
      sku: { id: EXISTING_SKU_ID, skuCode: 'SET', status: 'ACTIVE', isBundle: true, price: 2499 },
    }], { SET: [bundleDefinitionRow('component-1', 2, { status: 'DISABLED' })] });
    const before = structuredClone(harness.variants);
    await expect(harness.service.update(LEGACY_PRODUCT_ID, { status: 'ACTIVE' })).rejects.toMatchObject({
      response: { code: 'PRODUCT_BUNDLE_DEFINITION_INCOMPLETE' },
    });
    expect(harness.variants).toEqual(before);
    expect(harness.product.status).toBe('DRAFT');
    expect(harness.committed).toBe(false);
  });

  it('keeps an incomplete virtual SKU in draft for later definition editing', async () => {
    const harness = createLegacyWriteHarness();
    const saved = await harness.service.create(virtualInput('DRAFT'));
    expect(saved).toMatchObject({ status: 'DRAFT' });
    expect(harness.committed).toBe(true);
  });
});

describe('ProductsService graph-v0 independent card media', () => {
  const pair = (name: string): VariantCardMedia => ({
    cover: { type: 'IMAGE', url: `/uploads/${name}-cover.webp`, altText: null },
    hover: { type: 'IMAGE', url: `/uploads/${name}-hover.webp`, altText: name },
  });
  const retained = (): LegacyVariantRow => ({
    id: EXISTING_VARIANT_ID, productId: LEGACY_PRODUCT_ID, name: 'Red', position: 0,
    combinationKey: legacyUnmappedCombinationKey(EXISTING_VARIANT_ID), cardMedia: pair('red'),
    sku: { id: EXISTING_SKU_ID, skuCode: 'LEGACY-RED', status: 'ACTIVE', isBundle: false },
  });

  it('persists independent pairs on newly created legacy variant identities', async () => {
    const harness = createLegacyWriteHarness();
    await harness.service.create({
      name: 'Card product', slug: 'card-product', categoryId: 'category-id', status: 'DRAFT',
      solutions: [], images: [], detailBlocks: [],
      variants: [{ name: 'Red', position: 0, cardMedia: pair('red') },
        { name: 'Blue', position: 1, cardMedia: pair('blue') }],
    });
    expect(harness.variants.find(row => row.name === 'Red')).toHaveProperty('cardMedia', pair('red'));
    expect(harness.variants.find(row => row.name === 'Blue')).toHaveProperty('cardMedia', pair('blue'));
    expect(new Set(harness.variants.map(row => row.id)).size).toBe(2);
  });

  it.each([
    ['replacement', pair('replacement')],
    ['whole clearing', null],
    ['hover clearing', { ...pair('red'), hover: null }],
  ])('persists %s without replacing the retained SKU', async (_label, cardMedia) => {
    const harness = createLegacyWriteHarness([retained()]);
    await harness.service.update(LEGACY_PRODUCT_ID, { variants: [{
      name: 'Crimson', position: 3,
      sku: { skuCode: 'LEGACY-RED', status: 'ACTIVE' }, cardMedia,
    }] });
    expect(harness.variants[0]).toMatchObject({
      id: EXISTING_VARIANT_ID, name: 'Crimson', position: 3,
      cardMedia, sku: { id: EXISTING_SKU_ID },
    });
  });

  it('preserves omitted metadata on a renamed existing row and leaves a new row unconfigured', async () => {
    const harness = createLegacyWriteHarness([retained()]);
    await harness.service.update(LEGACY_PRODUCT_ID, { variants: [
      { name: 'Crimson', position: 1, sku: { skuCode: 'LEGACY-RED', status: 'ACTIVE' } },
      { name: 'New', position: 0 },
    ] });
    expect(harness.variants.find(row => row.id === EXISTING_VARIANT_ID)).toHaveProperty('cardMedia', pair('red'));
    expect(harness.variants.find(row => row.name === 'New')).toHaveProperty('cardMedia', null);
  });
});

describe('ProductsService graph-v0 variant compatibility', () => {
  it.each([1, 2])(
    'preallocates exact unique sentinels when legacy create writes %s variant(s)',
    async (variantCount) => {
      const harness = createLegacyWriteHarness();
      const inputVariants = Array.from(
        { length: variantCount },
        (_, index) => ({
          name: `Legacy ${index}`,
          position: index,
          sku: null,
        }),
      );

      await harness.service.create({
        name: 'Legacy product',
        slug: `legacy-product-${variantCount}`,
        categoryId: 'category-id',
        status: 'DRAFT',
        solutions: [],
        images: [],
        detailBlocks: [],
        variants: inputVariants,
      } as never);

      const created = harness.tx.productVariant.create.mock.calls.map(
        ([call]) => call.data,
      );
      expect(created).toHaveLength(variantCount);
      expect(new Set(created.map(({ id }) => id)).size).toBe(variantCount);
      for (const variant of created) {
        expect(variant.id).toMatch(/^[0-9a-f-]{36}$/i);
        expect(variant.combinationKey).toBe(
          legacyUnmappedCombinationKey(variant.id),
        );
      }
    },
  );

  it('mints the operator-facing product number from the sequence on create', async () => {
    const harness = createLegacyWriteHarness();

    await harness.service.create({
      name: 'Numbered product',
      slug: 'numbered-product',
      categoryId: 'category-id',
      status: 'DRAFT',
      solutions: [],
      images: [],
      detailBlocks: [],
      variants: [],
    } as never);

    const [call] = harness.tx.product.create.mock.calls;
    expect(call?.[0].data.productCode).toBe('P-000007');
  });

  it('adds a sentinel variant while preserving retained variant, SKU, and key identities', async () => {
    const existingKey = legacyUnmappedCombinationKey(EXISTING_VARIANT_ID);
    const harness = createLegacyWriteHarness([
      {
        id: EXISTING_VARIANT_ID,
        productId: LEGACY_PRODUCT_ID,
        name: 'Red',
        position: 0,
        combinationKey: existingKey,
        sku: {
          id: EXISTING_SKU_ID,
          skuCode: 'LEGACY-RED',
          status: 'ACTIVE',
          isBundle: false,
        },
      },
    ]);

    await harness.service.update(LEGACY_PRODUCT_ID, {
      variants: [
        {
          name: 'Red',
          position: 0,
          sku: { skuCode: 'LEGACY-RED', status: 'ACTIVE' },
        },
        { name: 'Blue', position: 1, sku: null },
      ],
    } as never);

    const created = harness.tx.productVariant.create.mock.calls[0]?.[0].data;
    expect(created?.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(created?.combinationKey).toBe(
      legacyUnmappedCombinationKey(created!.id),
    );
    expect(harness.variants).toContainEqual(
      expect.objectContaining({
        id: EXISTING_VARIANT_ID,
        combinationKey: existingKey,
      }),
    );
    expect(harness.tx.productVariant.update).toHaveBeenLastCalledWith({
      where: { id: EXISTING_VARIANT_ID },
      data: { name: 'Red', position: 0 },
    });
    expect(harness.tx.sku.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: EXISTING_SKU_ID },
        data: expect.objectContaining({
          variantId: EXISTING_VARIANT_ID,
          skuCode: 'LEGACY-RED',
        }),
      }),
    );
  });
});

describe('ProductsService admin list filters and counters', () => {
  it('searches the product code and ANDs the attention preset', async () => {
    const prisma = createPrismaMock([]);
    const service = createService(prisma);

    await service.list({
      search: 'P-000007',
      attention: 'missing_media',
      page: 1,
      pageSize: 20,
    } as AdminProductQuery);

    const [call] = prisma.product.findMany.mock.calls;
    expect(call?.[0].where).toMatchObject({
      OR: expect.arrayContaining([
        { productCode: { contains: 'P-000007', mode: 'insensitive' } },
      ]),
      AND: [{ images: { none: { optionValueId: null, variantId: null } } }],
    });
  });

  it('attaches active option names from one page-wide query', async () => {
    const prisma = createPrismaMock([{ id: 'p1' }, { id: 'p2' }]);
    vi.mocked(prisma.productOption.findMany).mockResolvedValue([
      { productId: 'p1', name: 'Color' },
      { productId: 'p1', name: 'Size' },
    ] as never);
    const service = createService(prisma);

    const page = await service.list({
      page: 1,
      pageSize: 20,
    } as AdminProductQuery);

    const byId = new Map(
      page.items.map((item) => [item.id, item.activeOptionNames]),
    );
    expect(byId.get('p1')).toEqual(['Color', 'Size']);
    // A product with no active option group reports an empty summary rather
    // than an absent field, so the column can render the SKU count alone.
    expect(byId.get('p2')).toEqual([]);
    // One query for the whole page — never one per row.
    expect(prisma.productOption.findMany).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(prisma.productOption.findMany).mock.calls[0]?.[0],
    ).toMatchObject({
      where: {
        productId: { in: expect.arrayContaining(['p1', 'p2']) },
        isActive: true,
      },
    });
  });

  it('aggregates the status totals and every attention preset in the database', async () => {
    const prisma = createPrismaMock([]);
    vi.mocked(prisma.product.groupBy).mockResolvedValue([
      { status: 'ACTIVE', _count: { _all: 5 } },
      { status: 'DRAFT', _count: { _all: 3 } },
      { status: 'DISABLED', _count: { _all: 1 } },
    ] as never);
    vi.mocked(prisma.product.count).mockResolvedValue(2 as never);
    const service = createService(prisma);

    const counts = await service.counts();

    expect(counts.status).toEqual({
      all: 9,
      active: 5,
      draft: 3,
      disabled: 1,
    });
    expect(counts.attention).toEqual({
      missing_media: 2,
      no_priced_sku: 2,
      incomplete_shipping: 2,
      stale_draft: 2,
    });
    // One query per preset — never a count over the visible page.
    expect(prisma.product.count).toHaveBeenCalledTimes(4);
  });
});

describe("formatProductCode", () => {
  it("renders sequence values as stable six-digit product numbers", () => {
    expect(formatProductCode(1n)).toBe("P-000001");
    expect(formatProductCode(7)).toBe("P-000007");
    expect(formatProductCode(999999n)).toBe("P-999999");
    // Past six digits the code simply grows; the sequence stays unique.
    expect(formatProductCode(1234567n)).toBe("P-1234567");
  });
});

describe("ProductsService.remove", () => {
  function createRemoveHarness(deleteImpl: () => Promise<unknown>) {
    const prisma = {
      product: {
        findUnique: vi.fn(async () => ({ id: "p1" })),
        delete: vi.fn(deleteImpl),
      },
    };
    return {
      service: new ProductsService(prisma as never, reviewsStub, inventoryStub),
      prisma,
    };
  }

  it("deletes an unreferenced product and revalidates the storefront", async () => {
    vi.mocked(revalidateCache).mockClear();
    const harness = createRemoveHarness(async () => ({ id: "p1" }));

    await expect(harness.service.remove("p1")).resolves.toEqual({ ok: true });
    expect(harness.prisma.product.delete).toHaveBeenCalledWith({
      where: { id: "p1" },
    });
    expect(vi.mocked(revalidateCache)).toHaveBeenCalledWith(["storefront"]);
  });

  it("answers 404 for a missing product before attempting the delete", async () => {
    const prisma = {
      product: {
        findUnique: vi.fn(async () => null),
        delete: vi.fn(async () => undefined),
      },
    };
    const service = new ProductsService(
      prisma as never,
      reviewsStub,
      inventoryStub,
    );

    await expect(service.remove("gone")).rejects.toMatchObject({ status: 404 });
    expect(prisma.product.delete).not.toHaveBeenCalled();
  });

  it("maps a foreign-key block to a readable 409 instead of a generic 500", async () => {
    const harness = createRemoveHarness(async () => {
      throw new Prisma.PrismaClientKnownRequestError(
        "Foreign key constraint violated on the constraint: `inventory_movements_sku_id_fkey`",
        { code: "P2003", clientVersion: "7.10.0" },
      );
    });

    await expect(harness.service.remove("p1")).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        code: "PRODUCT_HAS_HISTORY",
        message: expect.stringContaining("stock, order or marketing history"),
      }),
    });
  });

  it("rethrows unexpected failures untouched", async () => {
    const harness = createRemoveHarness(async () => {
      throw new Error("database exploded");
    });

    await expect(harness.service.remove("p1")).rejects.toThrow(
      "database exploded",
    );
  });
});

describe("ProductsService.bulkSetStatus", () => {
  it("returns a slug conflict instead of a server error for a colliding ACTIVE batch", async () => {
    const violation = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002', clientVersion: '7.10.0',
      meta: { modelName: 'Product', target: ['slug'] },
    });
    const prisma = {
      product: { findMany: vi.fn(async () => [{ id: 'draft-a' }, { id: 'draft-b' }]) },
      $transaction: vi.fn(async () => { throw violation; }),
    };
    const service = new ProductsService(prisma as never, reviewsStub, inventoryStub);

    await expect(service.bulkSetStatus(['draft-a', 'draft-b'], 'ACTIVE')).rejects.toMatchObject({
      response: { code: 'PRODUCT_SLUG_CONFLICT' },
    });
  });

  it("rolls back the entire ACTIVE batch when one product lacks an independent cover", async () => {
    let rows = [
      { id: "ready", name: "Ready", status: "DISABLED", defaultDisplayVariantId: null,
        variants: [{ id: "ready-v", name: "Ready variant", cardMedia: {
          cover: { type: "IMAGE", url: "/uploads/ready.webp", altText: null }, hover: null,
        }, sku: { status: "ACTIVE", price: 0 } }] },
      { id: "missing", name: "Missing", status: "DISABLED", defaultDisplayVariantId: null,
        variants: [{ id: "missing-v", name: "Missing variant", cardMedia: null, sku: { status: "ACTIVE", price: 100 } }] },
    ];
    const before = structuredClone(rows);
    const tx = {
      product: {
        updateMany: vi.fn(async () => { rows.forEach(row => { row.status = "ACTIVE"; }); return { count: rows.length }; }),
        findMany: vi.fn(async () => structuredClone(rows.filter(row => row.status === "ACTIVE"))),
      },
      sku: { findMany: vi.fn(async () => []) },
    };
    const prisma = {
      product: { findMany: vi.fn(async () => rows.map(row => ({ id: row.id }))) },
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => {
        const before = structuredClone(rows);
        try { return await callback(tx); } catch (error) { rows = before; throw error; }
      }),
    };
    const service = new ProductsService(prisma as never, reviewsStub, inventoryStub);
    await expect(service.bulkSetStatus(["ready", "missing"], "ACTIVE")).rejects.toMatchObject({
      response: { code: "PRODUCT_CARD_MEDIA_INCOMPLETE", products: [expect.objectContaining({ productId: "missing" })] },
    });
    expect(rows).toEqual(before);
  });

  it("updates the status of existing products and reports missing ids", async () => {
    vi.mocked(revalidateCache).mockClear();
    const prisma = {
      product: {
        findMany: vi.fn(async () => [{ id: "p1" }, { id: "p2" }]),
        updateMany: vi.fn(async () => ({ count: 2 })),
      },
    };
    const service = new ProductsService(
      prisma as never,
      reviewsStub,
      inventoryStub,
    );

    const result = await service.bulkSetStatus(
      ["p1", "p2", "gone"],
      "DISABLED",
    );

    expect(prisma.product.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["p1", "p2", "gone"] } },
      select: { id: true },
    });
    expect(prisma.product.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["p1", "p2"] } },
      data: { status: "DISABLED" },
    });
    expect(result).toEqual({ updated: 2, notFound: 1 });
    expect(vi.mocked(revalidateCache)).toHaveBeenCalledWith(["storefront"]);
  });

  it("skips the write entirely when no id exists and reports them all missing", async () => {
    const prisma = {
      product: {
        findMany: vi.fn(async () => []),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
    };
    const service = new ProductsService(
      prisma as never,
      reviewsStub,
      inventoryStub,
    );

    const result = await service.bulkSetStatus(["gone"], "ACTIVE");

    expect(prisma.product.updateMany).not.toHaveBeenCalled();
    expect(result).toEqual({ updated: 0, notFound: 1 });
  });

  it("rolls back the batch when a product's virtual SKU has no saved definition", async () => {
    let rows = [
      { id: "bundle-product", name: "Set", status: "DISABLED", defaultDisplayVariantId: null,
        variants: [{ id: "set-v", name: "Single", cardMedia: {
          cover: { type: "IMAGE", url: "/uploads/set.webp", altText: null }, hover: null,
        }, sku: { status: "ACTIVE", price: 2499 } }] },
    ];
    const before = structuredClone(rows);
    const tx = {
      product: {
        updateMany: vi.fn(async () => { rows.forEach(row => { row.status = "ACTIVE"; }); return { count: rows.length }; }),
        findMany: vi.fn(async () => structuredClone(rows.filter(row => row.status === "ACTIVE"))),
      },
      sku: {
        findMany: vi.fn(async () => [{
          id: "bundle-sku", skuCode: "SET", productId: "bundle-product", product: { name: "Set" },
          bundleComponents: [],
        }]),
      },
    };
    const prisma = {
      product: { findMany: vi.fn(async () => rows.map(row => ({ id: row.id }))) },
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => {
        const snapshot = structuredClone(rows);
        try { return await callback(tx); } catch (error) { rows = snapshot; throw error; }
      }),
    };
    const service = new ProductsService(prisma as never, reviewsStub, inventoryStub);
    await expect(service.bulkSetStatus(["bundle-product"], "ACTIVE")).rejects.toMatchObject({
      response: { code: "PRODUCT_BUNDLE_DEFINITION_INCOMPLETE", products: [expect.objectContaining({ productId: "bundle-product" })] },
    });
    expect(rows).toEqual(before);
  });
});
