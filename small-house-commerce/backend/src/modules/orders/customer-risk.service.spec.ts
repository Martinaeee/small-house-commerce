import { describe, expect, it, vi } from 'vitest';
import { CustomerRiskService } from './customer-risk.service.js';

function order(id: string, orderStatus: string, createdAt = new Date('2026-09-01T00:00:00Z')) {
  return { id, orderStatus, createdAt };
}

function customerWithOrders(orders: ReturnType<typeof order>[]) {
  return orders.length ? { id: 'cust-1', orders } : null;
}

function createHarness() {
  const prisma = {
    customer: { findUnique: vi.fn() },
    orderRiskFlag: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({})),
    },
    customerRiskLog: { create: vi.fn(async () => ({})) },
  };
  const service = new CustomerRiskService(prisma as never);
  return { prisma, service };
}

describe('CustomerRiskService.classifyForNewOrder', () => {
  it('returns NEW for a customer with no history', async () => {
    const { prisma, service } = createHarness();
    prisma.customer.findUnique.mockResolvedValue(customerWithOrders([]));
    const r = await service.classifyForNewOrder('+639171234567');
    expect(r.classification).toBe('NEW');
  });

  it('returns AGAIN after a signed order', async () => {
    const { prisma, service } = createHarness();
    prisma.customer.findUnique.mockResolvedValue(customerWithOrders([order('o1', 'SIGNED')]));
    const r = await service.classifyForNewOrder('+639171234567');
    expect(r.classification).toBe('AGAIN');
  });

  it('returns RPT when a previous active (PENDING) order exists', async () => {
    const { prisma, service } = createHarness();
    prisma.customer.findUnique.mockResolvedValue(customerWithOrders([order('o1', 'PENDING')]));
    const r = await service.classifyForNewOrder('+639171234567');
    expect(r.classification).toBe('RPT');
  });

  it('returns RPT for a previous CONFIRMED order', async () => {
    const { prisma, service } = createHarness();
    prisma.customer.findUnique.mockResolvedValue(customerWithOrders([order('o1', 'CONFIRMED')]));
    const r = await service.classifyForNewOrder('+639171234567');
    expect(r.classification).toBe('RPT');
  });

  it('returns RECHECK after a denied order', async () => {
    const { prisma, service } = createHarness();
    prisma.customer.findUnique.mockResolvedValue(customerWithOrders([order('o1', 'DENIED')]));
    const r = await service.classifyForNewOrder('+639171234567');
    expect(r.classification).toBe('RECHECK');
  });

  it('prioritises RECHECK over RPT (denied beats pending)', async () => {
    const { prisma, service } = createHarness();
    prisma.customer.findUnique.mockResolvedValue(
      customerWithOrders([order('o1', 'DENIED'), order('o2', 'PENDING')]),
    );
    const r = await service.classifyForNewOrder('+639171234567');
    expect(r.classification).toBe('RECHECK');
  });

  it('prioritises RPT over AGAIN (pending beats signed)', async () => {
    const { prisma, service } = createHarness();
    prisma.customer.findUnique.mockResolvedValue(
      customerWithOrders([order('o1', 'SIGNED'), order('o2', 'PENDING')]),
    );
    const r = await service.classifyForNewOrder('+639171234567');
    expect(r.classification).toBe('RPT');
  });

  it('excludes the just-created order from history (previousOrderIds)', async () => {
    const { prisma, service } = createHarness();
    prisma.customer.findUnique.mockResolvedValue(
      customerWithOrders([order('new', 'NEW'), order('o1', 'SIGNED')]),
    );
    const r = await service.classifyForNewOrder('+639171234567', ['new']);
    expect(r.classification).toBe('AGAIN');
    expect(r.previousOrderId).toBe('o1');
  });
});

describe('CustomerRiskService.markDuplicates', () => {
  function dupOrder(id: string, createdAt: Date, items: { productId: string; skuId: string }[]) {
    return { id, createdAt, items };
  }

  it('marks POSSIBLE_DUPLICATE for same product within 24h', async () => {
    const { prisma, service } = createHarness();
    const now = Date.now();
    prisma.customer.findUnique.mockResolvedValue({
      id: 'cust-1',
      orders: [
        dupOrder('o1', new Date(now - 3600_000), [{ productId: 'p1', skuId: 's1' }]),
        dupOrder('o2', new Date(now), [{ productId: 'p1', skuId: 's1' }]),
      ],
    });
    await service.markDuplicates('+639171234567');
    expect(prisma.orderRiskFlag.create).toHaveBeenCalledTimes(2);
  });

  it('does not mark orders far apart (beyond 24h)', async () => {
    const { prisma, service } = createHarness();
    prisma.customer.findUnique.mockResolvedValue({
      id: 'cust-1',
      orders: [
        dupOrder('o1', new Date(Date.now() - 48 * 3600_000), [{ productId: 'p1', skuId: 's1' }]),
        dupOrder('o2', new Date(), [{ productId: 'p1', skuId: 's1' }]),
      ],
    });
    await service.markDuplicates('+639171234567');
    expect(prisma.orderRiskFlag.create).not.toHaveBeenCalled();
  });

  it('does not mark different products', async () => {
    const { prisma, service } = createHarness();
    prisma.customer.findUnique.mockResolvedValue({
      id: 'cust-1',
      orders: [
        dupOrder('o1', new Date(Date.now() - 1000), [{ productId: 'p1', skuId: 's1' }]),
        dupOrder('o2', new Date(), [{ productId: 'p2', skuId: 's2' }]),
      ],
    });
    await service.markDuplicates('+639171234567');
    expect(prisma.orderRiskFlag.create).not.toHaveBeenCalled();
  });

  it('does not flag a single order', async () => {
    const { prisma, service } = createHarness();
    prisma.customer.findUnique.mockResolvedValue({
      id: 'cust-1',
      orders: [dupOrder('o1', new Date(), [{ productId: 'p1', skuId: 's1' }])],
    });
    await service.markDuplicates('+639171234567');
    expect(prisma.orderRiskFlag.create).not.toHaveBeenCalled();
  });

  it('is idempotent — skips when an unresolved flag already exists', async () => {
    const { prisma, service } = createHarness();
    prisma.customer.findUnique.mockResolvedValue({
      id: 'cust-1',
      orders: [
        dupOrder('o1', new Date(Date.now() - 1000), [{ productId: 'p1', skuId: 's1' }]),
        dupOrder('o2', new Date(), [{ productId: 'p1', skuId: 's1' }]),
      ],
    });
    prisma.orderRiskFlag.findFirst.mockResolvedValue({ id: 'flag-1' } as never);
    await service.markDuplicates('+639171234567');
    expect(prisma.orderRiskFlag.create).not.toHaveBeenCalled();
  });
});

describe('CustomerRiskService.logRisk', () => {
  it('records a risk log row', async () => {
    const { prisma, service } = createHarness();
    await service.logRisk({
      customerId: 'cust-1',
      orderId: 'order-1',
      riskType: 'RPT',
      reason: 'Active previous order',
    });
    expect(prisma.customerRiskLog.create).toHaveBeenCalledWith({
      data: {
        customerId: 'cust-1',
        orderId: 'order-1',
        riskType: 'RPT',
        previousOrderId: null,
        reason: 'Active previous order',
        operatorId: null,
      },
    });
  });
});
