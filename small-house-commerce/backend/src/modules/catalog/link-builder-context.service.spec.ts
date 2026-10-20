import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '../../generated/prisma/client.js';
import { LinkBuilderContextService } from './link-builder-context.service.js';

const NOW = new Date('2026-09-26T04:30:00.000Z');
const own = { id: 'u1', permissions: ['MARKETING_VIEW_OWN', 'MARKETING_MANAGE_OWN'] };
function harness() {
  const prisma = { product: { findMany: vi.fn().mockResolvedValue([{
    id: 'product', name: 'Compact Chair', productCode: 'CHAIR', slug: 'compact-chair',
    images: [{ url: '/uploads/chair.jpg' }],
    variants: [{ id: 'variant', name: 'Red / Small' }],
    landingPages: [{ id: 'page', slug: 'chair-red', name: 'My launch', ownerUserId: 'u1', status: 'ACTIVE', startAt: new Date('2026-10-01'), endAt: null, owner: { name: 'Operator', optimizerProfile: { aid: 'OP-1', displayName: 'Optimizer' } } }],
  }]) } };
  return { prisma, service: new LinkBuilderContextService(prisma as never) };
}

describe('LinkBuilderContextService', () => {
  it('returns slim target metadata with server-owned page identity and scheduled status', async () => {
    const { service } = harness();
    await expect(service.getContext(own, NOW)).resolves.toEqual({ products: [{
      id: 'product', name: 'Compact Chair', productCode: 'CHAIR', slug: 'compact-chair',
      thumbnailUrl: '/uploads/chair.jpg',
      variants: [{ id: 'variant', name: 'Red / Small' }],
      landingPages: [{ id: 'page', slug: 'chair-red', title: 'My launch', ownerUserId: 'u1', ownerName: 'Optimizer', aid: 'OP-1', effectiveStatus: 'SCHEDULED' }],
    }] });
  });

  it('limits optimizer page choices to their published unexpired records and priced active variants', async () => {
    const { service, prisma } = harness();
    await service.getContext(own, NOW);
    const query = prisma.product.findMany.mock.calls[0]?.[0];
    expect(query).toMatchObject({ where: { status: 'ACTIVE' }, select: {
      variants: { where: { sku: { is: { status: 'ACTIVE', price: { not: null } } } } },
      landingPages: { where: { ownerUserId: 'u1', status: 'ACTIVE', publishedContent: { not: Prisma.DbNull }, OR: [{ endAt: null }, { endAt: { gte: NOW } }] } },
    } });
    expect(query.select.landingPages.where).not.toHaveProperty('startAt');
    expect(JSON.stringify(query.select.landingPages.select)).not.toMatch(/"(?:orders?|customers?|passwordHash|draftContent|publishedContent)":/);
  });

  it('allows broad readers to choose visible pages but refuses unrelated accounts before querying', async () => {
    const { service, prisma } = harness();
    await service.getContext({ id: 'finance', permissions: ['MARKETING_VIEW_ALL'] }, NOW);
    expect(prisma.product.findMany.mock.calls[0]?.[0].select.landingPages.where).not.toHaveProperty('ownerUserId');
    prisma.product.findMany.mockClear();
    await expect(service.getContext({ id: 'legacy', permissions: ['CAMPAIGN_LINK_BUILD'] }, NOW)).rejects.toMatchObject({ status: 403 });
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });
});
