import { describe, expect, it, vi } from 'vitest';
import { HomepageSectionType as T } from '../../generated/prisma/client.js';
import type { ProductsService } from '../catalog/products.service.js';
import { emptyDocument } from './homepage-document.js';
import { signPreviewToken } from './homepage-preview-token.js';
import { HomepageService } from './homepage.service.js';

interface JoinRow {
  id: string;
  sectionId: string;
  productId: string;
  sortOrder: number;
  badge: string | null;
}

// The service returns a discriminated union of per-type section views; tests
// index result rows by position, so view them through this loose shape.
interface StorefrontSectionView {
  id: string;
  type: T;
  payload: unknown;
  products?: Array<{ id: string; badge: string | null }>;
  categories?: Array<{ id: string }>;
}

interface SectionFixture {
  id: string;
  type: T;
  title: string | null;
  subtitle: string | null;
  enabled: boolean;
  sortOrder: number;
  payload: unknown;
  products: JoinRow[];
}

const join = (
  sectionId: string,
  productId: string,
  sortOrder: number,
  badge: string | null = null,
): JoinRow => ({
  id: `j-${sectionId}-${productId}`,
  sectionId,
  productId,
  sortOrder,
  badge,
});

const section = (
  over: Partial<SectionFixture> & Pick<SectionFixture, 'id' | 'type'>,
): SectionFixture => ({
  title: null,
  subtitle: null,
  enabled: true,
  sortOrder: 0,
  payload: {},
  products: [],
  ...over,
});

function skuProduct(
  id: string,
  availableInventory: number,
  price: number | null,
) {
  return {
    id,
    slug: id,
    name: id.toUpperCase(),
    images: [],
    variants: [{ sku: { id: `${id}-sku`, price, availableInventory } }],
    reviewCount: 0,
    ratingAverage: null,
  };
}

function createContext(
  sections: SectionFixture[],
  catalog = new Map<string, unknown>([
    ['p1', skuProduct('p1', 3, 100)],
    ['p2', skuProduct('p2', 0, 100)],
  ]),
) {
  const productsById = catalog;

  const products = {
    storefrontByIds: vi.fn(async (ids: string[]) =>
      ids.map((id) => productsById.get(id)).filter(Boolean),
    ),
  } as unknown as ProductsService;

  const tx = {
    homepageSection: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn(async ({ data }: { data: unknown }) => ({
        id: 'new-id',
        ...(data as object),
      })),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: unknown }) => ({
          id: where.id,
          ...(data as object),
        }),
      ),
    },
    homepageSectionProduct: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      createMany: vi.fn(async () => ({ count: 0 })),
    },
  };

  const categoryRows = [
    {
      id: 'c1',
      name: 'Bedroom',
      slug: 'bedroom',
      imageUrl: 'https://cdn.example.com/c1.jpg',
    },
    { id: 'c2', name: 'No Image', slug: 'no-image', imageUrl: null },
    {
      id: 'c3',
      name: 'Disabled',
      slug: 'disabled',
      imageUrl: 'https://cdn.example.com/c3.jpg',
    },
  ];

  const prisma = {
    homepageSection: {
      // Emulates the storefront where: { enabled: true } predicate; admin
      // callers (no `where.enabled`) receive every section.
      findMany: vi.fn(async (args?: { where?: { enabled?: boolean } }) =>
        args?.where?.enabled === true
          ? sections.filter((s) => s.enabled)
          : sections,
      ),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        sections.some((s) => s.id === where.id) ? { id: where.id } : null,
      ),
      deleteMany: tx.homepageSection.deleteMany,
      create: tx.homepageSection.create,
      update: tx.homepageSection.update,
    },
    homepageSectionProduct: {
      deleteMany: tx.homepageSectionProduct.deleteMany,
      createMany: tx.homepageSectionProduct.createMany,
    },
    category: {
      // Emulates: ACTIVE + non-null imageUrl + id-in.
      findMany: vi.fn(async ({ where }: { where: { id?: { in: string[] } } }) =>
        categoryRows.filter(
          (c) =>
            c.imageUrl !== null && c.id !== 'c3' && where.id?.in.includes(c.id),
        ),
      ),
    },
    product: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((id) => ({ id })),
      ),
    },
    orderItem: {
      groupBy: vi.fn(async () => [] as Array<{ productId: string | null; _sum: { quantity: number | null } }>),
    },
    $transaction: vi.fn(async (cb: (client: typeof tx) => unknown) => cb(tx)),
  };

  return { prisma, products, tx };
}

