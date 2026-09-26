import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LinkBuilderContextService } from './link-builder-context.service.js';

const NOW = new Date('2026-09-26T04:30:00.000Z');

function harness() {
  const prisma = {
    product: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: '00000000-0000-7000-8000-000000000001',
          name: 'Compact Chair',
          slug: 'compact-chair',
          variants: [
            {
              id: '00000000-0000-7000-8000-000000000002',
              name: 'Red / Small',
            },
          ],
          landingPages: [
            {
              id: '00000000-0000-7000-8000-000000000003',
              slug: 'compact-chair-red',
              titleOverride: 'Compact Chair for Condos',
            },
            {
              id: '00000000-0000-7000-8000-000000000004',
              slug: 'compact-chair-organic',
              titleOverride: null,
            },
          ],
        },
      ]),
    },
  };
  return {
    prisma,
    service: new LinkBuilderContextService(prisma as never),
  };
}

describe('LinkBuilderContextService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns only public catalog link metadata', async () => {
    const { service } = harness();

    await expect(service.getContext()).resolves.toEqual({
      products: [
        {
          id: '00000000-0000-7000-8000-000000000001',
          name: 'Compact Chair',
          slug: 'compact-chair',
          variants: [
            {
              id: '00000000-0000-7000-8000-000000000002',
              name: 'Red / Small',
            },
          ],
          landingPages: [
            {
              id: '00000000-0000-7000-8000-000000000003',
              slug: 'compact-chair-red',
              title: 'Compact Chair for Condos',
            },
            {
              id: '00000000-0000-7000-8000-000000000004',
              slug: 'compact-chair-organic',
              title: 'Compact Chair',
            },
          ],
        },
      ],
    });
  });

  it('queries only active products, active SKU variants and currently live landing pages', async () => {
    const { service, prisma } = harness();

    await service.getContext();

    expect(prisma.product.findMany).toHaveBeenCalledWith({
      where: { status: 'ACTIVE' },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        slug: true,
        variants: {
          where: { sku: { is: { status: 'ACTIVE' } } },
          orderBy: [{ position: 'asc' }, { id: 'asc' }],
          select: { id: true, name: true },
        },
        landingPages: {
          where: {
            status: 'ACTIVE',
            AND: [
              { OR: [{ startAt: null }, { startAt: { lte: NOW } }] },
              { OR: [{ endAt: null }, { endAt: { gte: NOW } }] },
            ],
          },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            slug: true,
            titleOverride: true,
          },
        },
      },
    });
    const query = prisma.product.findMany.mock.calls[0]?.[0];
    expect(JSON.stringify(query)).not.toMatch(
      /"(?:orders?|customers?|profit|optimizer|adCode|seoDescription|imagesOverride)":/i,
    );
  });
});
