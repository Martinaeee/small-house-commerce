import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '../../generated/prisma/client.js';
import { ProductsService } from './products.service.js';
import type { FaqItem } from './faq/faq-content.js';

/**
 * Product FAQ persistence.
 *
 * The FAQ row has to be written inside the product's own transaction: a save
 * that renames the product but loses the FAQ (or the reverse) is worse than a
 * save that fails outright, because the operator sees a success toast either
 * way. These tests pin the atomicity, the "omitted means untouched" rule, and
 * the optimistic lock that stops two tabs from overwriting each other.
 */

function p2002(target: string[]) {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '7.10.0',
    meta: { modelName: 'Product', target },
  });
}

const OWN_ITEM: FaqItem = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Does it fit a small room?',
  answer: [{ kind: 'paragraph', text: 'Yes — it is 90cm wide.' }],
  enabled: true,
  position: 0,
  defaultOpen: false,
};

interface FaqRow {
  mode: string;
  items: unknown;
  version: number;
}

interface HarnessOptions {
  faqRow?: FaqRow | null;
  productUpdateFails?: boolean;
  now?: () => Date;
}

function createHarness(options: HarnessOptions = {}) {
  let faqRow: FaqRow | null = options.faqRow ?? null;

  const product = {
    id: 'p1',
    name: 'Chair',
    slug: 'chair',
    catalogGraphVersion: 0,
    images: [],
    detailBlocks: [],
    variants: [],
  };

  const tx = {
    $queryRaw: vi.fn(async () => [{ value: 1n }]),
    product: {
      create: vi.fn(async () => product),
      update: vi.fn(async () => {
        if (options.productUpdateFails) throw p2002(['slug']);
        return product;
      }),
      findUniqueOrThrow: vi.fn(async () => product),
    },
    productVariant: {
      findMany: vi.fn(async () => []),
      create: vi.fn(async () => ({ id: 'v-new' })),
    },
    productFaq: {
      findUnique: vi.fn(async () => faqRow),
      updateMany: vi.fn(async (arg: { data: FaqRow }) => {
        faqRow = {
          mode: arg.data.mode,
          items: arg.data.items,
          version: arg.data.version,
        };
        return { count: 1 };
      }),
      create: vi.fn(async (arg: { data: FaqRow }) => {
        faqRow = {
          mode: arg.data.mode,
          items: arg.data.items,
          version: arg.data.version,
        };
        return faqRow;
      }),
    },
  };

  const prisma = {
    product: { findUnique: vi.fn(async () => product) },
    category: { findUnique: vi.fn(async () => ({ id: 'c1' })) },
    productFaq: {
      findMany: vi.fn(async () =>
        faqRow ? [{ productId: 'p1', ...faqRow }] : [],
      ),
    },
    $transaction: vi.fn(async (arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (t: unknown) => Promise<unknown>)(tx)
        : Promise.all(arg as Promise<unknown>[]),
    ),
  };

  const inventory = { stockBySku: vi.fn(async () => new Map()) };
  const reviews = { summaryForProducts: vi.fn(async () => new Map()) };

  const service = new ProductsService(
    prisma as never,
    reviews as never,
    inventory as never,
    undefined,
    options.now,
  );

  return { service, prisma, tx, getFaqRow: () => faqRow };
}

