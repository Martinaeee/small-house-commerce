import { Prisma } from '../../generated/prisma/client.js';
import { describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { InventoryService } from '../inventory/inventory.service.js';
import { checkoutSchema } from './dto/order.dto.js';
import { idempotencyFingerprint } from './order-idempotency.js';
import { buildBundleSnapshot } from './order-item-snapshot.js';
import { OrdersService } from './orders.service.js';

// Valid v4 UUIDs: zod 4 enforces version/variant, and skuId/landingPageId pass
// through z.string().uuid() at the DTO boundary.
const SKU_ID = '00000000-0000-4000-8000-0000000000a1';
const LP_ID = '11111111-1111-4111-a111-111111111111';

function skuRecord() {
  return {
    id: SKU_ID,
    skuCode: 'CHAIR-1',
    status: 'ACTIVE',
    price: new Prisma.Decimal('199'),
    landedCost: new Prisma.Decimal('100'),
    // The real sku include always returns the Bundle bindings (empty for an
    // ordinary SKU); the fixture mirrors that shape.
    isBundle: false,
    bundleComponents: [],
    variant: {
      id: '00000000-0000-4000-8000-0000000000b1',
      name: 'Single',
      productId: '00000000-0000-4000-8000-0000000000c1',
      product: {
        id: '00000000-0000-4000-8000-0000000000c1',
        name: 'Chair',
        status: 'ACTIVE',
      },
    },
  };
}

function checkoutOverrides(overrides: Record<string, unknown> = {}) {
  return checkoutSchema.parse({
    customer: {
      name: 'Jane',
      phone: '09171234567',
      province: 'Metro Manila',
      city: 'Manila',
      streetAddress: '1 Main St',
    },
    items: [{ skuId: SKU_ID, quantity: 1 }],
    attribution: { sourceType: 'ORGANIC' },
    ...overrides,
  });
}

function createHarness(options: { skus?: Record<string, unknown>; metaCapi?: { enqueuePurchase: (...args: unknown[]) => Promise<boolean> } } = {}) {
  const skus = options.skus ?? { [SKU_ID]: skuRecord() };
  const tx: Record<string, any> = {
    $queryRaw: vi.fn(async (query: TemplateStringsArray) => query.join('').includes("nextval('order_number_seq')") ? [{ nextval: 1n }] : []),
    $executeRaw: vi.fn(async () => 0),
    order: {
      create: vi.fn(async (_args: { data: Record<string, unknown> }) => ({ id: 'order-1' })),
      findUnique: vi.fn(),
      update: vi.fn(async (_args: { where: Record<string, unknown>; data: Record<string, unknown> }) => ({
        id: 'order-1',
        ...(_args?.data ?? {}),
      })),
    },
    orderStatusHistory: { create: vi.fn(async () => ({})) },
    orderHandoverEvent: { findMany: vi.fn(async () => []) },
    returnAcceptanceItem: { findMany: vi.fn(async () => []) },
    customerRiskLog: { create: vi.fn(async () => ({})) },
    customerNote: { create: vi.fn(async () => ({})) },
    orderItem: {
      findMany: vi.fn(async () => []),
      delete: vi.fn(async () => ({})),
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
    },
    orderShippingAddress: {
      update: vi.fn(async () => ({})),
      create: vi.fn(async () => ({})),
    },
    orderMergeRecord: { create: vi.fn(async () => ({})) },
    inventoryReservation: { updateMany: vi.fn(async () => ({ count: 1 })) },
    shipment: { create: vi.fn(async () => ({ id: 'ship-1' })) },
    orderNote: { create: vi.fn(async () => ({})) },
    sku: { findMany: vi.fn(async () => []), findUnique: vi.fn() },
  };
  const prisma = {
    customer: { upsert: vi.fn(async () => ({ id: 'cust-1' })) },
    sku: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => skus[where.id] ?? null) },
    order: { findUnique: vi.fn() },
    $queryRaw: vi.fn(async () => [{ nextval: 1n }]),
    $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
  };
  tx.order.findUnique.mockImplementation((args: { where: { id: string } }) => prisma.order.findUnique(args));
  tx.sku.findUnique.mockImplementation((args: { where: { id: string } }) => prisma.sku.findUnique(args));
  const inventory = {
    availableBySku: vi.fn(async () => new Map([[SKU_ID, 5]])),
    defaultWarehouse: vi.fn(async () => ({ id: 'wh-1' })),
    reserveWithin: vi.fn<InventoryService['reserveWithin']>(async () => undefined),
    reserveConditionalWithin: vi.fn<InventoryService['reserveConditionalWithin']>(async () => undefined),
    releaseForOrder: vi.fn<InventoryService['releaseForOrder']>(async () => []),
    consumeForOrder: vi.fn<InventoryService['consumeForOrder']>(async () => undefined),
  };
  const customerRisk = {
    classifyForNewOrder: vi.fn(async () => ({
      classification: 'NEW',
      reason: 'No prior orders',
      previousOrderId: null,
    })),
    markDuplicates: vi.fn(async () => {}),
    logRisk: vi.fn(async () => {}),
  };
  const promotions = {
    resolveForCheckout: vi.fn(async () => null),
  };
  const backInStock = {
    deliverClaims: vi.fn(async () => undefined),
  };
  const metaCapi = options.metaCapi ?? { enqueuePurchase: vi.fn(async () => true) };
  const service = new OrdersService(
    prisma as never,
    inventory as unknown as InventoryService,
    customerRisk as never,
    { resolve: vi.fn(async () => null) } as never,
    promotions as never,
    backInStock as never,
    metaCapi as never,
  );
  return {
    service,
    prisma,
    tx,
    inventory,
    customerRisk,
    promotions,
    backInStock,
    metaCapi,
  };
}

describe('OrdersService.checkout attribution', () => {
  it('ignores an uncredentialed client landingPageId', async () => {
    const { service, tx } = createHarness();
    await service.checkout(checkoutOverrides({ attribution: { landingPageId: LP_ID } }));
    const data = tx.order.create.mock.calls[0]![0].data as {
      attribution: { create: Record<string, unknown> };
    };
    expect(data.attribution.create.landingPageId).toBeNull();
  });

  it('persists null landingPageId when attribution omits it', async () => {
    const { service, tx } = createHarness();
    // attribution itself is required (sourceType defaults to ORGANIC);
    // only landingPageId is absent here.
    await service.checkout(checkoutOverrides({ attribution: {} }));
    const data = tx.order.create.mock.calls[0]![0].data as {
      attribution: { create: Record<string, unknown> };
    };
    expect(data.attribution.create.landingPageId).toBeNull();
  });

  it('rejects a non-uuid landingPageId at the DTO boundary', () => {
    // safeParse the raw object: parse() output would already be validated.
    const result = checkoutSchema.safeParse({
      customer: {
        name: 'Jane',
        phone: '09171234567',
        province: 'Metro Manila',
        city: 'Manila',
        streetAddress: '1 Main St',
      },
      items: [{ skuId: SKU_ID, quantity: 1 }],
      attribution: { landingPageId: 'not-a-uuid' },
    });
    expect(result.success).toBe(false);
  });
});

