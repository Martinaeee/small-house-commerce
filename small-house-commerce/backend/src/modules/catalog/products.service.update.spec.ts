import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '../../generated/prisma/client.js';
import { ProductsService } from './products.service.js';
import type { UpdateProductInput } from './dto/product.dto.js';

/**
 * Regression cover for the admin save path.
 *
 * Two defects lived here:
 *  1. create()/update() returned the raw Prisma row while list()/get() ran it
 *     through withStock(). The edit form adopts the PATCH response as its new
 *     server truth, so `String(sku.onHand)` became "undefined" after the first
 *     save and the stock validator then blocked every later save client-side.
 *  2. update() replaced the variant list with deleteMany + recreate. SKUs are
 *     referenced by order_items / inventory_movements / inventory_reservations
 *     with onDelete: Restrict, so any product with sales history answered 400
 *     "Referenced record does not exist" — and even without history the new
 *     SKU ids silently orphaned the inventory rows keyed to the old ones.
 */

function p2003() {
  return new Prisma.PrismaClientKnownRequestError(
    'Foreign key constraint violated',
    { code: 'P2003', clientVersion: '7.10.0' },
  );
}

interface HarnessOptions {
  existingVariants?: Array<{
    id: string;
    name: string;
    position: number;
    sku: { id: string; skuCode: string } | null;
  }>;
  stock?: Map<string, { onHand: number; reserved: number; available: number }>;
  deleteFails?: boolean;
  skuDeleteFails?: boolean;
}

function createHarness(options: HarnessOptions = {}) {
  const {
    existingVariants = [],
    stock = new Map(),
    deleteFails = false,
    skuDeleteFails = false,
  } = options;

  const updatedProduct = {
    id: 'p1',
    name: 'Chair',
    slug: 'chair',
    variants: [{ id: 'v1', name: 'Default', position: 0, sku: { id: 'sku1', skuCode: 'CODE-1' } }],
  };

  const tx = {
    product: {
      create: vi.fn(async () => updatedProduct),
      update: vi.fn(async () => updatedProduct),
      findUniqueOrThrow: vi.fn(async () => updatedProduct),
    },
    productVariant: {
      findMany: vi.fn(async () => existingVariants),
      create: vi.fn(async () => ({ id: 'v-new' })),
      update: vi.fn(async () => ({ id: 'v1' })),
      delete: vi.fn(async () => {
        if (deleteFails) throw p2003();
        return { id: 'v1' };
      }),
      deleteMany: vi.fn(async () => ({ count: existingVariants.length })),
    },
    sku: {
      create: vi.fn(async () => ({ id: 'sku-new' })),
      update: vi.fn(async () => ({ id: 'sku1' })),
      delete: vi.fn(async () => {
        if (skuDeleteFails) throw p2003();
        return { id: 'sku1' };
      }),
    },
  };

  const prisma = {
    product: {
      findUnique: vi.fn(async () => ({ id: 'p1' })),
    },
    category: {
      findUnique: vi.fn(async () => ({ id: 'c1' })),
    },
    $transaction: vi.fn(async (arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (t: unknown) => Promise<unknown>)(tx)
        : Promise.all(arg as Promise<unknown>[]),
    ),
  };

  const inventory = { stockBySku: vi.fn(async () => stock) };
  const reviews = { summaryForProducts: vi.fn(async () => new Map()) };

  const service = new ProductsService(
    prisma as never,
    reviews as never,
    inventory as never,
  );

  return { service, prisma, tx, inventory };
}

const REFERENCED_VARIANT = {
  id: 'v1',
  name: 'Default',
  position: 0,
  sku: { id: 'sku1', skuCode: 'CODE-1' },
};

describe('ProductsService.update — stock enrichment', () => {
  it('returns onHand/reserved/availableInventory so the edit form can re-sync', async () => {
    const { service, inventory } = createHarness({
      existingVariants: [REFERENCED_VARIANT],
      stock: new Map([['sku1', { onHand: 7, reserved: 2, available: 5 }]]),
    });

    const result = (await service.update('p1', {
      description: 'edited',
    })) as { variants: Array<{ sku: Record<string, unknown> }> };

    expect(inventory.stockBySku).toHaveBeenCalledWith(['sku1']);
    expect(result.variants[0].sku).toMatchObject({
      id: 'sku1',
      onHand: 7,
      reserved: 2,
      availableInventory: 5,
    });
  });

  it('defaults a SKU with no inventory row to zero rather than dropping the field', async () => {
    const { service } = createHarness({
      existingVariants: [REFERENCED_VARIANT],
      stock: new Map(),
    });

    const result = (await service.update('p1', {
      description: 'edited',
    })) as { variants: Array<{ sku: Record<string, unknown> }> };

    expect(result.variants[0].sku).toMatchObject({
      onHand: 0,
      reserved: 0,
      availableInventory: 0,
    });
  });
});

