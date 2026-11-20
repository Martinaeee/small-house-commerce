import { Prisma } from '../../generated/prisma/client.js';
import { describe, expect, it, vi } from 'vitest';
import { InventoryService } from '../inventory/inventory.service.js';
import { checkoutSchema } from './dto/order.dto.js';
import { idempotencyFingerprint } from './order-idempotency.js';
import { OrdersService } from './orders.service.js';
import type { PaymentMethodsService } from '../payments/payment-methods.service.js';

const SKU_ID = '00000000-0000-4000-8000-0000000000a1';

function skuRecord() {
  return {
    id: SKU_ID,
    skuCode: 'CHAIR-1',
    status: 'ACTIVE',
    price: new Prisma.Decimal('199'),
    landedCost: new Prisma.Decimal('100'),
    isBundle: false,
    bundleComponents: [],
    variant: {
      id: '00000000-0000-4000-8000-0000000000b1',
      name: 'Single',
      productId: '00000000-0000-4000-8000-0000000000c1',
      product: { id: '00000000-0000-4000-8000-0000000000c1', name: 'Chair', status: 'ACTIVE' },
    },
  };
}

function methodsStub(
  state: { codEnabled: boolean; gcashEnabled: boolean },
  gateway = { env: 'test', merchantId: 'TEST34453112600' },
) {
  return {
    listEffectiveMethods: vi.fn(async () => ({
      codEnabled: state.codEnabled,
      revision: 0,
      methods: [
        { id: 'COD' as const, enabled: state.codEnabled, ready: true },
        { id: 'CARD' as const, enabled: false, ready: false },
        { id: 'GCASH' as const, enabled: state.gcashEnabled, ready: state.gcashEnabled },
        { id: 'BPI' as const, enabled: false, ready: false },
      ],
    })),
    gatewayConfig: vi.fn(() => gateway),
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

function createHarness(options: {
  methods?: ReturnType<typeof methodsStub>;
  skus?: Record<string, unknown>;
} = {}) {
  const skus = options.skus ?? { [SKU_ID]: skuRecord() };
  const tx: Record<string, any> = {
    $queryRaw: vi.fn(async (query: TemplateStringsArray) =>
      query.join('').includes("nextval('order_number_seq')") ? [{ nextval: 1n }] : [],
    ),
    $executeRaw: vi.fn(async () => 0),
    checkoutDraft: { findUnique: vi.fn(async () => null), update: vi.fn(async () => ({})) },
    customer: { upsert: vi.fn(async () => ({ id: 'cust-1' })) },
    order: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
        id: 'order-1',
        grandTotal: args.data.grandTotal,
      })),
      findUnique: vi.fn(),
      findMany: vi.fn(async () => []),
      update: vi.fn(async (_args: { where: Record<string, unknown>; data: Record<string, unknown> }) => ({
        id: 'order-1',
        ...(_args?.data ?? {}),
      })),
    },
    sunratePaymentAttempt: { create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
      id: 'attempt-1',
      ...args.data,
    })) },
    orderStatusHistory: { create: vi.fn(async () => ({})) },
    orderHandoverEvent: { findMany: vi.fn(async () => []) },
    returnAcceptanceItem: { findMany: vi.fn(async () => []) },
    customerRiskLog: { create: vi.fn(async () => ({})) },
    customerNote: { create: vi.fn(async () => ({})) },
    orderItem: { create: vi.fn(async () => ({})) },
    orderShippingAddress: { create: vi.fn(async () => ({})) },
    inventoryReservation: { updateMany: vi.fn(async () => ({ count: 1 })) },
    orderNote: { create: vi.fn(async () => ({})) },
    sku: { findMany: vi.fn(async () => []), findUnique: vi.fn() },
  };
  const prisma = {
    customer: { upsert: vi.fn(async () => ({ id: 'cust-1' })) },
    sku: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => skus[where.id] ?? null) },
    order: {
      findUnique: vi.fn(),
      update: vi.fn(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => ({
        id: 'order-1',
        ...(args?.data ?? {}),
      })),
    },
    $queryRaw: vi.fn(async () => [{ nextval: 1n }]),
    $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
  };
  tx.order.findUnique.mockImplementation((args: { where: { id: string } }) => prisma.order.findUnique(args));
  tx.sku.findUnique.mockImplementation((args: { where: { id: string } }) => prisma.sku.findUnique(args));
  const inventory = {
    availableBySku: vi.fn(async () => new Map([[SKU_ID, 5]])),
    defaultWarehouse: vi.fn(async () => ({ id: 'wh-1' })),
    reserveWithin: vi.fn(async () => undefined),
    reserveConditionalWithin: vi.fn(async () => undefined),
  };
  const customerRisk = {
    classifyForNewOrder: vi.fn(async () => ({ classification: 'NEW', reason: 'No prior orders', previousOrderId: null })),
    markDuplicates: vi.fn(async () => {}),
    logRisk: vi.fn(async () => {}),
  };
  const metaCapi = { enqueuePurchase: vi.fn(async () => true) };
  const service = new OrdersService(
    prisma as never,
    inventory as unknown as InventoryService,
    customerRisk as never,
    { resolve: vi.fn(async () => null) } as never,
    { resolveForCheckout: vi.fn(async () => null) } as never,
    { deliverClaims: vi.fn(async () => undefined) } as never,
    metaCapi as never,
    undefined,
    options.methods as unknown as PaymentMethodsService,
  );
  return { service, prisma, tx, inventory, customerRisk, metaCapi };
}