describe('OrdersService.lookup', () => {
  // Every failure path must resolve to this EXACT string so the response can
  // never reveal whether the order number exists (spec §3.1).
  const NOT_FOUND_MESSAGE = 'Order not found. Check your order number or mobile number.';

  function orderRecord(overrides: {
    customerPhone?: string | null;
    snapshotPhone?: string | null;
  } = {}) {
    const { customerPhone = '+639171234567', snapshotPhone = null } = overrides;
    return {
      id: 'order-1',
      orderNumber: 'PH1001',
      customer: customerPhone === null ? null : { normalizedPhone: customerPhone },
      shippingAddress: snapshotPhone === null ? null : { phone: snapshotPhone },
      items: [],
    };
  }

  it('throws the uniform 404 when the order number does not exist', async () => {
    const { service, prisma } = createHarness();
    prisma.order.findUnique.mockResolvedValue(null);

    const err = await service.lookup('PH9999', '09171234567').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(NotFoundException);
    expect((err as Error).message).toBe(NOT_FOUND_MESSAGE);
  });

  it('throws the uniform 404 when the phone does not match the customer', async () => {
    const { service, prisma } = createHarness();
    prisma.order.findUnique.mockResolvedValue(
      orderRecord({ customerPhone: '+639171234567' }),
    );

    const err = await service
      .lookup('PH1001', '09170000000')
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(NotFoundException);
    expect((err as Error).message).toBe(NOT_FOUND_MESSAGE);
  });

  it('throws the uniform 404 when the submitted phone is unparseable', async () => {
    const { service, prisma } = createHarness();
    prisma.order.findUnique.mockResolvedValue(
      orderRecord({ customerPhone: '+639171234567' }),
    );

    const err = await service.lookup('PH1001', 'abc').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(NotFoundException);
    expect((err as Error).message).toBe(NOT_FOUND_MESSAGE);
  });

  it('returns the order when the phone matches the customer record', async () => {
    const { service, prisma } = createHarness();
    const order = orderRecord({ customerPhone: '+639171234567' });
    prisma.order.findUnique.mockResolvedValue(order);

    // The response carries the lookup facts (how it was matched and whether
    // the personal details are included) beside the order itself in 'orders'.
    await expect(service.lookup('PH1001', '09171234567')).resolves.toMatchObject({
      matchedBy: 'orderNumber',
      personalDetailsIncluded: true,
      orders: [order],
    });
  });

  it('returns the order when the phone matches the shipping-address snapshot', async () => {
    const { service, prisma } = createHarness();
    const order = orderRecord({
      customerPhone: '+639000000000',
      snapshotPhone: '09171234567',
    });
    prisma.order.findUnique.mockResolvedValue(order);

    await expect(service.lookup('PH1001', '09171234567')).resolves.toMatchObject({
      matchedBy: 'orderNumber',
      personalDetailsIncluded: true,
      orders: [order],
    });
  });
});

describe('OrdersService confirm gate (CUSTOMER_RISK_SPEC §17)', () => {
  it('rejects confirming an RPT order without a review decision', async () => {
    const { service, prisma } = createHarness();
    prisma.order.findUnique.mockResolvedValue({
      id: 'order-1',
      orderNumber: 'PH100001',
      orderStatus: 'NEW',
      confirmationStatus: 'UNCONFIRMED',
      customerClassification: 'RPT',
      customerId: 'cust-1',
    });
    await expect(service.confirm('order-1', 'op-1')).rejects.toThrow(
      /customer-service decision is required/,
    );
  });

  it('confirms an RPT order when a decision is provided', async () => {
    const { service, prisma, tx } = createHarness();
    prisma.order.findUnique.mockResolvedValue({
      id: 'order-1',
      orderNumber: 'PH100001',
      orderStatus: 'NEW',
      confirmationStatus: 'NEEDS_REVIEW',
      customerClassification: 'RPT',
      customerId: 'cust-1',
    });
    tx.customerRiskLog = { create: vi.fn(async () => ({})) };
    tx.customerNote = { create: vi.fn(async () => ({})) };
    const out = await service.confirm('order-1', 'op-1', { decision: 'CONFIRM', note: 'Called customer' });
    expect(out.confirmationStatus).toBe('CONFIRMED');
    expect(tx.customerRiskLog.create).toHaveBeenCalled();
    expect(tx.customerNote.create).toHaveBeenCalled();
  });

  it('confirms a NORMAL order without a decision', async () => {
    const { service, prisma } = createHarness();
    prisma.order.findUnique.mockResolvedValue({
      id: 'order-1',
      orderNumber: 'PH100001',
      orderStatus: 'NEW',
      confirmationStatus: 'UNCONFIRMED',
      customerClassification: 'NEW',
      customerId: 'cust-1',
    });
    const out = await service.confirm('order-1', 'op-1');
    expect(out.confirmationStatus).toBe('CONFIRMED');
  });
});

describe('OrdersService.updateStatus legality', () => {
  it('rejects an illegal transition', async () => {
    const { service, tx } = createHarness();
    tx.order.findUnique.mockResolvedValue({ id: 'o1', orderStatus: 'SIGNED' });
    await expect(service.updateStatus('o1', 'CONFIRMED', undefined, 'op-1')).rejects.toThrow(
      /Invalid status transition/,
    );
  });

  it('allows NEW -> QUESTION', async () => {
    const { service, tx } = createHarness();
    tx.order.findUnique.mockResolvedValue({ id: 'o1', orderStatus: 'NEW' });
    tx.order.update = vi.fn(async () => ({ orderStatus: 'QUESTION' }));
    const out = await service.updateStatus('o1', 'QUESTION', 'need more info', 'op-1');
    expect(out.orderStatus).toBe('QUESTION');
    expect(tx.orderStatusHistory.create).toHaveBeenCalled();
  });
});

describe('OrdersService.assign', () => {
  it('assigns an order and writes history', async () => {
    const { service, prisma, tx } = createHarness();
    prisma.order.findUnique.mockResolvedValue({ id: 'o1', assignedToId: null });
    tx.order.update = vi.fn(async () => ({ assignedToId: 'cs-1' }));
    await service.assign('o1', 'cs-1', 'op-1');
    expect(tx.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ assignedToId: 'cs-1', assignedBy: 'op-1' }),
      }),
    );
    expect(tx.orderStatusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ statusDomain: 'ASSIGNMENT' }),
      }),
    );
  });
});

