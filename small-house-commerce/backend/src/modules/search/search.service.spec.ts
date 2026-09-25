import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { SearchService } from './search.service.js';

const USER_ID = '018f0c8b-2f4f-7f65-a409-a6bdb7de7523';
const PRODUCT_ID = '018f0c8b-2f4f-7f65-a409-a6bdb7de7524';

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

function productRow(overrides: Record<string, unknown> = {}) {
  return {
    product_id: PRODUCT_ID,
    name: 'Dining Chair',
    product_code: 'P-000123',
    slug: 'dining-chair',
    product_status: 'ACTIVE',
    matched_field: 'SKU_CODE',
    matched_text: 'CHAIR-L',
    sku_id: '018f0c8b-2f4f-7f65-a409-a6bdb7de7525',
    sku_code: 'CHAIR-L',
    sku_status: 'ACTIVE',
    variant_id: '018f0c8b-2f4f-7f65-a409-a6bdb7de7526',
    variant_name: 'Large',
    price: new Prisma.Decimal('1590'),
    available_inventory: 17,
    ...overrides,
  };
}

const orderRow = {
  order_id: '018f0c8b-2f4f-7f65-a409-a6bdb7de7530',
  order_number: 'PH120045',
  order_status: 'NEW',
  confirmation_status: 'UNCONFIRMED',
  customer_name: 'Jane Cruz',
  normalized_phone: '+639171234567',
  created_at: new Date('2026-09-25T01:02:03.000Z'),
  matched_field: 'ORDER_NUMBER',
  matched_text: 'PH120045',
};

const customerRow = {
  customer_id: '018f0c8b-2f4f-7f65-a409-a6bdb7de7540',
  name: 'Jane Cruz',
  normalized_phone: '+639171234567',
  email: null,
  risk_level: 'NORMAL',
  matched_field: 'PHONE',
  matched_text: '+639171234567',
};

function shipmentRow(id: string) {
  return {
    shipment_id: id,
    tracking_number: 'DUPLICATE-TRACKING',
    carrier: 'LBC',
    status: 'SHIPPING',
    order_id: orderRow.order_id,
    order_number: orderRow.order_number,
    matched_field: 'TRACKING_NUMBER',
    matched_text: 'DUPLICATE-TRACKING',
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function harness(permissions: string[]) {
  const prisma = {
    user: {
      findUnique: vi.fn().mockResolvedValue(userWith(permissions)),
    },
    $queryRaw: vi.fn(),
  };
  return {
    prisma,
    service: new SearchService(prisma as never),
  };
}

describe('SearchService', () => {
  it('queries only groups authorized by the active user', async () => {
    const { service, prisma } = harness(['PRODUCT_MANAGE']);
    prisma.$queryRaw.mockResolvedValueOnce([productRow()]);

    const result = await service.search(USER_ID, { q: 'chair', limit: 5 });

    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.user.findUnique.mock.calls[0]![0]).not.toHaveProperty('include');
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(Object.keys(result.groups)).toEqual(['products']);
    expect(result.groups.products?.items[0]).toMatchObject({
      kind: 'PRODUCT',
      productId: PRODUCT_ID,
      status: 'ACTIVE',
      matchedField: 'SKU_CODE',
      matchedSku: {
        skuCode: 'CHAIR-L',
        price: '1590',
        availableInventory: 17,
      },
    });
    expect(result.groups.products?.items[0]).not.toHaveProperty('supplierCost');
  });

  it('returns no groups and performs no raw query for ORDER_VIEW_OWN only', async () => {
    const { service, prisma } = harness(['ORDER_VIEW_OWN']);

    await expect(service.search(USER_ID, { q: 'PH12', limit: 5 })).resolves.toEqual({
      query: 'PH12',
      groups: {},
    });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it.each(['DISABLED', null])('rejects missing or inactive identity: %s', async (status) => {
    const { service, prisma } = harness([]);
    prisma.user.findUnique.mockResolvedValue(
      status === null ? null : userWith([], status),
    );

    await expect(
      service.search(USER_ID, { q: 'chair', limit: 5 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('returns groups in contract order even when queries complete in reverse order', async () => {
    const { service, prisma } = harness([
      'PRODUCT_MANAGE',
      'ORDER_VIEW_ALL',
      'CUSTOMER_MANAGE',
    ]);
    const products = deferred<unknown[]>();
    const orders = deferred<unknown[]>();
    const shipments = deferred<unknown[]>();
    const customers = deferred<unknown[]>();
    prisma.$queryRaw
      .mockReturnValueOnce(products.promise)
      .mockReturnValueOnce(orders.promise)
      .mockReturnValueOnce(shipments.promise)
      .mockReturnValueOnce(customers.promise);

    const pending = service.search(USER_ID, { q: 'common', limit: 5 });
    await vi.waitFor(() => expect(prisma.$queryRaw).toHaveBeenCalledTimes(4));
    customers.resolve([customerRow]);
    shipments.resolve([shipmentRow('018f0c8b-2f4f-7f65-a409-a6bdb7de7550')]);
    orders.resolve([orderRow]);
    products.resolve([productRow()]);

    const result = await pending;
    expect(Object.keys(result.groups)).toEqual([
      'products',
      'orders',
      'customers',
      'shipments',
    ]);
    expect(result.groups.orders?.items[0]?.createdAt).toBe('2026-09-25T01:02:03.000Z');
    expect(result.groups.customers?.items[0]?.email).toBeNull();
  });

  it('derives hasMore from limit plus one and preserves nullable SKU price', async () => {
    const { service, prisma } = harness(['PRODUCT_MANAGE']);
    prisma.$queryRaw.mockResolvedValueOnce([
      productRow({ product_id: `${PRODUCT_ID.slice(0, -1)}1`, price: null }),
      productRow({ product_id: `${PRODUCT_ID.slice(0, -1)}2` }),
      productRow({ product_id: `${PRODUCT_ID.slice(0, -1)}3` }),
    ]);

    const result = await service.search(USER_ID, { q: 'chair', limit: 2 });

    expect(result.groups.products).toMatchObject({ hasMore: true });
    expect(result.groups.products?.items).toHaveLength(2);
    expect(result.groups.products?.items[0]?.matchedSku?.price).toBeNull();
  });

  it('keeps duplicate tracking numbers as separate Shipment results', async () => {
    const { service, prisma } = harness(['ORDER_VIEW_ALL']);
    prisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        shipmentRow('018f0c8b-2f4f-7f65-a409-a6bdb7de7551'),
        shipmentRow('018f0c8b-2f4f-7f65-a409-a6bdb7de7552'),
      ]);

    const result = await service.search(USER_ID, { q: 'duplicate', limit: 5 });

    expect(result.groups.shipments?.items).toHaveLength(2);
    expect(result.groups.shipments?.items.map((item) => item.shipmentId)).toEqual([
      '018f0c8b-2f4f-7f65-a409-a6bdb7de7551',
      '018f0c8b-2f4f-7f65-a409-a6bdb7de7552',
    ]);
  });

  it('rejects the aggregate response when one authorized query fails', async () => {
    const { service, prisma } = harness(['PRODUCT_MANAGE', 'CUSTOMER_MANAGE']);
    prisma.$queryRaw
      .mockResolvedValueOnce([productRow()])
      .mockRejectedValueOnce(new Error('customer query failed'));

    await expect(
      service.search(USER_ID, { q: 'common', limit: 5 }),
    ).rejects.toThrow('customer query failed');
  });
});
