import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { LandingPagesService } from './landing-pages.service.js';
import { LandingSnapshotService } from './landing-snapshot.service.js';
import { OptimizersService } from '../../marketing/optimizers.service.js';
const ADMIN = { id: 'admin', permissions: ['MARKETING_VIEW_ALL', 'MARKETING_MANAGE_ALL'] };
import {
  adminLandingPageQuerySchema,
  createLandingPageSchema,
  updateLandingPageSchema,
} from './dto/landing-page.dto.js';
import { effectiveStatus } from './landing-page.util.js';

const NOW = new Date('2026-09-14T12:00:00Z');

function lpRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    productId: '22222222-2222-2222-2222-222222222222',
    name: '优化师A-首图版',
    adCode: null,
    slug: 'os-chair',
    titleOverride: null,
    imagesOverride: null,
    seoTitle: null,
    seoDescription: null,
    promoEnabled: false,
    promoHeadline: null,
    promoSubtext: null,
    startAt: null,
    endAt: null,
    status: 'ACTIVE',
    sortOrder: 0,
    draftContent: null,
    publishedContent: null,
    _count: { campaignLinks: 0 },
    product: { name: 'Chair', productCode: null, slug: 'chair', status: 'ACTIVE' },
    owner: null,
    createdAt: new Date('2026-09-10T00:00:00Z'),
    updatedAt: new Date('2026-09-13T00:00:00Z'),
    ...overrides,
  };
}

function createPrismaMock() {
  return {
    product: {
      findUnique: vi.fn(async (): Promise<{ id: string } | null> => ({
        id: '22222222-2222-2222-2222-222222222222',
      })),
    },
    productLandingPage: {
      findMany: vi.fn(async (_args?: unknown) => [lpRow()]),
      findUnique: vi.fn(async (): Promise<ReturnType<typeof lpRow> | null> => lpRow()),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
        ...lpRow(),
        ...args.data,
      })),
      update: vi.fn(
        async (args: { where: { id: string }; data: Record<string, unknown> }) => ({
          ...lpRow(),
          ...args.data,
          id: args.where.id,
        }),
      ),
      delete: vi.fn(async (args: { where: { id: string } }) => lpRow({ id: args.where.id })),
    },
  };
}

describe('effectiveStatus', () => {
  it('never treats an unpublished draft as LIVE', () => {
    expect(effectiveStatus({ status: 'DRAFT', startAt: null, endAt: null }, NOW)).toBe('DRAFT');
  });
  it('DISABLED always wins', () => {
    expect(effectiveStatus({ status: 'DISABLED', startAt: null, endAt: null }, NOW)).toBe('DISABLED');
  });
  it('no window means LIVE', () => {
    expect(effectiveStatus({ status: 'ACTIVE', startAt: null, endAt: null }, NOW)).toBe('LIVE');
  });
  it('start in the future is SCHEDULED', () => {
    expect(effectiveStatus({ status: 'ACTIVE', startAt: new Date('2026-09-15T00:00:00Z'), endAt: null }, NOW)).toBe('SCHEDULED');
  });
  it('end in the past is ENDED', () => {
    expect(effectiveStatus({ status: 'ACTIVE', startAt: null, endAt: new Date('2026-09-13T00:00:00Z') }, NOW)).toBe('ENDED');
  });
  it('inside the window is LIVE', () => {
    expect(
      effectiveStatus(
        { status: 'ACTIVE', startAt: new Date('2026-09-13T00:00:00Z'), endAt: new Date('2026-09-15T00:00:00Z') },
        NOW,
      ),
    ).toBe('LIVE');
  });
});

