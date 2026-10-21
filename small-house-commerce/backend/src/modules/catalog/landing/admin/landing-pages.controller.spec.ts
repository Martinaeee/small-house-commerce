import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import { once } from 'node:events';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import type { MarketingAccount } from '../../../marketing/marketing-access.js';
import { UploadsService } from '../../../uploads/uploads.service.js';
import { GUARDS_METADATA, HEADERS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { AdminLandingPagesController, AdminProductLandingPagesController } from './landing-pages.controller.js';
import { MarketingGuard } from '../../../marketing/marketing.guard.js';
import { landingAssignOwnerSchema, landingDraftWriteSchema, landingVersionSchema } from '../dto/landing-page.dto.js';

const content = { schemaVersion: 1, blocks: [{ id: 'buy', type: 'buy', sourceKey: null, props: {} }] };

describe('landing management authorization and write boundary', () => {
  it('protects both global and legacy product routes with owner-aware marketing access', () => {
    for (const controller of [AdminLandingPagesController, AdminProductLandingPagesController])
      expect(Reflect.getMetadata(GUARDS_METADATA, controller)).toContain(MarketingGuard);
  });

  it('requires a version and content, and rejects owner or slug changes in a draft write', () => {
    expect(landingDraftWriteSchema.safeParse({ content, expectedVersion: 0 }).success).toBe(true);
    expect(landingDraftWriteSchema.safeParse({ content, expectedVersion: 0, name: 'New internal name' }).success).toBe(true);
    for (const input of [{ content }, { content, expectedVersion: -1 }, { content, expectedVersion: 1, ownerUserId: 'other' }, { content, expectedVersion: 1, slug: 'new-address' }])
      expect(landingDraftWriteSchema.safeParse(input).success).toBe(false);
  });

  it('marks private previews as non-cacheable and non-referring', () => {
    const handler = AdminLandingPagesController.prototype.preview;
    expect(handler).toBeTypeOf('function');
    expect(Reflect.getMetadata(HEADERS_METADATA, handler)).toEqual(expect.arrayContaining([
      { name: 'Cache-Control', value: 'private, no-store' },
      { name: 'Referrer-Policy', value: 'no-referrer' },
    ]));
  });

  it('registers dedicated marketing product and owner choices under the guarded controller', () => {
    expect(Reflect.getMetadata(PATH_METADATA, AdminLandingPagesController.prototype.productOptions)).toBe('product-options');
    expect(Reflect.getMetadata(PATH_METADATA, AdminLandingPagesController.prototype.ownerOptions)).toBe('owner-options');
  });

  it('registers a strict versioned owner assignment action without accepting AID or historical changes', () => {
    expect(Reflect.getMetadata(PATH_METADATA, AdminLandingPagesController.prototype.assignOwner)).toBe(':id/assign-owner');
    const valid = { ownerUserId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', expectedVersion: 0 };
    expect(landingAssignOwnerSchema.safeParse(valid).success).toBe(true);
    for (const input of [{ ownerUserId: valid.ownerUserId }, { ...valid, ownerUserId: 'unknown' }, { ...valid, aid: 'MA-1' }, { ...valid, transferHistory: true }]) expect(landingAssignOwnerSchema.safeParse(input).success).toBe(false);
  });

  it('requires a version for publish and disable actions', () => {
    expect(landingVersionSchema.safeParse({ expectedVersion: 0 }).success).toBe(true);
    expect(landingVersionSchema.safeParse({}).success).toBe(false);
  });
});

const own: MarketingAccount = { id: 'optimizer-a', permissions: ['MARKETING_VIEW_OWN', 'MARKETING_MANAGE_OWN'] };
function mediaFixture(ownerUserId: string | null = own.id) {
  const pages = { getDraft: vi.fn().mockResolvedValue({ ownerUserId }) };
  const uploads = new UploadsService({ get: () => null } as never);
  const save = vi.spyOn(uploads, 'saveLocal').mockResolvedValue({ url: '/uploads/catalog/test.jpg', key: 'catalog/test.jpg' });
  return { pages, save, controller: new AdminLandingPagesController(pages as never, uploads) };
}
function rawRequest(buffer = Buffer.from('raw-file'), contentType = 'image/jpeg; charset=binary'): Request {
  const request = Readable.from([buffer]) as unknown as Request;
  request.headers = { 'content-type': contentType };
  return request;
}

describe('page-authorized media uploads', () => {
  it('registers a page-specific route under the existing owner-aware guard', () => {
    expect(AdminLandingPagesController.prototype.uploadMedia).toBeTypeOf('function');
    expect(Reflect.getMetadata(PATH_METADATA, AdminLandingPagesController.prototype.uploadMedia)).toBe(':id/uploads');
  });

  it('uploads raw bytes for an owned page without requiring product management', async () => {
    const { controller, pages, save } = mediaFixture();
    expect(controller.uploadMedia).toBeTypeOf('function');
    await expect(controller.uploadMedia('page-1', rawRequest(), own)).resolves.toEqual({ url: '/uploads/catalog/test.jpg', key: 'catalog/test.jpg' });
    expect(pages.getDraft).toHaveBeenCalledWith('page-1', own);
    expect(save).toHaveBeenCalledWith(Buffer.from('raw-file'), 'image/jpeg');
  });

  it('refuses a broad read-only finance account before consuming or storing bytes', async () => {
    const { controller, save } = mediaFixture(); const request = rawRequest();
    expect(controller.uploadMedia).toBeTypeOf('function');
    await expect(controller.uploadMedia('page-1', request, { id: 'finance', permissions: ['MARKETING_VIEW_ALL'] })).rejects.toBeInstanceOf(ForbiddenException);
    expect(request.listenerCount('data')).toBe(0); expect(save).not.toHaveBeenCalled();
    request.destroy();
  });

  it.each(['optimizer-b', null])('does not reveal or upload to an inaccessible owner %s', async owner => {
    const { controller, save } = mediaFixture(owner); const request = rawRequest();
    expect(controller.uploadMedia).toBeTypeOf('function');
    await expect(controller.uploadMedia('page-1', request, own)).rejects.toBeInstanceOf(NotFoundException);
    expect(request.listenerCount('data')).toBe(0); expect(save).not.toHaveBeenCalled(); request.destroy();
  });

  it('does not turn VIEW_ALL plus MANAGE_OWN into foreign management', async () => {
    const { controller, save } = mediaFixture('optimizer-b'); const request = rawRequest();
    expect(controller.uploadMedia).toBeTypeOf('function');
    await expect(controller.uploadMedia('page-1', request, { ...own, permissions: [...own.permissions, 'MARKETING_VIEW_ALL'] })).rejects.toBeInstanceOf(NotFoundException);
    expect(save).not.toHaveBeenCalled(); request.destroy();
  });

  it('lets an all-owner manager upload without changing page ownership', async () => {
    const { controller, save } = mediaFixture('optimizer-b');
    expect(controller.uploadMedia).toBeTypeOf('function');
    await controller.uploadMedia('page-1', rawRequest(), { id: 'admin', permissions: ['MARKETING_VIEW_ALL', 'MARKETING_MANAGE_ALL'] });
    expect(save).toHaveBeenCalledOnce();
  });

  it('rejects oversized image streams before storage using the existing 5MB cap', async () => {
    const { controller, save } = mediaFixture();
    expect(controller.uploadMedia).toBeTypeOf('function');
    await expect(controller.uploadMedia('page-1', rawRequest(Buffer.alloc(5 * 1024 * 1024 + 1), 'image/png'), own)).rejects.toThrow(/5MB/);
    expect(save).not.toHaveBeenCalled();
  });

  it('retains the larger existing video cap rather than treating a video as an image', async () => {
    const { controller, save } = mediaFixture(); const video = Buffer.alloc(6 * 1024 * 1024);
    expect(controller.uploadMedia).toBeTypeOf('function');
    await controller.uploadMedia('page-1', rawRequest(video, 'video/quicktime'), own);
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0][0].equals(video)).toBe(true);
    expect(save.mock.calls[0][1]).toBe('video/quicktime');
  });

  it('rejects unsupported already-parsed bodies without awaiting a consumed stream', async () => {
    const { controller, save } = mediaFixture();
    const request = rawRequest(Buffer.from('{}'), 'application/json');
    const ended = once(request, 'end'); request.resume(); await ended;
    const result = controller.uploadMedia('page-1', request, own).catch(error => error);
    await Promise.resolve();
    expect(request.listenerCount('data')).toBe(0);
    expect(await result).toMatchObject({ message: 'Unsupported media type: application/json' });
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects empty or unsupported uploads through the shared upload policy', async () => {
    const pages = { getDraft: vi.fn().mockResolvedValue({ ownerUserId: own.id }) };
    const controller = new AdminLandingPagesController(pages as never, new UploadsService({ get: () => null } as never));
    expect(controller.uploadMedia).toBeTypeOf('function');
    await expect(controller.uploadMedia('page-1', rawRequest(Buffer.alloc(0)), own)).rejects.toThrow(/body missing/);
    await expect(controller.uploadMedia('page-1', rawRequest(Buffer.from('x'), 'image/svg+xml'), own)).rejects.toThrow(/Unsupported media type/);
  });
});