describe('HomepageService.storefrontGet', () => {
  it('preserves collage identity, presentation and authoritative product hydration', async () => {
    const presentation = { layout: 'COLLAGE', featuredEntryId: 'photo', showQuote: true, overlay: 'STRONG' };
    const ctx = createContext([section({ id: 'ugc', type: T.UGC, payload: { presentation, entries: [{ id: 'photo', name: '', comment: 'Sample quote', imageUrl: '/uploads/e2e/home.jpg', productId: 'p1' }] } })]);
    const result = await new HomepageService(ctx.prisma as never, ctx.products).storefrontGet();
    expect(result.sections[0]).toHaveProperty('payload', { presentation, entries: [expect.objectContaining({ id: 'photo', name: '', comment: 'Sample quote', product: expect.objectContaining({ id: 'p1', slug: 'p1' }) })] });
  });

  it('does not accept a draft-supplied product as an active collage target', async () => {
    const ctx = createContext([section({ id: 'ugc', type: T.UGC, payload: { presentation: { layout: 'COLLAGE', featuredEntryId: 'photo' }, entries: [{ id: 'photo', name: '', comment: 'Sample quote', imageUrl: '/uploads/e2e/home.jpg', productId: 'missing', product: { id: 'missing', name: 'Stale product', slug: 'stale' } }] } })]);
    const result = await new HomepageService(ctx.prisma as never, ctx.products).storefrontGet();
    expect(result.sections[0]).not.toHaveProperty('payload.entries.0.product');
    expect(result.sections[0]).toHaveProperty('payload.entries.0.id', 'photo');
  });

  it('hydrates custom navigation without requiring a global category cover', async () => {
    const id = '00000000-0000-7000-8000-000000000701';
    const entryId = '00000000-0000-7000-8000-000000000702';
    const prisma = {
      homepageSection: { findMany: vi.fn(async () => [section({ id: 'nav', type: T.CATEGORY_TILES, payload: {
        entries: [{ id: entryId, imageUrl: '/uploads/e2e/custom.jpg', link: { type: 'CATEGORY', id } }], presentation: 'CIRCLES',
      } })]) },
      category: { findMany: vi.fn(async () => [{ id, name: 'Storage', slug: 'storage', imageUrl: null }]) },
      collection: { findMany: vi.fn(async () => []) },
    };
    const products = { storefrontByIds: vi.fn(async () => []) };
    const result = await new HomepageService(prisma as never, products as never).storefrontGet();
    expect(result.sections[0]).toHaveProperty('navigationEntries', [{
      id: entryId, name: 'Storage', imageUrl: '/uploads/e2e/custom.jpg', href: '/categories/storage', link: { type: 'CATEGORY', id },
    }]);
    expect(prisma.category.findMany).toHaveBeenCalledWith({ where: { id: { in: [id] }, status: 'ACTIVE' }, select: { id: true, name: true, slug: true } });
  });

  it('batches repeated references across modules once per entity type while preserving entry order', async () => {
    const id = '00000000-0000-7000-8000-000000000701';
    const entryA = '00000000-0000-7000-8000-000000000702';
    const entryB = '00000000-0000-7000-8000-000000000703';
    const entryC = '00000000-0000-7000-8000-000000000704';
    const categoryEntry = { id: entryA, imageUrl: '/uploads/category.jpg', link: { type: 'CATEGORY', id } };
    const prisma = {
      homepageSection: { findMany: vi.fn().mockResolvedValue([
        section({ id: 'first', type: T.CATEGORY_TILES, payload: { entries: [categoryEntry,
          { id: entryB, imageUrl: '/uploads/collection.jpg', link: { type: 'COLLECTION', id } },
          { ...categoryEntry, id: entryC }] } }),
        section({ id: 'second', type: T.CATEGORY_TILES, sortOrder: 10, payload: { entries: [categoryEntry] } }),
      ]) },
      category: { findMany: vi.fn().mockResolvedValue([{ id, name: 'Category', slug: 'category' }]) },
      collection: { findMany: vi.fn().mockResolvedValue([{ id, name: 'Collection', slug: 'collection' }]) },
    };
    const result = await new HomepageService(prisma as never, { storefrontByIds: async () => [] } as never).storefrontGet();
    expect(result.sections[0]).toHaveProperty('navigationEntries', [
      expect.objectContaining({ id: entryA, href: '/categories/category' }),
      expect.objectContaining({ id: entryB, href: '/collections/collection' }),
      expect.objectContaining({ id: entryC, href: '/categories/category' }),
    ]);
    expect(result.sections[1]).toHaveProperty('navigationEntries', [expect.objectContaining({ id: entryA })]);
    expect(prisma.category.findMany).toHaveBeenCalledExactlyOnceWith({ where: { id: { in: [id] }, status: 'ACTIVE' }, select: { id: true, name: true, slug: true } });
    expect(prisma.collection.findMany).toHaveBeenCalledExactlyOnceWith({ where: { id: { in: [id] }, status: 'ACTIVE' }, select: { id: true, name: true, slug: true } });
  });

  it('never falls back to legacy categories after explicitly clearing new entries', async () => {
    const ctx = createContext([section({ id: 'nav', type: T.CATEGORY_TILES, payload: { entries: [], categoryIds: ['c1'] } })]);
    const result = await new HomepageService(ctx.prisma as never, ctx.products).storefrontGet();
    expect(result.sections[0]).toHaveProperty('navigationEntries', []);
    expect(result.sections[0]).not.toHaveProperty('categories');
    expect(ctx.prisma.category.findMany).not.toHaveBeenCalled();
  });

  it('preserves lightweight card media and badges through its single product hydration', async () => {
    const ctx = createContext([section({
      id: 'grid', type: T.PRODUCT_GRID, products: [join('grid', 'p1', 0, 'New')],
    })]);
    ctx.products.storefrontByIds = vi.fn(async () => [{
      ...skuProduct('p1', 3, 100),
      cardMedia: {
        unselected: { cover: { id: 'cover', url: '/cover.webp', type: 'IMAGE', altText: null, sortOrder: 0 }, scene: null },
        variants: [{ variantId: 'v1', cover: { id: 'cover', url: '/cover.webp', type: 'IMAGE', altText: null, sortOrder: 0 },
          scene: { id: 'scene', url: '/scene.webp', type: 'IMAGE', altText: 'Room', sortOrder: 1 } }],
      },
    }]) as never;
    const result = await new HomepageService(ctx.prisma as never, ctx.products).storefrontGet();
    expect(result.sections[0]).toMatchObject({ products: [{
      id: 'p1', badge: 'New', cardMedia: {
        unselected: { cover: { id: 'cover', url: '/cover.webp' }, scene: null },
        variants: [{ variantId: 'v1', scene: { id: 'scene', url: '/scene.webp' } }],
      },
    }] });
    expect(ctx.products.storefrontByIds).toHaveBeenCalledTimes(1);
    expect(ctx.products.storefrontByIds).toHaveBeenCalledWith(['p1']);
  });

  it('returns enabled sections in order, hides disabled, filters grids to sellable products with badges', async () => {
    const sections = [
      section({
        id: 'hero',
        type: T.HERO,
        enabled: false,
        sortOrder: 0,
        title: 'H',
      }),
      section({
        id: 'grid',
        type: T.PRODUCT_GRID,
        sortOrder: 1,
        title: 'Favorites',
        products: [join('grid', 'p1', 0, '新品'), join('grid', 'p2', 1, null)],
      }),
      section({
        id: 'cats',
        type: T.CATEGORY_TILES,
        sortOrder: 2,
        payload: { categoryIds: ['c1', 'c2', 'c3', 'missing'] },
      }),
    ];
    const ctx = createContext(sections);
    const service = new HomepageService(ctx.prisma as never, ctx.products);

    const result = await service.storefrontGet();

    expect(result.sections.map((s) => s.id)).toEqual(['grid', 'cats']);
    const grid = result.sections[0] as StorefrontSectionView;
    expect(grid.products).toHaveLength(1);
    expect(grid.products?.[0]).toMatchObject({ id: 'p1', badge: '新品' });

    const cats = result.sections[1] as StorefrontSectionView;
    expect(cats.categories?.map((c) => c.id)).toEqual(['c1']);
  });

  it('orders a sales grid by recent units sold and keeps each badge with its product', async () => {
    const ctx = createContext(
      [section({
        id: 'grid',
        type: T.PRODUCT_GRID,
        payload: { sortMode: 'SALES' },
        products: [join('grid', 'p1', 0, 'A'), join('grid', 'p2', 1, 'B')],
      })],
      new Map([
        ['p1', skuProduct('p1', 3, 100)],
        ['p2', skuProduct('p2', 3, 100)],
      ]),
    );
    ctx.prisma.orderItem.groupBy.mockResolvedValue([
      { productId: 'p1', _sum: { quantity: 2 } },
      { productId: 'p2', _sum: { quantity: 6 } },
    ] as never);
    const result = await new HomepageService(ctx.prisma as never, ctx.products).storefrontGet();
    const grid = result.sections[0] as StorefrontSectionView;
    expect(grid.products?.map((product) => ({ id: product.id, badge: product.badge }))).toEqual([
      { id: 'p2', badge: 'B' },
      { id: 'p1', badge: 'A' },
    ]);
    expect(ctx.prisma.orderItem.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      by: ['productId'],
      where: {
        productId: { in: ['p1', 'p2'] },
        order: {
          createdAt: { gte: expect.any(Date) },
          orderStatus: { notIn: ['CANCELLED', 'DENIED', 'RETURNED', 'PARTIALLY_RETURNED'] },
        },
      },
    }));
  });

  it('keeps the manual grid order when a sales grid has no sold units yet', async () => {
    const ctx = createContext(
      [section({
        id: 'grid',
        type: T.PRODUCT_GRID,
        payload: { sortMode: 'SALES' },
        products: [join('grid', 'p1', 0, null), join('grid', 'p2', 1, null)],
      })],
      new Map([
        ['p1', skuProduct('p1', 3, 100)],
        ['p2', skuProduct('p2', 3, 100)],
      ]),
    );
    const result = await new HomepageService(ctx.prisma as never, ctx.products).storefrontGet();
    expect((result.sections[0] as StorefrontSectionView).products?.map((product) => product.id))
      .toEqual(['p1', 'p2']);
  });

  it('keeps out-of-stock products in ROOM_INSPIRATION (grid sellability filter is grid-only)', async () => {
    const sections = [
      section({
        id: 'room',
        type: T.ROOM_INSPIRATION,
        products: [join('room', 'p1', 0), join('room', 'p2', 1)],
      }),
    ];
    const ctx = createContext(sections);
    const service = new HomepageService(ctx.prisma as never, ctx.products);

    const result = await service.storefrontGet();
    expect((result.sections[0] as StorefrontSectionView).products).toHaveLength(
      2,
    );
  });

  it('returns empty-payload sections (USP defaults happen on the frontend)', async () => {
    const sections = [section({ id: 'usp', type: T.USP, payload: null })];
    const ctx = createContext(sections);
    const service = new HomepageService(ctx.prisma as never, ctx.products);

    const result = await service.storefrontGet();
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].type).toBe(T.USP);
  });

  it('attaches existing products to story/ugc payloads and drops unresolved productIds', async () => {
    const sections = [
      section({
        id: 'story',
        type: T.PRODUCT_STORY,
        payload: { heading: 'Hi', productId: 'p1' },
      }),
      section({
        id: 'story2',
        type: T.PRODUCT_STORY,
        payload: { heading: 'Ghost', productId: 'px' },
      }),
      section({
        id: 'ugc',
        type: T.UGC,
        payload: {
          entries: [
            { name: 'Maria', comment: 'Great', productId: 'p1' },
            { name: 'Jose', comment: 'Nice', productId: 'px' },
          ],
        },
      }),
    ];
    const ctx = createContext(sections);
    const service = new HomepageService(ctx.prisma as never, ctx.products);

    const result = await service.storefrontGet();
    const payload1 = result.sections[0].payload as Record<string, unknown>;
    expect(payload1.product).toMatchObject({ id: 'p1' });
    expect('productId' in payload1).toBe(false);

    const payload2 = result.sections[1].payload as Record<string, unknown>;
    expect('product' in payload2).toBe(false);

    const ugcPayload = result.sections[2].payload as {
      entries: Array<Record<string, unknown>>;
    };
    expect(ugcPayload.entries[0]).toMatchObject({
      name: 'Maria',
      product: { id: 'p1' },
    });
    expect('productId' in ugcPayload.entries[0]).toBe(false);
    expect('product' in ugcPayload.entries[1]).toBe(false);
  });

  it('hydrates room scene hotspot products with one batched lookup, drops inactive ids, keeps 0-stock ACTIVE', async () => {
    const sections = [
      section({
        id: 'room',
        type: T.ROOM_INSPIRATION,
        payload: {
          scenes: [
            {
              id: 'scene1',
              imageUrl: 'https://cdn.example.com/s1.jpg',
              alt: '客厅',
              hotspots: [
                { productId: 'p1', xPct: 10, yPct: 20 },
                { productId: 'p2', xPct: 30, yPct: 40 },
                { productId: 'p-gone', xPct: 50, yPct: 60 },
              ],
            },
          ],
        },
      }),
    ];
    const ctx = createContext(sections);
    const service = new HomepageService(ctx.prisma as never, ctx.products);

    const result = await service.storefrontGet();
    const payload = result.sections[0].payload as {
      scenes: Array<{
        id: string;
        imageUrl: string;
        alt?: string;
        hotspots: Array<{
          productId: string;
          xPct: number;
          yPct: number;
          product: { id: string };
        }>;
      }>;
    };

    expect(payload.scenes).toHaveLength(1);
    expect(payload.scenes[0]).toMatchObject({
      id: 'scene1',
      imageUrl: 'https://cdn.example.com/s1.jpg',
      alt: '客厅',
    });
    expect(payload.scenes[0].hotspots.map((h) => h.product.id)).toEqual([
      'p1',
      'p2',
    ]);
    expect(payload.scenes[0].hotspots[0]).toMatchObject({
      productId: 'p1',
      xPct: 10,
      yPct: 20,
    });
    // p2 has 0 inventory in the fixture but stays: ROOM_INSPIRATION has no stock gate.
    expect(payload.scenes[0].hotspots[1].product.id).toBe('p2');
    // Join ids and payload ids share the single batched lookup (dedup set).
    expect(ctx.products.storefrontByIds).toHaveBeenCalledTimes(1);
    expect(ctx.products.storefrontByIds).toHaveBeenCalledWith(
      expect.arrayContaining(['p1', 'p2', 'p-gone']),
    );
  });

  it('drops hotspots with non-finite coordinates and dedupes payload ids against join ids', async () => {
    const sections = [
      section({
        id: 'room',
        type: T.ROOM_INSPIRATION,
        payload: {
          scenes: [
            {
              id: 'scene1',
              imageUrl: 'https://cdn.example.com/s1.jpg',
              hotspots: [
                { productId: 'p1', xPct: 5, yPct: 95 },
                { productId: 'p2', xPct: Number.NaN, yPct: 40 },
                { productId: 'p2', xPct: Number.POSITIVE_INFINITY, yPct: 40 },
              ],
            },
          ],
        },
        // p1 also appears as a legacy join row — the lookup must stay single
        // and de-duplicated across both id sources.
        products: [join('room', 'p1', 0)],
      }),
    ];
    const ctx = createContext(sections);
    const service = new HomepageService(ctx.prisma as never, ctx.products);

    const result = await service.storefrontGet();
    const payload = result.sections[0].payload as {
      scenes: Array<{
        hotspots: Array<{ productId: string; product: { id: string } }>;
      }>;
    };

    // Only the well-formed p1 dot survives hydration.
    expect(payload.scenes[0].hotspots.map((h) => h.product.id)).toEqual(['p1']);
    expect(ctx.products.storefrontByIds).toHaveBeenCalledTimes(1);
    const lookupIds = vi.mocked(ctx.products.storefrontByIds).mock.calls[0][0];
    expect([...lookupIds].sort()).toEqual(['p1', 'p2']);
  });

  it('keeps legacy ROOM_INSPIRATION payload byte-for-byte when scenes is absent', async () => {
    const sections = [
      section({
        id: 'room',
        type: T.ROOM_INSPIRATION,
        payload: {
          imageUrl: 'https://cdn.example.com/legacy.jpg',
          heading: 'Old',
          body: 'Text',
        },
        products: [join('room', 'p1', 0)],
      }),
    ];
    const ctx = createContext(sections);
    const service = new HomepageService(ctx.prisma as never, ctx.products);

    const result = await service.storefrontGet();
    expect(result.sections[0].payload).toEqual({
      imageUrl: 'https://cdn.example.com/legacy.jpg',
      heading: 'Old',
      body: 'Text',
    });
  });
});

