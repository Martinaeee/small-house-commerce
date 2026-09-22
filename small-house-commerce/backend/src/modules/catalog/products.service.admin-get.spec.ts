import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { CatalogGraphService } from './catalog-graph.service.js';
import type { AdminProduct } from './catalog-graph.service.js';

/**
 * The service returns the Prisma snapshot with withStock()'s live stock
 * figures merged onto every SKU; the spec reads them through this shape.
 */
type EnrichedAdminProduct = AdminProduct & {
  variants: Array<{
    optionValues?: unknown;
    sku: Record<string, unknown> | null;
  }>;
};
import { ProductsService } from './products.service.js';

vi.mock('../../common/revalidation.js', () => ({
  CACHE_TAGS: { STOREFRONT: 'storefront' },
  revalidateCache: vi.fn(async () => undefined),
}));

/**
 * Task 20: the standing T10/T11 gap — the admin product GET (and every
 * update() response the edit form adopts as server truth) must carry the
 * typed option graph for graph products (catalogGraphVersion > 0):
 * options/values, variant option assignments, and the full scoped media set.
 * Graph-v0 legacy products keep the legacy-only payload so their variants
 * still edit through the legacy form.
 */

const PRODUCT_ID = '00000000-0000-4000-8000-000000000001';
const COLOR_OPTION_ID = '10000000-0000-4000-8000-000000000001';
const RED_VALUE_ID = '20000000-0000-4000-8000-000000000001';
const RED_VARIANT_ID = '30000000-0000-4000-8000-000000000001';
const RED_SKU_ID = '40000000-0000-4000-8000-000000000001';
const SHARED_MEDIA_ID = '50000000-0000-4000-8000-000000000001';
const SCOPED_MEDIA_ID = '50000000-0000-4000-8000-000000000002';

/** A row as ADMIN_PRODUCT_INCLUDE returns it: no options, no media key. */
function legacyAdminRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PRODUCT_ID,
    name: 'Test chair',
    slug: 'test-chair',
    catalogGraphVersion: 0,
    defaultDisplayVariantId: null,
    images: [
      {
        id: SHARED_MEDIA_ID,
        url: '/uploads/shared.svg',
        type: 'IMAGE',
        altText: null,
        sortOrder: 0,
        optionValueId: null,
        variantId: null,
      },
    ],
    detailBlocks: [],
    variants: [
      {
        id: RED_VARIANT_ID,
        name: 'Red',
        position: 0,
        combinationKey: '__legacy_unmapped__:30000000-0000-4000-8000-000000000001',
        optionValues: undefined,
        sku: {
          id: RED_SKU_ID,
          skuCode: 'E2E-1',
          status: 'ACTIVE',
          price: '1299',
          onHand: undefined,
        },
      },
    ],
    ...overrides,
  };
}

/** A row as CatalogGraphService snapshots it: full typed graph. */
function graphSnapshotRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PRODUCT_ID,
    name: 'Test chair',
    slug: 'test-chair',
    catalogGraphVersion: 2,
    defaultDisplayVariantId: RED_VARIANT_ID,
    images: [
      {
        id: SHARED_MEDIA_ID,
        url: '/uploads/shared.svg',
        type: 'IMAGE',
        altText: null,
        sortOrder: 0,
        optionValueId: null,
        variantId: null,
      },
      {
        id: SCOPED_MEDIA_ID,
        url: '/uploads/red.svg',
        type: 'IMAGE',
        altText: 'Red',
        sortOrder: 0,
        optionValueId: RED_VALUE_ID,
        variantId: null,
      },
    ],
    detailBlocks: [],
    options: [
      {
        id: COLOR_OPTION_ID,
        kind: 'COLOR',
        name: 'Color',
        position: 0,
        presentation: 'SWATCH',
        isMediaDriver: true,
        isActive: true,
        values: [
          {
            id: RED_VALUE_ID,
            label: 'Red',
            position: 0,
            swatchHex: '#ff0000',
            thumbnailUrl: null,
            thumbnailAlt: null,
            isActive: true,
          },
        ],
      },
    ],
    variants: [
      {
        id: RED_VARIANT_ID,
        name: 'Red',
        position: 0,
        combinationKey: `${COLOR_OPTION_ID}:${RED_VALUE_ID}`,
        optionValues: [{ optionId: COLOR_OPTION_ID, optionValueId: RED_VALUE_ID }],
        sku: {
          id: RED_SKU_ID,
          skuCode: 'E2E-1',
          status: 'ACTIVE',
          price: '1299',
        },
      },
    ],
    ...overrides,
  };
}

const STOCK = new Map([
  [RED_SKU_ID, { onHand: 7, reserved: 2, available: 5 }],
]);

function catalogGraphOver(productRow: Record<string, unknown> | null) {
  return new CatalogGraphService({
    product: { findUnique: vi.fn(async () => productRow) },
  } as never);
}

function createService(
  productRow: Record<string, unknown> | null,
  graph?: CatalogGraphService,
) {
  const prisma = {
    product: {
      findUnique: vi.fn(async () => productRow),
      findUniqueOrThrow: vi.fn(async () => productRow),
    },
  };
  const service = new ProductsService(
    prisma as never,
    { summaryForProducts: vi.fn(async () => new Map()) } as never,
    { stockBySku: vi.fn(async () => STOCK) } as never,
    graph,
  );
  return { service, prisma };
}

