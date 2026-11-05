import { GUARDS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { PERMISSIONS_KEY } from '../../auth/permissions.decorator.js';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/permissions.guard.js';
import { AdminCheckoutDraftsController } from './checkout-drafts.controller.js';

describe('AdminCheckoutDraftsController', () => {
  it('sits behind JWT and permission guards', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminCheckoutDraftsController)).toEqual(
      expect.arrayContaining([JwtAuthGuard, PermissionsGuard]),
    );
  });

  it('requires ORDER_VIEW_ALL on both reads', () => {
    const permissionOf = (method: 'list' | 'detail'): string[] =>
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        AdminCheckoutDraftsController.prototype[method] as object,
      );
    expect(permissionOf('list')).toEqual(['ORDER_VIEW_ALL']);
    expect(permissionOf('detail')).toEqual(['ORDER_VIEW_ALL']);
  });

  it('keeps the customer-service result as the only write and requires ORDER_VERIFY', () => {
    expect(Object.getOwnPropertyNames(AdminCheckoutDraftsController.prototype).sort()).toEqual(
      ['constructor', 'detail', 'followUp', 'list'].sort(),
    );
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        AdminCheckoutDraftsController.prototype.followUp as object,
      ),
    ).toEqual(['ORDER_VERIFY']);
  });

  it('delegates reads and the follow-up result to the draft service', async () => {
    const service = {
      list: vi.fn(async () => ({ items: [], total: 0 })),
      detail: vi.fn(async () => ({ id: 'draft-1' })),
      followUp: vi.fn(async () => ({ id: 'draft-1' })),
    };
    const controller = new AdminCheckoutDraftsController(service as never);
    await controller.list({ page: 1, pageSize: 20 });
    await controller.detail('draft-1');
    await controller.followUp('draft-1', { status: 'TO_CONTACT' }, { userId: 'user-9' });
    expect(service.list).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
    expect(service.detail).toHaveBeenCalledWith('draft-1');
    expect(service.followUp).toHaveBeenCalledWith('draft-1', { status: 'TO_CONTACT' }, 'user-9');
  });
});