describe('OrdersService.ship (§22.3, gates from workbench §6.1)', () => {
  const shipInput = {
    carrier: 'J&T',
    trackingNumber: 'JT-123',
    items: [{ orderItemId: '00000000-0000-4000-8000-0000000000d1', quantity: 1 }],
  };
  const ORDER_LINE = {
    id: shipInput.items[0]!.orderItemId,
    orderId: 'order-1',
    skuId: SKU_ID,
    skuCodeSnapshot: 'CHAIR-1',
    productNameSnapshot: 'Chair',
    variantSnapshot: 'Single',
    quantity: 2,
    unitPrice: new Prisma.Decimal('199'),
    unitDiscount: new Prisma.Decimal('0'),
    unitCostSnapshot: new Prisma.Decimal('100'),
    lineTotal: new Prisma.Decimal('199'),
  };

  function confirmedOrder(overrides: Record<string, unknown> = {}) {
    return {
      id: 'order-1',
      orderStatus: 'CONFIRMED',
      confirmationStatus: 'CONFIRMED',
      customerId: 'cust-1',
      items: [ORDER_LINE],
      shipments: [],
      riskFlags: [],
      handoverCompletedAt: new Date('2026-10-23T00:00:00.000Z'),
      ...overrides,
    };
  }

  it('rejects an order that is not CONFIRMED/SHIPPING', async () => {
    const { service, prisma } = createHarness();
    prisma.order.findUnique.mockResolvedValue(confirmedOrder({ orderStatus: 'NEW' }));
    await expect(service.ship('order-1', shipInput, 'op-1')).rejects.toThrow(
      /Only confirmed orders can be shipped/,
    );
  });

  it('rejects an order whose confirmationStatus is not CONFIRMED', async () => {
    const { service, prisma } = createHarness();
    prisma.order.findUnique.mockResolvedValue(
      confirmedOrder({ confirmationStatus: 'NEEDS_REVIEW' }),
    );
    await expect(service.ship('order-1', shipInput, 'op-1')).rejects.toThrow(
      /must be confirmation-confirmed/,
    );
  });

  it('rejects shipping with an unresolved RECHECK flag', async () => {
    const { service, prisma } = createHarness();
    prisma.order.findUnique.mockResolvedValue(
      confirmedOrder({
        riskFlags: [{ id: 'f1', flagType: 'CUSTOMER_RECHECK', resolved: false }],
      }),
    );
    await expect(service.ship('order-1', shipInput, 'op-1')).rejects.toThrow(
      /Unresolved risk flags? block shipping/,
    );
  });

  it('rejects shipping an unresolved duplicate flag', async () => {
    const { service, prisma } = createHarness();
    prisma.order.findUnique.mockResolvedValue(
      confirmedOrder({
        riskFlags: [{ id: 'f1', flagType: 'POSSIBLE_DUPLICATE', resolved: false }],
      }),
    );
    await expect(service.ship('order-1', shipInput, 'op-1')).rejects.toThrow(/block shipping/);
  });

  it('ignores a resolved flag', async () => {
    const { service, prisma, tx, inventory } = createHarness();
    prisma.order.findUnique.mockResolvedValue(
      confirmedOrder({
        riskFlags: [{ id: 'f1', flagType: 'CUSTOMER_RECHECK', resolved: true }],
      }),
    );
    tx.shipment = { create: vi.fn(async () => ({ id: 'ship-1' })) };
    tx.shipmentItem = { create: vi.fn(async () => ({})) };
    tx.inventoryReservation = { findMany: vi.fn(async () => []), update: vi.fn(async () => ({})) };
    tx.inventory = { update: vi.fn(async () => ({})) };
    tx.inventoryMovement = { create: vi.fn(async () => ({})) };
    tx.orderNote = { create: vi.fn(async () => ({})) };
    inventory.consumeForOrder = vi.fn(async () => {});
    await expect(service.ship('order-1', shipInput, 'op-1')).resolves.toMatchObject({
      shipmentId: 'ship-1',
    });
  });

  it('rejects shipping a confirmed order until every line has been handed over', async () => {
    const { service, prisma } = createHarness();
    prisma.order.findUnique.mockResolvedValue(
      confirmedOrder({ handoverCompletedAt: null }),
    );
    await expect(service.ship('order-1', shipInput, 'op-1')).rejects.toThrow(
      /handover/i,
    );
  });

  it('repairs a stale handover flag inside the shipping transaction', async () => {
    const { service, prisma, tx, inventory } = createHarness();
    prisma.order.findUnique.mockResolvedValue(
      confirmedOrder({ handoverCompletedAt: null }),
    );
    tx.orderHandoverEvent.findMany.mockResolvedValue([
      { type: 'HANDED_OVER', items: [{ orderItemId: ORDER_LINE.id, quantity: 2 }] },
    ]);
    tx.shipment = { create: vi.fn(async () => ({ id: 'ship-1' })) };
    tx.shipmentItem = { create: vi.fn(async () => ({})) };
    tx.inventoryReservation = { findMany: vi.fn(async () => []), update: vi.fn(async () => ({})) };
    tx.inventory = { update: vi.fn(async () => ({})) };
    tx.inventoryMovement = { create: vi.fn(async () => ({})) };
    tx.orderNote = { create: vi.fn(async () => ({})) };
    inventory.consumeForOrder = vi.fn(async () => {});

    await expect(service.ship('order-1', shipInput, 'op-1')).resolves.toMatchObject({
      orderStatus: 'SHIPPING',
    });
    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: { handoverCompletedAt: expect.any(Date) },
    });
  });

  it('rejects over-shipping a line', async () => {
    const { service, prisma } = createHarness();
    prisma.order.findUnique.mockResolvedValue(confirmedOrder());
    await expect(
      service.ship('order-1', { ...shipInput, items: [{ orderItemId: ORDER_LINE.id, quantity: 3 }] }, 'op-1'),
    ).rejects.toThrow(/only 2 remains/);
  });

  it('creates a shipment, flips to SHIPPING, consumes reservations and writes notes/history', async () => {
    const { service, prisma, tx, inventory } = createHarness();
    prisma.order.findUnique.mockResolvedValue(confirmedOrder());
    prisma.$transaction = vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx));
    tx.shipment = { create: vi.fn(async () => ({ id: 'ship-1' })) };
    tx.shipmentItem = {
      create: vi.fn(async () => ({})),
    };
    tx.inventoryReservation = {
      findMany: vi.fn(async () => []),
      update: vi.fn(async () => ({})),
    };
    tx.inventory = {
      update: vi.fn(async () => ({})),
    };
    tx.inventoryMovement = {
      create: vi.fn(async () => ({})),
    };
    tx.orderNote = { create: vi.fn(async () => ({})) };
    inventory.consumeForOrder = vi.fn(async () => {});

    const out = await service.ship('order-1', shipInput, 'op-1');
    expect(out.orderStatus).toBe('SHIPPING');
    expect(out.shipmentId).toBe('ship-1');
    expect(tx.shipment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ carrier: 'J&T', trackingNumber: 'JT-123' }),
      }),
    );
    expect(inventory.consumeForOrder).toHaveBeenCalled();
    expect(tx.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { orderStatus: 'SHIPPING' } }),
    );
    expect(tx.orderStatusHistory.create).toHaveBeenCalled();
    expect(tx.orderNote.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ noteType: 'WAREHOUSE' }) }),
    );
  });

  it('keeps the order SHIPPING when a second partial shipment is added', async () => {
    const { service, prisma, tx, inventory } = createHarness();
    prisma.order.findUnique.mockResolvedValue(
      confirmedOrder({
        orderStatus: 'SHIPPING',
        items: [ORDER_LINE, { ...ORDER_LINE, id: '00000000-0000-4000-8000-0000000000e1' }],
        shipments: [
          {
            id: 'ship-1',
            items: [{ item: { orderItemId: ORDER_LINE.id, quantity: 1 } }],
          },
        ],
      }),
    );
    tx.shipment = { create: vi.fn(async () => ({ id: 'ship-2' })) };
    tx.shipmentItem = { create: vi.fn(async () => ({})) };
    tx.inventoryReservation = { findMany: vi.fn(async () => []), update: vi.fn(async () => ({})) };
    tx.inventory = { update: vi.fn(async () => ({})) };
    tx.inventoryMovement = { create: vi.fn(async () => ({})) };
    tx.orderNote = { create: vi.fn(async () => ({})) };
    inventory.consumeForOrder = vi.fn(async () => {});

    const out = await service.ship('order-1', shipInput, 'op-1');
    expect(out.orderStatus).toBe('SHIPPING'); // stays SHIPPING, not flipped again
    expect(tx.orderStatusHistory.create).not.toHaveBeenCalled();
  });
});

