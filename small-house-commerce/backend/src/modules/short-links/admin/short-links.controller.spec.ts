import 'reflect-metadata';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { MarketingGuard } from '../../marketing/marketing.guard.js';
import { ShortLinksService } from '../short-links.service.js';
import { AdminShortLinksController } from './short-links.controller.js';

describe('AdminShortLinksController', () => {
  it('requires an authenticated marketing account', () => {
    expect(Reflect.getMetadata(PATH_METADATA, AdminShortLinksController)).toBe('admin/short-links');
    const guards = Reflect.getMetadata(GUARDS_METADATA, AdminShortLinksController);
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(MarketingGuard);
  });

  it('delegates creation to the service', async () => {
    const createLink = vi.fn().mockResolvedValue({
      code: 'abc12345',
      path: '/s/abc12345',
      target: '/products/chair',
    });
    const controller = new AdminShortLinksController({
      createLink,
    } as unknown as ShortLinksService);

    await expect(controller.create({ url: 'https://luwag.shop/products/chair' })).resolves.toEqual({
      code: 'abc12345',
      path: '/s/abc12345',
      target: '/products/chair',
    });
    expect(createLink).toHaveBeenCalledWith('https://luwag.shop/products/chair');
  });
});
