import {
  GUARDS_METADATA,
  HEADERS_METADATA,
} from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { PERMISSIONS_KEY } from '../../auth/permissions.decorator.js';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/permissions.guard.js';
import { AdminLinkBuilderController } from './link-builder.controller.js';

describe('AdminLinkBuilderController', () => {
  it('returns the minimal public catalog context', async () => {
    const context = {
      getContext: vi.fn().mockResolvedValue({ products: [] }),
    };
    const controller = new AdminLinkBuilderController(context as never);

    await expect(controller.getContext()).resolves.toEqual({ products: [] });
    expect(context.getContext).toHaveBeenCalledOnce();
  });

  it('requires the dedicated campaign link permission', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, AdminLinkBuilderController),
    ).toEqual(expect.arrayContaining([JwtAuthGuard, PermissionsGuard]));
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, AdminLinkBuilderController),
    ).toEqual(['CAMPAIGN_LINK_BUILD']);
  });

  it('marks the response private and non-cacheable', () => {
    expect(
      Reflect.getMetadata(
        HEADERS_METADATA,
        AdminLinkBuilderController.prototype.getContext,
      ),
    ).toContainEqual({ name: 'Cache-Control', value: 'private, no-store' });
  });
});
