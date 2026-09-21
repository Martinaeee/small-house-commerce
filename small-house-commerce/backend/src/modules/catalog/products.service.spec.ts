import { describe, expect, it, vi } from 'vitest';
import { legacyUnmappedCombinationKey } from './catalog-graph.js';
import type {
  AdminProductQuery,
  StorefrontProductQuery,
} from './dto/product.dto.js';
import { ProductsService } from './products.service.js';

vi.mock('../../common/revalidation.js', () => ({
  CACHE_TAGS: { STOREFRONT: 'storefront' },
  revalidateCache: vi.fn(async () => undefined),
}));

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

const LEGACY_PRODUCT_ID = '00000000-0000-4000-8000-000000000701';
const EXISTING_VARIANT_ID = '00000000-0000-4000-8000-000000000702';
const EXISTING_SKU_ID = '00000000-0000-4000-8000-000000000703';

interface LegacyVariantRow {
  id: string;
  productId: string;
  name: string;
  position: number;
  combinationKey: string;
  sku: {
    id: string;
    skuCode: string;
    status: 'ACTIVE' | 'DISABLED';
  } | null;
}

function createLegacyWriteHarness(initialVariants: LegacyVariantRow[] = []) {
  const variants = structuredClone(initialVariants);
  const productVariantCreate = vi.fn(
    async ({ data }: { data: Omit<LegacyVariantRow, 'sku'> }) => {
      const row = { ...data, sku: null };
      variants.push(row);
      return structuredClone(row);
    },
  );
  const productVariantUpdate = vi.fn(
    async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<LegacyVariantRow>;
    }) => {
      const row = variants.find(({ id }) => id === where.id);
      if (!row) throw new Error(`missing variant ${where.id}`);
      Object.assign(row, structuredClone(data));
      return structuredClone(row);
    },
  );
  const skuCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) =>
    structuredClone(data),
  );
  const skuUpdate = vi.fn(async ({ data }: { data: Record<string, unknown> }) =>
    structuredClone(data),
  );
  const tx = {
    product: {
      create: vi.fn(async () => ({ id: LEGACY_PRODUCT_ID })),
      update: vi.fn(async () => ({ id: LEGACY_PRODUCT_ID, variants: [] })),
      findUniqueOrThrow: vi.fn(async () => ({
        id: LEGACY_PRODUCT_ID,
        variants: [],
      })),
    },
    productVariant: {
      create: productVariantCreate,
      findMany: vi.fn(async () => structuredClone(variants)),
      update: productVariantUpdate,
      delete: vi.fn(async () => undefined),
    },
    sku: {
      create: skuCreate,
      update: skuUpdate,
      delete: vi.fn(async () => undefined),
    },
  };
  const prisma = {
    category: {
      findUnique: vi.fn(async () => ({ id: 'category-id' })),
    },
    product: {
      findUnique: vi.fn(async () => ({
        id: LEGACY_PRODUCT_ID,
        catalogGraphVersion: 0,
      })),
    },
    $transaction: vi.fn(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    ),
  };
  return {
    service: new ProductsService(prisma as never, reviewsStub, inventoryStub),
    tx,
    variants,
  };
}

describe('ProductsService graph-v0 variant compatibility', () => {
  it.each([1, 2])(
    'preallocates exact unique sentinels when legacy create writes %s variant(s)',
    async (variantCount) => {
      const harness = createLegacyWriteHarness();
      const inputVariants = Array.from(
        { length: variantCount },
        (_, index) => ({
          name: `Legacy ${index}`,
          position: index,
          sku: null,
        }),
      );

      await harness.service.create({
        name: 'Legacy product',
        slug: `legacy-product-${variantCount}`,
        categoryId: 'category-id',
        status: 'DRAFT',
        solutions: [],
        images: [],
        detailBlocks: [],
        variants: inputVariants,
      } as never);

      const created = harness.tx.productVariant.create.mock.calls.map(
        ([call]) => call.data,
      );
      expect(created).toHaveLength(variantCount);
      expect(new Set(created.map(({ id }) => id)).size).toBe(variantCount);
      for (const variant of created) {
        expect(variant.id).toMatch(/^[0-9a-f-]{36}$/i);
        expect(variant.combinationKey).toBe(
          legacyUnmappedCombinationKey(variant.id),
        );
      }
    },
  );

  it('adds a sentinel variant while preserving retained variant, SKU, and key identities', async () => {
    const existingKey = legacyUnmappedCombinationKey(EXISTING_VARIANT_ID);
    const harness = createLegacyWriteHarness([
      {
        id: EXISTING_VARIANT_ID,
        productId: LEGACY_PRODUCT_ID,
        name: 'Red',
        position: 0,
        combinationKey: existingKey,
        sku: {
          id: EXISTING_SKU_ID,
          skuCode: 'LEGACY-RED',
          status: 'ACTIVE',
        },
      },
    ]);

    await harness.service.update(LEGACY_PRODUCT_ID, {
      variants: [
        {
          name: 'Red',
          position: 0,
          sku: { skuCode: 'LEGACY-RED', status: 'ACTIVE' },
        },
        { name: 'Blue', position: 1, sku: null },
      ],
    } as never);

    const created = harness.tx.productVariant.create.mock.calls[0]?.[0].data;
    expect(created?.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(created?.combinationKey).toBe(
      legacyUnmappedCombinationKey(created!.id),
    );
    expect(harness.variants).toContainEqual(
      expect.objectContaining({
        id: EXISTING_VARIANT_ID,
        combinationKey: existingKey,
      }),
    );
    expect(harness.tx.productVariant.update).toHaveBeenLastCalledWith({
      where: { id: EXISTING_VARIANT_ID },
      data: { name: 'Red', position: 0 },
    });
    expect(harness.tx.sku.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: EXISTING_SKU_ID },
        data: expect.objectContaining({
          variantId: EXISTING_VARIANT_ID,
          skuCode: 'LEGACY-RED',
        }),
      }),
    );
  });
});