describe('HomepageService versioned storefront source', () => {
  const PRODUCT_ID = '00000000-0000-7000-8000-000000000101';
  const COLLECTION_ID = '00000000-0000-7000-8000-000000000102';
  const NOW = new Date('2026-09-27T12:00:00.000Z');
  const SECRET = 'homepage-preview-secret';

  function versionedContext(
    effective: unknown,
    draft: unknown = effective,
    draftRev = 7,
  ) {
    const ctx = createContext([]);
    const productsById = new Map<string, unknown>([
      [PRODUCT_ID, skuProduct(PRODUCT_ID, 2, 100)],
    ]);
    ctx.products.storefrontByIds = vi.fn(async (ids: string[]) =>
      ids.map((id) => productsById.get(id)).filter(Boolean),
    ) as never;
    const docs = {
      getEffectiveVersion: vi.fn(async () =>
        effective === null ? null : { document: effective, versionNo: 3 },
      ),
      getDraftForPreview: vi.fn(async () => ({ draft, draftRev })),
    };
    const links = {
      slugs: vi.fn(
        async (_type: string, ids: string[]) =>
          new Map(
            ids.map((id) => [id, id === PRODUCT_ID ? 'chair' : 'living-room']),
          ),
      ),
    };
    const config = { get: vi.fn(() => SECRET) };
    return { ...ctx, docs, links, config };
  }

  function versionedService(ctx: ReturnType<typeof versionedContext>) {
    return new HomepageService(
      ctx.prisma as never,
      ctx.products,
      ctx.docs as never,
      ctx.links as never,
      ctx.config as never,
    );
  }

  it.each([
    { live: 'STUDIO_V3', draft: undefined },
    { live: undefined, draft: 'STUDIO_V3' },
  ] as const)('uses the selected source appearance, not the other document ($live / $draft)', async ({ live, draft }) => {
    const liveDocument = emptyDocument();
    const draftDocument = emptyDocument();
    if (live) liveDocument.appearance = live;
    if (draft) draftDocument.appearance = draft;
    const ctx = versionedContext(liveDocument, draftDocument);
    const service = versionedService(ctx);
    const published = await service.storefrontGet();
    const preview = await service.storefrontGet({ previewToken: signPreviewToken(7, SECRET, new Date()) });
    if (live) expect(published).toHaveProperty('appearance', live);
    else expect(published).not.toHaveProperty('appearance');
    if (draft) expect(preview).toHaveProperty('appearance', draft);
    else expect(preview).not.toHaveProperty('appearance');
  });

  it('serves the effective document, filters scheduled sections and slides, and resolves hero links in one batch', async () => {
    vi.setSystemTime(NOW);
    const document = structuredClone(emptyDocument());
    const hero = document.sections[0];
    const slides = hero.payload.slides as Array<Record<string, unknown>>;
    const active = slides[0];
    (
      active.elements as Record<string, Record<string, unknown>>
    ).ctaPrimary.link = {
      type: 'PRODUCT',
      id: PRODUCT_ID,
    };
    (
      active.elements as Record<string, Record<string, unknown>>
    ).ctaPrimary.text = 'Shop';
    active.sortOrder = 2;
    const future = structuredClone(active);
    future.id = '00000000-0000-7000-8000-000000000011';
    future.sortOrder = 1;
    future.schedule = {
      publishAt: new Date(NOW.getTime() + 1).toISOString(),
      unpublishAt: null,
    };
    const disabled = structuredClone(active);
    disabled.id = '00000000-0000-7000-8000-000000000012';
    disabled.enabled = false;
    disabled.sortOrder = 0;
    hero.payload.slides = [active, future, disabled] as never;

    const hidden = structuredClone(document.sections[0]);
    hidden.id = '00000000-0000-7000-8000-000000000002';
    hidden.type = 'USP';
    hidden.sortOrder = 1;
    hidden.schedule = {
      publishAt: new Date(NOW.getTime() + 1).toISOString(),
      unpublishAt: null,
    };
    hidden.payload = { text: 'future' };
    document.sections.push(hidden);

    const ctx = versionedContext(document);
    const result = await versionedService(ctx).storefrontGet();

    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]).toMatchObject({
      id: hero.id,
      type: T.HERO,
      enabled: true,
    });
    const payload = result.sections[0].payload as {
      slides: Array<Record<string, unknown>>;
    };
    expect(payload.slides.map((slide) => slide.id)).toEqual([active.id]);
    expect(
      (payload.slides[0].elements as Record<string, Record<string, unknown>>)
        .ctaPrimary,
    ).toMatchObject({
      link: { type: 'PRODUCT', id: PRODUCT_ID },
      linkHref: '/products/chair',
    });
    expect(ctx.links.slugs).toHaveBeenCalledTimes(1);
    expect(ctx.links.slugs).toHaveBeenCalledWith('PRODUCT', [PRODUCT_ID]);
    vi.useRealTimers();
  });

  it('treats countdown endsAt as an exclusive storefront boundary', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      const document = structuredClone(emptyDocument());
      const countdown = structuredClone(document.sections[0]);
      countdown.id = '00000000-0000-7000-8000-000000000002';
      countdown.type = 'COUNTDOWN_BANNER' as never;
      countdown.title = 'Ends soon';
      countdown.schedule = { publishAt: NOW.toISOString(), unpublishAt: null };
      countdown.payload = {
        endsAt: new Date(NOW.getTime() + 1).toISOString(),
        ctaText: 'Shop now',
        ctaLink: '/collections/sale',
      };
      countdown.products = [];
      document.sections = [countdown];

      const ctx = versionedContext(document);
      const service = versionedService(ctx);
      const active = await service.storefrontGet();

      expect(active.sections).toHaveLength(1);
      expect(active.sections[0]).toMatchObject({
        type: 'COUNTDOWN_BANNER',
        schedule: countdown.schedule,
      });
      // Banners carry no product joins, so hydration asks for zero ids.
      expect(ctx.products.storefrontByIds).toHaveBeenCalledWith([]);

      countdown.payload = { endsAt: NOW.toISOString() };
      await expect(service.storefrontGet()).resolves.toMatchObject({ sections: [] });

      countdown.payload = {
        endsAt: new Date(NOW.getTime() + 60_000).toISOString(),
      };
      countdown.schedule = {
        publishAt: null,
        unpublishAt: NOW.toISOString(),
      };
      await expect(service.storefrontGet()).resolves.toMatchObject({ sections: [] });
    } finally {
      vi.useRealTimers();
    }
  });

  it('filters an expired countdown from a token-based draft preview', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      const effective = structuredClone(emptyDocument());
      const draft = structuredClone(emptyDocument());
      const countdown = structuredClone(draft.sections[0]);
      countdown.id = '00000000-0000-7000-8000-000000000002';
      countdown.type = 'COUNTDOWN_BANNER' as never;
      countdown.schedule = { publishAt: null, unpublishAt: null };
      countdown.payload = { endsAt: NOW.toISOString() };
      countdown.products = [];
      draft.sections = [countdown];

      const ctx = versionedContext(effective, draft, 7);
      const token = signPreviewToken(7, SECRET, NOW);

      await expect(
        versionedService(ctx).storefrontGet({ previewToken: token }),
      ).resolves.toMatchObject({ sections: [] });
    } finally {
      vi.useRealTimers();
    }
  });

  it('passes persisted non-HERO section styles through the storefront projection', async () => {
    const document = structuredClone(emptyDocument());
    const usp = structuredClone(document.sections[0]);
    usp.id = '00000000-0000-7000-8000-000000000002';
    usp.type = 'USP';
    usp.style = {
      backgroundColor: '#112233',
      textColor: '#fefefe',
      contentWidth: 'NARROW',
      paddingTop: 18,
      paddingBottom: 26,
    };
    document.sections = [usp];

    const result = await versionedService(versionedContext(document)).storefrontGet();

    expect(result.sections[0]).toMatchObject({ style: usp.style });
  });

  it('merges homepage default styles under each section, letting the section override single fields', async () => {
    const document = structuredClone(emptyDocument());
    document.defaults = {
      backgroundColor: '#F2EFE9',
      textColor: '#292724',
      contentWidth: 'STANDARD',
      paddingTop: 40,
      paddingBottom: 40,
    };
    const inherited = structuredClone(document.sections[0]);
    inherited.id = '00000000-0000-7000-8000-000000000002';
    inherited.type = 'USP';
    inherited.payload = {};
    delete inherited.style;
    const overriding = structuredClone(inherited);
    overriding.id = '00000000-0000-7000-8000-000000000003';
    overriding.style = { contentWidth: 'NARROW', paddingTop: 8 };
    document.sections = [inherited, overriding];

    const result = await versionedService(versionedContext(document)).storefrontGet();

    expect(result.sections[0]).toMatchObject({ style: document.defaults });
    expect(result.sections[1]).toMatchObject({
      style: {
        backgroundColor: '#F2EFE9',
        textColor: '#292724',
        contentWidth: 'NARROW',
        paddingTop: 8,
        paddingBottom: 40,
      },
    });
  });

  it('resolves section common above global device fields without losing unrelated overrides', async () => {
    const document = emptyDocument();
    document.defaults = {
      paddingTop: 40,
      overrides: { mobile: { paddingTop: 12, paddingBottom: 10 } },
    };
    document.sections[0].style = { paddingTop: 30, overrides: { mobile: { contentWidth: 'FULL' } } };
    const result = await versionedService(versionedContext(document)).storefrontGet();
    expect(result.sections[0]).toMatchObject({ style: {
      paddingTop: 30,
      overrides: { mobile: { paddingBottom: 10, contentWidth: 'FULL' } },
    } });
  });

  it('omits the style block when neither the section nor the homepage defaults set anything', async () => {
    const document = structuredClone(emptyDocument());
    document.defaults = {};
    const usp = structuredClone(document.sections[0]);
    delete usp.style;
    usp.id = '00000000-0000-7000-8000-000000000002';
    usp.type = 'USP';
    usp.payload = {};
    document.sections = [usp];

    const result = await versionedService(versionedContext(document)).storefrontGet();

    expect(result.sections[0]).not.toHaveProperty('style');
  });

  it('uses document products for non-HERO hydration without querying legacy joins', async () => {
    const document = structuredClone(emptyDocument());
    const grid = structuredClone(document.sections[0]);
    grid.id = '00000000-0000-7000-8000-000000000002';
    grid.type = 'PRODUCT_GRID';
    grid.payload = {};
    grid.products = [
      { productId: PRODUCT_ID, sortOrder: 0, badge: 'Featured' },
    ];
    document.sections = [grid];

    const ctx = versionedContext(document);
    const result = await versionedService(ctx).storefrontGet();

    expect(result.sections[0]).toMatchObject({
      enabled: true,
      type: T.PRODUCT_GRID,
    });
    expect(
      (result.sections[0] as StorefrontSectionView).products,
    ).toMatchObject([{ id: PRODUCT_ID, badge: 'Featured' }]);
    expect(ctx.prisma.homepageSection.findMany).not.toHaveBeenCalled();
  });

  it('uses document product sortOrder for merchandising while filtering unsellable products and keeping badges attached', async () => {
    const SECOND_PRODUCT_ID = '00000000-0000-7000-8000-000000000103';
    const UNSALEABLE_PRODUCT_ID = '00000000-0000-7000-8000-000000000104';
    const document = structuredClone(emptyDocument());
    const grid = structuredClone(document.sections[0]);
    grid.id = '00000000-0000-7000-8000-000000000002';
    grid.type = 'PRODUCT_GRID';
    grid.payload = {};
    grid.products = [
      { productId: PRODUCT_ID, sortOrder: 2, badge: 'Second' },
      { productId: SECOND_PRODUCT_ID, sortOrder: 0, badge: 'First' },
      { productId: UNSALEABLE_PRODUCT_ID, sortOrder: 1, badge: 'Unavailable' },
    ];
    document.sections = [grid];

    const ctx = versionedContext(document);
    ctx.products.storefrontByIds = vi.fn(async (ids: string[]) =>
      ids
        .map((id) => {
          if (id === PRODUCT_ID) return skuProduct(id, 2, 100);
          if (id === SECOND_PRODUCT_ID) return skuProduct(id, 1, 80);
          if (id === UNSALEABLE_PRODUCT_ID) return skuProduct(id, 0, 60);
          return undefined;
        })
        .filter(Boolean),
    ) as never;

    const result = await versionedService(ctx).storefrontGet();

    expect(
      (result.sections[0] as StorefrontSectionView).products,
    ).toMatchObject([
      { id: SECOND_PRODUCT_ID, badge: 'First' },
      { id: PRODUCT_ID, badge: 'Second' },
    ]);
  });

  it('falls back to the legacy homepage sections when no version is effective and normalizes a legacy hero', async () => {
    const sections = [
      section({
        id: 'legacy-hero',
        type: T.HERO,
        title: 'Legacy title',
        payload: { desktopImage: '/uploads/catalog/legacy.jpg' },
      }),
    ];
    const ctx = createContext(sections);
    const docs = { getEffectiveVersion: vi.fn(async () => null) };
    const service = new HomepageService(
      ctx.prisma as never,
      ctx.products,
      docs as never,
    );

    const result = await service.storefrontGet();

    expect(result.sections).toHaveLength(1);
    expect(
      (result.sections[0].payload as Record<string, unknown>).slides,
    ).toHaveLength(1);
    expect(ctx.prisma.homepageSection.findMany).toHaveBeenCalledOnce();
  });

  it('resolves every entity link type in deduplicated batches and leaves missing targets null', async () => {
    const document = structuredClone(emptyDocument());
    const heroPayload = document.sections[0].payload as {
      slides: Array<{ elements: Record<string, Record<string, unknown>> }>;
    };
    const elements = heroPayload.slides[0].elements;
    elements.eyebrow.link = { type: 'PRODUCT', id: PRODUCT_ID };
    elements.heading.link = {
      type: 'CATEGORY',
      id: '00000000-0000-7000-8000-000000000199',
    };
    elements.offer.link = {
      type: 'LANDING',
      id: '00000000-0000-7000-8000-000000000103',
    };
    elements.ctaPrimary.link = {
      type: 'EXTERNAL',
      url: 'https://example.com/sale',
    };
    elements.ctaSecondary.link = { type: 'COLLECTION', id: COLLECTION_ID };
    elements.countdown.link = { type: 'PRODUCT', id: PRODUCT_ID };
    elements.countdown.endsAt = null;

    const originalElements = structuredClone(elements);
    const ctx = versionedContext(document);
    ctx.links.slugs.mockImplementation(
      async (_type: string, ids: string[]) =>
        new Map(
          ids
            .filter((id) => id !== '00000000-0000-7000-8000-000000000199')
            .map((id) => [
              id,
              id === PRODUCT_ID
                ? 'chair'
                : id === COLLECTION_ID
                  ? 'chairs'
                  : 'sale',
            ]),
        ),
    );
    const result = await versionedService(ctx).storefrontGet();
    const outputElements = (
      result.sections[0].payload as { slides: Array<Record<string, unknown>> }
    ).slides[0].elements as Record<string, Record<string, unknown>>;

    expect(outputElements.eyebrow.linkHref).toBe('/products/chair');
    expect(outputElements.heading.linkHref).toBeNull();
    expect(outputElements.offer.linkHref).toBe('/lp/sale');
    expect(outputElements.ctaPrimary.linkHref).toBe('https://example.com/sale');
    expect(outputElements.ctaSecondary.linkHref).toBe('/collections/chairs');
    expect(outputElements.countdown.linkHref).toBeNull();
    expect(ctx.links.slugs).toHaveBeenCalledTimes(4);
    expect(heroPayload.slides[0].elements).toEqual(originalElements);
  });

  it('resolves the whole-slide link and every link zone on a hero slide', async () => {
    const document = structuredClone(emptyDocument());
    const heroPayload = document.sections[0].payload as {
      slides: Array<Record<string, unknown>>;
    };
    const slide = heroPayload.slides[0];
    slide.linkMode = 'SLIDE';
    slide.slideLink = { type: 'COLLECTION', id: COLLECTION_ID };
    slide.zones = [
      {
        id: '00000000-0000-7000-8000-000000000031',
        layout: { xPct: 10, yPct: 20, widthPct: 30, heightPct: 25 },
        link: { type: 'PRODUCT', id: PRODUCT_ID },
        background: { visible: false, color: '#B99B81' },
      },
      {
        id: '00000000-0000-7000-8000-000000000032',
        layout: { xPct: 0, yPct: 0, widthPct: 10, heightPct: 10 },
        link: { type: 'SUBSCRIBE' },
        background: { visible: true, color: '#B99B81' },
      },
    ];

    const ctx = versionedContext(document);
    const result = await versionedService(ctx).storefrontGet();
    const outputSlide = (
      result.sections[0].payload as { slides: Array<Record<string, unknown>> }
    ).slides[0];

    expect(outputSlide.linkMode).toBe('SLIDE');
    expect(outputSlide.slideLinkHref).toBe('/collections/living-room');
    const zones = outputSlide.zones as Array<Record<string, unknown>>;
    expect(zones[0].linkHref).toBe('/products/chair');
    // The subscribe popup is an action, not a URL: it keeps its type and
    // resolves to no href.
    expect(zones[1].linkHref).toBeNull();
    expect((zones[1].link as Record<string, unknown>).type).toBe('SUBSCRIBE');
  });

  it('filters and resolves announcement items, while preserving sort order and input immutability', async () => {
    vi.setSystemTime(NOW);
    const document = structuredClone(emptyDocument());
    document.announcement = {
      enabled: true,
      rotationMs: 5000,
      items: [
        {
          id: '00000000-0000-7000-8000-000000000021',
          text: 'Collection',
          link: { type: 'COLLECTION', id: COLLECTION_ID },
          linkLabel: 'Shop',
          textColor: '#292724',
          backgroundColor: '#F2EFE9',
          schedule: { publishAt: null, unpublishAt: null },
          enabled: true,
          sortOrder: 2,
        },
        {
          id: '00000000-0000-7000-8000-000000000022',
          text: 'Future',
          link: null,
          linkLabel: null,
          textColor: '#292724',
          backgroundColor: '#F2EFE9',
          schedule: {
            publishAt: new Date(NOW.getTime() + 1).toISOString(),
            unpublishAt: null,
          },
          enabled: true,
          sortOrder: 1,
        },
      ],
    };
    const original = structuredClone(document);
    const ctx = versionedContext(document);
    const result = await versionedService(ctx).storefrontGetAnnouncement();

    expect(result).toEqual({
      enabled: true,
      rotationMs: 5000,
      items: [
        expect.objectContaining({
          text: 'Collection',
          link: { type: 'COLLECTION', id: COLLECTION_ID },
          linkHref: '/collections/living-room',
        }),
      ],
    });
    expect(document).toEqual(original);
    expect(ctx.links.slugs).toHaveBeenCalledWith('COLLECTION', [COLLECTION_ID]);
    vi.useRealTimers();
  });

  it('removes announcement countdowns at their exact deadline for live and preview sources', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      const document = structuredClone(emptyDocument());
      const richContent = {
        version: 1 as const,
        doc: {
          type: 'doc' as const,
          content: [
            {
              type: 'paragraph' as const,
              attrs: { textAlign: 'center' as const },
              content: [{ type: 'text' as const, text: 'Rich active' }],
            },
          ],
        },
      };
      document.announcement = {
        enabled: true,
        rotationMs: 5000,
        items: [
          {
            id: '00000000-0000-7000-8000-000000000023',
            text: 'Expired',
            link: null,
            linkLabel: null,
            textColor: '#292724',
            backgroundColor: '#F2EFE9',
            schedule: { publishAt: null, unpublishAt: null },
            countdown: {
              endsAt: NOW.toISOString(),
              color: null,
              fontFamily: 'SANS',
              fontSize: 'MD',
              fontWeight: 700,
            },
            enabled: true,
            sortOrder: 0,
          },
          {
            id: '00000000-0000-7000-8000-000000000024',
            text: 'Rich active',
            content: richContent,
            link: { type: 'COLLECTION', id: COLLECTION_ID },
            linkLabel: 'Shop now',
            textColor: '#292724',
            backgroundColor: '#F2EFE9',
            schedule: { publishAt: null, unpublishAt: null },
            countdown: {
              endsAt: new Date(NOW.getTime() + 1000).toISOString(),
              color: '#FFFFFF',
              fontFamily: 'POPPINS',
              fontSize: 'LG',
              fontWeight: 800,
            },
            enabled: true,
            sortOrder: 1,
          },
          {
            id: '00000000-0000-7000-8000-000000000025',
            text: 'Legacy sibling',
            link: null,
            linkLabel: null,
            textColor: '#292724',
            backgroundColor: '#F2EFE9',
            schedule: { publishAt: null, unpublishAt: null },
            enabled: true,
            sortOrder: 2,
          },
        ],
      };
      const original = structuredClone(document);
      const ctx = versionedContext(document);
      const service = versionedService(ctx);

      const live = await service.storefrontGetAnnouncement();
      const preview = await service.storefrontGetAnnouncement({
        previewToken: signPreviewToken(7, SECRET, NOW),
      });

      for (const result of [live, preview]) {
        expect(result?.items.map((item) => item.id)).toEqual([
          '00000000-0000-7000-8000-000000000024',
          '00000000-0000-7000-8000-000000000025',
        ]);
        expect(result?.items[0]).toMatchObject({
          text: 'Rich active',
          content: richContent,
          schedule: { publishAt: null, unpublishAt: null },
          countdown: {
            endsAt: new Date(NOW.getTime() + 1000).toISOString(),
            color: '#FFFFFF',
            fontFamily: 'POPPINS',
            fontSize: 'LG',
            fontWeight: 800,
          },
          linkHref: '/collections/living-room',
        });
      }
      expect(document).toEqual(original);
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns null when the announcement block is disabled or has no active items', async () => {
    const document = structuredClone(emptyDocument());
    const ctx = versionedContext(document);
    const service = versionedService(ctx);

    await expect(service.storefrontGetAnnouncement()).resolves.toBeNull();

    document.announcement = {
      enabled: true,
      rotationMs: 5000,
      items: [],
    };
    await expect(service.storefrontGetAnnouncement()).resolves.toBeNull();
  });

  it('serves a matching preview draft and rejects malformed or stale preview tokens', async () => {
    vi.setSystemTime(NOW);
    const effective = structuredClone(emptyDocument());
    effective.sections[0].title = 'Published';
    const draft = structuredClone(emptyDocument());
    draft.sections[0].title = 'Draft';
    const ctx = versionedContext(effective, draft, 7);
    const service = versionedService(ctx);
    const token = signPreviewToken(7, SECRET, NOW);

    await expect(
      service.storefrontGet({ previewToken: token }),
    ).resolves.toMatchObject({
      sections: [expect.objectContaining({ title: 'Draft' })],
    });
    expect(ctx.docs.getEffectiveVersion).not.toHaveBeenCalled();

    await expect(
      service.storefrontGet({ previewToken: 'malformed' }),
    ).rejects.toMatchObject({ status: 404 });

    const mismatch = signPreviewToken(6, SECRET, NOW);
    await expect(
      service.storefrontGet({ previewToken: mismatch }),
    ).rejects.toMatchObject({ status: 404 });
    expect(ctx.docs.getEffectiveVersion).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
