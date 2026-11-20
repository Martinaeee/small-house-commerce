import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '../../generated/prisma/client.js';
import { ApplyVerifiedResultService } from './apply-verified-result.service.js';

const ATTEMPT = {
  id: 'attempt-1',
  orderId: 'order-1',
  channel: 'gcash',
  env: 'test',
  merchantId: 'TEST34453112600',
  merchantOrderNum: 'AT20261120100000001234',
  amount: new Prisma.Decimal('199.00'),
  currency: 'PHP',
  transId: null,
  cardBrand: null,
  cardLast4: null,
  status: 'PENDING',
  lastResult: {
    metaConsent: true,
    fbp: 'fb.1.2.abc',
    fbc: 'fb.1.2.def',
    eventSourceUrl: 'https://luwag.shop/checkout',
  },
};

const ORDER = {
  id: 'order-1',
  orderNumber: 'PH100030',
  orderStatus: 'NEW',
  paymentStatus: 'ONLINE_PENDING',
  grandTotal: new Prisma.Decimal('199.00'),
  payments: [{ id: 'pay-1', status: 'ONLINE_PENDING', paidAt: null }],
  items: [{ skuId: 'sku-1', quantity: 2, unitPrice: new Prisma.Decimal('99.50') }],
  customer: { normalizedPhone: '639171234567' },
};

const RESULT = {
  merchantOrderNum: 'AT20261120100000001234',
  transId: 'trans-1',
  respCode: '00',
  amount: '199.00',
  currency: 'PHP',
  paymentBrand: 'gcash',
  gwTime: '20261120080000',
  merId: 'TEST34453112600',
  transType: 'PURC',
  source: 'NOTIFY' as const,
};

function harness(options: { consent?: boolean } = {}) {
  const consent = options.consent ?? true;
  const attempt = {
    ...ATTEMPT,
    lastResult: { ...ATTEMPT.lastResult, metaConsent: consent },
  };
  const order = { ...ORDER };
  const outbox: Array<Record<string, unknown>> = [];
  const metaCapi = {
    enqueuePurchase: vi.fn(async (input: Record<string, unknown>) => {
      // The real service refuses an unconsented event.
      if (input.consent !== true) return false;
      outbox.push(input);
      return true;
    }),
  };
  const tx = {
    $executeRaw: vi.fn(async () => 0),
    $queryRaw: vi.fn(async () => []),
    sunratePaymentAttempt: {
      findUnique: vi.fn(async () => attempt),
      update: vi.fn(async (args: { data: Record<string, unknown> }) => {
        Object.assign(attempt, args.data);
        return { ...attempt };
      }),
    },
    order: {
      findUnique: vi.fn(async () => order),
      update: vi.fn(async (args: { data: Record<string, unknown> }) => {
        Object.assign(order, args.data);
        return { ...order };
      }),
    },
    payment: {
      update: vi.fn(async (args: { data: Record<string, unknown> }) => {
        Object.assign(order.payments[0]!, args.data);
        return { ...order.payments[0] };
      }),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
  };
  const service = new ApplyVerifiedResultService(prisma as never, metaCapi as never);
  return { service, tx, attempt, order, metaCapi, outbox };
}

describe('Purchase on a verified payment', () => {
  it('queues the Purchase with the facts the checkout saved', async () => {
    const { service, outbox } = harness();

    await service.applyVerifiedResult(RESULT);

    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      orderNumber: 'PH100030',
      items: [{ skuId: 'sku-1', quantity: 2, unitPrice: 99.5 }],
      value: 199,
      phone: '639171234567',
      consent: true,
      fbp: 'fb.1.2.abc',
      fbc: 'fb.1.2.def',
      eventSourceUrl: 'https://luwag.shop/checkout',
    });
  });

  it('never borrows the server address as the shopper address', async () => {
    const { service, outbox } = harness();

    await service.applyVerifiedResult(RESULT);

    // No client address at all: the payment server's own address would
    // point Meta at the wrong person.
    expect(outbox[0]!.clientIp ?? null).toBeNull();
    expect(outbox[0]!.clientUserAgent ?? null).toBeNull();
  });

  it('sends the amount the order was written with', async () => {
    const { service, outbox } = harness();

    await service.applyVerifiedResult(RESULT);

    expect(outbox[0]!.value).toBe(Number(ORDER.grandTotal));
  });

  it('queues no Purchase for a shopper who did not consent', async () => {
    const { service, outbox } = harness({ consent: false });

    await service.applyVerifiedResult(RESULT);

    expect(outbox).toHaveLength(0);
  });

  it('queues the Purchase only once when the same notification arrives again', async () => {
    const { service, outbox } = harness();

    await service.applyVerifiedResult(RESULT);
    await service.applyVerifiedResult(RESULT);

    expect(outbox).toHaveLength(1);
  });

  it('queues no Purchase when the payment did not go through', async () => {
    const { service, outbox } = harness();

    await service.applyVerifiedResult({ ...RESULT, respCode: '01' });

    expect(outbox).toHaveLength(0);
  });
});
