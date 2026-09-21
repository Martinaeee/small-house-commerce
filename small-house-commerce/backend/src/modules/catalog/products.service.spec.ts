import { describe, expect, it, vi } from 'vitest';
import type {
  AdminProductQuery,
  StorefrontProductQuery,
} from './dto/product.dto.js';
import { ProductsService } from './products.service.js';

type MockProductRow = { id: string; [key: string]: unknown };

function createPrismaMock(rows: MockProductRow[]) {
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
      findMany: vi.fn(async () => [...hydratedRows].reverse()),
      findFirst: vi.fn(async () => hydratedRows[0] ?? null),
      count: vi.fn(async () => rows.length),
    },
    category: {
      findMany: vi.fn(async () => []),
    },
    inventory: {
      groupBy: vi.fn(async () => []),
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
          variants: expect.objectContaining({
            orderBy: [{ position: 'asc' }, { id: 'asc' }],
          }),
        }),
      }),
    );
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
