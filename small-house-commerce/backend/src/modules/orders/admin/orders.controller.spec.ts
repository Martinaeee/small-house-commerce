import { GUARDS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { PERMISSIONS_KEY } from '../../auth/permissions.decorator.js';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/permissions.guard.js';
import { AdminOrdersController } from './orders.controller.js';

const USER = { userId: 'op-1' };

function harness(has: (permission: string) => Promise<boolean>) {
  const orders = { confirm: vi.fn(async () => ({})), updateStatus: vi.fn(async () => ({})) };
  const verification = {} as never;
  const permissions = { has: vi.fn(has) };
  const controller = new AdminOrdersController(
    orders as never,
    verification,
    permissions as never,
  );
  return { controller, orders, permissions };
}

describe('AdminOrdersController permission rules', () => {
  it('sits behind the auth and permission guards', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminOrdersController)).toEqual(
      expect.arrayContaining([JwtAuthGuard, PermissionsGuard]),
    );
  });

  it('keeps the write surfaces under their own permissions', () => {
    // @SetMetadata stores the route metadata on the handler function itself.
    const permissionOf = (method: keyof AdminOrdersController): string[] =>
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        AdminOrdersController.prototype[method] as object,
      );
    expect(permissionOf('list')).toEqual(['ORDER_VIEW_ALL']);
    expect(permissionOf('addNote')).toEqual(['ORDER_NOTE_WRITE']);
    expect(permissionOf('addRiskFlag')).toEqual(['ORDER_RISK_WRITE']);
    expect(permissionOf('resolveRiskFlag')).toEqual(['ORDER_RISK_WRITE']);
    expect(permissionOf('merge')).toEqual(['ORDER_MERGE']);
  });

  it('refuses a cancel decision without ORDER_CANCEL', async () => {
    const { controller, orders, permissions } = harness(() => Promise.resolve(false));
    await expect(
      controller.confirm('order-1', USER, { decision: 'CANCEL' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(permissions.has).toHaveBeenCalledWith('op-1', 'ORDER_CANCEL');
    expect(orders.confirm).not.toHaveBeenCalled();
  });

  it('allows a cancel decision for a holder of ORDER_CANCEL', async () => {
    const { controller, orders, permissions } = harness(() => Promise.resolve(true));
    await controller.confirm('order-1', USER, { decision: 'CANCEL' });
    expect(permissions.has).toHaveBeenCalledWith('op-1', 'ORDER_CANCEL');
    expect(orders.confirm).toHaveBeenCalledWith('order-1', USER.userId, {
      decision: 'CANCEL',
    });
  });

  it('confirms without asking for ORDER_CANCEL when no cancellation is decided', async () => {
    const { controller, orders, permissions } = harness(() => Promise.resolve(false));
    await controller.confirm('order-1', USER, { decision: 'CONFIRM' });
    expect(permissions.has).not.toHaveBeenCalled();
    expect(orders.confirm).toHaveBeenCalledWith('order-1', USER.userId, {
      decision: 'CONFIRM',
    });
  });

  it('refuses a denial through the status endpoint without ORDER_CANCEL', async () => {
    const { controller, orders } = harness(() => Promise.resolve(false));
    await expect(
      controller.updateStatus('order-1', { status: 'DENIED' } as never, USER),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(orders.updateStatus).not.toHaveBeenCalled();
  });
});
