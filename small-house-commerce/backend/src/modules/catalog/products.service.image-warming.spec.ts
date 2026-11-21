import { describe, expect, it, vi } from 'vitest';
import { ProductsService } from './products.service.js';

/**
 * Publishing a product must pre-warm the image optimizer, otherwise the
 * first phone to open the new PDP asks the box for every rendition at once
 * from cold (measured: the tail waited 19s, Safari gave up and rendered
 * broken images). These tests pin the write paths that must trigger the
 * warm and the ones that must stay cheap.
 */
vi.mock('../../common/revalidation.js', () => ({
  CACHE_TAGS: { STOREFRONT: 'storefront' },
  revalidateCache: vi.fn(async () => undefined),
}));

const warming = vi.hoisted(() => ({ warmProductImages: vi.fn(async () => undefined) }));
vi.mock('../../common/image-warming.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../common/image-warming.js')>();
  return { ...actual, warmProductImages: warming.warmProductImages };
});

const sharedImage = {
  id: 'i1',
  url: '/uploads/catalog/2026/gallery.png',
  type: 'IMAGE',
  altText: null,
  sortOrder: 0,
  optionValueId: null,
  variantId: null,
};
const scopedImage = {
  id: 'i2',
  url: '/uploads/catalog/2026/scoped.png',
  type: 'IMAGE',
  altText: null,
  sortOrder: 1,
  optionValueId: 'value-1',
  variantId: null,
};
const detailBlock = {
  id: 'd1',
  url: '/uploads/catalog/2026/detail.png',
  type: 'IMAGE',
  altText: null,
  sortOrder: 0,
  optionValueId: null,
  variantId: null,
  groupKey: null,
};

function createHarness(product: Record<string, unknown>) {
  const tx = {
    $queryRaw: vi.fn(async () => [{ catalog_graph_version: 0, value: 1n }]),
    product: {
      create: vi.fn(async () => product),
      update: vi.fn(async () => product),
      findUniqueOrThrow: vi.fn(async () => product),
      findMany: vi.fn(async () => [] as unknown[]),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    productImage: { findMany: vi.fn(async () => []) },
    sku: { findMany: vi.fn(async () => [] as unknown[]) },
  };

  const prisma = {
    product: {
      findUnique: vi.fn(async () => ({ id: 'p1', catalogGraphVersion: 0 })),
      findMany: vi.fn(async () => [{ id: 'p1' }]),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    category: { findUnique: vi.fn(async () => ({ id: 'c1' })) },
    productFaq: { findMany: vi.fn(async () => [] as unknown[]) },
    sharedFaqSet: { findUnique: vi.fn(async () => null) },
    $transaction: vi.fn(async (arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (t: unknown) => Promise<unknown>)(tx)
        : Promise.all(arg as Promise<unknown>[]),
    ),
  };

  const service = new ProductsService(
    prisma as never,
    { summaryForProducts: vi.fn(async () => new Map()) } as never,
    { stockBySku: vi.fn(async () => new Map()) } as never,
  );

  return { service, prisma, tx };
}

const ACTIVE_PRODUCT = {
  id: 'p1',
  name: 'Pet Station',
  slug: 'pet-station',
  status: 'ACTIVE',
  images: [sharedImage, scopedImage],
  detailBlocks: [detailBlock],
  variants: [],
  options: [],
  reviews: [],
};

const DRAFT_PRODUCT = { ...ACTIVE_PRODUCT, status: 'DRAFT' };

describe('ProductsService image warming', () => {
  it('warms gallery and detail images after an update that replaces media', async () => {
    warming.warmProductImages.mockClear();
    const { service } = createHarness(ACTIVE_PRODUCT);

    await service.update('p1', {
      images: [{ url: sharedImage.url, type: 'IMAGE', sortOrder: 0 }],
      detailBlocks: [{ url: detailBlock.url, type: 'IMAGE', sortOrder: 0 }],
    });

    expect(warming.warmProductImages).toHaveBeenCalledTimes(1);
    expect(warming.warmProductImages).toHaveBeenCalledWith([
      sharedImage.url,
      scopedImage.url,
      detailBlock.url,
    ]);
  });

  it('does not warm on a scalar-only edit', async () => {
    warming.warmProductImages.mockClear();
    const { service } = createHarness(ACTIVE_PRODUCT);

    await service.update('p1', { description: 'Edited copy' });

    expect(warming.warmProductImages).not.toHaveBeenCalled();
  });

  it('warms when an update publishes the product', async () => {
    warming.warmProductImages.mockClear();
    const { service } = createHarness(ACTIVE_PRODUCT);

    await service.update('p1', { status: 'ACTIVE' });

    expect(warming.warmProductImages).toHaveBeenCalledTimes(1);
  });

  it('does not warm an update that leaves the product unpublished', async () => {
    warming.warmProductImages.mockClear();
    const { service } = createHarness(DRAFT_PRODUCT);

    await service.update('p1', {
      images: [{ url: sharedImage.url, type: 'IMAGE', sortOrder: 0 }],
    });

    expect(warming.warmProductImages).not.toHaveBeenCalled();
  });

  it('warms after a create that publishes the product', async () => {
    warming.warmProductImages.mockClear();
    const { service } = createHarness(ACTIVE_PRODUCT);

    await service.create({
      name: 'Pet Station',
      slug: 'pet-station',
      categoryId: '11111111-1111-1111-1111-111111111111',
      status: 'ACTIVE',
      solutions: [],
      images: [{ url: sharedImage.url, type: 'IMAGE', sortOrder: 0 }],
      detailBlocks: [],
      variants: [],
    } as never);

    expect(warming.warmProductImages).toHaveBeenCalledTimes(1);
  });

  it('warms the media of products bulk-published from the list', async () => {
    warming.warmProductImages.mockClear();
    const { service, prisma } = createHarness(ACTIVE_PRODUCT);
    prisma.product.findMany = vi.fn(async () => [
      {
        id: 'p1',
        status: 'ACTIVE',
        images: [{ url: sharedImage.url, type: 'IMAGE' }],
        detailBlocks: [{ url: detailBlock.url, type: 'IMAGE' }],
      },
    ]);

    await service.bulkSetStatus(['p1'], 'ACTIVE');

    expect(warming.warmProductImages).toHaveBeenCalledWith([
      sharedImage.url,
      detailBlock.url,
    ]);
  });

  it('does not warm when bulk-disabling', async () => {
    warming.warmProductImages.mockClear();
    const { service } = createHarness(ACTIVE_PRODUCT);

    await service.bulkSetStatus(['p1'], 'DISABLED');

    expect(warming.warmProductImages).not.toHaveBeenCalled();
  });
});
