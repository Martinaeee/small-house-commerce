import { describe, expect, it, vi } from 'vitest';
import { ProductsService } from './products.service.js';

function createPrismaMock(rows: Array<{ id: string }>) {
  return {
    product: {
      // The query forces ACTIVE + id-in; echo rows in the (deliberately
      // shuffled) order the mock holds, so the service must re-sort itself.
      // presentStorefront enriches `variants`; an empty array keeps the
      // fixture minimal without crashing the inventory pipeline.
      findMany: vi.fn(async () => [...rows].reverse().map((row) => ({ ...row, variants: [] }))),
    },
    inventory: {
      groupBy: vi.fn(async () => []),
    },
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
