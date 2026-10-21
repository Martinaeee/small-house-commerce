import { GUARDS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { PERMISSIONS_KEY } from '../../../auth/permissions.decorator.js';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../../../auth/permissions.guard.js';
import { sharedFaqProductQuerySchema } from '../dto/shared-faq.dto.js';
import { AdminSharedFaqController } from './shared-faq.controller.js';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('AdminSharedFaqController product selection', () => {
  it('keeps the FAQ-only product picker under its own permission', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminSharedFaqController))
      .toEqual(expect.arrayContaining([JwtAuthGuard, PermissionsGuard]));
    expect(Reflect.getMetadata(PERMISSIONS_KEY, AdminSharedFaqController))
      .toEqual(['PRODUCT_FAQ_SHARED_MANAGE']);
  });

  it('parses a selected ID batch and delegates to the restricted FAQ projection', async () => {
    const page = { items: [], total: 0, page: 1, pageSize: 20 };
    const shared = { listProducts: vi.fn(async () => page) };
    const controller = new AdminSharedFaqController(shared as never);
    const query = sharedFaqProductQuerySchema.parse({ ids: `${A},${B}` });
    await expect(controller.listProducts(query)).resolves.toEqual(page);
    expect(shared.listProducts).toHaveBeenCalledWith({ ids: [A, B], page: 1, pageSize: 20 });
  });

  it.each([{ ids: 'bad-id' }, { ids: '' }, { page: 0 }, { pageSize: 101 }])
    ('rejects malformed or oversized picker queries %j', (query) => {
      expect(sharedFaqProductQuerySchema.safeParse(query).success).toBe(false);
    });
});
