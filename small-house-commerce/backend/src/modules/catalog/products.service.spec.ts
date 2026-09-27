import { describe, expect, it, vi } from 'vitest';
import { legacyUnmappedCombinationKey } from './catalog-graph.js';
import type {
  AdminProductQuery,
  StorefrontProductQuery,
} from './dto/product.dto.js';
import { ProductsService, formatProductCode } from './products.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { revalidateCache } from '../../common/revalidation.js';

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
      groupBy: vi.fn(async () => [] as unknown[]),
    },
    productOption: {
      findMany: vi.fn(async () => [] as unknown[]),
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
          detailBlocks: expect.objectContaining({
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
          detailBlocks: expect.objectContaining({
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
    // product_code_seq lookup; the value only has to be renderable.
    $queryRaw: vi.fn(async () => [{ value: 7n }]),
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

  it('mints the operator-facing product number from the sequence on create', async () => {
    const harness = createLegacyWriteHarness();

    await harness.service.create({
      name: 'Numbered product',
      slug: 'numbered-product',
      categoryId: 'category-id',
      status: 'DRAFT',
      solutions: [],
      images: [],
      detailBlocks: [],
      variants: [],
    } as never);

    const [call] = harness.tx.product.create.mock.calls;
    expect(call?.[0].data.productCode).toBe('P-000007');
  });

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

describe('ProductsService admin list filters and counters', () => {
  it('searches the product code and ANDs the attention preset', async () => {
    const prisma = createPrismaMock([]);
    const service = createService(prisma);

    await service.list({
      search: 'P-000007',
      attention: 'missing_media',
      page: 1,
      pageSize: 20,
    } as AdminProductQuery);

    const [call] = prisma.product.findMany.mock.calls;
    expect(call?.[0].where).toMatchObject({
      OR: expect.arrayContaining([
        { productCode: { contains: 'P-000007', mode: 'insensitive' } },
      ]),
      AND: [{ images: { none: { optionValueId: null, variantId: null } } }],
    });
  });

  it('attaches active option names from one page-wide query', async () => {
    const prisma = createPrismaMock([{ id: 'p1' }, { id: 'p2' }]);
    vi.mocked(prisma.productOption.findMany).mockResolvedValue([
      { productId: 'p1', name: 'Color' },
      { productId: 'p1', name: 'Size' },
    ] as never);
    const service = createService(prisma);

    const page = await service.list({
      page: 1,
      pageSize: 20,
    } as AdminProductQuery);

    const byId = new Map(
      page.items.map((item) => [item.id, item.activeOptionNames]),
    );
    expect(byId.get('p1')).toEqual(['Color', 'Size']);
    // A product with no active option group reports an empty summary rather
    // than an absent field, so the column can render the SKU count alone.
    expect(byId.get('p2')).toEqual([]);
    // One query for the whole page — never one per row.
    expect(prisma.productOption.findMany).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(prisma.productOption.findMany).mock.calls[0]?.[0],
    ).toMatchObject({
      where: {
        productId: { in: expect.arrayContaining(['p1', 'p2']) },
        isActive: true,
      },
    });
  });

  it('aggregates the status totals and every attention preset in the database', async () => {
    const prisma = createPrismaMock([]);
    vi.mocked(prisma.product.groupBy).mockResolvedValue([
      { status: 'ACTIVE', _count: { _all: 5 } },
      { status: 'DRAFT', _count: { _all: 3 } },
      { status: 'DISABLED', _count: { _all: 1 } },
    ] as never);
    vi.mocked(prisma.product.count).mockResolvedValue(2 as never);
    const service = createService(prisma);

    const counts = await service.counts();

    expect(counts.status).toEqual({
      all: 9,
      active: 5,
      draft: 3,
      disabled: 1,
    });
    expect(counts.attention).toEqual({
      missing_media: 2,
      no_priced_sku: 2,
      incomplete_shipping: 2,
      stale_draft: 2,
    });
    // One query per preset — never a count over the visible page.
    expect(prisma.product.count).toHaveBeenCalledTimes(4);
  });
});

describe("formatProductCode", () => {
  it("renders sequence values as stable six-digit product numbers", () => {
    expect(formatProductCode(1n)).toBe("P-000001");
    expect(formatProductCode(7)).toBe("P-000007");
    expect(formatProductCode(999999n)).toBe("P-999999");
    // Past six digits the code simply grows; the sequence stays unique.
    expect(formatProductCode(1234567n)).toBe("P-1234567");
  });
});

describe("ProductsService.remove", () => {
  function createRemoveHarness(deleteImpl: () => Promise<unknown>) {
    const prisma = {
      product: {
        findUnique: vi.fn(async () => ({ id: "p1" })),
        delete: vi.fn(deleteImpl),
      },
    };
    return {
      service: new ProductsService(prisma as never, reviewsStub, inventoryStub),
      prisma,
    };
  }

  it("deletes an unreferenced product and revalidates the storefront", async () => {
    vi.mocked(revalidateCache).mockClear();
    const harness = createRemoveHarness(async () => ({ id: "p1" }));

    await expect(harness.service.remove("p1")).resolves.toEqual({ ok: true });
    expect(harness.prisma.product.delete).toHaveBeenCalledWith({
      where: { id: "p1" },
    });
    expect(vi.mocked(revalidateCache)).toHaveBeenCalledWith(["storefront"]);
  });

  it("answers 404 for a missing product before attempting the delete", async () => {
    const prisma = {
      product: {
        findUnique: vi.fn(async () => null),
        delete: vi.fn(async () => undefined),
      },
    };
    const service = new ProductsService(
      prisma as never,
      reviewsStub,
      inventoryStub,
    );

    await expect(service.remove("gone")).rejects.toMatchObject({ status: 404 });
    expect(prisma.product.delete).not.toHaveBeenCalled();
  });

  it("maps a foreign-key block to a readable 409 instead of a generic 500", async () => {
    const harness = createRemoveHarness(async () => {
      throw new Prisma.PrismaClientKnownRequestError(
        "Foreign key constraint violated on the constraint: `inventory_movements_sku_id_fkey`",
        { code: "P2003", clientVersion: "7.10.0" },
      );
    });

    await expect(harness.service.remove("p1")).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({ code: "PRODUCT_HAS_HISTORY" }),
    });
  });

  it("rethrows unexpected failures untouched", async () => {
    const harness = createRemoveHarness(async () => {
      throw new Error("database exploded");
    });

    await expect(harness.service.remove("p1")).rejects.toThrow(
      "database exploded",
    );
  });
});

describe("ProductsService.bulkSetStatus", () => {
  it("updates the status of existing products and reports missing ids", async () => {
    vi.mocked(revalidateCache).mockClear();
    const prisma = {
      product: {
        findMany: vi.fn(async () => [{ id: "p1" }, { id: "p2" }]),
        updateMany: vi.fn(async () => ({ count: 2 })),
      },
    };
    const service = new ProductsService(
      prisma as never,
      reviewsStub,
      inventoryStub,
    );

    const result = await service.bulkSetStatus(
      ["p1", "p2", "gone"],
      "DISABLED",
    );

    expect(prisma.product.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["p1", "p2", "gone"] } },
      select: { id: true },
    });
    expect(prisma.product.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["p1", "p2"] } },
      data: { status: "DISABLED" },
    });
    expect(result).toEqual({ updated: 2, notFound: 1 });
    expect(vi.mocked(revalidateCache)).toHaveBeenCalledWith(["storefront"]);
  });

  it("skips the write entirely when no id exists and reports them all missing", async () => {
    const prisma = {
      product: {
        findMany: vi.fn(async () => []),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
    };
    const service = new ProductsService(
      prisma as never,
      reviewsStub,
      inventoryStub,
    );

    const result = await service.bulkSetStatus(["gone"], "ACTIVE");

    expect(prisma.product.updateMany).not.toHaveBeenCalled();
    expect(result).toEqual({ updated: 0, notFound: 1 });
  });
});
