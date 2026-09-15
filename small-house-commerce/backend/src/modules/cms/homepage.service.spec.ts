import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { HomepageSectionType as T } from '../../generated/prisma/client.js';
import type { ProductsService } from '../catalog/products.service.js';
import { HomepageService } from './homepage.service.js';

interface JoinRow {
  id: string;
  sectionId: string;
  productId: string;
  sortOrder: number;
  badge: string | null;
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

const join = (sectionId: string, productId: string, sortOrder: number, badge: string | null = null): JoinRow => ({
  id: `j-${sectionId}-${productId}`,
  sectionId,
  productId,
  sortOrder,
  badge,
});

const section = (over: Partial<SectionFixture> & Pick<SectionFixture, 'id' | 'type'>): SectionFixture => ({
  title: null,
  subtitle: null,
  enabled: true,
  sortOrder: 0,
  payload: {},
  products: [],
  ...over,
});

function skuProduct(id: string, availableInventory: number, price: number | null) {
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

function createContext(sections: SectionFixture[]) {
  const productsById = new Map<string, unknown>([
    ['p1', skuProduct('p1', 3, 100)],
    ['p2', skuProduct('p2', 0, 100)],
  ]);

  const products = {
    storefrontByIds: vi.fn(async (ids: string[]) =>
      ids.map((id) => productsById.get(id)).filter(Boolean),
    ),
  } as unknown as ProductsService;

  const tx = {
    homepageSection: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn(async ({ data }: { data: unknown }) => ({ id: 'new-id', ...(data as object) })),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: unknown }) => ({
        id: where.id,
        ...(data as object),
      })),
    },
    homepageSectionProduct: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      createMany: vi.fn(async () => ({ count: 0 })),
    },
  };

  const categoryRows = [
    { id: 'c1', name: 'Bedroom', slug: 'bedroom', imageUrl: 'https://cdn.example.com/c1.jpg' },
    { id: 'c2', name: 'No Image', slug: 'no-image', imageUrl: null },
    { id: 'c3', name: 'Disabled', slug: 'disabled', imageUrl: 'https://cdn.example.com/c3.jpg' },
  ];

  const prisma = {
    homepageSection: {
      // Emulates the storefront where: { enabled: true } predicate; admin
      // callers (no `where.enabled`) receive every section.
      findMany: vi.fn(
        async (args?: { where?: { enabled?: boolean } }) =>
          args?.where?.enabled === true ? sections.filter((s) => s.enabled) : sections,
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
          (c) => c.imageUrl !== null && c.id !== 'c3' && where.id?.in.includes(c.id),
        ),
      ),
    },
    product: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((id) => ({ id })),
      ),
    },
    $transaction: vi.fn(async (cb: (tx: typeof tx) => unknown) => cb(tx)),
  };

  return { prisma, products, tx };
}

