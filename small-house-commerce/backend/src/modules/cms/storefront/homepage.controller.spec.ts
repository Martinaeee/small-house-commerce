import { RequestMethod } from '@nestjs/common';
import {
  METHOD_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { StorefrontHomepageController } from './homepage.controller.js';

function routeMetadata(methodName: 'get' | 'announcement') {
  const handler = StorefrontHomepageController.prototype[methodName];
  return {
    path: Reflect.getMetadata(PATH_METADATA, handler),
    method: Reflect.getMetadata(METHOD_METADATA, handler),
  };
}

describe('StorefrontHomepageController', () => {
  it('exposes homepage and announcement GET routes', () => {
    expect(routeMetadata('get')).toEqual({
      method: RequestMethod.GET,
      path: 'homepage',
    });
    expect(routeMetadata('announcement')).toEqual({
      method: RequestMethod.GET,
      path: 'announcement',
    });
  });

  it('forwards previewToken and marks every supplied token request private', async () => {
    const homepage = {
      storefrontGet: vi.fn().mockResolvedValue({ sections: [] }),
      storefrontGetAnnouncement: vi.fn().mockResolvedValue(null),
    };
    const res = { setHeader: vi.fn() };
    const controller = new StorefrontHomepageController(homepage as never);

    await expect(
      controller.get('invalid-token', res as never),
    ).resolves.toEqual({ sections: [] });
    expect(homepage.storefrontGet).toHaveBeenCalledWith({
      previewToken: 'invalid-token',
    });
    expect(res.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'private, no-store',
    );

    await controller.announcement('', res as never);
    expect(homepage.storefrontGetAnnouncement).toHaveBeenCalledWith({
      previewToken: '',
    });
    expect(res.setHeader).toHaveBeenCalledTimes(2);
  });

  it('forwards a tokenless announcement request without setting a cache header', async () => {
    const homepage = {
      storefrontGet: vi.fn(),
      storefrontGetAnnouncement: vi.fn().mockResolvedValue(null),
    };
    const res = { setHeader: vi.fn() };
    const controller = new StorefrontHomepageController(homepage as never);

    await expect(
      controller.announcement(undefined, res as never),
    ).resolves.toBeNull();
    expect(homepage.storefrontGetAnnouncement).toHaveBeenCalledWith({
      previewToken: undefined,
    });
    expect(res.setHeader).not.toHaveBeenCalled();
  });

  it('marks repeated query values private and forwards an invalid-token sentinel instead of an array', async () => {
    const homepage = {
      storefrontGet: vi.fn().mockResolvedValue({ sections: [] }),
      storefrontGetAnnouncement: vi.fn().mockResolvedValue(null),
    };
    const homepageResponse = { setHeader: vi.fn() };
    const announcementResponse = { setHeader: vi.fn() };
    const controller = new StorefrontHomepageController(homepage as never);

    await controller.get(
      ['first-token', 'second-token'] as never,
      homepageResponse as never,
    );
    await controller.announcement(
      ['', 'announcement-token'] as never,
      announcementResponse as never,
    );

    expect(homepage.storefrontGet).toHaveBeenCalledWith({
      previewToken: '',
    });
    expect(homepage.storefrontGetAnnouncement).toHaveBeenCalledWith({
      previewToken: '',
    });
    expect(homepageResponse.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'private, no-store',
    );
    expect(announcementResponse.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'private, no-store',
    );
  });

  it('declares query and passthrough response parameters instead of sending manually', () => {
    for (const methodName of ['get', 'announcement'] as const) {
      const metadata = Reflect.getMetadata(
        ROUTE_ARGS_METADATA,
        StorefrontHomepageController,
        methodName,
      ) as Record<string, { data?: unknown; index: number }>;
      const args = Object.values(metadata);
      expect(args).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ data: 'previewToken' }),
          expect.objectContaining({ data: undefined }),
        ]),
      );
    }
  });
});