describe('OrdersService order-item option snapshots (Task 17)', () => {
  // Stable graph identities for a Size(0)/Color(1) product graph.
  const COLOR_OPTION_ID = '10000000-0000-4000-8000-0000000000c1';
  const RED_VALUE_ID = '20000000-0000-4000-8000-0000000000c1';
  const SIZE_OPTION_ID = '30000000-0000-4000-8000-0000000000c1';
  const LARGE_VALUE_ID = '40000000-0000-4000-8000-0000000000c1';

  /** SKU of a variant fully materialized into the typed option graph. */
  function skuWithOptionsRecord() {
    const base = skuRecord();
    return {
      ...base,
      variant: {
        ...base.variant,
        name: 'Red / Large',
        // Deliberately out of positional order (color pos 1 before size pos 0).
        optionValues: [
          {
            optionId: COLOR_OPTION_ID,
            optionValueId: RED_VALUE_ID,
            option: { id: COLOR_OPTION_ID, name: 'Color', position: 1 },
            optionValue: { id: RED_VALUE_ID, label: 'Red' },
          },
          {
            optionId: SIZE_OPTION_ID,
            optionValueId: LARGE_VALUE_ID,
            option: { id: SIZE_OPTION_ID, name: 'Size', position: 0 },
            optionValue: { id: LARGE_VALUE_ID, label: 'Large' },
          },
        ],
      },
    };
  }

  function orderDetailRow() {
    return {
      id: 'order-1',
      customer: { notes: [], riskLogs: [] },
      statusHistory: [],
      notes: [],
    };
  }

  it('storefront/admin checkout snapshots options sorted by position with stable ids', async () => {
    // The checkout request is SKU-only ({skuId, quantity}) — both the guest
    // storefront controller and the admin manual-entry controller route here,
    // and the structured snapshot is derived from the SKU's variant graph.
    const { service, prisma, tx } = createHarness();
    prisma.sku.findUnique.mockResolvedValue(skuWithOptionsRecord());

    await service.checkout(
      checkoutOverrides({
        attribution: {},
        items: [{ skuId: SKU_ID, quantity: 2 }],
      }),
    );

    const item = tx.order.create.mock.calls[0]![0].data.items.create[0] as Record<string, unknown>;
    expect(item.optionSnapshot).toEqual({
      version: 1,
      options: [
        { optionId: SIZE_OPTION_ID, optionValueId: LARGE_VALUE_ID, label: 'Size', value: 'Large' },
        { optionId: COLOR_OPTION_ID, optionValueId: RED_VALUE_ID, label: 'Color', value: 'Red' },
      ],
    });
    // The legacy variant text stays populated as the historical fallback.
    expect(item.variantSnapshot).toBe('Red / Large');
  });

  it('checkout of a legacy variant writes the variant text and leaves optionSnapshot null', async () => {
    // skuRecord() predates the typed graph (no optionValues): the column must
    // stay DB NULL (key omitted) rather than a rebuilt empty snapshot.
    const { service, prisma, tx } = createHarness();
    prisma.sku.findUnique.mockResolvedValue(skuRecord());

    await service.checkout(checkoutOverrides({ attribution: {} }));

    const item = tx.order.create.mock.calls[0]![0].data.items.create[0] as Record<string, unknown>;
    expect(item).not.toHaveProperty('optionSnapshot');
    expect(item.variantSnapshot).toBe('Single');
  });

  it('admin edit that adds a line snapshots its options too', async () => {
    const { service, prisma, tx } = createHarness();
    prisma.order.findUnique
      .mockResolvedValueOnce({
        id: 'order-1',
        orderStatus: 'NEW',
        items: [],
        discountTotal: new Prisma.Decimal('0'),
        shippingTotal: new Prisma.Decimal('0'),
      })
      .mockResolvedValueOnce(orderDetailRow());
    tx.sku.findMany.mockResolvedValue([skuWithOptionsRecord()]);

    await service.edit('order-1', { items: [{ skuId: SKU_ID, quantity: 1 }] }, 'op-1');

    const created = tx.orderItem.create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(created.optionSnapshot).toEqual({
      version: 1,
      options: [
        { optionId: SIZE_OPTION_ID, optionValueId: LARGE_VALUE_ID, label: 'Size', value: 'Large' },
        { optionId: COLOR_OPTION_ID, optionValueId: RED_VALUE_ID, label: 'Color', value: 'Red' },
      ],
    });
    expect(created.variantSnapshot).toBe('Red / Large');
  });

  it('quantity-only edits never rebuild the stored option snapshot', async () => {
    const { service, prisma, tx } = createHarness();
    prisma.order.findUnique
      .mockResolvedValueOnce({
        id: 'order-1',
        orderStatus: 'NEW',
        items: [
          {
            id: 'line-1',
            orderId: 'order-1',
            skuId: SKU_ID,
            quantity: 1,
            unitPrice: new Prisma.Decimal('199'),
            lineTotal: new Prisma.Decimal('199'),
            optionSnapshot: { version: 1, options: [] },
          },
        ],
        discountTotal: new Prisma.Decimal('0'),
        shippingTotal: new Prisma.Decimal('0'),
      })
      .mockResolvedValueOnce(orderDetailRow());

    await service.edit('order-1', { items: [{ skuId: SKU_ID, quantity: 3 }] }, 'op-1');

    // Historical snapshots are written once at creation and never rewritten.
    const data = tx.orderItem.update.mock.calls[0]![0].data as Record<string, unknown>;
    expect(Object.keys(data).sort()).toEqual(['lineTotal', 'quantity']);
    expect(data.quantity).toBe(3);
  });
});

