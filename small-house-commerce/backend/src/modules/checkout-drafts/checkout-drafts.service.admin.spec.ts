import { describe, expect, it, vi } from 'vitest';
import { CheckoutDraftsService } from './checkout-drafts.service.js';

function serviceWith(rows: unknown[], total = rows.length) {
  const findMany = vi.fn(async () => rows);
  const count = vi.fn(async () => total);
  const findUnique = vi.fn(async () => rows[0] ?? null);
  const service = new CheckoutDraftsService({
    checkoutDraft: { findMany, count, findUnique },
  } as never);
  return { service, findMany, count, findUnique };
}

describe('CheckoutDraftsService admin reads', () => {
  it('searches name or phone and never includes EXPIRED rows by default', async () => {
    const { service, findMany, count } = serviceWith([]);
    await service.list({ search: '0917', page: 2, pageSize: 20 });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: { in: ['OPEN', 'CONVERTED'] },
          OR: [
            { contactName: { contains: '0917', mode: 'insensitive' } },
            { contactPhone: { contains: '0917' } },
          ],
        },
        skip: 20,
        take: 20,
        orderBy: { updatedAt: 'desc' },
      }),
    );
    expect(count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: { in: ['OPEN', 'CONVERTED'] } }) }),
    );
  });

  it('filters by one status when asked', async () => {
    const { service, findMany } = serviceWith([]);
    await service.list({ status: 'CONVERTED', page: 1, pageSize: 20 });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'CONVERTED' } }),
    );
  });

  it('returns the order number and id of a converted draft', async () => {
    const { service } = serviceWith([
      {
        id: 'draft-1',
        status: 'CONVERTED',
        hasUserInput: true,
        clientRevision: 4,
        contactName: 'Ana',
        contactPhone: '0917',
        snapshot: {},
        productSnapshot: [],
        orderId: 'order-1',
        createdAt: new Date('2026-11-01'),
        updatedAt: new Date('2026-11-02'),
        expiresAt: new Date('2026-12-01'),
        order: { id: 'order-1', orderNumber: 'PH100020' },
      },
    ]);
    await expect(service.detail('draft-1')).resolves.toMatchObject({
      id: 'draft-1',
      status: 'CONVERTED',
      orderId: 'order-1',
      orderNumber: 'PH100020',
    });
  });

  it('summarises products for the list row', async () => {
    const { service } = serviceWith([
      {
        id: 'draft-2',
        status: 'OPEN',
        hasUserInput: true,
        contactName: null,
        contactPhone: '0917',
        productSnapshot: [
          {
            skuId: 'sku-1', skuCode: 'SH-1', productId: 'p-1', productName: 'Oak Chair',
            productSlug: 'oak-chair', variantName: 'Natural', thumbnailUrl: '/a.jpg',
            unitPrice: '1299', quantity: 2,
          },
        ],
        orderId: null,
        createdAt: new Date('2026-11-01'),
        updatedAt: new Date('2026-11-02'),
        expiresAt: new Date('2026-12-01'),
        order: null,
      },
    ]);
    await expect(service.detail('draft-2')).resolves.toMatchObject({
      itemCount: 1,
      firstItemName: 'Oak Chair',
      firstItemThumbnail: '/a.jpg',
      orderId: null,
      orderNumber: null,
    });
  });
});