describe('HomepageService.storefrontGet', () => {
  it('returns enabled sections in order, hides disabled, filters grids to sellable products with badges', async () => {
    const sections = [
      section({ id: 'hero', type: T.HERO, enabled: false, sortOrder: 0, title: 'H' }),
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
    const grid = result.sections[0];
    expect(grid.products).toHaveLength(1);
    expect(grid.products?.[0]).toMatchObject({ id: 'p1', badge: '新品' });

    const cats = result.sections[1];
    expect(cats.categories?.map((c) => c.id)).toEqual(['c1']);
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
    expect(result.sections[0].products).toHaveLength(2);
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
      section({ id: 'story', type: T.PRODUCT_STORY, payload: { heading: 'Hi', productId: 'p1' } }),
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

    const ugcPayload = result.sections[2].payload as { entries: Array<Record<string, unknown>> };
    expect(ugcPayload.entries[0]).toMatchObject({ name: 'Maria', product: { id: 'p1' } });
    expect('productId' in ugcPayload.entries[0]).toBe(false);
    expect('product' in ugcPayload.entries[1]).toBe(false);
  });
});

describe('HomepageService.saveSections', () => {
  it('rejects creating a second singleton section with 400', async () => {
    const ctx = createContext([section({ id: 'h1', type: T.HERO, sortOrder: 0 })]);
    const service = new HomepageService(ctx.prisma as never, ctx.products);

    await expect(
      service.saveSections({
        sections: [
          { id: 'h1', type: T.HERO, enabled: true, sortOrder: 0 },
          { type: T.HERO, enabled: true, sortOrder: 1 },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ctx.tx.homepageSection.create).not.toHaveBeenCalled();
  });

  it('deletes omitted non-singletons but keeps omitted singleton sections', async () => {
    const ctx = createContext([
      section({ id: 'h1', type: T.HERO, sortOrder: 0 }),
      section({ id: 'g1', type: T.PRODUCT_GRID, sortOrder: 1 }),
    ]);
    const service = new HomepageService(ctx.prisma as never, ctx.products);

    await service.saveSections({
      sections: [{ id: 'h1', type: T.HERO, enabled: false, sortOrder: 2 }],
    });

    expect(ctx.tx.homepageSection.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['g1'] } },
    });
    expect(ctx.tx.homepageSection.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'h1' }, data: expect.objectContaining({ enabled: false, sortOrder: 2 }) }),
    );
  });

  it('rejects payloads that fail per-type validation (UGC > 6 entries)', async () => {
    const ctx = createContext([section({ id: 'u1', type: T.UGC, sortOrder: 0 })]);
    const service = new HomepageService(ctx.prisma as never, ctx.products);

    await expect(
      service.saveSections({
        sections: [
          {
            id: 'u1',
            type: T.UGC,
            enabled: true,
            sortOrder: 0,
            payload: { entries: Array.from({ length: 7 }, () => ({ name: 'n', comment: 'c' })) },
          },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires type when creating and rejects changing an existing type', async () => {
    const ctx = createContext([section({ id: 'h1', type: T.HERO, sortOrder: 0 })]);
    const service = new HomepageService(ctx.prisma as never, ctx.products);

    await expect(
      service.saveSections({ sections: [{ enabled: true, sortOrder: 0 }] }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.saveSections({
        sections: [{ id: 'h1', type: T.USP, enabled: true, sortOrder: 0 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('HomepageService.setSectionProducts', () => {
  it('replaces the whole join list in one transaction', async () => {
    const ctx = createContext([section({ id: 'g1', type: T.PRODUCT_GRID })]);
    const service = new HomepageService(ctx.prisma as never, ctx.products);

    const result = await service.setSectionProducts('g1', {
      rows: [
        { productId: 'p1', sortOrder: 0, badge: '新品' },
        { productId: 'p2', sortOrder: 1 },
      ],
    });

    expect(result).toEqual({ ok: true, count: 2 });
    expect(ctx.tx.homepageSectionProduct.deleteMany).toHaveBeenCalledWith({
      where: { sectionId: 'g1' },
    });
    expect(ctx.tx.homepageSectionProduct.createMany).toHaveBeenCalledWith({
      data: [
        { sectionId: 'g1', productId: 'p1', sortOrder: 0, badge: '新品' },
        { sectionId: 'g1', productId: 'p2', sortOrder: 1, badge: null },
      ],
    });
  });

  it('404s an unknown section', async () => {
    const ctx = createContext([]);
    const service = new HomepageService(ctx.prisma as never, ctx.products);
    await expect(
      service.setSectionProducts('nope', { rows: [] }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects unknown products and duplicate product rows', async () => {
    const ctx = createContext([section({ id: 'g1', type: T.PRODUCT_GRID })]);
    const service = new HomepageService(ctx.prisma as never, ctx.products);

    // Mock only knows p1.
    ctx.prisma.product.findMany.mockResolvedValue([{ id: 'p1' }]);
    await expect(
      service.setSectionProducts('g1', {
        rows: [{ productId: 'p1', sortOrder: 0 }, { productId: 'p2', sortOrder: 1 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.setSectionProducts('g1', {
        rows: [{ productId: 'p1', sortOrder: 0 }, { productId: 'p1', sortOrder: 1 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
