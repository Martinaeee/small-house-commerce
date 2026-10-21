import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { OrdersService } from './orders.service.js';

/**
 * Guest order lookup (2026-10-21 revision): the shopper may give the order
 * number OR the mobile number — either one alone has to work.
 *
 * The security model changes with it:
 * - mobile number alone  → the phone IS the identity proof, full details.
 * - order number alone   → a 6-digit sequential number is guessable, so the
 *   personal fields (name, phone, delivery address) are withheld until the
 *   shopper also proves the phone.
 */

const NOT_FOUND_MESSAGE = 'Order not found. Check your order number or mobile number.';

function orderRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    orderNumber: 'PH100001',
    orderStatus: 'NEW',
    confirmationStatus: 'UNCONFIRMED',
    paymentStatus: 'COD_PENDING',
    currency: 'PHP',
    subtotal: '210',
    discountTotal: '0',
    shippingTotal: '0',
    grandTotal: '210',
    createdAt: '2026-10-21T00:00:00.000Z',
    customer: {
      id: 'cust-1',
      name: 'Juan Dela Cruz',
      normalizedPhone: '+639171234567',
      email: null,
    },
    items: [
      {
        id: 'item-1',
        productId: 'product-1',
        variantId: 'variant-1',
        skuId: 'sku-1',
        productNameSnapshot: 'Chair',
        skuCodeSnapshot: 'RED-SMALL',
        variantSnapshot: 'Red / Small',
        optionSnapshot: null,
        quantity: 1,
        unitPrice: '210',
        lineTotal: '210',
        createdAt: '2026-10-21T00:00:00.000Z',
      },
    ],
    shippingAddress: {
      id: 'addr-1',
      fullName: 'Juan Dela Cruz',
      phone: '09171234567',
      province: 'Metro Manila',
      city: 'Manila',
      barangay: null,
      postalCode: null,
      streetAddress: '1 Main St',
      landmark: null,
      createdAt: '2026-10-21T00:00:00.000Z',
    },
    statusHistory: [],
    ...overrides,
  };
}

function createHarness() {
  const prisma = {
    order: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  };
  const service = new OrdersService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, prisma };
}

describe('OrdersService.lookup — order number alone', () => {
  it('returns the order but withholds the personal details', async () => {
    const { service, prisma } = createHarness();
    prisma.order.findUnique.mockResolvedValue(orderRecord());

    const result = await service.lookup('PH100001', null);

    expect(result.orderNumber).toBe('PH100001');
    expect(result.matchedBy).toBe('orderNumber');
    expect(result.personalDetailsIncluded).toBe(false);
    expect(result.shippingAddress).toBeNull();
    expect(result.customer?.name).toBeNull();
    expect(result.customer?.normalizedPhone).toBeNull();
  });

  it('throws the uniform 404 when the order number does not exist', async () => {
    const { service, prisma } = createHarness();
    prisma.order.findUnique.mockResolvedValue(null);

    const err = await service.lookup('PH999999', null).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(NotFoundException);
    expect((err as Error).message).toBe(NOT_FOUND_MESSAGE);
  });
});

describe('OrdersService.lookup — mobile number alone', () => {
  it('returns the most recent order for that number with its personal details', async () => {
    const { service, prisma } = createHarness();
    prisma.order.findMany.mockResolvedValue([orderRecord()]);

    const result = await service.lookup(null, '0917 123 4567');

    expect(result.orderNumber).toBe('PH100001');
    expect(result.matchedBy).toBe('phone');
    expect(result.personalDetailsIncluded).toBe(true);
    expect(result.shippingAddress?.streetAddress).toBe('1 Main St');
    expect(result.customer?.name).toBe('Juan Dela Cruz');
    expect(result.otherOrders).toEqual([]);
  });

  it('lists the other orders on that number so the shopper can pick one', async () => {
    const { service, prisma } = createHarness();
    prisma.order.findMany.mockResolvedValue([
      orderRecord({ id: 'order-3', orderNumber: 'PH100003', createdAt: '2026-10-21T05:00:00.000Z' }),
      orderRecord({ id: 'order-2', orderNumber: 'PH100002', createdAt: '2026-10-21T02:00:00.000Z' }),
      orderRecord({ id: 'order-1', orderNumber: 'PH100001', createdAt: '2026-09-21T02:00:00.000Z' }),
    ]);

    const result = await service.lookup(null, '09171234567');

    expect(result.orderNumber).toBe('PH100003');
    expect(result.otherOrders).toEqual([
      expect.objectContaining({ orderNumber: 'PH100002' }),
      expect.objectContaining({ orderNumber: 'PH100001' }),
    ]);
  });

  it('throws the uniform 404 when no order belongs to that number', async () => {
    const { service, prisma } = createHarness();
    prisma.order.findMany.mockResolvedValue([]);

    const err = await service.lookup(null, '09171234567').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(NotFoundException);
    expect((err as Error).message).toBe(NOT_FOUND_MESSAGE);
  });

  it('throws the uniform 404 when the number cannot be parsed', async () => {
    const { service, prisma } = createHarness();
    prisma.order.findMany.mockResolvedValue([]);

    const err = await service.lookup(null, 'abc').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(NotFoundException);
    expect((err as Error).message).toBe(NOT_FOUND_MESSAGE);
  });
});

describe('OrdersService.lookup — both fields', () => {
  it('keeps the strict phone check and the full details', async () => {
    const { service, prisma } = createHarness();
    prisma.order.findUnique.mockResolvedValue(orderRecord());

    const result = await service.lookup('PH100001', '09171234567');

    expect(result.matchedBy).toBe('orderNumber');
    expect(result.personalDetailsIncluded).toBe(true);
    expect(result.shippingAddress?.streetAddress).toBe('1 Main St');
  });

  it('throws the uniform 404 when neither field is given', async () => {
    const { service, prisma } = createHarness();

    const err = await service.lookup(null, null).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(NotFoundException);
    expect((err as Error).message).toBe(NOT_FOUND_MESSAGE);
    expect(prisma.order.findUnique).not.toHaveBeenCalled();
    expect(prisma.order.findMany).not.toHaveBeenCalled();
  });
});

describe('OrdersService.lookup — guest data minimisation', () => {
  it('never pulls internal notes, risk flags or cost snapshots for the guest', async () => {
    const { service, prisma } = createHarness();
    prisma.order.findUnique.mockResolvedValue(orderRecord());

    await service.lookup('PH100001', null);

    const args = JSON.stringify(prisma.order.findUnique.mock.calls[0]?.[0] ?? {});
    for (const internal of [
      'notes',
      'riskFlags',
      'riskLogs',
      'unitCostSnapshot',
      'unitDiscount',
      'reservations',
      'mergeRecords',
      'payments',
      'optimizer',
    ]) {
      expect(args).not.toContain(internal);
    }
  });
});
