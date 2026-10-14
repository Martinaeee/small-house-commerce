import { GUARDS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { PERMISSIONS_KEY } from '../../../auth/permissions.decorator.js';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../../../auth/permissions.guard.js';
import { AdminSharedFaqPreviewController } from './shared-faq-preview.controller.js';

describe('AdminSharedFaqPreviewController', () => {
  it('returns the shared items for a read-only product-editor preview', async () => {
    const items = [{ id: '11111111-1111-4111-8111-111111111111' }];
    const sharedFaq = { get: vi.fn().mockResolvedValue({ id: 'shared', items, version: 4, usage: { productCount: 2 } }) };
    const controller = new AdminSharedFaqPreviewController(sharedFaq as never);

    await expect(controller.preview()).resolves.toEqual({ items });
  });

  it('requires the product management permission and auth guards', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, AdminSharedFaqPreviewController),
    ).toEqual(expect.arrayContaining([JwtAuthGuard, PermissionsGuard]));
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, AdminSharedFaqPreviewController),
    ).toEqual(['PRODUCT_MANAGE']);
  });
});