function createOverviewHarness(
  rows: unknown[],
  options: { itemMatchIds?: string[]; updatedItemMatchIds?: string[] } = {},
) {
  type Query = {
    where?: {
      mode?: string;
      productId?: string;
      updatedAt?: { gte: Date };
      AND?: Array<{
        productId?: { in: string[] };
        OR?: Array<
          | { product?: { OR?: Array<Record<string, { contains: string }>> } }
          | { productId?: { in: string[] } }
        >;
      }>;
    };
    skip?: number;
    take?: number;
  };
  const filteredRows = (query: Query = {}) => {
    const mode = query.where?.mode;
    const productId = query.where?.productId;
    const updatedSince = query.where?.updatedAt?.gte;
    const and = query.where?.AND ?? [];
    const searchClause =
      and.find((clause) =>
        clause.OR?.some((entry) => 'product' in entry),
      )?.OR ?? [];
    const updatedIds = and.find((clause) => clause.productId?.in)?.productId?.in;
    const productOr = (searchClause[0] as { product?: { OR?: Array<Record<string, { contains: string }>> } })
      ?.product?.OR;
    const search = productOr?.[0] ? Object.values(productOr[0])[0]?.contains : undefined;
    const jsonIds = (searchClause[1] as { productId?: { in: string[] } })?.productId?.in ?? [];
    const filtered = (rows as Array<{
      productId: string;
      mode: string;
      items: Array<{
        title: string;
        answer: Array<{ text?: string }>;
        updatedAt?: string;
      }>;
      updatedAt?: Date;
      product: { name: string; slug: string; productCode?: string | null };
    }>).filter((row) => {
      const matchesMode = !mode || row.mode === mode;
      const matchesProduct = !productId || row.productId === productId;
      const matchesDate = !updatedSince || (row.updatedAt ?? new Date(0)) >= updatedSince;
      const matchesUpdatedItems = !updatedIds || updatedIds.includes(row.productId);
      const visible = row.mode !== 'SHARED' || row.items.length > 0;
      const haystack = [
        row.product.name,
        row.product.slug,
        row.product.productCode ?? '',
        ...row.items.flatMap((item) => [item.title, ...item.answer.map((block) => block.text ?? '')]),
      ]
        .join(' ')
        .toLowerCase();
      const matchesSearch =
        !search || haystack.includes(search.toLowerCase()) || jsonIds.includes(row.productId);
      return matchesMode && matchesProduct && matchesDate && matchesUpdatedItems && visible && matchesSearch;
    });
    const skip = query.skip ?? 0;
    return filtered.slice(skip, query.take === undefined ? undefined : skip + query.take);
  };
  const prisma = {
    product: { findUnique: vi.fn() },
    productFaq: {
      findMany: vi.fn(async (query: Query) => filteredRows(query)),
      count: vi.fn(async (query: Query) => filteredRows(query).length),
    },
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      const sql = Array.from(strings).join(' ');
      const ids = sql.includes('jsonb_array_elements')
        ? (options.updatedItemMatchIds ?? [])
        : (options.itemMatchIds ?? []);
      return ids.map((id) => ({ product_id: id }));
    }),
    $transaction: vi.fn(async (queries: readonly Promise<unknown>[]) =>
      Promise.all(queries),
    ),
  };
  const reviews = { summaryForProducts: vi.fn(async () => new Map()) };
  const inventory = { stockBySku: vi.fn(async () => new Map()) };
  const service = new ProductsService(
    prisma as never,
    reviews as never,
    inventory as never,
  );
  return { service, prisma };
}

const OVERVIEW_ROWS = [
  {
    productId: 'p1',
    mode: 'EXTEND',
    items: [OWN_ITEM],
    version: 2,
    product: {
      id: 'p1',
      name: 'Narrow Storage Cart',
      slug: 'narrow-storage-cart',
      status: 'ACTIVE',
      productCode: 'P-000021',
      images: [{ url: '/uploads/cart.png', altText: 'Cart' }],
    },
  },
];


