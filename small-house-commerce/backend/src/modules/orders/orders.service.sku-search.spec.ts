import { describe, expect, it, vi } from 'vitest';
import { InventoryService } from '../inventory/inventory.service.js';
import { OrdersService } from './orders.service.js';

/**
 * The new-order picker lists the sellable SKUs of the whole catalogue: a
 * phone order can buy anything, so the list is not cut down to a handful of
 * rows, and every row carries the photo of the variant.
 */

function createHarness(rows: unknown[] = [], total = 0) {
  const prisma = {
    sku: {
      findMany: vi.fn(async () => rows as never[]),
      count: vi.fn(async () => total),
    },
  };
  const service = new OrdersService(
    prisma as never,
    { releaseForOrder: vi.fn(async () => []) } as unknown as InventoryService,
    { logRisk: vi.fn(async () => {}) } as never,
    { resolve: vi.fn(async () => null) } as never,
    { resolveForCheckout: vi.fn(async () => null) } as never,
    { deliverClaims: vi.fn(async () => undefined) } as never,
  );
  return { service, prisma };
}

const skuRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'sku-1',
  skuCode: 'CH001-B',
  price: '3499',
  variant: {
    id: 'variant-1',
    name: 'Black',
    optionValues: [{ optionValueId: 'value-black' }],
    product: {
      name: "Height-Adjustable Kids Study Chair",
      images: [
        {
          url: '/uploads/black.png',
          type: 'IMAGE',
          optionValueId: 'value-black',
          variantId: null,
          isScene: false,
        },
      ],
    },
  },
  ...overrides,
});

describe('OrdersService.skuSearch', () => {
  it('asks for the whole sellable catalogue, not a handful of rows', async () => {
    const { service, prisma } = createHarness([], 56);

    await service.skuSearch('');

    const call = prisma.sku.findMany.mock.calls[0][0] as { take: number };
    expect(call.take).toBeGreaterThanOrEqual(56);
  });

  it('reports the real number of sellable SKUs next to the rows', async () => {
    const { service } = createHarness([skuRow()], 56);

    const result = await service.skuSearch('');

    expect(result.total).toBe(56);
    expect(result.items).toHaveLength(1);
  });

  it('returns the photo of the variant for every row', async () => {
    const { service } = createHarness([skuRow()], 1);

    const result = await service.skuSearch('');

    expect(result.items[0]).toMatchObject({
      skuId: 'sku-1',
      skuCode: 'CH001-B',
      price: '3499',
      thumbnailUrl: '/uploads/black.png',
      label: "Height-Adjustable Kids Study Chair — Black (CH001-B)",
    });
  });

  it('searches the SKU code, the variant name and the product name', async () => {
    const { service, prisma } = createHarness([], 0);

    await service.skuSearch('black');

    const where = (prisma.sku.findMany.mock.calls[0][0] as {
      where: { OR: Record<string, unknown>[] };
    }).where;
    expect(where.OR).toHaveLength(3);
    expect(where.OR[0]).toHaveProperty('skuCode');
    expect(where.OR[1]).toHaveProperty('variant.name');
    expect(where.OR[2]).toHaveProperty('variant.product.name');
  });

  it('keeps the sellable filter when a term is given', async () => {
    const { service, prisma } = createHarness([], 0);

    await service.skuSearch('chair');

    const where = (prisma.sku.findMany.mock.calls[0][0] as {
      where: {
        status: string;
        price: { not: null };
        variant: { product: { status: string } };
      };
    }).where;
    expect(where.status).toBe('ACTIVE');
    expect(where.price.not).toBeNull();
    expect(where.variant.product.status).toBe('ACTIVE');
  });
});
