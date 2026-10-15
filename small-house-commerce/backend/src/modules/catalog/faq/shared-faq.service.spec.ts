import { BadRequestException, ConflictException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SHARED_FAQ_SET_ID, SharedFaqService } from './shared-faq.service.js';
import type { FaqItem } from './faq-content.js';

const ITEM: FaqItem = {
  id: '11111111-1111-7111-8111-111111111111',
  title: 'How does Cash on Delivery work?',
  answer: [{ kind: 'paragraph', text: 'Pay the rider when the order arrives.' }],
  enabled: true,
  position: 0,
  defaultOpen: false,
};

interface Row {
  id: string;
  items: FaqItem[];
  version: number;
  updatedByUserId: string | null;
}

function createPrismaMock() {
  let row: Row | null = null;
  return {
    current: () => row,
    sharedFaqSet: {
      findUnique: vi.fn(async () => row),
      findUniqueOrThrow: vi.fn(async () => {
        if (!row) throw Object.assign(new Error('not found'), { code: 'P2025' });
        return row;
      }),
      upsert: vi.fn(
        async ({ create }: { create: { id: string; items: FaqItem[]; version: number } }) => {
          row ??= { ...create, updatedByUserId: null };
          return row;
        },
      ),
      update: vi.fn(),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; version: number };
          data: Partial<Row>;
        }) => {
          if (!row || row.version !== where.version) return { count: 0 };
          row = { ...row, ...data } as Row;
          return { count: 1 };
        },
      ),
    },
    product: {
      count: vi.fn(async () => 0),
      findMany: vi.fn(async (query: {
        where?: { id?: { in: string[] }; status?: string };
      }) => (query.where?.id?.in ?? []).map((id) => ({ id }))),
    },
    productFaq: {
      count: vi.fn(async () => 0),
      findMany: vi.fn(
        async (): Promise<{ productId: string }[]> => [],
      ),
    },
  };
}

function createService(now: () => Date = () => new Date()) {
  const prisma = createPrismaMock();
  return { prisma, service: new SharedFaqService(prisma as never, now) };
}

