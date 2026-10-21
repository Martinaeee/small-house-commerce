import { GUARDS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { PERMISSIONS_KEY } from '../../../auth/permissions.decorator.js';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../../../auth/permissions.guard.js';
import { AdminProductFaqController } from './product-faq.controller.js';

describe('AdminProductFaqController', () => {
  it('delegates the overview query to ProductsService', async () => {
    const products = {
      listFaqProducts: vi.fn().mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
      }),
    };
    const controller = new AdminProductFaqController(products as never);
    const query = { page: 1, pageSize: 20 };

    await expect(controller.list(query)).resolves.toEqual({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
    expect(products.listFaqProducts).toHaveBeenCalledWith(query);
  });

  it('requires the product management permission and auth guards', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, AdminProductFaqController),
    ).toEqual(expect.arrayContaining([JwtAuthGuard, PermissionsGuard]));
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, AdminProductFaqController),
    ).toEqual(['PRODUCT_MANAGE']);
  });
});