describe('checkout — online payment branch', () => {
  it('creates an ONLINE_PENDING order with a CREATING attempt for GCASH', async () => {
    const methods = methodsStub({ codEnabled: true, gcashEnabled: true });
    const { service, tx, metaCapi } = createHarness({ methods });
    const result = await service.checkout(checkoutOverrides({ paymentMethod: 'GCASH' }));
    const data = tx.order.create.mock.calls[0]![0].data as Record<string, any>;
    expect(data.paymentStatus).toBe('ONLINE_PENDING');
    expect(data.payments.create.method).toBe('SUNRATE');
    expect(data.payments.create.status).toBe('ONLINE_PENDING');
    const attempt = tx.sunratePaymentAttempt.create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(attempt.channel).toBe('gcash');
    expect(attempt.status).toBe('CREATING');
    expect(attempt.env).toBe('test');
    expect(attempt.merchantId).toBe('TEST34453112600');
    expect(String(attempt.merchantOrderNum)).toMatch(/^AT\d{14}\d{6}$/);
    expect(result.payment).toEqual({ attemptId: 'attempt-1', channel: 'gcash', env: 'test' });
    // No Purchase until the payment is verified.
    expect(metaCapi.enqueuePurchase).not.toHaveBeenCalled();
  });

  it('rejects a disabled online method without leaving an order', async () => {
    const methods = methodsStub({ codEnabled: true, gcashEnabled: false });
    const { service, tx } = createHarness({ methods });
    await expect(
      service.checkout(checkoutOverrides({ paymentMethod: 'GCASH' })),
    ).rejects.toMatchObject({ message: 'PAYMENT_METHOD_DISABLED' });
    expect(tx.order.create).not.toHaveBeenCalled();
  });

  it('keeps the COD branch untouched when no method is chosen', async () => {
    const methods = methodsStub({ codEnabled: true, gcashEnabled: true });
    const { service, tx, metaCapi } = createHarness({ methods });
    const result = await service.checkout(checkoutOverrides(), {
      clientIp: null,
      clientUserAgent: null,
      eventSourceUrl: 'https://luwag.shop/checkout',
    });
    const data = tx.order.create.mock.calls[0]![0].data as Record<string, any>;
    expect(data.payments.create.method).toBe('COD');
    expect(data.payments.create.status).toBe('COD_PENDING');
    expect(tx.sunratePaymentAttempt.create).not.toHaveBeenCalled();
    expect(result.payment).toBeUndefined();
    expect(metaCapi.enqueuePurchase).toHaveBeenCalled();
  });

  it('rejects a new COD request when COD is disabled, but replays an existing order', async () => {
    const methods = methodsStub({ codEnabled: false, gcashEnabled: true });
    const { service, prisma, tx } = createHarness({ methods });

    await expect(service.checkout(checkoutOverrides())).rejects.toMatchObject({
      message: 'PAYMENT_METHOD_DISABLED',
    });
    expect(tx.order.create).not.toHaveBeenCalled();

    // Replay: an existing order with the same key fingerprint returns as-is.
    const input = checkoutOverrides({ idempotencyKey: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
    prisma.order.findUnique.mockResolvedValue({
      orderNumber: 'PH1001',
      orderStatus: 'NEW',
      confirmationStatus: 'UNCONFIRMED',
      customerClassification: 'NEW',
      grandTotal: new Prisma.Decimal('199'),
      idempotencyHash: idempotencyFingerprint(input),
    });
    const replay = await service.checkout(input);
    expect(replay).toMatchObject({ orderNumber: 'PH1001' });
  });

  it('rejects manual draft conversion when COD is disabled and leaves the draft open', async () => {
    const methods = methodsStub({ codEnabled: false, gcashEnabled: true });
    const { service, tx } = createHarness({ methods });
    tx.checkoutDraft.findUnique.mockResolvedValue({
      id: 'draft-1',
      status: 'OPEN',
      clientRevision: 3,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(
      service.checkout(checkoutOverrides(), undefined, {
        id: 'draft-1',
        tokenHash: 'draft-token-hash',
        revision: 3,
        operatorId: 'operator-1',
        riskReviewed: true,
      }),
    ).rejects.toMatchObject({ message: 'PAYMENT_METHOD_DISABLED' });
    expect(tx.order.create).not.toHaveBeenCalled();
    expect(tx.checkoutDraft.update).not.toHaveBeenCalled();
  });
});
