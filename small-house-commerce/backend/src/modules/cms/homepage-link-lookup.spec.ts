import { describe, expect, it, vi } from 'vitest';
import { PrismaLinkLookup } from './homepage-link-lookup.js';

describe('PrismaLinkLookup', () => {
  function makeLookup() {
    const prisma = {
      product: { findMany: vi.fn() },
      collection: { findMany: vi.fn() },
      category: { findMany: vi.fn() },
      productLandingPage: { findMany: vi.fn() },
    };
    return { prisma, lookup: new PrismaLinkLookup(prisma as never) };
  }

  it('resolves navigation targets in typed batches without a global cover requirement', async () => {
    const { prisma, lookup } = makeLookup();
    prisma.category.findMany.mockResolvedValue([{ id: 'shared', name: 'Category', slug: 'category' }]);
    prisma.collection.findMany.mockResolvedValue([{ id: 'shared', name: 'Collection', slug: 'collection' }]);
    const result = await lookup.navigationTargets({ categoryIds: ['shared', 'shared'], collectionIds: ['shared'] });
    expect(result).toEqual(new Map([
      ['CATEGORY:shared', { type: 'CATEGORY', id: 'shared', name: 'Category', slug: 'category' }],
      ['COLLECTION:shared', { type: 'COLLECTION', id: 'shared', name: 'Collection', slug: 'collection' }],
    ]));
    for (const delegate of [prisma.category, prisma.collection]) {
      expect(delegate.findMany).toHaveBeenCalledExactlyOnceWith({ where: { id: { in: ['shared'] }, status: 'ACTIVE' }, select: { id: true, name: true, slug: true } });
    }
  });

  it('does not query empty navigation batches', async () => {
    const { prisma, lookup } = makeLookup();
    await expect(lookup.navigationTargets({ categoryIds: [], collectionIds: [] })).resolves.toEqual(new Map());
    expect(prisma.category.findMany).not.toHaveBeenCalled();
    expect(prisma.collection.findMany).not.toHaveBeenCalled();
  });

  it('deduplicates product ids and returns the stored product statuses', async () => {
    const { prisma, lookup } = makeLookup();
    prisma.product.findMany.mockResolvedValue([
      { id: 'p1', status: 'ACTIVE' },
      { id: 'p2', status: 'DRAFT' },
    ]);

    await expect(lookup.productStatuses(['p1', 'p1', 'p2'])).resolves.toEqual(
      new Map([
        ['p1', 'ACTIVE'],
        ['p2', 'DRAFT'],
      ]),
    );
    expect(prisma.product.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['p1', 'p2'] } },
      select: { id: true, status: true },
    });
  });

  it('resolves entity existence across collections, categories, and landing pages', async () => {
    const { prisma, lookup } = makeLookup();
    prisma.collection.findMany.mockResolvedValue([{ id: 'c1' }]);
    prisma.category.findMany.mockResolvedValue([{ id: 'cat1' }]);
    prisma.productLandingPage.findMany.mockResolvedValue([{ id: 'l1' }]);

    await expect(lookup.collectionExists(['c1', 'c1', 'missing'])).resolves.toEqual(
      new Set(['c1']),
    );
    await expect(lookup.categoryExists(['cat1'])).resolves.toEqual(new Set(['cat1']));
    await expect(lookup.landingExists(['l1'])).resolves.toEqual(new Set(['l1']));

    expect(prisma.collection.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['c1', 'missing'] } },
      select: { id: true },
    });
    expect(prisma.category.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['cat1'] } },
      select: { id: true },
    });
    expect(prisma.productLandingPage.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['l1'] } },
      select: { id: true },
    });
  });

  it('returns slugs for every supported link entity type with deduplicated ids', async () => {
    const { prisma, lookup } = makeLookup();
    prisma.product.findMany.mockResolvedValue([{ id: 'p1', slug: 'chair' }]);
    prisma.collection.findMany.mockResolvedValue([{ id: 'c1', slug: 'chairs' }]);
    prisma.category.findMany.mockResolvedValue([{ id: 'cat1', slug: 'living-room' }]);
    prisma.productLandingPage.findMany.mockResolvedValue([{ id: 'l1', slug: 'ad-chair' }]);

    await expect(lookup.slugs('PRODUCT', ['p1', 'p1'])).resolves.toEqual(
      new Map([['p1', 'chair']]),
    );
    await expect(lookup.slugs('COLLECTION', ['c1'])).resolves.toEqual(
      new Map([['c1', 'chairs']]),
    );
    await expect(lookup.slugs('CATEGORY', ['cat1'])).resolves.toEqual(
      new Map([['cat1', 'living-room']]),
    );
    await expect(lookup.slugs('LANDING', ['l1'])).resolves.toEqual(
      new Map([['l1', 'ad-chair']]),
    );

    expect(prisma.product.findMany).toHaveBeenLastCalledWith({
      where: { id: { in: ['p1'] } },
      select: { id: true, slug: true },
    });
  });

  it('does not query Prisma for empty lookup inputs', async () => {
    const { prisma, lookup } = makeLookup();

    await expect(lookup.productStatuses([])).resolves.toEqual(new Map());
    await expect(lookup.collectionExists([])).resolves.toEqual(new Set());
    await expect(lookup.categoryExists([])).resolves.toEqual(new Set());
    await expect(lookup.landingExists([])).resolves.toEqual(new Set());
    await expect(lookup.slugs('PRODUCT', [])).resolves.toEqual(new Map());

    expect(prisma.product.findMany).not.toHaveBeenCalled();
    expect(prisma.collection.findMany).not.toHaveBeenCalled();
    expect(prisma.category.findMany).not.toHaveBeenCalled();
    expect(prisma.productLandingPage.findMany).not.toHaveBeenCalled();
  });
});
