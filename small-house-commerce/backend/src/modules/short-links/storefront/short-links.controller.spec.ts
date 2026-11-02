import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { ShortLinksService } from '../short-links.service.js';
import { StorefrontShortLinksController } from './short-links.controller.js';

describe('StorefrontShortLinksController', () => {
  it('is a public storefront route', () => {
    expect(Reflect.getMetadata(PATH_METADATA, StorefrontShortLinksController)).toBe(
      'storefront/short-links',
    );
  });

  it('returns the saved target for a known code', async () => {
    const controller = new StorefrontShortLinksController({
      resolve: vi.fn().mockResolvedValue({ target: '/products/chair?cl=code' }),
    } as unknown as ShortLinksService);

    await expect(controller.resolve('abc12345')).resolves.toEqual({
      target: '/products/chair?cl=code',
    });
  });

  it('returns 404 for an unknown code', async () => {
    const controller = new StorefrontShortLinksController({
      resolve: vi.fn().mockResolvedValue(null),
    } as unknown as ShortLinksService);

    await expect(controller.resolve('missing1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
