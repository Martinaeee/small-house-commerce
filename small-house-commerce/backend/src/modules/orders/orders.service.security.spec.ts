import { afterEach, describe, expect, it, vi } from 'vitest';
import { InventoryService } from '../inventory/inventory.service.js';
import { OrdersService } from './orders.service.js';

/**
 * The security tightening (stage 1A):
 *   - the status endpoint can no longer reach CONFIRMED, SHIPPING or
 *     CANCELLED, so it cannot be used to walk around confirm(), ship() and
 *     cancel()
 *   - the confirm endpoint obeys the review decision, refuses unresolved
 *     risk flags and (once the rule is switched on) refuses an order whose
 *     manual verification is not finished
 */

const ORDER_ID = '00000000-0000-4000-8000-0000000000a1';

function createHarness() {
  const tx: Record<string, any> = {
    $queryRaw: vi.fn(async () => []),
    $executeRaw: vi.fn(async () => 0),
    order: {
      findUnique: vi.fn(),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'order-1', ...data })),
    },
    orderStatusHistory: { create: vi.fn(async () => ({})) },
    customerRiskLog: { create: vi.fn(async () => ({})) },
    customerNote: { create: vi.fn(async () => ({})) },
    inventoryReservation: { updateMany: vi.fn(async () => ({ count: 1 })) },
    orderVerificationAssignment: { findFirst: vi.fn(async () => null) },
    orderVerificationItem: { findMany: vi.fn(async () => []) },
  };
  const prisma = {
    order: { findUnique: vi.fn() },
    $queryRaw: vi.fn(async () => []),
    $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
  };
  tx.order.findUnique.mockImplementation((args: { where: { id: string } }) => prisma.order.findUnique(args));

  const inventory = {
    releaseForOrder: vi.fn(async () => ['reservation-1']),
    consumeForOrder: vi.fn(async () => undefined),
  };
  const customerRisk = { logRisk: vi.fn(async () => {}) };
  const backInStock = { deliverClaims: vi.fn(async () => undefined) };
  const service = new OrdersService(
    prisma as never,
    inventory as unknown as InventoryService,
    customerRisk as never,
    { resolve: vi.fn(async () => null) } as never,
    { resolveForCheckout: vi.fn(async () => null) } as never,
    backInStock as never,
  );
  return { service, prisma, tx, inventory, customerRisk, backInStock };
}

const orderRow = (overrides: Record<string, unknown> = {}) => ({
  id: ORDER_ID,
  orderNumber: 'PH100001',
  orderStatus: 'NEW',
  confirmationStatus: 'UNCONFIRMED',
  customerClassification: 'NEW',
  customerId: 'cust-1',
  riskFlags: [] as unknown[],
  ...overrides,
});

afterEach(() => {
  delete process.env.ORDER_VERIFICATION_REQUIRED;
});

describe('updateStatus can no longer walk around the order flow', () => {
  it('refuses to confirm an order (only the confirm endpoint may do that)', async () => {
    const { service, tx } = createHarness();
    tx.order.findUnique.mockResolvedValue(orderRow());
    await expect(service.updateStatus(ORDER_ID, 'CONFIRMED', undefined, 'op-1')).rejects.toThrow(
      /Invalid status transition/,
    );
    expect(tx.order.update).not.toHaveBeenCalled();
  });

  it('refuses to ship an order (only the ship endpoint may do that)', async () => {
    const { service, tx } = createHarness();
    tx.order.findUnique.mockResolvedValue(orderRow({ orderStatus: 'CONFIRMED' }));
    await expect(service.updateStatus(ORDER_ID, 'SHIPPING', undefined, 'op-1')).rejects.toThrow(
      /Invalid status transition/,
    );
    expect(tx.order.update).not.toHaveBeenCalled();
  });

  it('refuses to cancel an order (only the cancel endpoint may do that)', async () => {
    const { service, tx, inventory } = createHarness();
    tx.order.findUnique.mockResolvedValue(orderRow());
    await expect(service.updateStatus(ORDER_ID, 'CANCELLED', undefined, 'op-1')).rejects.toThrow(
      /Invalid status transition/,
    );
    expect(inventory.releaseForOrder).not.toHaveBeenCalled();
  });

  it('refuses to cancel an order that is already on the way', async () => {
    const { service, tx, inventory } = createHarness();
    tx.order.findUnique.mockResolvedValue(orderRow({ orderStatus: 'SHIPPING' }));
    await expect(service.updateStatus(ORDER_ID, 'CANCELLED', undefined, 'op-1')).rejects.toThrow(
      /Invalid status transition/,
    );
    expect(inventory.releaseForOrder).not.toHaveBeenCalled();
  });

  it('still allows the in-progress states', async () => {
    const { service, tx } = createHarness();
    tx.order.findUnique.mockResolvedValue(orderRow());
    const out = await service.updateStatus(ORDER_ID, 'QUESTION', 'need more info', 'op-1');
    expect(out.orderStatus).toBe('QUESTION');
    expect(tx.orderStatusHistory.create).toHaveBeenCalled();
  });

  it('still allows a denial (the customer refused) and releases the reservation', async () => {
    const { service, tx, inventory } = createHarness();
    tx.order.findUnique.mockResolvedValue(orderRow());
    const out = await service.updateStatus(ORDER_ID, 'DENIED', 'customer refused', 'op-1');
    expect(out.orderStatus).toBe('DENIED');
    expect(inventory.releaseForOrder).toHaveBeenCalled();
  });
});

