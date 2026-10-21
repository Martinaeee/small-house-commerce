import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { ProductsService } from './products.service.js';
import type { UpdateProductInput } from './dto/product.dto.js';
import type { SceneMediaRow } from './product-scene-policy.js';
import { CatalogGraphVersionRequiredError } from './dto/catalog-graph.dto.js';

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

/** Shaped like the real thing: Prisma reports the offending columns in meta.target. */
function p2002(target: string[]) {
  return new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed',
    { code: 'P2002', clientVersion: '7.10.0', meta: { modelName: 'Sku', target } },
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
  variantCreateFails?: 'name' | 'sku_code';
  nameSwapFails?: boolean;
  lockedGraphVersion?: number;
  existingImages?: SceneMediaRow[];
  productWriteError?: unknown;
}

function createHarness(options: HarnessOptions = {}) {
  const {
    existingVariants = [],
    stock = new Map(),
    deleteFails = false,
    skuDeleteFails = false,
    variantCreateFails,
    nameSwapFails = false,
    lockedGraphVersion = 0,
    existingImages = [],
    productWriteError,
  } = options;
  let images = structuredClone(existingImages);

  const updatedProduct = {
    id: 'p1',
    name: 'Chair',
    slug: 'chair',
    images,
    variants: [{ id: 'v1', name: 'Default', position: 0, sku: { id: 'sku1', skuCode: 'CODE-1' } }],
  };

  const tx = {
    $queryRaw: vi.fn(async (query: TemplateStringsArray) => query.join('').includes('catalog_graph_version')
      ? [{ catalog_graph_version: lockedGraphVersion }]
      : [{ value: 1n }]),
    productImage: {
      findMany: vi.fn(async () => structuredClone(images)),
    },
    product: {
      create: vi.fn(async () => updatedProduct),
      update: vi.fn(async ({ data }: { data: { images?: { create: SceneMediaRow[] } } }) => {
        if (productWriteError) throw productWriteError;
        if (data.images) {
          images = data.images.create.map((row, index) => ({
            ...row, id: `image-${index}`, productId: 'p1', optionValueId: null, variantId: null,
          }));
          updatedProduct.images = images;
        }
        return updatedProduct;
      }),
      findUniqueOrThrow: vi.fn(async () => updatedProduct),
    },
    productVariant: {
      findMany: vi.fn(async () => existingVariants),
      create: vi.fn(async (_arg: { data: { name: string } }) => ({ id: 'v-new' })),
      update: vi.fn(async (_arg: { where: { id: string }; data: { name: string } }) => {
        if (nameSwapFails) throw p2002(['product_id', 'name']);
        return { id: 'v1' };
      }),
      delete: vi.fn(async (_arg: { where: { id: string } }) => {
        if (deleteFails) throw p2003();
        return { id: 'v1' };
      }),
      deleteMany: vi.fn(async () => ({ count: existingVariants.length })),
    },
    sku: {
      create: vi.fn(async (_arg: { data: Record<string, unknown> }) => {
        if (variantCreateFails) throw p2002([variantCreateFails]);
        return { id: 'sku-new' };
      }),
      update: vi.fn(async (_arg: { data: Record<string, unknown> }) => ({ id: 'sku1' })),
      delete: vi.fn(async (_arg: { where: { id: string } }) => {
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
    productFaq: {
      findMany: vi.fn(async () => [] as unknown[]),
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

describe('ProductsService legacy scene persistence', () => {
  const storedScene: SceneMediaRow = {
    id: 'old-image', productId: 'p1', optionValueId: null, variantId: null,
    url: '/uploads/scene.webp', type: 'IMAGE', isScene: true,
  };
  const createInput = (images: UpdateProductInput['images']) => ({
    name: 'Chair', slug: 'chair', categoryId: 'c1', status: 'DRAFT' as const,
    solutions: [], detailBlocks: [], variants: [], images: images ?? [],
  });

  it('preserves an omitted scene by URL/type after a legacy reorder', async () => {
    const { service } = createHarness({ existingImages: [storedScene] });
    const result = await service.update('p1', { images: [
      { url: '/uploads/new.webp', type: 'IMAGE', sortOrder: 0 },
      { url: storedScene.url, type: 'IMAGE', sortOrder: 1 },
    ] });
    expect(result?.images.map(row => row.isScene)).toEqual([false, true]);
  });

  it('respects an explicit legacy scene clear', async () => {
    const { service } = createHarness({ existingImages: [storedScene] });
    const result = await service.update('p1', { images: [
      { url: storedScene.url, type: 'IMAGE', sortOrder: 0, isScene: false },
    ] });
    expect(result?.images[0].isScene).toBe(false);
  });

  it('does not carry a scene to a replacement video with the same URL', async () => {
    const { service } = createHarness({ existingImages: [storedScene] });
    const result = await service.update('p1', { images: [
      { url: storedScene.url, type: 'VIDEO', sortOrder: 0 },
    ] });
    expect(result?.images[0].isScene).toBe(false);
  });

  it('deletes all legacy images when images is explicitly empty', async () => {
    const { service } = createHarness({ existingImages: [storedScene] });
    const result = await service.update('p1', { images: [] });
    expect(result?.images).toEqual([]);
  });

  it('does not replace media or lock graph version for a scalar-only update', async () => {
    const { service, tx } = createHarness({ existingImages: [storedScene], lockedGraphVersion: 1 });
    const result = await service.update('p1', { description: 'Edited copy' });
    expect(result?.images[0].isScene).toBe(true);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.productImage.findMany).not.toHaveBeenCalled();
  });

  it.each([
    ['images', { images: [] }],
    ['variants', { variants: [] }],
  ])('rejects a stale legacy %s replacement after graph materialization', async (_label, input) => {
    const { service, tx } = createHarness({ existingImages: [storedScene], lockedGraphVersion: 1 });
    await expect(service.update('p1', input)).rejects.toBeInstanceOf(CatalogGraphVersionRequiredError);
    expect(tx.product.update).not.toHaveBeenCalled();
    expect(tx.productVariant.deleteMany).not.toHaveBeenCalled();
    expect(tx.productImage.findMany).not.toHaveBeenCalled();
  });

  it('rejects ambiguous legacy metadata rather than inheriting by array position', async () => {
    const { service, tx } = createHarness({ existingImages: [storedScene] });
    await expect(service.update('p1', { images: [
      { url: storedScene.url, type: 'IMAGE', sortOrder: 0 },
      { url: storedScene.url, type: 'IMAGE', sortOrder: 1 },
    ] })).rejects.toThrow(/uniquely|ambiguous/i);
    expect(tx.product.update).not.toHaveBeenCalled();
  });

  it('rejects multiple explicit legacy scenes before writing', async () => {
    const { service, tx } = createHarness();
    await expect(service.update('p1', { images: [
      { url: '/uploads/a.webp', type: 'IMAGE', sortOrder: 0, isScene: true },
      { url: '/uploads/b.webp', type: 'IMAGE', sortOrder: 1, isScene: true },
    ] })).rejects.toThrow(/scene/i);
    expect(tx.product.update).not.toHaveBeenCalled();
  });

  it('validates shared scene uniqueness on create too', async () => {
    const { service, tx } = createHarness();
    await expect(service.create(createInput([
      { url: '/uploads/a.webp', type: 'IMAGE', sortOrder: 0, isScene: true },
      { url: '/uploads/b.webp', type: 'IMAGE', sortOrder: 1, isScene: true },
    ]))).rejects.toThrow(/scene/i);
    expect(tx.product.create).not.toHaveBeenCalled();
  });

  it('refuses scene video on a direct create call', async () => {
    const { service, tx } = createHarness();
    await expect(service.create(createInput([
      { url: '/uploads/a.mp4', type: 'VIDEO', sortOrder: 0, isScene: true },
    ]))).rejects.toThrow(/scene.*image/i);
    expect(tx.product.create).not.toHaveBeenCalled();
  });

  it('writes an explicit false scene flag for a new omitted image', async () => {
    const { service, tx } = createHarness();
    await service.create(createInput([{ url: '/uploads/plain.webp', type: 'IMAGE', sortOrder: 0 }]));
    expect(tx.product.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ images: { create: [
        { url: '/uploads/plain.webp', type: 'IMAGE', sortOrder: 0, isScene: false },
      ] } }),
    }));
  });
});

describe('ProductsService scene database errors', () => {
  const knownError = (code: string, modelName: string, cause: Record<string, unknown>) =>
    new Prisma.PrismaClientKnownRequestError('Database write failed', {
      code, clientVersion: '7.10.0', meta: {
        modelName, driverAdapterError: { name: 'DriverAdapterError', cause },
      },
    });

  it.each([
    'product_images_scene_shared_key',
    'product_images_scene_option_value_key',
    'product_images_scene_variant_key',
  ])('maps the actual adapter shape for %s to a readable scene error', async index => {
    const error = knownError('P2002', 'ProductImage', {
      originalCode: '23505', kind: 'UniqueConstraintViolation', constraint: { index }, table: 'product_images',
    });
    const { service } = createHarness({ productWriteError: error });
    const result = await service.update('p1', { description: 'Edited' }).catch(caught => caught);
    expect(result).toBeInstanceOf(BadRequestException);
    expect(result.getResponse()).toMatchObject({ statusCode: 400, message: 'Only one scene image is allowed per media gallery.' });
  });

  it('maps the observed P2039 scene IMAGE check without exposing the failed row', async () => {
    const error = knownError('P2039', 'ProductImage', {
      originalCode: '23514', kind: 'postgres', code: '23514',
      originalMessage: 'new row for relation "product_images" violates check constraint "product_images_scene_image_check"',
      detail: 'Failing row contains private database details.',
    });
    const { service } = createHarness({ productWriteError: error });
    const result = await service.update('p1', { description: 'Edited' }).catch(caught => caught);
    expect(result).toBeInstanceOf(BadRequestException);
    expect(result.getResponse()).toMatchObject({ statusCode: 400, message: 'Scene media must be an image.' });
  });

  it('keeps a SKU uniqueness error as an ordinary conflict', async () => {
    const error = knownError('P2002', 'Sku', {
      constraint: { index: 'skus_sku_code_key' }, kind: 'UniqueConstraintViolation',
    });
    const { service } = createHarness({ productWriteError: error });
    await expect(service.update('p1', { description: 'Edited' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not mislabel another ProductImage check as a scene IMAGE error', async () => {
    const error = knownError('P2039', 'ProductImage', {
      originalCode: '23514', originalMessage: 'violates check constraint "product_images_media_scope_check"',
    });
    const { service } = createHarness({ productWriteError: error });
    await expect(service.update('p1', { description: 'Edited' })).rejects.toBe(error);
  });
});

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

describe('ProductsService SEO persistence', () => {
  it('writes independent SEO fields on update, including explicit null clears', async () => {
    const { service, tx } = createHarness();

    await service.update('p1', {
      seoTitle: 'Compact chair | LUWAG',
      metaDescription: null,
    });

    expect(tx.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1' },
        data: expect.objectContaining({
          seoTitle: 'Compact chair | LUWAG',
          metaDescription: null,
        }),
      }),
    );
  });

  it('writes SEO fields on create without aliasing description or tagline', async () => {
    const { service, tx } = createHarness();

    await service.create({
      name: 'Chair',
      slug: 'chair',
      description: 'Product body',
      tagline: 'Hero copy',
      seoTitle: 'Search title',
      metaDescription: 'Search description',
      categoryId: 'c1',
      status: 'DRAFT',
      solutions: [],
      images: [],
      detailBlocks: [],
      variants: [],
    } as unknown as Parameters<typeof service.create>[0]);

    expect(tx.product.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        description: 'Product body',
        tagline: 'Hero copy',
        seoTitle: 'Search title',
        metaDescription: 'Search description',
      }),
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

  it('rejects a payload that reuses a variant name instead of silently overwriting it', async () => {
    // Two variants called "Default" both resolve to the same stored row, so
    // the second write silently replaced the first: the operator saw "saved"
    // while a variant and its stock had been swallowed. @@unique([productId,
    // name]) forbids it, so say so.
    const { service } = createHarness({ existingVariants: [REFERENCED_VARIANT] });

    await expect(
      service.update('p1', {
        variants: [
          { name: 'Default', position: 0, sku: { skuCode: 'CODE-1' } },
          { name: 'Default', position: 1, sku: { skuCode: 'CODE-2' } },
        ],
      } as UpdateProductInput),
    ).rejects.toThrow(/Default/);
  });

  it('reports a taken SKU code as a SKU problem, not a slug problem', async () => {
    const { service } = createHarness({
      existingVariants: [REFERENCED_VARIANT],
      variantCreateFails: 'sku_code',
    });

    await expect(
      service.update('p1', {
        variants: [
          { name: 'Default', position: 0, sku: { skuCode: 'CODE-1' } },
          { name: 'Black', position: 1, sku: { skuCode: 'TAKEN' } },
        ],
      } as UpdateProductInput),
    ).rejects.toThrow(/SKU code "TAKEN" is already used/);
  });

  it('renames every variant before assigning names, so a swap does not collide', async () => {
    // Swapping two names wrote A->B while B still held it, tripping
    // @@unique([productId, name]). Clearing the names first makes the order
    // irrelevant.
    const { service, tx } = createHarness({
      existingVariants: [
        { id: 'v1', name: 'Alpha', position: 0, sku: { id: 'sku1', skuCode: 'A' } },
        { id: 'v2', name: 'Beta', position: 1, sku: { id: 'sku2', skuCode: 'B' } },
      ],
    });

    await service.update('p1', {
      variants: [
        { name: 'Beta', position: 0, sku: { skuCode: 'A' } },
        { name: 'Alpha', position: 1, sku: { skuCode: 'B' } },
      ],
    } as UpdateProductInput);

    const nameWrites = tx.productVariant.update.mock.calls.map(
      ([arg]) => (arg as { data: { name: string } }).data.name,
    );
    expect(nameWrites).toEqual(['__pending_rename__v1', '__pending_rename__v2', 'Beta', 'Alpha']);
  });

  it('surfaces a variant-name collision as a variant problem, not a slug problem', async () => {
    const { service } = createHarness({
      existingVariants: [
        { id: 'v1', name: 'Alpha', position: 0, sku: { id: 'sku1', skuCode: 'A' } },
        { id: 'v2', name: 'Beta', position: 1, sku: { id: 'sku2', skuCode: 'B' } },
      ],
      nameSwapFails: true,
    });

    await expect(
      service.update('p1', {
        variants: [
          { name: 'Beta', position: 0, sku: { skuCode: 'A' } },
          { name: 'Alpha', position: 1, sku: { skuCode: 'B' } },
        ],
      } as UpdateProductInput),
    ).rejects.toThrow(/Two variants cannot share the name/);
  });
});