describe('ProductsService.get typed graph presentation', () => {
  it('returns the typed option graph for a graph product', async () => {
    // The real CatalogGraphService loads the snapshot (findUnique stubbed):
    // the typed graph arrives with the real images/media split applied.
    const graph = catalogGraphOver(graphSnapshotRow());
    const adminSnapshot = vi.spyOn(graph, 'adminSnapshot');
    const { service } = createService(
      legacyAdminRow({ catalogGraphVersion: 2 }),
      graph,
    );

    const result = (await service.get(PRODUCT_ID)) as EnrichedAdminProduct;

    expect(adminSnapshot).toHaveBeenCalledWith(PRODUCT_ID);
    // Typed graph keys reach the payload...
    expect(result.options).toEqual(graphSnapshotRow().options);
    expect(result.media).toEqual([
      expect.objectContaining({ id: SHARED_MEDIA_ID }),
      expect.objectContaining({ id: SCOPED_MEDIA_ID, optionValueId: RED_VALUE_ID }),
    ]);
    // ...including variant option assignments for the matrix editor.
    expect(result.variants[0].optionValues).toEqual([
      { optionId: COLOR_OPTION_ID, optionValueId: RED_VALUE_ID },
    ]);
    // Stock enrichment survives the snapshot swap.
    expect(result.variants[0].sku?.onHand).toBe(7);
    expect(result.variants[0].sku?.availableInventory).toBe(5);
    // The legacy gallery contract stays shared-only.
    expect(result.images).toEqual([
      expect.objectContaining({ id: SHARED_MEDIA_ID }),
    ]);
  });

  it('keeps the legacy payload (no options/media keys) for a graph-v0 product', async () => {
    const graph = catalogGraphOver(graphSnapshotRow());
    const adminSnapshot = vi.spyOn(graph, 'adminSnapshot');
    const { service } = createService(legacyAdminRow(), graph);

    const result = (await service.get(PRODUCT_ID)) as EnrichedAdminProduct;

    expect(adminSnapshot).not.toHaveBeenCalled();
    expect(result.options).toBeUndefined();
    expect('media' in result).toBe(false);
    expect(result.variants[0].sku?.onHand).toBe(7);
  });

  it('falls back to the legacy payload when the graph service is unavailable', async () => {
    const { service } = createService(legacyAdminRow(), undefined);

    const result = (await service.get(PRODUCT_ID)) as EnrichedAdminProduct;

    expect(result.options).toBeUndefined();
    expect('media' in result).toBe(false);
  });

  it('still 404s for a missing product', async () => {
    const { service } = createService(null, undefined);

    await expect(service.get(PRODUCT_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('ProductsService.update typed graph presentation', () => {
  function updateHarness(
    row: Record<string, unknown>,
    graph?: CatalogGraphService,
  ) {
    const tx = {
      product: {
        update: vi.fn(async () => row),
        findUniqueOrThrow: vi.fn(async () => row),
      },
    };
    const prisma = {
      product: {
        findUnique: vi.fn(async () => row),
        findUniqueOrThrow: vi.fn(async () => row),
      },
      $transaction: vi.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
      ),
    };
    const service = new ProductsService(
      prisma as never,
      { summaryForProducts: vi.fn(async () => new Map()) } as never,
      { stockBySku: vi.fn(async () => STOCK) } as never,
      graph,
    );
    return { service, prisma, tx };
  }

  it('re-presents a scalar-only save of a graph product through the typed snapshot', async () => {
    const graph = catalogGraphOver(graphSnapshotRow());
    const adminSnapshot = vi.spyOn(graph, 'adminSnapshot');
    // findUnique (existing check) and tx.product.update both return the
    // legacy-shaped row: version 2 but no options/media keys on the wire.
    const { service } = updateHarness(
      legacyAdminRow({ catalogGraphVersion: 2 }),
      graph,
    );

    const result = (await service.update(PRODUCT_ID, { name: 'Renamed' } as never)) as AdminProduct;

    expect(adminSnapshot).toHaveBeenCalledWith(PRODUCT_ID);
    expect(result.options).toEqual(graphSnapshotRow().options);
    // The snapshot's media set carries the scoped row alongside shared media.
    expect(result.media).toEqual(graphSnapshotRow().images);
  });

  it('keeps the legacy response shape for a graph-v0 product save', async () => {
    const graph = catalogGraphOver(graphSnapshotRow());
    const adminSnapshot = vi.spyOn(graph, 'adminSnapshot');
    const { service } = updateHarness(legacyAdminRow(), graph);

    const result = (await service.update(PRODUCT_ID, { name: 'Renamed' } as never)) as AdminProduct;

    expect(adminSnapshot).not.toHaveBeenCalled();
    expect(result.options).toBeUndefined();
    expect('media' in result).toBe(false);
  });
});

describe('CatalogGraphService.adminSnapshot', () => {
  it('splits shared images from the full scoped media set without mutating reads', async () => {
    const prisma = {
      product: {
        findUnique: vi.fn(async () => graphSnapshotRow()),
      },
    };
    const service = new CatalogGraphService(prisma as never);

    const result = await service.adminSnapshot(PRODUCT_ID);

    expect(prisma.product.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: PRODUCT_ID } }),
    );
    expect(result?.images).toEqual([
      expect.objectContaining({ id: SHARED_MEDIA_ID }),
    ]);
    expect(result?.media).toHaveLength(2);
    expect(result?.options).toHaveLength(1);
    expect(result?.catalogGraphVersion).toBe(2);
  });

  it('returns null for a missing product', async () => {
    const prisma = {
      product: { findUnique: vi.fn(async () => null) },
    };
    const service = new CatalogGraphService(prisma as never);

    await expect(service.adminSnapshot(PRODUCT_ID)).resolves.toBeNull();
  });
});
