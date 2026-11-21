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
  lastResult: { metaConsent: true, eventSourceUrl: 'https://luwag.shop/checkout' },
  lastQueryAt: null,
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

function harness(query: Record<string, unknown>) {
  const attempt = { ...ATTEMPT };
  const order = { ...ORDER, payments: [{ ...ORDER.payments[0] }] };
  const outbox: Array<Record<string, unknown>> = [];
  const metaCapi = {
    enqueuePurchase: vi.fn(async (input: Record<string, unknown>) => {
      outbox.push(input);
      return true;
    }),
  };
  const client = {
    queryOrder: vi.fn(async () => ({
      respCode: String(query.respCode ?? '00'),
      respMsg: String(query.respMsg ?? 'success'),
      transId: query.transID as string | undefined,
      paymentBrand: query.paymentBrand as string | undefined,
      raw: query as Record<string, string>,
    })),
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
    sunratePaymentAttempt: {
      findUnique: vi.fn(async () => ({
        ...attempt,
        order: {
          orderNumber: 'PH100030',
          paymentStatus: order.paymentStatus,
          orderStatus: order.orderStatus,
        },
      })),
      update: tx.sunratePaymentAttempt.update,
    },
  };
  const service = new ApplyVerifiedResultService(prisma as never, metaCapi as never, client as never);
  return { service, tx, attempt, order, client, metaCapi, outbox };
}

const SUCCESSFUL_QUERY = {
  respCode: '00',
  respMsg: 'success',
  transID: 'trans-9',
  transType: 'PURC',
  merID: 'TEST34453112600',
  gwTime: '20261120080000',
  paymentBrand: 'gcash',
};

describe('reconcile', () => {
  it('applies a successful query as a verified payment', async () => {
    const { service, tx, outbox } = harness(SUCCESSFUL_QUERY);

    const result = await service.reconcile('attempt-1');

    expect(result).toMatchObject({
      orderNumber: 'PH100030',
      paymentStatus: 'PAID',
      attemptStatus: 'SUCCEEDED',
    });
    // The admin drawer's "last query" must show this query too.
    expect(result.lastQueryAt).toBeInstanceOf(Date);
    const queriedAt = tx.sunratePaymentAttempt.update.mock.calls.some(
      (call) => (call[0] as { data: Record<string, unknown> }).data.lastQueryAt instanceof Date,
    );
    expect(queriedAt).toBe(true);
    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: { paymentStatus: 'PAID' },
    });
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ orderNumber: 'PH100030', value: 199 });
  });

  it('asks the gateway about the attempt it was given', async () => {
    const { service, client } = harness(SUCCESSFUL_QUERY);

    await service.reconcile('attempt-1');

    expect(client.queryOrder).toHaveBeenCalledWith({
      orderNum: 'AT20261120100000001234',
      paymentMethod: 'gcash',
      transTime: '20261120100000',
    });
  });

  it('leaves the state alone when the query does not prove a payment', async () => {
    const { service, tx, outbox } = harness({ respCode: '01', respMsg: 'not paid' });

    const result = await service.reconcile('attempt-1');

    expect(result).toMatchObject({
      orderNumber: 'PH100030',
      paymentStatus: 'ONLINE_PENDING',
      attemptStatus: 'PENDING',
    });
    expect(tx.order.update).not.toHaveBeenCalled();
    expect(tx.payment.update).not.toHaveBeenCalled();
    expect(outbox).toHaveLength(0);
    const attemptUpdate = tx.sunratePaymentAttempt.update.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(attemptUpdate.data.lastQueryAt).toBeInstanceOf(Date);
  });

  it('refuses a second query for the same attempt within ten seconds', async () => {
    const { service } = harness(SUCCESSFUL_QUERY);

    await service.reconcile('attempt-1');

    await expect(service.reconcile('attempt-1')).rejects.toMatchObject({
      status: 409,
      message: 'QUERY_THROTTLED',
    });
  });
});