describe('OrdersService.sign (§69)', () => {
  it('rejects a shipment that does not belong to the order', async () => {
    const { service, prisma } = createHarness();
    prisma.order.findUnique.mockResolvedValue({
      id: 'order-1',
      orderStatus: 'SHIPPING',
      shipments: [{ id: 'ship-other', status: 'SHIPPING' }],
    });
    await expect(service.sign('order-1', 'ship-missing', 'op-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('signs the last shipment and flips the order to SIGNED', async () => {
    const { service, prisma, tx } = createHarness();
    prisma.order.findUnique.mockResolvedValue({
      id: 'order-1',
      orderStatus: 'SHIPPING',
      items: [{ id: 'line-1', quantity: 1 }],
      shipments: [
        {
          id: 'ship-1',
          status: 'SHIPPING',
          carrier: 'J&T',
          trackingNumber: 'JT-1',
          items: [{ orderItemId: 'line-1', quantity: 1 }],
        },
      ],
    });
    tx.shipment = { update: vi.fn(async () => ({ status: 'SIGNED' })) };
    tx.shipment = {
      update: vi.fn(async () => ({ status: 'SIGNED' })),
      count: vi.fn(async () => 0),
    };
    tx.orderNote = { create: vi.fn(async () => ({})) };
    const out = await service.sign('order-1', 'ship-1', 'op-1');
    expect(out.orderStatus).toBe('SIGNED');
    expect(tx.shipment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'SIGNED', signedAt: expect.any(Date) } }),
    );
    expect(tx.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { orderStatus: 'SIGNED' } }),
    );
  });

  it('keeps the order SHIPPING when another box is still out', async () => {
    const { service, prisma, tx } = createHarness();
    prisma.order.findUnique.mockResolvedValue({
      id: 'order-1',
      orderStatus: 'SHIPPING',
      items: [{ id: 'line-1', quantity: 1 }],
      shipments: [
        {
          id: 'ship-1',
          status: 'SHIPPING',
          carrier: 'J&T',
          trackingNumber: 'JT-1',
          items: [{ orderItemId: 'line-1', quantity: 1 }],
        },
        {
          id: 'ship-2',
          status: 'SHIPPING',
          carrier: 'Ninja',
          trackingNumber: 'N-2',
          items: [],
        },
      ],
    });
    tx.shipment = {
      update: vi.fn(async () => ({ status: 'SIGNED' })),
      count: vi.fn(async () => 1),
    };
    tx.orderNote = { create: vi.fn(async () => ({})) };
    const out = await service.sign('order-1', 'ship-1', 'op-1');
    expect(out.orderStatus).toBe('SHIPPING');
    expect(tx.order.update).not.toHaveBeenCalled();
  });

  it('keeps the order SHIPPING when a signed box does not cover the whole order', async () => {
    const { service, prisma, tx } = createHarness();
    prisma.order.findUnique.mockResolvedValue({
      id: 'order-1',
      orderStatus: 'SHIPPING',
      items: [{ id: 'line-1', quantity: 2 }],
      shipments: [
        {
          id: 'ship-1',
          status: 'SHIPPING',
          carrier: 'J&T',
          trackingNumber: 'JT-1',
          items: [{ orderItemId: 'line-1', quantity: 1 }],
        },
      ],
    });
    tx.shipment = {
      update: vi.fn(async () => ({ status: 'SIGNED' })),
      count: vi.fn(async () => 0),
    };
    tx.orderNote = { create: vi.fn(async () => ({})) };
    const out = await service.sign('order-1', 'ship-1', 'op-1');
    expect(out.orderStatus).toBe('SHIPPING');
    expect(tx.order.update).not.toHaveBeenCalled();
  });

  it('signs the remaining goods of a partially returned box and closes the order as PARTIALLY_RETURNED', async () => {
    const { service, prisma, tx } = createHarness();
    prisma.order.findUnique.mockResolvedValue({
      id: 'order-1',
      orderStatus: 'SHIPPING',
      items: [{ id: 'line-1', quantity: 2 }],
      shipments: [
        {
          id: 'ship-1',
          status: 'SHIPPING',
          carrier: 'J&T',
          trackingNumber: 'JT-1',
          items: [{ orderItemId: 'line-1', quantity: 2 }],
        },
      ],
    });
    tx.shipment = {
      update: vi.fn(async () => ({ status: 'PARTIALLY_RETURNED' })),
      count: vi.fn(async () => 0),
    };
    tx.orderNote = { create: vi.fn(async () => ({})) };
    tx.returnAcceptanceItem = {
      findMany: vi.fn(async () => [
        { orderItemId: 'line-1', quantityGood: 1, quantityDamaged: 0 },
      ]),
    };
    const out = await service.sign('order-1', 'ship-1', 'op-1');
    expect(out.orderStatus).toBe('PARTIALLY_RETURNED');
    expect(out.shipmentStatus).toBe('PARTIALLY_RETURNED');
    expect(tx.shipment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'PARTIALLY_RETURNED', signedAt: expect.any(Date) },
      }),
    );
    expect(tx.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { orderStatus: 'PARTIALLY_RETURNED' } }),
    );
  });

  it('refuses to sign a box whose goods were already fully returned', async () => {
    const { service, prisma } = createHarness();
    prisma.order.findUnique.mockResolvedValue({
      id: 'order-1',
      orderStatus: 'SHIPPING',
      items: [{ id: 'line-1', quantity: 2 }],
      shipments: [
        {
          id: 'ship-1',
          status: 'RETURNED',
          carrier: 'J&T',
          trackingNumber: 'JT-1',
          items: [{ orderItemId: 'line-1', quantity: 2 }],
        },
      ],
    });
    await expect(service.sign('order-1', 'ship-1', 'op-1')).rejects.toThrow(
      /already returned/,
    );
  });

  it('rejects signing an already-signed shipment', async () => {
    const { service, prisma } = createHarness();
    prisma.order.findUnique.mockResolvedValue({
      id: 'order-1',
      orderStatus: 'SHIPPING',
      shipments: [{ id: 'ship-1', status: 'SIGNED' }],
    });
    await expect(service.sign('order-1', 'ship-1', 'op-1')).rejects.toThrow(
      /already signed/,
    );
  });
});

const CHAIR_SKU_ID = '00000000-0000-4000-8000-0000000000d1';
const TABLE_SKU_ID = '00000000-0000-4000-8000-0000000000d2';
const BUNDLE_SKU_ID = '00000000-0000-4000-8000-0000000000d3';
const BUNDLE_VARIANT_ID = '00000000-0000-4000-8000-0000000000b2';
const BUNDLE_PRODUCT_ID = '00000000-0000-4000-8000-0000000000c2';
const ITEM_ID = '00000000-0000-4000-8000-0000000000e1';
const ITEM_KEPT_ID = '00000000-0000-4000-8000-0000000000e2';
const ITEM_MERGED_ID = '00000000-0000-4000-8000-0000000000e3';

function componentRow(
  skuId: string,
  skuCode: string,
  quantity: number,
  position: number,
  overrides: { status?: string; isBundle?: boolean; productStatus?: string } = {},
) {
  return {
    componentSkuId: skuId,
    quantity,
    position,
    componentSku: {
      skuCode,
      isBundle: overrides.isBundle ?? false,
      status: overrides.status ?? 'ACTIVE',
      variant: {
        name: `${skuCode} variant`,
        product: { name: `${skuCode} product`, status: overrides.productStatus ?? 'ACTIVE' },
      },
    },
  };
}

function bundleRecord(
  components = [componentRow(CHAIR_SKU_ID, 'CHAIR', 2, 0), componentRow(TABLE_SKU_ID, 'TABLE', 1, 1)],
) {
  return {
    id: BUNDLE_SKU_ID,
    skuCode: 'SET',
    status: 'ACTIVE',
    isBundle: true,
    price: new Prisma.Decimal('2499'),
    landedCost: null,
    variant: {
      id: BUNDLE_VARIANT_ID,
      name: 'Set',
      productId: BUNDLE_PRODUCT_ID,
      product: { id: BUNDLE_PRODUCT_ID, name: 'Set product', status: 'ACTIVE' },
    },
    bundleComponents: components,
  };
}