describe('createLandingPageSchema', () => {
  const valid = () => ({
    name: '圣诞版',
    slug: 'os-chair-xmas',
    adCode: 'FB-1234',
    titleOverride: '圣诞特价人体工学椅',
    imagesOverride: [{ url: 'https://cdn.example.test/a.jpg', altText: '主图' }],
    promoEnabled: true,
    promoHeadline: 'Christmas Sale',
    promoSubtext: 'Limited time',
    startAt: '2026-12-01T00:00:00+08:00',
    endAt: '2026-12-31T23:59:59+08:00',
    status: 'ACTIVE',
    sortOrder: 2,
  });

  it('accepts the valid payload', () => {
    expect(createLandingPageSchema.safeParse(valid()).success).toBe(true);
  });
  it('rejects bad slugs', () => {
    for (const slug of ['UPPER', '-lead', 'trail-', 'with space', '中文']) {
      expect(createLandingPageSchema.safeParse({ ...valid(), slug }).success).toBe(false);
    }
  });
  it('requires promoHeadline when promoEnabled is true', () => {
    expect(createLandingPageSchema.safeParse({ ...valid(), promoEnabled: true, promoHeadline: null }).success).toBe(false);
  });
  it('rejects endAt <= startAt', () => {
    expect(
      createLandingPageSchema.safeParse({ ...valid(), endAt: '2026-11-30T23:59:59+08:00' }).success,
    ).toBe(false);
  });
  it('rejects more than 10 images', () => {
    const imagesOverride = Array.from({ length: 11 }, (_, i) => ({ url: `https://cdn.example.test/${i}.jpg` }));
    expect(createLandingPageSchema.safeParse({ ...valid(), imagesOverride }).success).toBe(false);
  });
  it('rejects non-https-ish invalid urls and overlong names', () => {
    expect(createLandingPageSchema.safeParse({ ...valid(), imagesOverride: [{ url: 'not-a-url' }] }).success).toBe(false);
    expect(createLandingPageSchema.safeParse({ ...valid(), name: 'x'.repeat(121) }).success).toBe(false);
  });
  it('update schema has no slug field and is fully optional', () => {
    expect(updateLandingPageSchema.safeParse({}).success).toBe(true);
    expect('slug' in updateLandingPageSchema.shape).toBe(false);
  });
});

describe('LandingPagesService product list', () => {
  it('scopes the legacy product entry to the same marketing owner', async () => {
    const prisma = createPrismaMock();
    const service = new LandingPagesService(prisma as never, {} as never, new LandingSnapshotService(prisma as never), new OptimizersService(prisma as never));
    const rows = await service.adminListForProduct('22222222-2222-2222-2222-222222222222', {
      id: 'u1', permissions: ['MARKETING_VIEW_OWN'],
    });
    expect(prisma.productLandingPage.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { productId: '22222222-2222-2222-2222-222222222222', ownerUserId: 'u1' },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    }));
    expect(rows[0]).toMatchObject({ slug: 'os-chair', effectiveStatus: 'LIVE' });
  });
});

