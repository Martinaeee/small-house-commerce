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

  it('exposes no write route', () => {
    expect(Object.getOwnPropertyNames(AdminCheckoutDraftsController.prototype).sort()).toEqual(
      ['constructor', 'detail', 'list'].sort(),
    );
  });

  it('delegates reads to the draft service', async () => {
    const service = {
      list: vi.fn(async () => ({ items: [], total: 0 })),
      detail: vi.fn(async () => ({ id: 'draft-1' })),
    };
    const controller = new AdminCheckoutDraftsController(service as never);
    await controller.list({ page: 1, pageSize: 20 });
    await controller.detail('draft-1');
    expect(service.list).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
    expect(service.detail).toHaveBeenCalledWith('draft-1');
  });
});
