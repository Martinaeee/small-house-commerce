import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { AdminOrdersController } from './orders.controller.js';
import { PERMISSIONS_KEY } from '../../auth/permissions.decorator.js';

function harness(allowed: string[]) {
  const orders = {
    bulkOrders: vi.fn(async () => ({ results: [] })),
    convertDraftToOrder: vi.fn(),
    checkoutDraftRisk: vi.fn(),
    checkout: vi.fn(async () => ({})),
  };
  const permissions = {
    has: vi.fn(async (_id: string, p: string) => allowed.includes(p)),
  };
  return {
    orders,
    c: new AdminOrdersController(
      orders as never,
      {} as never,
      {} as never,
      {} as never,
      permissions as never,
    ),
  };
}

describe('workbench write permissions', () => {
  it('routes an older draft-create request through confirmed conversion rather than ordinary checkout', async () => {
    const { c, orders } = harness(['ORDER_VIEW_ALL']);
    const body = { checkoutDraftId: 'draft', customer: { name: 'Ana' }, customerNote: 'Call first' };
    await c.create(body as never, { userId: 'op' }, { headers: {} } as never);
    expect(orders.convertDraftToOrder).toHaveBeenCalledWith('draft', 'op', expect.objectContaining({
      customer: body.customer, customerNote: 'Call first',
    }));
    expect(orders.checkout).not.toHaveBeenCalled();
  });
  it('does not let the older create endpoint bypass draft view permission', async () => {
    const { c, orders } = harness([]);
    await expect(c.create({ checkoutDraftId: 'draft' } as never, { userId: 'op' }, { headers: {} } as never))
      .rejects.toThrow('permission');
    expect(orders.convertDraftToOrder).not.toHaveBeenCalled();
    expect(orders.checkout).not.toHaveBeenCalled();
  });

  it('requires view and confirm permissions on manual draft conversion', () => {
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        AdminOrdersController.prototype.convertDraft,
      ),
    ).toEqual(['ORDER_VIEW_ALL', 'ORDER_CONFIRM']);
  });
  it.each(['confirm', 'cancel', 'assign', 'status'] as const)(
    'rejects bulk %s before any write without its permission',
    async (action) => {
      const { c, orders } = harness([]);
      await expect(
        c.bulk({ action, ids: [] } as never, { userId: 'op' }),
      ).rejects.toThrow('permission');
      expect(orders.bulkOrders).not.toHaveBeenCalled();
    },
  );
  it('requires cancel in addition to confirm when a bulk status denies orders', async () => {
    const { c, orders } = harness(['ORDER_CONFIRM']);
    await expect(
      c.bulk({ action: 'status', status: 'DENIED', ids: [] }, { userId: 'op' }),
    ).rejects.toThrow('permission');
    expect(orders.bulkOrders).not.toHaveBeenCalled();
  });
  it('dispatches an authorized action with the authenticated operator identity', async () => {
    const { c, orders } = harness(['ORDER_ASSIGN']);
    await c.bulk(
      { action: 'assign', assignedToId: 'staff', ids: ['order'] },
      { userId: 'op' },
    );
    expect(orders.bulkOrders).toHaveBeenCalledWith(
      { action: 'assign', assignedToId: 'staff', ids: ['order'] },
      'op',
    );
  });
});
