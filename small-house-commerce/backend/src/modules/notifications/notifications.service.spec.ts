import { ForbiddenException } from '@nestjs/common';
import { attentionWhere } from '../catalog/admin-product-attention.js';
import { NotificationsService } from './notifications.service.js';

const USER_ID = '018f0c8b-2f4f-7f65-a409-a6bdb7de7523';
const NOW = new Date('2026-09-26T00:00:00.000Z');

function userWith(permissions: string[], status = 'ACTIVE') {
  return {
    status,
    roles: [
      {
        role: {
          permissions: permissions.map((code) => ({ permission: { code } })),
        },
      },
    ],
  };
}

function harness(permissions: string[]) {
  const prisma = {
    user: {
      findUnique: vi.fn().mockResolvedValue(userWith(permissions)),
    },
    order: {
      count: vi.fn(),
    },
    product: {
      count: vi.fn(),
    },
  };
  return {
    prisma,
    service: new NotificationsService(prisma as never),
  };
}

describe('NotificationsService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns authorized positive issue counts in deterministic contract order', async () => {
    const { service, prisma } = harness(['ORDER_CONFIRM', 'PRODUCT_MANAGE']);
    prisma.order.count.mockResolvedValueOnce(2).mockResolvedValueOnce(3);
    prisma.product.count
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(11)
      .mockResolvedValueOnce(13);

    const result = await service.notifications(USER_ID);

    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: USER_ID },
      select: {
        status: true,
        roles: {
          select: {
            role: {
              select: {
                permissions: {
                  select: { permission: { select: { code: true } } },
                },
              },
            },
          },
        },
      },
    });
    expect(result.items).toEqual([
      {
        kind: 'ORDER_NEEDS_REVIEW',
        count: 2,
        href: '/admin/orders?confirmation=NEEDS_REVIEW',
      },
      {
        kind: 'ORDER_UNCONFIRMED',
        count: 3,
        href: '/admin/orders?confirmation=UNCONFIRMED',
      },
      {
        kind: 'PRODUCT_MISSING_MEDIA',
        count: 5,
        href: '/admin/products?attention=missing_media',
      },
      {
        kind: 'PRODUCT_NO_PRICED_SKU',
        count: 7,
        href: '/admin/products?attention=no_priced_sku',
      },
      {
        kind: 'PRODUCT_INCOMPLETE_SHIPPING',
        count: 11,
        href: '/admin/products?attention=incomplete_shipping',
      },
      {
        kind: 'PRODUCT_STALE_DRAFT',
        count: 13,
        href: '/admin/products?attention=stale_draft',
      },
    ]);
    expect(result.totalCount).toBe(41);
    expect(result.totalCount).toBe(
      result.items.reduce((sum, item) => sum + item.count, 0),
    );
    expect(result).not.toHaveProperty('generatedAt');
    expect(result.items.every((item) => !('timestamp' in item))).toBe(true);
  });

  it('omits zero-count categories without changing the remaining order or sum', async () => {
    const { service, prisma } = harness(['ORDER_CONFIRM', 'PRODUCT_MANAGE']);
    prisma.order.count.mockResolvedValueOnce(0).mockResolvedValueOnce(4);
    prisma.product.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(6)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(8);

    await expect(service.notifications(USER_ID)).resolves.toEqual({
      totalCount: 18,
      items: [
        {
          kind: 'ORDER_UNCONFIRMED',
          count: 4,
          href: '/admin/orders?confirmation=UNCONFIRMED',
        },
        {
          kind: 'PRODUCT_NO_PRICED_SKU',
          count: 6,
          href: '/admin/products?attention=no_priced_sku',
        },
        {
          kind: 'PRODUCT_STALE_DRAFT',
          count: 8,
          href: '/admin/products?attention=stale_draft',
        },
      ],
    });
  });

  it('does not treat ORDER_VIEW_ALL as confirmation-work permission', async () => {
    const { service, prisma } = harness(['ORDER_VIEW_ALL']);

    await expect(service.notifications(USER_ID)).resolves.toEqual({
      totalCount: 0,
      items: [],
    });
    expect(prisma.order.count).not.toHaveBeenCalled();
    expect(prisma.product.count).not.toHaveBeenCalled();
  });

  it('runs only canonical product counts for a product-only user', async () => {
    const { service, prisma } = harness(['PRODUCT_MANAGE']);
    prisma.product.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(4);

    const result = await service.notifications(USER_ID);

    expect(prisma.order.count).not.toHaveBeenCalled();
    expect(prisma.product.count).toHaveBeenCalledTimes(4);
    expect(result.totalCount).toBe(10);
    expect(result.items.map((item) => item.kind)).toEqual([
      'PRODUCT_MISSING_MEDIA',
      'PRODUCT_NO_PRICED_SKU',
      'PRODUCT_INCOMPLETE_SHIPPING',
      'PRODUCT_STALE_DRAFT',
    ]);
  });

  it('returns an exact empty response without domain queries for unsupported permissions', async () => {
    const { service, prisma } = harness(['ORDER_VIEW_OWN', 'CUSTOMER_MANAGE']);

    await expect(service.notifications(USER_ID)).resolves.toEqual({
      totalCount: 0,
      items: [],
    });
    expect(prisma.order.count).not.toHaveBeenCalled();
    expect(prisma.product.count).not.toHaveBeenCalled();
  });

  it.each(['DISABLED', null])('rejects missing or inactive identity: %s', async (status) => {
    const { service, prisma } = harness([]);
    prisma.user.findUnique.mockResolvedValue(
      status === null ? null : userWith([], status),
    );

    await expect(service.notifications(USER_ID)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.order.count).not.toHaveBeenCalled();
    expect(prisma.product.count).not.toHaveBeenCalled();
  });

  it('rejects the whole response when one authorized domain count fails', async () => {
    const { service, prisma } = harness(['ORDER_CONFIRM', 'PRODUCT_MANAGE']);
    prisma.order.count
      .mockResolvedValueOnce(1)
      .mockRejectedValueOnce(new Error('order count failed'));
    prisma.product.count.mockResolvedValue(1);

    await expect(service.notifications(USER_ID)).rejects.toThrow(
      'order count failed',
    );
  });

  it('uses exact order states and canonical product predicates with one captured now', async () => {
    const { service, prisma } = harness(['ORDER_CONFIRM', 'PRODUCT_MANAGE']);
    prisma.order.count.mockResolvedValue(1);
    prisma.product.count.mockResolvedValue(1);

    await service.notifications(USER_ID);

    expect(prisma.order.count).toHaveBeenNthCalledWith(1, {
      where: { confirmationStatus: 'NEEDS_REVIEW' },
    });
    expect(prisma.order.count).toHaveBeenNthCalledWith(2, {
      where: { confirmationStatus: 'UNCONFIRMED' },
    });
    expect(prisma.product.count).toHaveBeenNthCalledWith(1, {
      where: attentionWhere('missing_media'),
    });
    expect(prisma.product.count).toHaveBeenNthCalledWith(2, {
      where: attentionWhere('no_priced_sku'),
    });
    expect(prisma.product.count).toHaveBeenNthCalledWith(3, {
      where: attentionWhere('incomplete_shipping'),
    });
    expect(prisma.product.count).toHaveBeenNthCalledWith(4, {
      where: attentionWhere('stale_draft', NOW),
    });
  });
});
