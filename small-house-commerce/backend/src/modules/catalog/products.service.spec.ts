import { describe, expect, it, vi } from 'vitest';
import type { StorefrontProductQuery } from './dto/product.dto.js';
import { ProductsService } from './products.service.js';

function createPrismaMock(rows: Array<{ id: string }>) {
  return {
    product: {
      // The query forces ACTIVE + id-in; echo rows in the (deliberately
      // shuffled) order the mock holds, so the service must re-sort itself.
      // presentStorefront enriches `variants`; an empty array keeps the
      // fixture minimal without crashing the inventory pipeline.
      findMany: vi.fn(async () => [...rows].reverse().map((row) => ({ ...row, variants: [] }))),
      count: vi.fn(async () => rows.length),
    },
    inventory: {
      groupBy: vi.fn(async () => []),
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
}

const reviewsStub = {
  summaryForProducts: vi.fn(async () => new Map()),
} as never;

describe('ProductsService.storefrontByIds', () => {
  it('queries ACTIVE products by id and returns them in the requested order', async () => {
    const prisma = createPrismaMock([{ id: 'p1' }, { id: 'p2' }]);
    const service = new ProductsService(prisma as never, reviewsStub);

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
    const service = new ProductsService(prisma as never, reviewsStub);

    const result = await service.storefrontByIds([]);

    expect(result).toEqual([]);
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });
});

describe('ProductsService.storefrontList ids branch', () => {
  it('returns an empty page and runs no catalog queries when ids is present but empty', async () => {
    // `?ids=` preprocesses to [] (the schema enforces no min length): the
    // mere presence of the parameter must short-circuit to an empty page,
    // never fall through to the full paginated catalog.
    const prisma = createPrismaMock([]);
    const service = new ProductsService(prisma as never, reviewsStub);

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
    const service = new ProductsService(prisma as never, reviewsStub);

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
    expect(result.items[0]).toMatchObject({ reviewCount: 0, ratingAverage: null });
  });
});