describe('ProductsService FAQ — overview read path', () => {
  it('returns product groups with raw faq mode, items, and version', async () => {
    const { service } = createOverviewHarness(OVERVIEW_ROWS);

    const result = await service.listFaqProducts({ page: 1, pageSize: 20 });

    expect(result).toMatchObject({ page: 1, pageSize: 20, total: 1 });
    expect(result.items[0]).toMatchObject({
      product: {
        id: 'p1',
        name: 'Narrow Storage Cart',
        slug: 'narrow-storage-cart',
        status: 'ACTIVE',
      },
      faq: {
        mode: 'EXTEND',
        version: 2,
        items: [{ id: OWN_ITEM.id, title: 'Does it fit a small room?' }],
      },
    });
  });

  it('applies search, mode, and pagination without loading full product details', async () => {
    const rows = [
      ...OVERVIEW_ROWS,
      {
        ...OVERVIEW_ROWS[0],
        productId: 'p2',
        mode: 'CUSTOM',
        product: {
          ...OVERVIEW_ROWS[0].product,
          id: 'p2',
          name: 'Narrow Desk Cart',
          slug: 'narrow-desk-cart',
        },
      },
      {
        ...OVERVIEW_ROWS[0],
        productId: 'p3',
        mode: 'CUSTOM',
        product: {
          ...OVERVIEW_ROWS[0].product,
          id: 'p3',
          name: 'Narrow Shelf Cart',
          slug: 'narrow-shelf-cart',
        },
      },
    ];
    const { service, prisma } = createOverviewHarness(rows);

    const result = await service.listFaqProducts({
      search: 'narrow',
      mode: 'CUSTOM',
      page: 2,
      pageSize: 1,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.product.id).toBe('p3');
    expect(result.page).toBe(2);
    expect(prisma.product.findUnique).not.toHaveBeenCalled();
  });

  it('returns the product code and cover thumbnail with each group', async () => {
    const { service } = createOverviewHarness(OVERVIEW_ROWS);

    const result = await service.listFaqProducts({ page: 1, pageSize: 20 });

    expect(result.items[0]?.product).toMatchObject({
      productCode: 'P-000021',
      thumbnailUrl: '/uploads/cart.png',
      thumbnailAlt: 'Cart',
    });
  });

  it('filters by product id and by a per-question update window', async () => {
    const rows = [
      {
        ...OVERVIEW_ROWS[0],
        items: [
          {
            ...OWN_ITEM,
            updatedAt: '2026-10-01T00:00:00.000Z',
          },
        ],
      },
      {
        ...OVERVIEW_ROWS[0],
        productId: 'p2',
        product: { ...OVERVIEW_ROWS[0]!.product, id: 'p2' },
        items: [
          {
            ...OWN_ITEM,
            updatedAt: '2026-10-09T00:00:00.000Z',
          },
        ],
      },
    ];
    const { service, prisma } = createOverviewHarness(rows, {
      updatedItemMatchIds: ['p2'],
    });

    const byProduct = await service.listFaqProducts({ productId: 'p2', page: 1, pageSize: 20 });
    expect(byProduct.items.map((item) => item.product.id)).toEqual(['p2']);

    const byDate = await service.listFaqProducts({
      updatedSince: '2026-10-05T00:00:00.000Z',
      page: 1,
      pageSize: 20,
    });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(byDate.items.map((item) => item.product.id)).toEqual(['p2']);
  });

  it('matches question text through the database and keeps the FAQ ownership', async () => {
    const rows = [
      {
        ...OVERVIEW_ROWS[0],
        product: { ...OVERVIEW_ROWS[0]!.product, name: 'Plain Cart' },
      },
      {
        ...OVERVIEW_ROWS[0],
        productId: 'p2',
        product: {
          ...OVERVIEW_ROWS[0]!.product,
          id: 'p2',
          name: 'Other Cart',
          productCode: 'P-000099',
        },
      },
    ];
    const { service, prisma } = createOverviewHarness(rows, { itemMatchIds: ['p2'] });

    const result = await service.listFaqProducts({ search: 'hallway', page: 1, pageSize: 20 });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(result.items.map((item) => item.product.id)).toEqual(['p2']);
    expect(result.items[0]?.faq.items).toHaveLength(1);
  });
});


describe('ProductsService FAQ — write path', () => {
  it('writes the product faq inside the same transaction as product creation', async () => {
    const { service, tx } = createHarness();

    await service.create({
      name: 'Chair',
      slug: 'chair',
      categoryId: 'c1',
      images: [],
      detailBlocks: [],
      variants: [],
      faq: { mode: 'CUSTOM', items: [OWN_ITEM], expectedVersion: 0 },
    } as never);

    expect(tx.productFaq.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          productId: 'p1',
          mode: 'CUSTOM',
          version: 1,
        }),
      }),
    );
  });

  it('writes the product faq inside the same transaction as the product update', async () => {
    const { service, tx } = createHarness();

    await service.update('p1', {
      name: 'Renamed',
      faq: { mode: 'CUSTOM', items: [OWN_ITEM], expectedVersion: 0 },
    });

    expect(tx.product.update).toHaveBeenCalledTimes(1);
    expect(tx.productFaq.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          productId: 'p1',
          mode: 'CUSTOM',
          version: 1,
        }),
      }),
    );
  });

  it('does not write the faq when the product update fails', async () => {
    const { service, tx } = createHarness({ productUpdateFails: true });

    await expect(
      service.update('p1', {
        name: 'Renamed',
        faq: { mode: 'CUSTOM', items: [OWN_ITEM], expectedVersion: 0 },
      }),
    ).rejects.toBeDefined();

    expect(tx.productFaq.create).not.toHaveBeenCalled();
    expect(tx.productFaq.updateMany).not.toHaveBeenCalled();
  });

  it('leaves the faq untouched when the payload omits it', async () => {
    const { service, tx } = createHarness();

    await service.update('p1', { name: 'Renamed' });

    expect(tx.productFaq.create).not.toHaveBeenCalled();
    expect(tx.productFaq.updateMany).not.toHaveBeenCalled();
  });

  it('keeps the stored items when only the mode changes', async () => {
    const { service, getFaqRow } = createHarness();

    await service.update('p1', {
      faq: { mode: 'CUSTOM', items: [OWN_ITEM], expectedVersion: 0 },
    });
    await service.update('p1', {
      faq: { mode: 'SHARED', items: [OWN_ITEM], expectedVersion: 1 },
    });

    expect(getFaqRow()).toMatchObject({ mode: 'SHARED', version: 2 });
    expect(getFaqRow()?.items).toMatchObject([{ id: OWN_ITEM.id, title: OWN_ITEM.title }]);
  });

  it('strips shared-only category and audience metadata from product questions', async () => {
    const { service, getFaqRow } = createHarness();

    await service.update('p1', {
      faq: {
        mode: 'CUSTOM',
        items: [
          {
            ...OWN_ITEM,
            // An over-eager client (or a shared draft pasted in) must not be
            // able to smuggle shared-library grouping into a product row.
            category: 'DELIVERY',
            audience: {
              scope: 'PRODUCTS',
              productIds: [
                'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
              ],
            },
          },
        ],
        expectedVersion: 0,
      },
    });

    const stored = getFaqRow()?.items as unknown as { category?: string; audience?: unknown }[];
    expect(stored[0]).toMatchObject({ id: OWN_ITEM.id, title: OWN_ITEM.title });
    expect(stored[0]).not.toHaveProperty('category');
    expect(stored[0]).not.toHaveProperty('audience');
  });

  it('rejects a stale expectedVersion with a named conflict', async () => {
    const { service, tx } = createHarness({
      faqRow: { mode: 'CUSTOM', items: [OWN_ITEM], version: 3 },
    });

    const error = (await service
      .update('p1', {
        faq: { mode: 'CUSTOM', items: [OWN_ITEM], expectedVersion: 1 },
      })
      .catch((thrown: unknown) => thrown)) as unknown as {
      getResponse: () => unknown;
    };

    expect(error.getResponse()).toMatchObject({
      code: 'FAQ_VERSION_MISMATCH',
      currentVersion: 3,
    });
    expect(tx.productFaq.updateMany).not.toHaveBeenCalled();
  });

  it('rejects malformed faq items instead of storing them', async () => {
    const { service } = createHarness();

    const error = (await service
      .update('p1', {
        faq: {
          mode: 'CUSTOM',
          items: [{ id: 'not-a-uuid', title: '' }] as never,
          expectedVersion: 0,
        },
      })
      .catch((thrown: unknown) => thrown)) as unknown as {
      getResponse: () => unknown;
    };

    expect(error.getResponse()).toMatchObject({ code: 'FAQ_INVALID' });
  });

  it('strips shared-only categories without changing a product question timestamp', async () => {
    const FIRST = '2026-10-01T00:00:00.000Z';
    const { service, getFaqRow } = createHarness({
      faqRow: {
        mode: 'CUSTOM',
        items: [{ ...OWN_ITEM, category: 'DELIVERY', updatedAt: FIRST }],
        version: 1,
      },
      now: () => new Date('2026-10-10T00:00:00.000Z'),
    });

    await service.update('p1', {
      faq: {
        mode: 'CUSTOM',
        items: [{ ...OWN_ITEM, category: 'RETURNS' }],
        expectedVersion: 1,
      },
    });

    const items = getFaqRow()?.items as
      | Array<Record<string, unknown>>
      | undefined;
    const item = items?.[0];
    expect(item).not.toHaveProperty('category');
    expect(item?.updatedAt).toBe(FIRST);
  });

  it('keeps per-question timestamps for unchanged items and stamps only what changed', async () => {
    const FIRST = '2026-10-01T00:00:00.000Z';
    const NOW = new Date('2026-10-10T00:00:00.000Z');
    const SECOND_ID = '22222222-2222-4222-8222-222222222222';
    const { service, getFaqRow } = createHarness({
      faqRow: {
        mode: 'CUSTOM',
        items: [
          { ...OWN_ITEM, updatedAt: FIRST },
          { ...OWN_ITEM, id: SECOND_ID, title: 'Second?', position: 1, updatedAt: FIRST },
        ],
        version: 1,
      },
      now: () => NOW,
    });

    await service.update('p1', {
      faq: {
        mode: 'CUSTOM',
        items: [
          { ...OWN_ITEM, title: 'Changed?' },
          {
            ...OWN_ITEM,
            id: SECOND_ID,
            title: 'Second?',
            position: 1,
            updatedAt: '1999-01-01T00:00:00.000Z',
          },
        ],
        expectedVersion: 1,
      },
    });

    const items = getFaqRow()?.items as Array<{ id: string; updatedAt?: string }>;
    expect(items[0]?.updatedAt).toBe(NOW.toISOString());
    expect(items[1]?.updatedAt).toBe(FIRST);
  });
});

describe('ProductsService FAQ — admin read path', () => {
  it('returns the stored faq on the admin GET', async () => {
    const { service } = createHarness({
      faqRow: { mode: 'EXTEND', items: [OWN_ITEM], version: 2 },
    });

    const result = (await service.get('p1')) as {
      faq: { mode: string; version: number; items: unknown[] };
    };

    expect(result.faq).toMatchObject({ mode: 'EXTEND', version: 2 });
    expect(result.faq.items).toEqual([OWN_ITEM]);
  });

  it('resolves a product with no faq row as SHARED at version 0', async () => {
    const { service } = createHarness();

    const result = (await service.get('p1')) as {
      faq: { mode: string; version: number; items: unknown[] };
    };

    expect(result.faq).toEqual({ mode: 'SHARED', items: [], version: 0 });
  });

  it('returns the faq on the PATCH response so the form can re-sync', async () => {
    const { service } = createHarness();

    const result = (await service.update('p1', {
      faq: { mode: 'CUSTOM', items: [OWN_ITEM], expectedVersion: 0 },
    })) as { faq: { mode: string; version: number } };

    expect(result.faq).toMatchObject({ mode: 'CUSTOM', version: 1 });
  });
});
