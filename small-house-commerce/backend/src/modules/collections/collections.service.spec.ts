import { describe, expect, it, vi } from 'vitest';
import { CollectionsService } from './collections.service.js';

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