describe('SharedFaqService', () => {
  let ctx: ReturnType<typeof createService>;

  beforeEach(() => {
    ctx = createService();
  });

  it('creates the singleton on first read', async () => {
    const set = await ctx.service.get();
    expect(set.id).toBe(SHARED_FAQ_SET_ID);
    expect(set.items).toEqual([]);
    expect(set.version).toBe(0);
    expect(ctx.prisma.sharedFaqSet.upsert).toHaveBeenCalledOnce();
  });

  it('returns the stored library on later reads without re-creating it', async () => {
    await ctx.service.update([ITEM], 0, 'u1');
    const set = await ctx.service.get();
    expect(set.items).toMatchObject([{ id: ITEM.id, title: ITEM.title }]);
    expect(set.version).toBe(1);
    expect(ctx.prisma.sharedFaqSet.upsert).toHaveBeenCalledOnce();
  });

  it('validates the payload before writing', async () => {
    await expect(
      ctx.service.update([{ ...ITEM, title: '' }], 0, 'u1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ctx.prisma.sharedFaqSet.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a stale version with a named conflict', async () => {
    await ctx.service.update([ITEM], 0, 'u1');
    await expect(ctx.service.update([ITEM], 0, 'u2')).rejects.toMatchObject({
      response: { code: 'FAQ_VERSION_MISMATCH', currentVersion: 1 },
    });
  });

  it('increments the version and records who edited the library', async () => {
    await ctx.service.update([ITEM], 0, 'u1');
    expect(ctx.prisma.current()).toMatchObject({ version: 1, updatedByUserId: 'u1' });
  });

  it('reports a conflict when the guarded update matches no row', async () => {
    await ctx.service.get();
    ctx.prisma.sharedFaqSet.findUniqueOrThrow = vi.fn(async () => ({
      id: SHARED_FAQ_SET_ID,
      items: [],
      version: 0,
      updatedByUserId: null,
    })) as never;
    ctx.prisma.sharedFaqSet.updateMany = vi.fn(async () => ({ count: 0 })) as never;
    await expect(ctx.service.update([ITEM], 0, 'u1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('accepts an empty library so every shared question can be switched off', async () => {
    await expect(ctx.service.update([], 0, 'u1')).resolves.toEqual({ version: 1 });
  });

  it('stamps only new or changed questions and ignores client-supplied timestamps', async () => {
    let clock = new Date('2026-10-01T00:00:00.000Z');
    const service = new SharedFaqService(ctx.prisma as never, () => clock);
    const SECOND_ID = '22222222-2222-7222-8222-222222222222';

    await service.update(
      [ITEM, { ...ITEM, id: SECOND_ID, title: 'Unchanged?', position: 1 }],
      0,
      'u1',
    );
    const first = await service.get();
    expect(first.items[0]!.updatedAt).toBe(clock.toISOString());
    expect(first.items[1]!.updatedAt).toBe(clock.toISOString());

    clock = new Date('2026-10-10T00:00:00.000Z');
    await service.update(
      [
        { ...ITEM, title: 'Changed?' },
        { ...ITEM, id: SECOND_ID, title: 'Unchanged?', position: 1, updatedAt: '1999-01-01T00:00:00.000Z' },
      ],
      1,
      'u1',
    );

    const second = await service.get();
    expect(second.items[0]!.updatedAt).toBe(clock.toISOString());
    expect(second.items[1]!.updatedAt).toBe('2026-10-01T00:00:00.000Z');
  });

  it('reports inheriting products (active minus CUSTOM) when an all-product question exists', async () => {
    await ctx.service.update([ITEM], 0, 'u1');
    ctx.prisma.product.findMany = vi.fn(async () =>
      ['a1', 'a2', 'a3', 'a4', 'a5'].map((id) => ({ id })),
    ) as never;
    ctx.prisma.productFaq.findMany = vi.fn(async () =>
      ['a1', 'a2', 'a3'].map((productId) => ({ productId })),
    ) as never;
    const set = await ctx.service.get();
    expect(set.usage).toEqual({ productCount: 2 });
  });

  it('counts only products a targeted question actually applies to', async () => {
    await ctx.service.update(
      [
        {
          ...ITEM,
          audience: {
            scope: 'PRODUCTS',
            productIds: [
              'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            ],
          },
        },
      ],
      0,
      'u1',
    );
    ctx.prisma.productFaq.findMany = vi.fn(async () =>
      [{ productId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }],
    ) as never;
    ctx.prisma.product.findMany = vi.fn(async () =>
      [{ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }],
    ) as never;
    const set = await ctx.service.get();
    expect(set.usage).toEqual({ productCount: 0 });
    expect(ctx.prisma.productFaq.findMany).toHaveBeenCalledWith({
      where: { mode: 'CUSTOM', product: { status: 'ACTIVE' } },
      select: { productId: true },
    });
  });

  it('counts the intersection of a targeted audience with inheriting products', async () => {
    await ctx.service.update(
      [
        {
          ...ITEM,
          audience: {
            scope: 'PRODUCTS',
            productIds: [
              'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
              'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            ],
          },
        },
      ],
      0,
      'u1',
    );
    ctx.prisma.product.findMany = vi.fn(async () =>
      [
        { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
        { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' },
      ],
    ) as never;
    ctx.prisma.productFaq.findMany = vi.fn(async () =>
      [{ productId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }],
    ) as never;
    const set = await ctx.service.get();
    expect(set.usage).toEqual({ productCount: 1 });
  });

  it('rejects an audience with missing products before replacing the library', async () => {
    const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    ctx.prisma.product.findMany.mockResolvedValue([{ id: A }]);
    await expect(ctx.service.update([
      { ...ITEM, audience: { scope: 'PRODUCTS', productIds: [A, B] } },
    ], 0, 'u1')).rejects.toMatchObject({
      response: { code: 'FAQ_AUDIENCE_PRODUCT_MISSING', productIds: [B] },
    });
    expect(ctx.prisma.current()?.items ?? []).toEqual([]);
    expect(ctx.prisma.sharedFaqSet.updateMany).not.toHaveBeenCalled();
  });

  it('previews the proposed library impact without writing or incrementing version', async () => {
    const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const before = await ctx.service.get();
    ctx.prisma.product.findMany.mockImplementation(async (query) => {
      if (query.where?.id?.in) {
        return query.where.id.in.map((id) => ({ id }));
      }
      if (query.where?.status === 'ACTIVE') {
        return [A, B, C].map((id) => ({ id }));
      }
      return [];
    });
    ctx.prisma.productFaq.findMany.mockResolvedValue([{ productId: C }]);
    const proposed = [
      {
        ...ITEM,
        audience: { scope: 'PRODUCTS' as const, productIds: [A, B, C] },
      },
      {
        ...ITEM,
        id: '22222222-2222-7222-8222-222222222222',
        title: 'Can this be assembled?',
        position: 1,
        audience: { scope: 'PRODUCTS' as const, productIds: [A, D] },
      },
    ];

    await expect(
      ctx.service.previewImpact(proposed, before.version),
    ).resolves.toEqual({ productCount: 2, version: before.version });
    expect((await ctx.service.get()).version).toBe(before.version);
    expect(ctx.prisma.sharedFaqSet.update).not.toHaveBeenCalled();
    expect(ctx.prisma.sharedFaqSet.updateMany).not.toHaveBeenCalled();
  });

  it('reports zero impact for a disabled-only proposed library', async () => {
    const before = await ctx.service.get();
    ctx.prisma.product.findMany.mockResolvedValue([
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
    ]);

    await expect(
      ctx.service.previewImpact([{ ...ITEM, enabled: false }], before.version),
    ).resolves.toEqual({ productCount: 0, version: before.version });
    expect(ctx.prisma.sharedFaqSet.updateMany).not.toHaveBeenCalled();
  });

  it('rejects malformed proposed items before calculating impact', async () => {
    await expect(
      ctx.service.previewImpact([{ ...ITEM, title: '' }], 0),
    ).rejects.toMatchObject({ response: { code: 'FAQ_INVALID' } });
    expect(ctx.prisma.sharedFaqSet.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a stale impact preview with the named version conflict', async () => {
    const before = await ctx.service.get();

    await expect(
      ctx.service.previewImpact([ITEM], before.version + 1),
    ).rejects.toMatchObject({
      response: {
        code: 'FAQ_VERSION_MISMATCH',
        currentVersion: before.version,
      },
    });
    expect(ctx.prisma.sharedFaqSet.updateMany).not.toHaveBeenCalled();
  });

  it('rejects deleted audience products without writing the proposed library', async () => {
    const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const before = await ctx.service.get();
    ctx.prisma.product.findMany.mockImplementation(async (query) => {
      if (query.where?.id?.in) return [{ id: A }];
      return [{ id: A }];
    });

    await expect(
      ctx.service.previewImpact(
        [
          {
            ...ITEM,
            audience: { scope: 'PRODUCTS', productIds: [A, B] },
          },
        ],
        before.version,
      ),
    ).rejects.toMatchObject({
      response: { code: 'FAQ_AUDIENCE_PRODUCT_MISSING', productIds: [B] },
    });
    expect(ctx.prisma.sharedFaqSet.update).not.toHaveBeenCalled();
    expect(ctx.prisma.sharedFaqSet.updateMany).not.toHaveBeenCalled();
  });

  it('lists only FAQ-relevant product identity, thumbnail and inheritance mode', async () => {
    ctx.prisma.product.findMany.mockResolvedValue([
      {
        id: 'p1', name: 'Cart', slug: 'cart', status: 'ACTIVE', productCode: 'P-000021',
        images: [{ url: '/uploads/cart.png' }], faq: { mode: 'CUSTOM' },
        description: 'Private admin data', variants: [{ sku: { cost: 100 } }],
      },
      {
        id: 'p2', name: 'Desk', slug: 'desk', status: 'DRAFT', productCode: null,
        images: [], faq: null,
      },
    ] as never);
    ctx.prisma.product.count.mockResolvedValue(12);
    const result = await ctx.service.listProducts({ search: 'cart', page: 2, pageSize: 10 });
    expect(result).toEqual({
      items: [
        { id: 'p1', name: 'Cart', slug: 'cart', status: 'ACTIVE', productCode: 'P-000021', thumbnailUrl: '/uploads/cart.png', faqMode: 'CUSTOM' },
        { id: 'p2', name: 'Desk', slug: 'desk', status: 'DRAFT', productCode: null, thumbnailUrl: null, faqMode: 'SHARED' },
      ], total: 12, page: 2, pageSize: 10,
    });
    expect(ctx.prisma.product.findMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 10, take: 10,
      where: { OR: [
        { name: { contains: 'cart', mode: 'insensitive' } },
        { slug: { contains: 'cart', mode: 'insensitive' } },
        { productCode: { contains: 'cart', mode: 'insensitive' } },
      ] },
    }));
    const query = ctx.prisma.product.findMany.mock.calls[0]?.[0];
    expect(query).toHaveProperty('select.id', true);
    expect(query).not.toHaveProperty('include');
    expect(query).not.toHaveProperty('select.variants');
  });

  it('resolves existing selected IDs without returning the rest of the catalogue', async () => {
    ctx.prisma.product.findMany.mockResolvedValue([]);
    await ctx.service.listProducts({ ids: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'], page: 1, pageSize: 50 });
    expect(ctx.prisma.product.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'] } },
    }));
  });

  it('counts disabled targeted items as applying to nothing', async () => {
    await ctx.service.update(
      [
        {
          ...ITEM,
          enabled: false,
          audience: {
            scope: 'PRODUCTS',
            productIds: [
              'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            ],
          },
        },
      ],
      0,
      'u1',
    );
    ctx.prisma.product.findMany = vi.fn(async () =>
      [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }],
    ) as never;
    expect((await ctx.service.get()).usage).toEqual({ productCount: 0 });
  });
});
