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
  lastResult: { metaConsent: true, fbp: 'fb.1.2.abc' },
};

const ORDER = {
  id: 'order-1',
  orderNumber: 'PH100030',
  orderStatus: 'NEW',
  paymentStatus: 'ONLINE_PENDING',
  grandTotal: new Prisma.Decimal('199.00'),
  payments: [{ id: 'pay-1', status: 'ONLINE_PENDING', paidAt: null }],
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

function harness(options: { attempt?: Record<string, unknown>; order?: Record<string, unknown> } = {}) {
  const attempt = { ...ATTEMPT, ...(options.attempt ?? {}) };
  const order = { ...ORDER, ...(options.order ?? {}) };
  const tx = {
    $executeRaw: vi.fn(async () => 0),
    $queryRaw: vi.fn(async () => []),
    sunratePaymentAttempt: {
      findUnique: vi.fn(async () => attempt),
      update: vi.fn(async (args: { data: Record<string, unknown> }) => ({ ...attempt, ...args.data })),
    },
    order: {
      findUnique: vi.fn(async () => order),
      update: vi.fn(async (args: { data: Record<string, unknown> }) => ({ ...order, ...args.data })),
    },
    payment: {
      update: vi.fn(async (args: { data: Record<string, unknown> }) => ({ ...order.payments[0], ...args.data })),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
  };
  const service = new ApplyVerifiedResultService(prisma as never);
  return { service, tx, attempt, order };
}

describe('ApplyVerifiedResultService', () => {
  it('marks the payment, the order and the attempt as paid', async () => {
    const { service, tx } = harness();

    const outcome = await service.applyVerifiedResult(RESULT);

    expect(outcome).toBe('APPLIED');
    expect(tx.payment.update).toHaveBeenCalledWith({
      where: { id: 'pay-1' },
      data: { status: 'PAID', paidAt: new Date('2026-11-20T00:00:00Z') },
    });
    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: { paymentStatus: 'PAID' },
    });
    const attemptUpdate = tx.sunratePaymentAttempt.update.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(attemptUpdate.data.status).toBe('SUCCEEDED');
    expect(attemptUpdate.data.transId).toBe('trans-1');
    expect(attemptUpdate.data.cardBrand).toBe('gcash');
    // The checkout facts must survive: the Purchase event still needs them.
    expect((attemptUpdate.data.lastResult as Record<string, unknown>).metaConsent).toBe(true);
  });

  it('ignores a second delivery of the same notification', async () => {
    const { service, tx } = harness({
      attempt: { status: 'SUCCEEDED', transId: 'trans-1' },
      order: { paymentStatus: 'PAID' },
    });

    const outcome = await service.applyVerifiedResult(RESULT);

    expect(outcome).toBe('DUPLICATE');
    expect(tx.payment.update).not.toHaveBeenCalled();
    expect(tx.order.update).not.toHaveBeenCalled();
  });

  it('never downgrades a paid order on a late failure notification', async () => {
    const { service, tx } = harness({
      attempt: { status: 'SUCCEEDED', transId: 'trans-1' },
      order: { paymentStatus: 'PAID' },
    });

    const outcome = await service.applyVerifiedResult({ ...RESULT, respCode: '01' });

    expect(outcome).toBe('IGNORED_LATE_FAILURE');
    expect(tx.payment.update).not.toHaveBeenCalled();
    expect(tx.order.update).not.toHaveBeenCalled();
    expect(tx.sunratePaymentAttempt.update).not.toHaveBeenCalled();
  });

  it('records a late success on a cancelled order as review, not paid', async () => {
    const { service, tx } = harness({ order: { orderStatus: 'CANCELLED' } });

    const outcome = await service.applyVerifiedResult(RESULT);

    expect(outcome).toBe('REVIEW');
    expect(tx.payment.update).not.toHaveBeenCalled();
    expect(tx.order.update).not.toHaveBeenCalled();
    const attemptUpdate = tx.sunratePaymentAttempt.update.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(attemptUpdate.data.status).toBe('REVIEW');
  });

  it('refuses a notification whose amount does not match the order', async () => {
    const { service, tx } = harness();

    const outcome = await service.applyVerifiedResult({ ...RESULT, amount: '1.00' });

    expect(outcome).toBe('REVIEW');
    expect(tx.payment.update).not.toHaveBeenCalled();
    const attemptUpdate = tx.sunratePaymentAttempt.update.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(attemptUpdate.data.status).toBe('REVIEW');
  });

  it('refuses a notification that names another merchant', async () => {
    const { service, tx } = harness();

    const outcome = await service.applyVerifiedResult({ ...RESULT, merId: 'SOMEONE_ELSE' });

    expect(outcome).toBe('REVIEW');
    expect(tx.payment.update).not.toHaveBeenCalled();
  });

  it('refuses a notification for another currency or transaction type', async () => {
    const { service } = harness();

    expect(await service.applyVerifiedResult({ ...RESULT, currency: 'USD' })).toBe('REVIEW');
    expect(await service.applyVerifiedResult({ ...RESULT, transType: 'REFD' })).toBe('REVIEW');
  });

  it('refuses a brand that does not belong to the channel', async () => {
    const { service } = harness({ attempt: { channel: 'bpi' } });

    expect(await service.applyVerifiedResult({ ...RESULT, paymentBrand: 'visa' })).toBe('REVIEW');
  });

  it('marks a failed payment as failed', async () => {
    const { service, tx } = harness();

    const outcome = await service.applyVerifiedResult({ ...RESULT, respCode: '01' });

    expect(outcome).toBe('APPLIED');
    expect(tx.payment.update).toHaveBeenCalledWith({
      where: { id: 'pay-1' },
      data: { status: 'FAILED' },
    });
    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: { paymentStatus: 'FAILED' },
    });
  });

  it('locks the merchant order number so two deliveries cannot race', async () => {
    const { service, tx } = harness();

    await service.applyVerifiedResult(RESULT);

    expect(tx.$executeRaw).toHaveBeenCalled();
  });
});
