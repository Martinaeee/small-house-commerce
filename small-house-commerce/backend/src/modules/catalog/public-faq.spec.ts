import { describe, expect, it, vi } from 'vitest';
import { ProductsService } from './products.service.js';

vi.mock('../../common/revalidation.js', () => ({
  CACHE_TAGS: { STOREFRONT: 'storefront' },
  revalidateCache: vi.fn(async () => undefined),
}));

const SHARED_ITEM = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'How does delivery work?',
  answer: [{ kind: 'paragraph', text: 'We deliver nationwide.' }],
  enabled: true,
  position: 0,
  defaultOpen: true,
};

const PRODUCT_ITEM = {
  id: '22222222-2222-4222-8222-222222222222',
  title: 'Does it fit?',
  answer: [{ kind: 'paragraph', text: 'Yes, it fits small rooms.' }],
  enabled: true,
  position: 0,
  defaultOpen: false,
};

function createService(productFaq: unknown, sharedItems: unknown[]) {
  const product = {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Storage cart',
    slug: 'storage-cart',
    catalogGraphVersion: 0,
    defaultDisplayVariantId: null,
    images: [],
    options: [],
    variants: [],
    detailBlocks: [],
    faq: productFaq,
  };
  const prisma = {
    product: {
      findFirst: vi.fn(async () => product),
    },
    sharedFaqSet: {
      findUnique: vi.fn(async () => ({
        items: sharedItems,
        version: 8,
        updatedByUserId: 'admin-only',
      })),
    },
    inventory: { groupBy: vi.fn(async () => []) },
    productImage: { findMany: vi.fn(async () => []) },
  };
  const reviews = {
    storefrontForProduct: vi.fn(async () => ({
      reviewCount: 0,
      ratingAverage: null,
      reviews: [],
    })),
  };
  const inventory = { availableBySku: vi.fn(async () => new Map()) };
  return {
    service: new ProductsService(
      prisma as never,
      reviews as never,
      inventory as never,
    ),
    prisma,
  };
}

describe('ProductsService public FAQ projection', () => {
  it('serves only effective FAQ items and no editor metadata', async () => {
    const { service } = createService(
      { mode: 'EXTEND', items: [PRODUCT_ITEM], version: 3 },
      [SHARED_ITEM],
    );

    const result = await service.storefrontGetBySlug('storage-cart');

    expect(result.effectiveFaq).toEqual([SHARED_ITEM, PRODUCT_ITEM]);
    expect(result).not.toHaveProperty('faq');
    expect(JSON.stringify(result)).not.toMatch(
      /updatedByUserId|expectedVersion|version/,
    );
  });

  it('returns an empty effective FAQ array when no item is enabled', async () => {
    const { service } = createService(
      {
        mode: 'CUSTOM',
        items: [{ ...PRODUCT_ITEM, enabled: false }],
        version: 4,
      },
      [SHARED_ITEM],
    );

    const result = await service.storefrontGetBySlug('storage-cart');

    expect(result.effectiveFaq).toEqual([]);
  });

  it('does not expose or read the shared library for CUSTOM products', async () => {
    const { service, prisma } = createService(
      { mode: 'CUSTOM', items: [PRODUCT_ITEM], version: 1 },
      [SHARED_ITEM],
    );

    const result = await service.storefrontGetBySlug('storage-cart');

    expect(result.effectiveFaq).toEqual([PRODUCT_ITEM]);
    expect(prisma.sharedFaqSet.findUnique).not.toHaveBeenCalled();
  });

  it('applies a targeted shared question only on its selected products', async () => {
    const thisProduct = {
      ...SHARED_ITEM,
      id: '44444444-4444-4444-8444-444444444444',
      title: 'Only for this cart?',
      position: 1,
      audience: {
        scope: 'PRODUCTS',
        productIds: [
          '33333333-3333-4333-8333-333333333333',
          '55555555-5555-4555-8555-555555555555',
        ],
      },
    };
    const otherProducts = {
      ...SHARED_ITEM,
      id: '66666666-6666-4666-8666-666666666666',
      title: 'Only for another cart?',
      position: 2,
      audience: {
        scope: 'PRODUCTS',
        productIds: [
          '55555555-5555-4555-8555-555555555555',
          '77777777-7777-4777-8777-777777777777',
        ],
      },
    };
    const { service } = createService({ mode: 'SHARED', items: [], version: 1 }, [
      SHARED_ITEM,
      thisProduct,
      otherProducts,
    ]);

    const result = await service.storefrontGetBySlug('storage-cart');

    expect(result.effectiveFaq.map((item) => item.title)).toEqual([
      SHARED_ITEM.title,
      thisProduct.title,
    ]);
    // The audience is admin metadata: the storefront must not receive it.
    expect(JSON.stringify(result)).not.toMatch(/audience|productIds/);
  });
});
