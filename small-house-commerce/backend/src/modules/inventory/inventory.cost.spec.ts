import { describe, expect, it, vi } from 'vitest';
import { InventoryService } from './inventory.service.js';

/**
 * The cost-backfill grid is the operator's way to make the dashboard's
 * profit numbers real: without a landed cost on a SKU, the profit column
 * stays withheld. These tests pin the grid's rows and the settled batch
 * write.
 */
function makeService(overrides: {
  skus?: unknown[];
  stock?: unknown[];
  sales?: unknown[];
  update?: (...args: unknown[]) => unknown;
} = {}) {
  const prisma = {
    sku: {
      findMany: vi.fn().mockResolvedValue(overrides.skus ?? []),
      update: vi.fn().mockImplementation(overrides.update ?? (() => ({}))),
    },
    inventory: { groupBy: vi.fn().mockResolvedValue(overrides.stock ?? []) },
    orderItem: { groupBy: vi.fn().mockResolvedValue(overrides.sales ?? []) },
  };
  const service = new InventoryService(prisma as never, {} as never);
  return { prisma, service };
}

describe('InventoryService.costRows', () => {
  it('joins the SKU, its stock and its 30-day sales', async () => {
    const { service } = makeService({
      skus: [
        {
          id: 'sku-1',
          skuCode: 'CART-WH-03',
          supplierCost: { toFixed: () => '400.00' },
          landedCost: { toFixed: () => '520.50' },
          costCurrency: 'PHP',
          productId: 'product-1',
          product: { name: '3-Tier Rolling Cart' },
          variant: { name: 'White' },
        },
      ],
      stock: [{ skuId: 'sku-1', _sum: { onHand: 12, reserved: 2 } }],
      sales: [{ skuId: 'sku-1', _sum: { quantity: 28 } }],
    });

    const rows = await service.costRows();

    expect(rows).toEqual([
      {
        skuId: 'sku-1',
        skuCode: 'CART-WH-03',
        productId: 'product-1',
        productName: '3-Tier Rolling Cart',
        variantName: 'White',
        supplierCost: 400,
        landedCost: 520.5,
        costCurrency: 'PHP',
        onHand: 12,
        reserved: 2,
        available: 10,
        unitsSold30d: 28,
      },
    ]);
  });

  it('reports a SKU with no stock row as zero rather than failing', async () => {
    const { service } = makeService({
      skus: [
        {
          id: 'sku-2',
          skuCode: 'CHAIR-SD-01',
          supplierCost: null,
          landedCost: null,
          costCurrency: null,
          productId: 'product-2',
          product: { name: 'Folding Chair' },
          variant: { name: 'Sand' },
        },
      ],
    });

    const rows = await service.costRows();

    expect(rows[0]).toMatchObject({
      onHand: 0,
      reserved: 0,
      available: 0,
      unitsSold30d: 0,
      supplierCost: null,
      landedCost: null,
    });
  });
});

describe('InventoryService.setCosts', () => {
  it('writes only the fields the caller sent', async () => {
    const update = vi.fn().mockResolvedValue({
      landedCost: { toFixed: () => '520.50' },
      supplierCost: { toFixed: () => '400.00' },
      costCurrency: 'PHP',
    });
    const { prisma, service } = makeService({ update });

    const results = await service.setCosts([
      { skuId: 'sku-1', landedCost: 520.5, supplierCost: 400, costCurrency: 'PHP' },
    ]);

    const data = prisma.sku.update.mock.calls[0][0].data;
    expect(Object.keys(data).sort()).toEqual(['costCurrency', 'landedCost', 'supplierCost']);
    expect(results).toEqual([
      {
        skuId: 'sku-1',
        ok: true,
        landedCost: 520.5,
        supplierCost: 400,
        costCurrency: 'PHP',
      },
    ]);
  });

  it('leaves an omitted field untouched', async () => {
    const update = vi.fn().mockResolvedValue({
      landedCost: { toFixed: () => '99.00' },
      supplierCost: null,
      costCurrency: null,
    });
    const { prisma, service } = makeService({ update });

    await service.setCosts([{ skuId: 'sku-1', landedCost: 99 }]);

    const data = prisma.sku.update.mock.calls[0][0].data;
    expect(Object.keys(data)).toEqual(['landedCost']);
  });

  it('keeps a failing row from aborting the rest of the batch', async () => {
    const update = vi
      .fn()
      .mockRejectedValueOnce(new Error('SKU not found'))
      .mockResolvedValueOnce({
        landedCost: { toFixed: () => '10.00' },
        supplierCost: null,
        costCurrency: null,
      });
    const { service } = makeService({ update });

    const results = await service.setCosts([
      { skuId: 'missing', landedCost: 1 },
      { skuId: 'sku-2', landedCost: 10 },
    ]);

    expect(results[0]).toEqual({ skuId: 'missing', ok: false, error: 'SKU not found' });
    expect(results[1]).toMatchObject({ skuId: 'sku-2', ok: true, landedCost: 10 });
  });
});