function ordinaryRecord(id: string, skuCode: string) {
  return {
    id,
    skuCode,
    status: 'ACTIVE',
    isBundle: false,
    price: new Prisma.Decimal('199'),
    landedCost: null,
    variant: {
      id: `${id}-variant`,
      name: 'Single',
      productId: `${id}-product`,
      product: { id: `${id}-product`, name: `${skuCode} product`, status: 'ACTIVE' },
    },
    bundleComponents: [],
  };
}

/** A stored version-1 Bundle snapshot: one CHAIR per Bundle, two per set. */
const SNAPSHOT_V1 = {
  version: 1,
  bundleSkuId: BUNDLE_SKU_ID,
  bundleSkuCode: 'SET',
  components: [{
    componentSkuId: CHAIR_SKU_ID,
    skuCode: 'CHAIR',
    productName: 'CHAIR product',
    variantName: 'CHAIR variant',
    quantity: 2,
    totalQuantity: 4,
    position: 0,
  }],
};

function orderDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    orderNumber: 'PH1',
    orderStatus: 'NEW',
    confirmationStatus: 'UNCONFIRMED',
    customerId: 'cust-1',
    createdAt: new Date('2026-10-01T00:00:00Z'),
    discountTotal: new Prisma.Decimal(0),
    shippingTotal: new Prisma.Decimal(0),
    assignedToId: null,
    assignedBy: null,
    items: [],
    shippingAddress: null,
    riskFlags: [],
    shipments: [],
    reservations: [],
    statusHistory: [],
    notes: [],
    customer: { notes: [], riskLogs: [] },
    handoverCompletedAt: new Date('2026-10-23T00:00:00.000Z'),
    ...overrides,
  };
}

describe('OrdersService Bundle checkout', () => {
  it('reserves Bundle components and freezes a version-1 snapshot on the line', async () => {
    const harness = createHarness({ skus: { [BUNDLE_SKU_ID]: bundleRecord() } });
    harness.inventory.availableBySku.mockResolvedValue(
      new Map([[CHAIR_SKU_ID, 11], [TABLE_SKU_ID, 4]]),
    );

    await harness.service.checkout(checkoutOverrides({
      attribution: { sourceType: 'ORGANIC' },
      items: [{ skuId: BUNDLE_SKU_ID, quantity: 2 }],
    }));

    const data = harness.tx.order.create.mock.calls[0]![0].data;
    expect(data.items.create).toEqual([expect.objectContaining({
      skuId: BUNDLE_SKU_ID,
      quantity: 2,
      bundleSnapshot: {
        version: 1,
        bundleSkuId: BUNDLE_SKU_ID,
        bundleSkuCode: 'SET',
        components: [
          { componentSkuId: CHAIR_SKU_ID, skuCode: 'CHAIR', productName: 'CHAIR product', variantName: 'CHAIR variant', quantity: 2, totalQuantity: 4, position: 0 },
          { componentSkuId: TABLE_SKU_ID, skuCode: 'TABLE', productName: 'TABLE product', variantName: 'TABLE variant', quantity: 1, totalQuantity: 2, position: 1 },
        ],
      },
    })]);
    expect(harness.inventory.reserveConditionalWithin.mock.calls.map((call) => [call[1], call[3]])).toEqual([
      [CHAIR_SKU_ID, 4],
      [TABLE_SKU_ID, 2],
    ]);
  });

  it('refuses a Bundle whose saved definition is unusable before writing anything', async () => {
    const harness = createHarness({
      skus: { [BUNDLE_SKU_ID]: bundleRecord([componentRow(CHAIR_SKU_ID, 'CHAIR', 2, 0, { status: 'DISABLED' })]) },
    });

    await expect(harness.service.checkout(checkoutOverrides({
      attribution: { sourceType: 'ORGANIC' },
      items: [{ skuId: BUNDLE_SKU_ID, quantity: 1 }],
    })))
      .rejects.toThrow(/SET is not available for purchase/);
    expect(harness.tx.order.create).not.toHaveBeenCalled();
    expect(harness.inventory.reserveWithin).not.toHaveBeenCalled();
    expect(harness.inventory.reserveConditionalWithin).not.toHaveBeenCalled();
  });

  it('rejects the order when Bundle and ordinary lines exceed a shared component', async () => {
    const harness = createHarness({
      skus: { [BUNDLE_SKU_ID]: bundleRecord(), [CHAIR_SKU_ID]: ordinaryRecord(CHAIR_SKU_ID, 'CHAIR') },
    });
    harness.inventory.availableBySku.mockResolvedValue(
      new Map([[CHAIR_SKU_ID, 11], [TABLE_SKU_ID, 4]]),
    );

    await expect(harness.service.checkout(checkoutOverrides({
      attribution: { sourceType: 'ORGANIC' },
      items: [
        { skuId: BUNDLE_SKU_ID, quantity: 2 },
        { skuId: CHAIR_SKU_ID, quantity: 8 },
      ],
    }))).rejects.toThrow(/Insufficient stock for SET/);
    expect(harness.tx.order.create).not.toHaveBeenCalled();
    expect(harness.inventory.reserveWithin).not.toHaveBeenCalled();
    expect(harness.inventory.reserveConditionalWithin).not.toHaveBeenCalled();
  });
});

