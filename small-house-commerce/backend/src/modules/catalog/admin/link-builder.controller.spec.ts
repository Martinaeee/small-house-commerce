import {
  GUARDS_METADATA,
  HEADERS_METADATA,
} from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { MarketingGuard } from '../../marketing/marketing.guard.js';
import { AdminLinkBuilderController } from './link-builder.controller.js';

describe('AdminLinkBuilderController', () => {
  it('returns the minimal public catalog context', async () => {
    const context = {
      getContext: vi.fn().mockResolvedValue({ products: [] }),
    };
    const controller = new AdminLinkBuilderController(context as never);

    const account = { id: 'u1', permissions: ['MARKETING_VIEW_OWN'] };
    await expect(controller.getContext(account)).resolves.toEqual({ products: [] });
    expect(context.getContext).toHaveBeenCalledWith(account);
  });

  it('uses the owner-aware marketing guard, not a legacy permission bypass', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, AdminLinkBuilderController),
    ).toEqual(expect.arrayContaining([JwtAuthGuard, MarketingGuard]));
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