describe('ProductsService.create — stock enrichment', () => {
  it('returns stock figures on the created product too', async () => {
    const { service } = createHarness({
      stock: new Map([['sku1', { onHand: 3, reserved: 1, available: 2 }]]),
    });

    const result = (await service.create({
      name: 'Chair',
      slug: 'chair',
      categoryId: 'c1',
      images: [],
      detailBlocks: [],
      variants: [],
    } as unknown as Parameters<typeof service.create>[0])) as {
      variants: Array<{ sku: Record<string, unknown> }>;
    };

    expect(result.variants[0].sku).toMatchObject({
      onHand: 3,
      reserved: 1,
      availableInventory: 2,
    });
  });
});

describe('ProductsService.update — variant reconcile', () => {
  it('updates an existing variant and its SKU in place instead of recreating them', async () => {
    const { service, tx } = createHarness({ existingVariants: [REFERENCED_VARIANT] });

    await service.update('p1', {
      variants: [
        { name: 'Default', position: 0, sku: { skuCode: 'CODE-1', price: 150 } },
      ],
    } as UpdateProductInput);

    expect(tx.productVariant.deleteMany).not.toHaveBeenCalled();
    expect(tx.sku.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sku1' } }),
    );
    expect(tx.sku.create).not.toHaveBeenCalled();
    expect(tx.productVariant.create).not.toHaveBeenCalled();
  });

  it('keeps the SKU when the variant is renamed but its SKU code is unchanged', async () => {
    const { service, tx } = createHarness({ existingVariants: [REFERENCED_VARIANT] });

    await service.update('p1', {
      variants: [
        { name: 'Standard', position: 0, sku: { skuCode: 'CODE-1', price: 150 } },
      ],
    } as UpdateProductInput);

    expect(tx.productVariant.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'v1' } }),
    );
    expect(tx.sku.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sku1' } }),
    );
    expect(tx.productVariant.create).not.toHaveBeenCalled();
    expect(tx.productVariant.delete).not.toHaveBeenCalled();
  });

  it('creates a genuinely new variant and leaves the existing one alone', async () => {
    const { service, tx } = createHarness({ existingVariants: [REFERENCED_VARIANT] });

    await service.update('p1', {
      variants: [
        { name: 'Default', position: 0, sku: { skuCode: 'CODE-1' } },
        { name: 'Black', position: 1, sku: { skuCode: 'CODE-2' } },
      ],
    } as UpdateProductInput);

    expect(tx.productVariant.create).toHaveBeenCalledTimes(1);
    expect(tx.sku.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ skuCode: 'CODE-2' }),
      }),
    );
    expect(tx.productVariant.delete).not.toHaveBeenCalled();
  });

  it('removes a variant that is no longer in the payload', async () => {
    const { service, tx } = createHarness({
      existingVariants: [
        REFERENCED_VARIANT,
        { id: 'v2', name: 'Black', position: 1, sku: { id: 'sku2', skuCode: 'CODE-2' } },
      ],
    });

    await service.update('p1', {
      variants: [
        { name: 'Default', position: 0, sku: { skuCode: 'CODE-1' } },
      ],
    } as UpdateProductInput);

    expect(tx.productVariant.delete).toHaveBeenCalledWith({ where: { id: 'v2' } });
    expect(tx.productVariant.delete).not.toHaveBeenCalledWith({ where: { id: 'v1' } });
  });

  it('names the variant that blocks a removal instead of leaking the raw FK error', async () => {
    const { service } = createHarness({
      existingVariants: [
        REFERENCED_VARIANT,
        { id: 'v2', name: 'Black', position: 1, sku: { id: 'sku2', skuCode: 'CODE-2' } },
      ],
      deleteFails: true,
    });

    await expect(
      service.update('p1', {
        variants: [
          { name: 'Default', position: 0, sku: { skuCode: 'CODE-1' } },
        ],
      } as UpdateProductInput),
    ).rejects.toThrow(/Black/);
  });

  it('names the SKU that blocks removal when the operator turns it off', async () => {
    // Dropping a variant's SKU deletes the SKU row — same FK restriction, so
    // it needs the same readable message rather than a raw P2003.
    const { service } = createHarness({
      existingVariants: [REFERENCED_VARIANT],
      skuDeleteFails: true,
    });

    await expect(
      service.update('p1', {
        variants: [{ name: 'Default', position: 0 }],
      } as UpdateProductInput),
    ).rejects.toThrow(/Default/);
  });
});
