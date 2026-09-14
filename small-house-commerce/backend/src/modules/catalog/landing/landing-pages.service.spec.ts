import { ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductsService } from '../products.service.js';
import { LandingPagesService } from './landing-pages.service.js';
import { createLandingPageSchema, updateLandingPageSchema } from './dto/landing-page.dto.js';
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

describe('LandingPagesService CRUD', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let products: Pick<ProductsService, 'storefrontGetBySlug'>;
  let service: LandingPagesService;

  beforeEach(() => {
    prisma = createPrismaMock();
    products = { storefrontGetBySlug: vi.fn() };
    service = new LandingPagesService(prisma as never, products as unknown as ProductsService);
  });

  const validInput = () =>
    createLandingPageSchema.parse({
      name: '圣诞版',
      slug: 'os-chair-xmas',
      titleOverride: '圣诞特价人体工学椅',
      startAt: '2026-12-01T00:00:00+08:00',
      endAt: '2026-12-31T23:59:59+08:00',
    });

  it('creates a landing page with Date-converted window and effectiveStatus attached', async () => {
    const result = await service.adminCreate('22222222-2222-2222-2222-222222222222', validInput());
    const data = prisma.productLandingPage.create.mock.calls[0]![0].data;
    expect(data.startAt).toBeInstanceOf(Date);
    expect(data.endAt).toBeInstanceOf(Date);
    expect(result.effectiveStatus).toBe('SCHEDULED');
  });

  it('create throws 404 when the parent product is missing', async () => {
    prisma.product.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.adminCreate('22222222-2222-2222-2222-222222222222', validInput()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('create maps P2002 slug collision to 409', async () => {
    prisma.productLandingPage.create.mockRejectedValueOnce({ code: 'P2002' });
    await expect(
      service.adminCreate('22222222-2222-2222-2222-222222222222', validInput()),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('lists for a product in sortOrder/createdAt order with effectiveStatus', async () => {
    const rows = await service.adminListForProduct('22222222-2222-2222-2222-222222222222');
    const findManyArg = prisma.productLandingPage.findMany.mock.calls[0]![0] as {
      orderBy: unknown;
    };
    expect(findManyArg.orderBy).toEqual([
      { sortOrder: 'asc' },
      { createdAt: 'asc' },
    ]);
    expect(rows[0]).toMatchObject({ slug: 'os-chair', effectiveStatus: 'LIVE' });
  });

  it('update 404s on unknown id; otherwise persists and clears nullable fields', async () => {
    prisma.productLandingPage.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.adminUpdate('11111111-1111-1111-1111-111111111111', updateLandingPageSchema.parse({})),
    ).rejects.toBeInstanceOf(NotFoundException);

    prisma.productLandingPage.findUnique.mockResolvedValueOnce(lpRow());
    await service.adminUpdate(
      '11111111-1111-1111-1111-111111111111',
      updateLandingPageSchema.parse({ titleOverride: null, promoEnabled: false, promoHeadline: null }),
    );
    const data = prisma.productLandingPage.update.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.titleOverride).toBeNull();
    expect(data.promoHeadline).toBeNull();
  });

  it('remove 404s on unknown id and returns id on success', async () => {
    prisma.productLandingPage.findUnique.mockResolvedValueOnce(null);
    await expect(service.adminRemove('11111111-1111-1111-1111-111111111111')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    prisma.productLandingPage.findUnique.mockResolvedValueOnce(lpRow());
    await expect(service.adminRemove('11111111-1111-1111-1111-111111111111')).resolves.toEqual({
      id: '11111111-1111-1111-1111-111111111111',
    });
  });
});