describe('LandingPagesService.adminList metrics', () => {
  type MetricsRow = {
    id: string;
    productId: string;
    name: string;
    slug: string;
    adCode: string | null;
    titleOverride: string | null;
    promoEnabled: boolean;
    promoHeadline: string | null;
    promoSubtext: string | null;
    startAt: Date | null;
    endAt: Date | null;
    status: 'ACTIVE' | 'DISABLED';
    sortOrder: number;
    createdAt: Date;
    updatedAt: Date;
    product: { name: string };
    _count: { campaignLinks: number };
  };
  type ListArgs = {
    where: {
      productId?: string;
      status?: string;
      OR: Array<Record<string, unknown>>;
      AND?: unknown[];
      updatedAt: { gte?: Date; lt?: Date };
    };
    orderBy: unknown[];
  };
  type CountGroup = Array<{ landingPageId: string; _count: { _all: number } }>;

  function createMetricsMock() {
    return {
      product: { findUnique: vi.fn(async () => ({ id: 'p1' })) },
      productLandingPage: {
        findMany: vi.fn(
          async (_args: ListArgs): Promise<MetricsRow[]> => [
            {
              id: 'lp-1', productId: 'p1', name: 'A', slug: 'a', adCode: null, titleOverride: null,
              promoEnabled: false, promoHeadline: null, promoSubtext: null,
              status: 'ACTIVE', startAt: null, endAt: null, sortOrder: 0,
              createdAt: new Date('2026-09-10T00:00:00Z'),
              updatedAt: new Date('2026-09-10T00:00:00Z'), product: { name: 'Chair' }, _count: { campaignLinks: 0 },
            },
            {
              id: 'lp-2', productId: 'p1', name: 'B', slug: 'b', adCode: 'FB-9', titleOverride: 'B 标题',
              promoEnabled: false, promoHeadline: null, promoSubtext: null,
              status: 'ACTIVE', startAt: null, endAt: null, sortOrder: 1,
              createdAt: new Date('2026-09-11T00:00:00Z'),
              updatedAt: new Date('2026-09-11T00:00:00Z'), product: { name: 'Chair' }, _count: { campaignLinks: 0 },
            },
          ],
        ),
        count: vi.fn(async () => 2),
        updateMany: vi.fn(
          async (_args: { where: Record<string, unknown>; data: Record<string, unknown> }) => ({ count: 2 }),
        ),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      landingPageVisit: {
        groupBy: vi.fn(
          async (_args: { where: Record<string, unknown> }): Promise<CountGroup> => [
            { landingPageId: 'lp-1', _count: { _all: 4 } },
          ],
        ),
      },
      orderAttribution: {
        groupBy: vi.fn(
          async (_args: { where: Record<string, unknown> }): Promise<CountGroup> => [
            { landingPageId: 'lp-1', _count: { _all: 2 } },
          ],
        ),
      },
      $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    };
  }

  it('accepts accounting-period dates separately from page modification dates', () => {
    expect(adminLandingPageQuerySchema.parse({ dateFrom: '2026-09-01', periodFrom: '2026-10-01', periodTo: '2026-10-03' })).toMatchObject({ dateFrom: '2026-09-01', periodFrom: '2026-10-01', periodTo: '2026-10-03' });
    expect(adminLandingPageQuerySchema.safeParse({ periodFrom: '2026-10-04', periodTo: '2026-10-03' }).success).toBe(false);
    expect(adminLandingPageQuerySchema.safeParse({ periodFrom: '2026-02-30' }).success).toBe(false);
  });

  it('returns independently bounded page-day visits and immutable-owner verified valid orders', async () => {
    const prisma = createMetricsMock();
    prisma.landingPageVisit.groupBy.mockResolvedValueOnce([{ landingPageId: 'lp-1', _count: { _all: 40 } }]).mockResolvedValueOnce([{ landingPageId: 'lp-1', _count: { _all: 3 } }]);
    prisma.orderAttribution.groupBy.mockResolvedValueOnce([{ landingPageId: 'lp-1', _count: { _all: 20 } }]).mockResolvedValueOnce([{ landingPageId: 'lp-1', _count: { _all: 2 } }]);
    const service = new LandingPagesService(prisma as never, {} as never, new LandingSnapshotService(prisma as never), new OptimizersService(prisma as never));
    const result = await service.adminList(adminLandingPageQuerySchema.parse({ periodFrom: '2026-10-01', periodTo: '2026-10-03' }), { id: 'owner-a', permissions: ['MARKETING_VIEW_OWN'] });
    expect(result.items[0]).toMatchObject({ views: 40, orders: 20, periodViews: 3, periodOrders: 2 });
    expect(result).toMatchObject({ period: { from: '2026-10-01', to: '2026-10-03' } });
    expect(prisma.landingPageVisit.groupBy.mock.calls[1]?.[0].where).toMatchObject({ landingPageId: { in: ['lp-1', 'lp-2'] }, visitDay: { gte: new Date('2026-10-01T00:00:00Z'), lte: new Date('2026-10-03T00:00:00Z') } });
    expect(prisma.orderAttribution.groupBy.mock.calls[1]?.[0].where).toMatchObject({ optimizerId: 'owner-a', legacy: false, linkId: { not: null }, touchedAt: { gte: new Date('2026-09-30T16:00:00Z'), lt: new Date('2026-10-03T16:00:00Z') }, order: { orderStatus: { notIn: ['CANCELLED', 'DENIED'] } } });
  });

  it('joins visits/orders and computes conversion rate, zero when no views', async () => {
    const prisma = createMetricsMock();
    const service = new LandingPagesService(prisma as never, { storefrontGetBySlug: vi.fn() } as never, new LandingSnapshotService(prisma as never), new OptimizersService(prisma as never));
    const result = await service.adminList(adminLandingPageQuerySchema.parse({}), ADMIN);

    expect(result.total).toBe(2);
    const a = result.items.find((i) => i.id === 'lp-1')!;
    const b = result.items.find((i) => i.id === 'lp-2')!;
    expect(a).toMatchObject({ productName: 'Chair', views: 4, orders: 2, conversionRate: 0.5, effectiveStatus: 'LIVE' });
    expect(b).toMatchObject({ views: 0, orders: 0, conversionRate: 0 });

    const orderWhere = prisma.orderAttribution.groupBy.mock.calls[0]![0].where;
    expect(orderWhere).toMatchObject({
      landingPageId: { in: ['lp-1', 'lp-2'] },
      order: { orderStatus: { notIn: ['CANCELLED', 'DENIED'] } },
    });
  });

  it('passes search/status/date/effective/product filters into Prisma where', async () => {
    const prisma = createMetricsMock();
    const service = new LandingPagesService(prisma as never, { storefrontGetBySlug: vi.fn() } as never, new LandingSnapshotService(prisma as never), new OptimizersService(prisma as never));
    await service.adminList(
      adminLandingPageQuerySchema.parse({
        search: '椅',
        status: 'ACTIVE',
        effectiveStatus: 'LIVE',
        productId: '22222222-2222-4222-a222-222222222222',
        dateFrom: '2026-09-01',
        dateTo: '2026-09-30',
        sortBy: 'title',
        sortDir: 'asc',
      }),
      ADMIN,
    );
    const args = prisma.productLandingPage.findMany.mock.calls[0]![0] as ListArgs;
    expect(args.where.productId).toBe('22222222-2222-4222-a222-222222222222');
    expect(args.where.status).toBe('ACTIVE');
    expect(args.where.OR.map((c: { name?: unknown }) => 'name' in c)).toContain(true);
    expect(args.where.AND).toHaveLength(2);
    expect(args.where.updatedAt.gte).toEqual(new Date('2026-08-31T16:00:00Z'));
    expect(args.where.updatedAt.lt).toEqual(new Date('2026-09-30T16:00:00Z'));
    expect(args.orderBy[0]).toEqual({ titleOverride: 'asc' });
  });

});

describe('storefront landing composite + view beacon', () => {
  const liveInclude = () => ({
    id: 'lp-1',
    name: 'A',
    adCode: 'FB-1',
    slug: 'a',
    titleOverride: '促销名',
    imagesOverride: [{ url: 'https://cdn.example.test/a.jpg', altText: '图' }],
    seoTitle: null,
    seoDescription: null,
    promoEnabled: true,
    promoHeadline: 'Christmas Sale',
    promoSubtext: null,
    status: 'ACTIVE' as const,
    startAt: null,
    endAt: null,
    sortOrder: 0,
    publishedContent: { schemaVersion: 1, blocks: [{ id: 'buy', type: 'buy', sourceKey: null, props: {} }] },
    publishedRevision: 1,
    product: { slug: 'chair', status: 'ACTIVE' as const },
  });

  it('returns whitelisted landing fields plus the storefront product', async () => {
    const prisma = {
      product: { findUnique: vi.fn() },
      productLandingPage: { findUnique: vi.fn(async () => liveInclude()) },
      landingPageVisit: { upsert: vi.fn() },
    };
    const products = {
      storefrontGetBySlug: vi.fn(async () => ({ id: 'p1', slug: 'chair', name: 'Chair' })),
    };
    const service = new LandingPagesService(prisma as never, products as never, new LandingSnapshotService(prisma as never), new OptimizersService(prisma as never));

    const result = await service.storefrontGetComposite('a');
    expect(products.storefrontGetBySlug).toHaveBeenCalledWith('chair');
    expect(result.landingPage).toEqual({
      id: 'lp-1',
      slug: 'a',
      content: { schemaVersion: 1, seoTitle: null, seoDescription: null, startAt: null, endAt: null, blocks: [{ id: 'buy', type: 'buy', sourceKey: null, props: {} }] },
      publishedRevision: 1,
    });
    expect(result.landingPage).not.toHaveProperty('name');
    expect(result.landingPage).not.toHaveProperty('draftContent');
    expect(result.landingPage).not.toHaveProperty('adCode');
    expect(result.landingPage).not.toHaveProperty('status');
    expect(result.product).toMatchObject({ slug: 'chair' });
  });

  it.each([
    ['missing', null],
    ['disabled', { ...liveInclude(), status: 'DISABLED' as const }],
    ['scheduled', { ...liveInclude(), startAt: new Date('2099-01-01T00:00:00Z') }],
    ['ended', { ...liveInclude(), endAt: new Date('2000-01-01T00:00:00Z') }],
    ['parent draft', { ...liveInclude(), product: { slug: 'chair', status: 'DRAFT' as const } }],
  ])('404 when %s', async (_label, row) => {
    const prisma = {
      productLandingPage: { findUnique: vi.fn(async () => row) },
      landingPageVisit: { upsert: vi.fn() },
    };
    const products = { storefrontGetBySlug: vi.fn() };
    const service = new LandingPagesService(prisma as never, products as never, new LandingSnapshotService(prisma as never), new OptimizersService(prisma as never));
    await expect(service.storefrontGetComposite('a')).rejects.toBeInstanceOf(NotFoundException);
    expect(products.storefrontGetBySlug).not.toHaveBeenCalled();
  });

  it('recordView counts the same session again after Manila midnight, but not a same-day refresh', async () => {
    const visits = new Set<string>();
    const prisma = {
      productLandingPage: { findUnique: vi.fn(async () => ({ id: 'lp-1', status: 'ACTIVE' as const, publishedContent: { blocks: [] }, startAt: null, endAt: null, product: { status: 'ACTIVE' as const } })) },
      landingPageVisit: { upsert: vi.fn(async ({ where }: { where: unknown }) => { visits.add(JSON.stringify(where)); return {}; }) },
    };
    const service = new LandingPagesService(prisma as never, {} as never, new LandingSnapshotService(prisma as never), new OptimizersService(prisma as never));
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-10-10T15:59:59Z'));
      await service.recordView('a', 'tab-1');
      await service.recordView('a', 'tab-1');
      expect(visits.size).toBe(1);
      vi.setSystemTime(new Date('2026-10-10T16:00:00Z'));
      await service.recordView('a', 'tab-1');
      expect(visits.size).toBe(2);
    } finally { vi.useRealTimers(); }
  });

  it('recordView upserts with the compound unique key for a live LP', async () => {
    const prisma = {
      productLandingPage: {
        findUnique: vi.fn(async () => ({
          id: 'lp-1', status: 'ACTIVE' as const, startAt: null, endAt: null,
          product: { status: 'ACTIVE' as const },
        })),
      },
      landingPageVisit: { upsert: vi.fn(async () => ({})) },
    };
    const service = new LandingPagesService(prisma as never, { storefrontGetBySlug: vi.fn() } as never, new LandingSnapshotService(prisma as never), new OptimizersService(prisma as never));
    await service.recordView('a', 'visit-uuid-1234');
    expect(prisma.landingPageVisit.upsert).toHaveBeenCalledWith({
      where: { landingPageId_visitKey_visitDay: { landingPageId: 'lp-1', visitKey: 'visit-uuid-1234', visitDay: expect.any(Date) } },
      create: { landingPageId: 'lp-1', visitKey: 'visit-uuid-1234', visitDay: expect.any(Date), createdAt: expect.any(Date) },
      update: {},
    });
  });

  it('recordView is a silent no-op when not live and swallows a race P2002', async () => {
    type ViewLookup = {
      id: string;
      status: 'ACTIVE' | 'DISABLED';
      startAt: Date | null;
      endAt: Date | null;
      product: { status: 'ACTIVE' | 'DRAFT' };
    };
    const prisma = {
      productLandingPage: {
        findUnique: vi.fn(async (): Promise<ViewLookup> => ({
          id: 'lp-1', status: 'DISABLED', startAt: null, endAt: null,
          product: { status: 'ACTIVE' },
        })),
      },
      landingPageVisit: { upsert: vi.fn() },
    };
    const service = new LandingPagesService(prisma as never, { storefrontGetBySlug: vi.fn() } as never, new LandingSnapshotService(prisma as never), new OptimizersService(prisma as never));
    await expect(service.recordView('a', 'visit-uuid-1234')).resolves.toBeUndefined();
    expect(prisma.landingPageVisit.upsert).not.toHaveBeenCalled();

    prisma.productLandingPage.findUnique.mockResolvedValueOnce({
      id: 'lp-1', status: 'ACTIVE', startAt: null, endAt: null, product: { status: 'ACTIVE' },
    });
    prisma.landingPageVisit.upsert.mockRejectedValueOnce({ code: 'P2002' });
    await expect(service.recordView('a', 'visit-uuid-1234')).resolves.toBeUndefined();
  });
});