describe('OrdersService Bundle edit, merge and ship', () => {
  it('reserves a newly added Bundle line from the current definition', async () => {
    const harness = createHarness({ skus: { [BUNDLE_SKU_ID]: bundleRecord() } });
    harness.prisma.order.findUnique.mockResolvedValue(orderDetail());
    harness.tx.sku.findMany.mockResolvedValue([bundleRecord()]);
    harness.tx.orderItem.findMany.mockResolvedValue([]);

    await harness.service.edit('order-1', { items: [{ skuId: BUNDLE_SKU_ID, quantity: 2 }] }, 'op-1');

    expect(harness.tx.orderItem.create.mock.calls[0]![0].data).toMatchObject({
      skuId: BUNDLE_SKU_ID,
      quantity: 2,
      bundleSnapshot: expect.objectContaining({ version: 1 }),
    });
    expect(harness.inventory.reserveConditionalWithin.mock.calls.map((call) => [call[1], call[3]])).toEqual([
      [CHAIR_SKU_ID, 4],
      [TABLE_SKU_ID, 2],
    ]);
  });

  it('follows the saved snapshot when an existing Bundle line grows after a definition change', async () => {
    const harness = createHarness({ skus: {} });
    harness.prisma.order.findUnique.mockResolvedValue(orderDetail({
      items: [{
        id: ITEM_ID, skuId: BUNDLE_SKU_ID, quantity: 2,
        unitPrice: new Prisma.Decimal('2499'), bundleSnapshot: SNAPSHOT_V1,
      }],
    }));
    // The current definition now needs five chairs per set; the stored
    // snapshot still owes two, so only the delta follows it.
    harness.tx.sku.findMany.mockResolvedValue([bundleRecord([componentRow(CHAIR_SKU_ID, 'CHAIR', 5, 0)])]);
    harness.tx.orderItem.findMany.mockResolvedValue([
      { id: ITEM_ID, unitPrice: new Prisma.Decimal('2499'), quantity: 3 },
    ]);

    await harness.service.edit('order-1', { items: [{ skuId: BUNDLE_SKU_ID, quantity: 3 }] }, 'op-1');

    expect(harness.inventory.reserveConditionalWithin.mock.calls.map((call) => [call[1], call[3]])).toEqual([[CHAIR_SKU_ID, 2]]);
  });

  it('follows the stored snapshot when an existing Bundle line shrinks', async () => {
    const harness = createHarness({ skus: {} });
    harness.prisma.order.findUnique.mockResolvedValue(orderDetail({
      items: [{
        id: ITEM_ID, skuId: BUNDLE_SKU_ID, quantity: 3,
        unitPrice: new Prisma.Decimal('2499'), bundleSnapshot: { ...SNAPSHOT_V1, components: [{ ...SNAPSHOT_V1.components[0]!, totalQuantity: 6 }] },
      }],
    }));
    harness.tx.sku.findMany.mockResolvedValue([bundleRecord([componentRow(CHAIR_SKU_ID, 'CHAIR', 5, 0)])]);
    harness.tx.orderItem.findMany.mockResolvedValue([
      { id: ITEM_ID, unitPrice: new Prisma.Decimal('2499'), quantity: 1 },
    ]);

    await harness.service.edit('order-1', { items: [{ skuId: BUNDLE_SKU_ID, quantity: 1 }] }, 'op-1');

    expect(harness.inventory.releaseForOrder).toHaveBeenCalledWith(harness.tx, 'order-1');
    // Two chairs per set from the snapshot, not five from the new definition.
    expect(harness.inventory.reserveConditionalWithin.mock.calls.map((call) => [call[1], call[3]])).toEqual([
      [CHAIR_SKU_ID, 2],
    ]);
  });

  it('releases the components when a Bundle line is removed', async () => {
    const harness = createHarness({ skus: {} });
    harness.tx.sku.findMany.mockResolvedValue([bundleRecord()]);
    harness.prisma.order.findUnique.mockResolvedValue(orderDetail({
      items: [{
        id: ITEM_ID, skuId: BUNDLE_SKU_ID, quantity: 2,
        unitPrice: new Prisma.Decimal('2499'), bundleSnapshot: SNAPSHOT_V1,
      }],
    }));
    harness.tx.orderItem.findMany.mockResolvedValue([]);

    await harness.service.edit('order-1', { items: [] }, 'op-1');

    expect(harness.tx.orderItem.delete).toHaveBeenCalledWith({ where: { id: ITEM_ID } });
    expect(harness.inventory.releaseForOrder).toHaveBeenCalledWith(harness.tx, 'order-1');
  });

  it('refuses to add a Bundle line whose current definition is unusable', async () => {    const harness = createHarness({ skus: {} });
    harness.prisma.order.findUnique.mockResolvedValue(orderDetail());
    harness.tx.sku.findMany.mockResolvedValue([
      bundleRecord([componentRow(CHAIR_SKU_ID, 'CHAIR', 0, 0)]),
    ]);

    await expect(harness.service.edit('order-1', { items: [{ skuId: BUNDLE_SKU_ID, quantity: 1 }] }, 'op-1'))
      .rejects.toThrow(/Bundle SET is not available for purchase/);
    expect(harness.tx.orderItem.create).not.toHaveBeenCalled();
    expect(harness.inventory.reserveWithin).not.toHaveBeenCalled();
    expect(harness.inventory.reserveConditionalWithin).not.toHaveBeenCalled();
  });

  it('refuses to resize a Bundle line whose stored snapshot is unreadable', async () => {
    const harness = createHarness({ skus: {} });
    harness.prisma.order.findUnique.mockResolvedValue(orderDetail({
      items: [{
        id: ITEM_ID, skuId: BUNDLE_SKU_ID, quantity: 2,
        unitPrice: new Prisma.Decimal('2499'), bundleSnapshot: { version: 9 },
      }],
    }));
    harness.tx.sku.findMany.mockResolvedValue([bundleRecord()]);

    await expect(harness.service.edit('order-1', { items: [{ skuId: BUNDLE_SKU_ID, quantity: 3 }] }, 'op-1'))
      .rejects.toThrow(/snapshot is unreadable/);
    expect(harness.inventory.reserveWithin).not.toHaveBeenCalled();
    expect(harness.inventory.reserveConditionalWithin).not.toHaveBeenCalled();
  });

  it('keeps two Bundle lines with different snapshots apart when merging', async () => {
    const harness = createHarness({ skus: {} });
    harness.tx.sku.findMany.mockResolvedValue([bundleRecord()]);
    const primary = orderDetail({
      createdAt: new Date('2026-10-01T00:00:00Z'),
      shippingAddress: { phone: '09171234567', streetAddress: '1 Main St', province: 'Metro Manila', city: 'Manila' },
      items: [{ id: ITEM_KEPT_ID, skuId: BUNDLE_SKU_ID, unitPrice: new Prisma.Decimal('2499'), quantity: 1, lineTotal: new Prisma.Decimal('2499'), bundleSnapshot: { ...SNAPSHOT_V1, components: [{ ...SNAPSHOT_V1.components[0]!, totalQuantity: 2 }] } }],
    });
    const merged = orderDetail({
      id: 'order-2', orderNumber: 'PH2',
      createdAt: new Date('2026-10-02T00:00:00Z'),
      shippingAddress: { phone: '09171234567', streetAddress: '1 Main St', province: 'Metro Manila', city: 'Manila' },
      items: [{
        id: ITEM_MERGED_ID, skuId: BUNDLE_SKU_ID, unitPrice: new Prisma.Decimal('2499'), quantity: 1, lineTotal: new Prisma.Decimal('2499'),
        bundleSnapshot: { ...SNAPSHOT_V1, components: [{ ...SNAPSHOT_V1.components[0]!, quantity: 3, totalQuantity: 3 }] },
      }],
    });
    harness.prisma.order.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === 'order-1' ? primary : merged);

    await harness.service.merge({ primaryOrderId: 'order-1', mergedOrderId: 'order-2' }, 'op-1');

    expect(harness.tx.orderItem.update).toHaveBeenCalledWith({ where: { id: ITEM_MERGED_ID }, data: { orderId: 'order-1' } });
    expect(harness.tx.orderItem.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ quantity: 2 }) }),
    );
  });

  it('collapses two Bundle lines that share one definition and restates the line totals', async () => {
    const harness = createHarness({ skus: {} });
    harness.tx.sku.findMany.mockResolvedValue([bundleRecord()]);
    const sharedSnapshot = buildBundleSnapshot({
      skuId: BUNDLE_SKU_ID,
      skuCode: 'SET',
      quantity: 1,
      components: [componentRow(CHAIR_SKU_ID, 'CHAIR', 2, 0)],
    });
    const address = { phone: '09171234567', streetAddress: '1 Main St', province: 'Metro Manila', city: 'Manila' };
    const primary = orderDetail({
      createdAt: new Date('2026-10-01T00:00:00Z'),
      shippingAddress: address,
      items: [{ id: ITEM_KEPT_ID, skuId: BUNDLE_SKU_ID, unitPrice: new Prisma.Decimal('2499'), quantity: 1, lineTotal: new Prisma.Decimal('2499'), bundleSnapshot: sharedSnapshot }],
    });
    const merged = orderDetail({
      id: 'order-2', orderNumber: 'PH2',
      createdAt: new Date('2026-10-02T00:00:00Z'),
      shippingAddress: address,
      items: [{ id: ITEM_MERGED_ID, skuId: BUNDLE_SKU_ID, unitPrice: new Prisma.Decimal('2499'), quantity: 2, lineTotal: new Prisma.Decimal('4998'), bundleSnapshot: { ...sharedSnapshot, components: [{ ...sharedSnapshot.components[0]!, totalQuantity: 4 }] } }],
    });
    harness.prisma.order.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === 'order-1' ? primary : merged);

    await harness.service.merge({ primaryOrderId: 'order-1', mergedOrderId: 'order-2' }, 'op-1');

    expect(harness.tx.orderItem.update).toHaveBeenCalledWith({
      where: { id: ITEM_KEPT_ID },
      data: {
        quantity: 3,
        lineTotal: new Prisma.Decimal('7497'),
        bundleSnapshot: expect.objectContaining({
          components: [expect.objectContaining({ componentSkuId: CHAIR_SKU_ID, quantity: 2, totalQuantity: 6 })],
        }),
      },
    });
  });

  it('consumes the snapshot components when a Bundle line ships', async () => {
    const harness = createHarness({ skus: {} });
    harness.tx.sku.findMany.mockResolvedValue([bundleRecord()]);
    harness.prisma.order.findUnique.mockResolvedValue(orderDetail({
      orderStatus: 'CONFIRMED',
      confirmationStatus: 'CONFIRMED',
      items: [{ id: ITEM_ID, skuId: BUNDLE_SKU_ID, skuCodeSnapshot: 'SET', quantity: 2, bundleSnapshot: SNAPSHOT_V1 }],
    }));

    await harness.service.ship('order-1', { carrier: 'LBC', items: [{ orderItemId: ITEM_ID, quantity: 1 }] }, 'op-1');

    expect(Array.from(harness.inventory.consumeForOrder.mock.calls[0]![2] as Map<string, number>))
      .toEqual([[CHAIR_SKU_ID, 2]]);
  });

  it('refuses to consume inventory for an unreadable Bundle snapshot', async () => {
    const harness = createHarness({ skus: {} });
    harness.prisma.order.findUnique.mockResolvedValue(orderDetail({
      orderStatus: 'CONFIRMED',
      confirmationStatus: 'CONFIRMED',
      items: [{ id: ITEM_ID, skuId: BUNDLE_SKU_ID, skuCodeSnapshot: 'SET', quantity: 1, bundleSnapshot: { version: 9 } }],
    }));

    await expect(harness.service.ship('order-1', { carrier: 'LBC', items: [{ orderItemId: ITEM_ID, quantity: 1 }] }, 'op-1'))
      .rejects.toThrow(/snapshot is unreadable/);
    expect(harness.inventory.consumeForOrder).not.toHaveBeenCalled();
  });
});

