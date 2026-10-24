import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductsService } from './products.service.js';
import { bulkPdpBannerSchema, createProductSchema, updateProductSchema } from './dto/product.dto.js';
import { updateSettingsSchema } from '../settings/dto/settings.dto.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { ReviewsService } from './reviews.service.js';
import type { InventoryService } from '../inventory/inventory.service.js';
import { revalidateCache } from '../../common/revalidation.js';

vi.mock('../../common/revalidation.js', () => ({
  CACHE_TAGS: { STOREFRONT: 'storefront' }, revalidateCache: vi.fn(),
}));
const id = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';

beforeEach(() => vi.clearAllMocks());

describe('PDP presentation validation', () => {
  it('preserves omitted presentation fields on partial updates', () => {
    expect(updateProductSchema.parse({ name: 'Desk' })).toEqual({ name: 'Desk' });
    expect(createProductSchema.parse({ name: 'Desk', slug: 'desk', categoryId: id }))
      .not.toHaveProperty('pdpBannerEnabled');
  });

  it('accepts per-product presentation fields and the site default', () => {
    expect(updateProductSchema.parse({ sellingPointsVisibility: 'HIDE', pdpBannerEnabled: true,
      pdpBannerText: ' Offer ', pdpBannerBackground: '#123456', pdpBannerTextColor: null }))
      .toMatchObject({ sellingPointsVisibility: 'HIDE', pdpBannerText: 'Offer' });
    expect(updateSettingsSchema.parse({ messengerUrl: '', hideSellingPoints: true }))
      .toMatchObject({ hideSellingPoints: true });
  });

  it.each(['red', '#fff', 'url(https://example.com/x)', '#123456; color:red'])('rejects unsafe colour %s', (colour) => {
    expect(updateProductSchema.safeParse({ pdpBannerBackground: colour }).success).toBe(false);
    expect(bulkPdpBannerSchema.safeParse({ ids: [id], banner: { text: 'Offer', background: colour } }).success).toBe(false);
  });

  it('bounds bulk requests and rejects blank or oversized banner text', () => {
    for (const ids of [[], Array(101).fill(id)]) {
      expect(bulkPdpBannerSchema.safeParse({ ids, banner: null }).success).toBe(false);
    }
    for (const text of ['   ', 'x'.repeat(61)]) {
      expect(bulkPdpBannerSchema.safeParse({ ids: [id], banner: { text, background: '#123456' } }).success).toBe(false);
    }
    expect(bulkPdpBannerSchema.parse({ ids: [id], banner: null }).banner).toBeNull();
  });
});

describe('bulk PDP banner writes', () => {
  function harness(count = 1) {
    const updateMany = vi.fn().mockResolvedValue({ count });
    const prisma = { product: { updateMany } } as unknown as PrismaService;
    return { updateMany, service: new ProductsService(prisma, {} as ReviewsService, {} as InventoryService) };
  }

  it('updates only the requested IDs, counts actual writes, and revalidates storefront', async () => {
    const { service, updateMany } = harness(1);
    expect(await service.bulkSetPdpBanner([id, other, id], { text: 'Offer', background: '#123456' }))
      .toEqual({ updated: 1, notFound: 1 });
    expect(updateMany).toHaveBeenCalledWith({ where: { id: { in: [id, other] } }, data: {
      pdpBannerEnabled: true, pdpBannerText: 'Offer', pdpBannerBackground: '#123456', pdpBannerTextColor: null,
    } });
    expect(revalidateCache).toHaveBeenCalledWith(['storefront']);
  });

  it('clears every presentation field without touching product status or tags', async () => {
    const { service, updateMany } = harness();
    await service.bulkSetPdpBanner([id], null);
    expect(updateMany.mock.calls[0][0].data).toEqual({
      pdpBannerEnabled: false, pdpBannerText: null, pdpBannerBackground: null, pdpBannerTextColor: null,
    });
  });

  it('does not report success or invalidate the storefront after a failed write', async () => {
    const { service, updateMany } = harness();
    updateMany.mockRejectedValue(new Error('database unavailable'));
    await expect(service.bulkSetPdpBanner([id], null)).rejects.toThrow('database unavailable');
    expect(revalidateCache).not.toHaveBeenCalled();
  });
});
