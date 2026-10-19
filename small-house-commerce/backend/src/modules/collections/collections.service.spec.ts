import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CACHE_TAGS, revalidateCache } from '../../common/revalidation.js';
import { CollectionsService } from './collections.service.js';

vi.mock('../../common/revalidation.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../common/revalidation.js')>(),
  revalidateCache: vi.fn(),
}));

describe('CollectionsService storefront revalidation', () => {
  beforeEach(() => { vi.mocked(revalidateCache).mockReset().mockResolvedValue(undefined); });

  it.each(['create', 'update', 'remove'] as const)('invalidates the storefront only after %s commits', async (operation) => {
    const row = { id: 'collection', slug: 'studio' };
    let committed = false;
    const tx = { collection: { create: vi.fn().mockResolvedValue(row), update: vi.fn().mockResolvedValue(row) } };
    const prisma = {
      collection: {
        findUnique: vi.fn().mockResolvedValue(operation === 'create' ? null : row),
        delete: vi.fn(async () => { committed = true; return row; }),
      },
      $transaction: vi.fn(async (work: (client: typeof tx) => Promise<unknown>) => {
        const result = await work(tx);
        committed = true;
        return result;
      }),
    };
    vi.mocked(revalidateCache).mockImplementation(async () => { expect(committed).toBe(true); });
    const service = new CollectionsService(prisma as never, {} as never);
    const result = operation === 'create'
      ? await service.create({ name: 'Studio', slug: 'studio', type: 'NAVIGATION', status: 'ACTIVE', sortOrder: 0, productIds: [] })
      : operation === 'update' ? await service.update('collection', { status: 'DISABLED' }) : await service.remove('collection');
    expect(result).toEqual(operation === 'remove' ? { id: 'collection' } : row);
    expect(revalidateCache).toHaveBeenCalledExactlyOnceWith([CACHE_TAGS.STOREFRONT]);
  });

  it.each(['create', 'update', 'remove'] as const)('does not invalidate after a failed %s', async (operation) => {
    const failure = new Error('database write failed');
    const prisma = {
      collection: { findUnique: vi.fn().mockResolvedValue(operation === 'create' ? null : { id: 'collection' }), delete: vi.fn().mockRejectedValue(failure) },
      $transaction: vi.fn().mockRejectedValue(failure),
    };
    const service = new CollectionsService(prisma as never, {} as never);
    const request = operation === 'create'
      ? service.create({ name: 'Studio', slug: 'studio', type: 'NAVIGATION', status: 'ACTIVE', sortOrder: 0, productIds: [] })
      : operation === 'update' ? service.update('collection', { status: 'DISABLED' }) : service.remove('collection');
    await expect(request).rejects.toThrow(failure);
    expect(revalidateCache).not.toHaveBeenCalled();
  });
});

describe('CollectionsService.storefrontProducts', () => {
  it('returns the complete storefront product contract in collection membership order', async () => {
    const membershipRows = [
      {
        product: {
          id: 'product-2',
          name: 'Second',
          slug: 'second',
          description: null,
          images: [],
          variants: [],
        },
      },
      {
        product: {
          id: 'product-1',
          name: 'First',
          slug: 'first',
          description: null,
          images: [],
          variants: [],
        },
      },
    ];
    const storefrontProducts = [
      {
        id: 'product-2',
        name: 'Second',
        slug: 'second',
        options: [{ id: 'option-2', values: [] }],
        variants: [],
        images: [],
        reviewCount: 2,
        ratingAverage: 4.5,
        cardMedia: {
          unselected: { cover: { id: 'cover', url: '/cover.webp', type: 'IMAGE', altText: null, sortOrder: 0 }, scene: null },
          variants: [{ variantId: 'variant-2', cover: { id: 'cover', url: '/cover.webp', type: 'IMAGE', altText: null, sortOrder: 0 },
            scene: { id: 'scene', url: '/scene.webp', type: 'IMAGE', altText: 'Room', sortOrder: 1 } }],
        },
      },
      {
        id: 'product-1',
        name: 'First',
        slug: 'first',
        options: [{ id: 'option-1', values: [] }],
        variants: [],
        images: [],
        reviewCount: 0,
        ratingAverage: null,
      },
    ];
    const prisma = {
      collection: {
        findFirst: vi.fn().mockResolvedValue({ id: 'collection-1' }),
      },
      collectionProduct: {
        findMany: vi.fn().mockResolvedValue(membershipRows),
        count: vi.fn().mockResolvedValue(membershipRows.length),
      },
      $transaction: vi
        .fn()
        .mockResolvedValue([membershipRows, membershipRows.length]),
    };
    const products = {
      storefrontByIds: vi.fn().mockResolvedValue(storefrontProducts),
    };

    const service = new CollectionsService(
      prisma as never,
      products as never,
    );

    const result = await service.storefrontProducts('chairs-stools', {
      page: 2,
      pageSize: 2,
      room: 'LIVING_ROOM',
    });

    expect(products.storefrontByIds).toHaveBeenCalledWith([
      'product-2',
      'product-1',
    ]);
    expect(result).toEqual({
      items: storefrontProducts,
      total: 2,
      page: 2,
      pageSize: 2,
    });
  });
});