describe('OrdersService.checkout idempotency', () => {
  const KEY = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
  const REQUEST_META = {
    eventSourceUrl: 'https://luwag.shop/checkout/confirm',
    clientIp: '203.0.113.10',
    clientUserAgent: 'vitest',
  };

  function existingOrder(
    input: ReturnType<typeof checkoutOverrides>,
    overrides: Record<string, unknown> = {},
  ) {
    return {
      orderNumber: 'PH1001',
      orderStatus: 'NEW',
      confirmationStatus: 'UNCONFIRMED',
      customerClassification: 'NEW',
      idempotencyHash: idempotencyFingerprint(input),
      ...overrides,
    };
  }

  it('replays the original order for the same key and content without side effects', async () => {
    const harness = createHarness();
    const input = checkoutOverrides({ idempotencyKey: KEY });
    harness.prisma.order.findUnique.mockResolvedValueOnce(existingOrder(input));

    const result = await harness.service.checkout(input, REQUEST_META);

    expect(result).toEqual({
      orderNumber: 'PH1001',
      orderStatus: 'NEW',
      confirmationStatus: 'UNCONFIRMED',
      riskType: null,
      requiresReview: false,
    });
    expect(harness.prisma.$transaction).not.toHaveBeenCalled();
    expect(harness.prisma.customer.upsert).not.toHaveBeenCalled();
    expect(harness.inventory.reserveWithin).not.toHaveBeenCalled();
    expect(harness.metaCapi.enqueuePurchase).not.toHaveBeenCalled();
  });

  it('rejects the same key when the order content changed', async () => {
    const harness = createHarness();
    const input = checkoutOverrides({ idempotencyKey: KEY });
    harness.prisma.order.findUnique.mockResolvedValueOnce(
      existingOrder(input, { idempotencyHash: 'deadbeef'.repeat(8) }),
    );

    const error = await harness.service.checkout(input).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as Error).message).toContain('PH1001');
    expect(harness.prisma.$transaction).not.toHaveBeenCalled();
    expect(harness.prisma.customer.upsert).not.toHaveBeenCalled();
  });

  it('stores the key and fingerprint on a new order', async () => {
    const harness = createHarness();
    const input = checkoutOverrides({ idempotencyKey: KEY });
    harness.prisma.order.findUnique.mockResolvedValueOnce(null);

    await harness.service.checkout(input);

    const data = harness.tx.order.create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.idempotencyKey).toBe(KEY);
    expect(data.idempotencyHash).toBe(idempotencyFingerprint(input));
  });

  it('turns a concurrent unique-key race into a replay', async () => {
    const harness = createHarness();
    const input = checkoutOverrides({ idempotencyKey: KEY });
    harness.prisma.order.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        existingOrder(input, { orderStatus: 'CONFIRMED', confirmationStatus: 'CONFIRMED' }),
      );
    harness.prisma.$transaction.mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    );

    const result = await harness.service.checkout(input, REQUEST_META);

    expect(result.orderNumber).toBe('PH1001');
    expect(result.orderStatus).toBe('CONFIRMED');
    expect(result.requiresReview).toBe(false);
    expect(harness.metaCapi.enqueuePurchase).not.toHaveBeenCalled();
  });

  it('rethrows a unique violation that is not about the idempotency key', async () => {
    const harness = createHarness();
    const input = checkoutOverrides({ idempotencyKey: KEY });
    harness.prisma.order.findUnique.mockResolvedValue(null);
    const failure = Object.assign(new Error('Unique constraint failed on order_number'), {
      code: 'P2002',
    });
    harness.prisma.$transaction.mockRejectedValueOnce(failure);

    await expect(harness.service.checkout(input, REQUEST_META)).rejects.toBe(failure);
  });

  it('keeps the no-key path unchanged', async () => {
    const harness = createHarness();
    await harness.service.checkout(checkoutOverrides());

    expect(harness.prisma.order.findUnique).not.toHaveBeenCalled();
    const data = harness.tx.order.create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.idempotencyKey).toBeNull();
    expect(data.idempotencyHash).toBeNull();
  });
});