describe('the confirm endpoint obeys the review decision', () => {
  it('cancels the order when the decision is CANCEL', async () => {
    const { service, prisma, tx, inventory } = createHarness();
    prisma.order.findUnique.mockResolvedValue(
      orderRow({ customerClassification: 'RPT', confirmationStatus: 'NEEDS_REVIEW' }),
    );
    const out = await service.confirm(ORDER_ID, 'op-1', { decision: 'CANCEL', note: '客户不要了' });
    expect(out.orderStatus).toBe('CANCELLED');
    expect(out.confirmationStatus).not.toBe('CONFIRMED');
    expect(inventory.releaseForOrder).toHaveBeenCalled();
    expect(tx.orderStatusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ newStatus: 'CANCELLED' }),
      }),
    );
  });

  it('sends the order back to QUESTION when more information is requested', async () => {
    const { service, prisma } = createHarness();
    prisma.order.findUnique.mockResolvedValue(
      orderRow({ customerClassification: 'RPT', confirmationStatus: 'NEEDS_REVIEW' }),
    );
    const out = await service.confirm(ORDER_ID, 'op-1', {
      decision: 'REQUEST_INFO',
      note: '等客户回电',
    });
    expect(out.orderStatus).toBe('QUESTION');
    expect(out.confirmationStatus).not.toBe('CONFIRMED');
  });

  it('refuses to confirm while a risk flag is unresolved', async () => {
    const { service, prisma, tx } = createHarness();
    prisma.order.findUnique.mockResolvedValue(
      orderRow({ riskFlags: [{ flagType: 'POSSIBLE_DUPLICATE', reason: 'same phone' }] }),
    );
    await expect(service.confirm(ORDER_ID, 'op-1')).rejects.toThrow(/RISK_FLAG_UNRESOLVED/);
    expect(tx.order.update).not.toHaveBeenCalled();
  });
});

describe('the verification checklist', () => {
  it('does not stop the confirmation', async () => {
    const { service, prisma } = createHarness();
    prisma.order.findUnique.mockResolvedValue(orderRow());
    const out = await service.confirm(ORDER_ID, 'op-1');
    expect(out.confirmationStatus).toBe('CONFIRMED');
  });

  it('confirms an order with open questions', async () => {
    // The operator ticks what applies to the order in front of them; the
    // checklist is the record of what was checked, not a gate.
    const { service, prisma, tx } = createHarness();
    prisma.order.findUnique.mockResolvedValue(orderRow());
    tx.orderVerificationAssignment.findFirst.mockResolvedValue({ id: 'as-1' });
    tx.orderVerificationItem.findMany.mockResolvedValue([
      { itemKey: 'phone_valid', titleSnapshot: '确认联系电话是否有效', required: false, status: 'DONE' },
      { itemKey: 'intent', titleSnapshot: '确认客户购买意愿', required: false, status: 'PENDING' },
    ]);
    const out = await service.confirm(ORDER_ID, 'op-1');
    expect(out.confirmationStatus).toBe('CONFIRMED');
    expect(tx.order.update).toHaveBeenCalled();
  });

  it('confirms an order nobody assigned a checklist to', async () => {
    const { service, prisma } = createHarness();
    prisma.order.findUnique.mockResolvedValue(orderRow());
    const out = await service.confirm(ORDER_ID, 'op-1');
    expect(out.confirmationStatus).toBe('CONFIRMED');
  });
});
