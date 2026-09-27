import { RequestMethod, ParseUUIDPipe } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { CmsModule } from '../cms.module.js';
import { DOCUMENT_VALIDATOR } from '../homepage-document.js';
import { HomepageDocumentService } from '../homepage-document.service.js';
import { PrismaLinkLookup } from '../homepage-link-lookup.js';
import { HomepageValidator } from '../homepage-validation.js';
import { PREVIEW_TOKEN_TTL_MS, verifyPreviewToken } from '../homepage-preview-token.js';
import { AdminHomepageController } from './homepage.controller.js';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/permissions.guard.js';
import { PERMISSIONS_KEY } from '../../auth/permissions.decorator.js';
import {
  previewTokenSchema,
  publishSchema,
  restoreSchema,
  saveDraftSchema,
  unpublishSchema,
} from '../dto/homepage-document.dto.js';

const DOCUMENT_ROUTES = [
  { methodName: 'getDraft', method: RequestMethod.GET, path: 'draft' },
  { methodName: 'saveDraft', method: RequestMethod.PUT, path: 'draft' },
  { methodName: 'validate', method: RequestMethod.POST, path: 'validate' },
  { methodName: 'publish', method: RequestMethod.POST, path: 'publish' },
  { methodName: 'listVersions', method: RequestMethod.GET, path: 'versions' },
  { methodName: 'getVersion', method: RequestMethod.GET, path: 'versions/:id' },
  {
    methodName: 'restore',
    method: RequestMethod.POST,
    path: 'versions/:id/restore',
  },
  {
    methodName: 'unpublish',
    method: RequestMethod.POST,
    path: 'versions/:id/unpublish',
  },
  { methodName: 'previewToken', method: RequestMethod.POST, path: 'preview-token' },
] as const;

const USER_ID = '018f0c8b-2f4f-7f65-a409-a6bdb7de7523';
const VERSION_ID = '018f0c8b-2f4f-7f65-a409-a6bdb7de7524';

function routeMetadata(methodName: string) {
  const handler = AdminHomepageController.prototype[methodName as keyof AdminHomepageController];
  return {
    path: Reflect.getMetadata(PATH_METADATA, handler),
    method: Reflect.getMetadata(METHOD_METADATA, handler),
  };
}

function request(userId = USER_ID) {
  return { user: { userId, email: 'admin@test' } } as never;
}

describe('AdminHomepageController routes', () => {
  it('exposes exactly the nine document routes with independently asserted metadata', () => {
    const documentHandlerNames = Object.getOwnPropertyNames(
      AdminHomepageController.prototype,
    ).filter((name) => name !== 'constructor' && name !== 'list');
    expect(documentHandlerNames.sort()).toEqual(
      DOCUMENT_ROUTES.map(({ methodName }) => methodName).sort(),
    );

    for (const { methodName, method, path } of DOCUMENT_ROUTES) {
      expect(routeMetadata(methodName)).toEqual({ method, path });
    }
  });

  it('protects every route with JWT authentication, permission checks, and PRODUCT_MANAGE', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminHomepageController)).toEqual(
      expect.arrayContaining([JwtAuthGuard, PermissionsGuard]),
    );
    expect(Reflect.getMetadata(PERMISSIONS_KEY, AdminHomepageController)).toEqual([
      'PRODUCT_MANAGE',
    ]);
  });

  it('removes both legacy write handlers while retaining the read-only GET route', async () => {
    const homepage = { adminList: vi.fn().mockResolvedValue({ sections: [] }) };
    const controller = new AdminHomepageController(homepage as never, {} as never, {} as never, {} as never);

    expect((AdminHomepageController.prototype as Record<string, unknown>).save).toBeUndefined();
    expect((AdminHomepageController.prototype as Record<string, unknown>).setProducts).toBeUndefined();
    expect(Reflect.getMetadata(PATH_METADATA, AdminHomepageController.prototype.list)).toBe(
      'sections',
    );
    expect(Reflect.getMetadata(METHOD_METADATA, AdminHomepageController.prototype.list)).toBe(
      RequestMethod.GET,
    );
    await expect(controller.list()).resolves.toEqual({ sections: [] });
    expect(homepage.adminList).toHaveBeenCalledOnce();
  });
});

describe('AdminHomepageController delegation', () => {
  function makeController(secret = 'homepage-secret') {
    const docs = {
      getDraft: vi.fn().mockResolvedValue({ draft: { schemaVersion: 1 }, draftRev: 8 }),
      saveDraft: vi.fn().mockResolvedValue({ draftRev: 9 }),
      publish: vi.fn().mockResolvedValue({ versionNo: 4, publishAt: '2026-09-27T00:00:00.000Z' }),
      listVersions: vi.fn().mockResolvedValue([]),
      getVersion: vi.fn().mockResolvedValue({ id: VERSION_ID }),
      restoreVersion: vi.fn().mockResolvedValue({ draftRev: 10 }),
      unpublishVersion: vi.fn().mockResolvedValue(undefined),
    };
    const validator = { validate: vi.fn().mockResolvedValue({ errors: [], warnings: [] }) };
    const config = { get: vi.fn().mockReturnValue(secret) };
    const homepage = { adminList: vi.fn() };
    return {
      controller: new AdminHomepageController(
        homepage as never,
        docs as never,
        validator as never,
        config as unknown as ConfigService,
      ),
      docs,
      validator,
      config,
    };
  }

  it('delegates draft reads and saves with the authenticated user id and expected revision', async () => {
    const { controller, docs } = makeController();
    const draft = { schemaVersion: 1, sections: [], announcement: {} };

    await expect(controller.getDraft()).resolves.toEqual({ draft: { schemaVersion: 1 }, draftRev: 8 });
    await expect(controller.saveDraft({ draft, expectedRev: 8 }, request())).resolves.toEqual({ draftRev: 9 });

    expect(docs.getDraft).toHaveBeenCalledOnce();
    expect(docs.saveDraft).toHaveBeenCalledWith(draft, 8, USER_ID);
  });

  it('validates the currently saved draft without writing it', async () => {
    const { controller, docs, validator } = makeController();

    await expect(controller.validate()).resolves.toEqual({ errors: [], warnings: [] });

    expect(docs.getDraft).toHaveBeenCalledOnce();
    expect(validator.validate).toHaveBeenCalledWith({ schemaVersion: 1 });
  });

  it('delegates publish options and identity without recreating version logic', async () => {
    const { controller, docs } = makeController();
    const input = {
      note: 'Homepage refresh',
      publishAt: '2026-10-01T00:00:00+08:00',
      unpublishAt: '2026-10-02T00:00:00+08:00',
      confirmWarnings: true,
    };

    await expect(controller.publish(input, request())).resolves.toEqual({
      versionNo: 4,
      publishAt: '2026-09-27T00:00:00.000Z',
    });
    expect(docs.publish).toHaveBeenCalledWith({ ...input, userId: USER_ID });
  });

  it('delegates version listing, reading, restore, and unpublish with their valid UUIDv7 route ids', async () => {
    const { controller, docs } = makeController();

    await controller.listVersions();
    await controller.getVersion(VERSION_ID);
    await controller.restore(VERSION_ID, request());
    await controller.unpublish(VERSION_ID);

    expect(docs.listVersions).toHaveBeenCalledOnce();
    expect(docs.getVersion).toHaveBeenCalledWith(VERSION_ID);
    expect(docs.restoreVersion).toHaveBeenCalledWith(VERSION_ID, USER_ID);
    expect(docs.unpublishVersion).toHaveBeenCalledWith(VERSION_ID);
  });

  it('rejects malformed version ids through v7 pipes before document delegation', async () => {
    const { docs } = makeController();
    const versionHandlers = ['getVersion', 'restore', 'unpublish'] as const;

    for (const methodName of versionHandlers) {
      const metadata = Reflect.getMetadata(
        ROUTE_ARGS_METADATA,
        AdminHomepageController,
        methodName,
      ) as Record<string, { data?: unknown; pipes?: unknown[] }>;
      const idArgument = Object.values(metadata).find((argument) => argument.data === 'id');
      const idPipe = idArgument?.pipes?.find(
        (pipe): pipe is ParseUUIDPipe => pipe instanceof ParseUUIDPipe,
      );

      expect(idPipe).toBeInstanceOf(ParseUUIDPipe);
      if (!idPipe) throw new Error(`missing UUID pipe for ${methodName}`);
      expect((idPipe as unknown as { version: string }).version).toBe('7');
      await expect(idPipe.transform('not-a-version-id')).rejects.toThrow();
      await expect(idPipe.transform(VERSION_ID)).resolves.toBe(VERSION_ID);
    }

    expect(docs.getVersion).not.toHaveBeenCalled();
    expect(docs.restoreVersion).not.toHaveBeenCalled();
    expect(docs.unpublishVersion).not.toHaveBeenCalled();
  });

  it('signs the current saved draft revision and returns the fixed TTL', async () => {
    const { controller, docs, config } = makeController();

    const result = await controller.previewToken();

    expect(config.get).toHaveBeenCalledWith('homepagePreviewSecret');
    expect(docs.getDraft).toHaveBeenCalledOnce();
    expect(result.expiresInMs).toBe(PREVIEW_TOKEN_TTL_MS);
    expect(verifyPreviewToken(result.token, 'homepage-secret', new Date())).toEqual({
      draftRev: 8,
    });
  });

  it('returns 503 and does not read or sign when preview signing is disabled', async () => {
    const { controller, docs } = makeController('');

    await expect(controller.previewToken()).rejects.toMatchObject({ status: 503 });
    expect(docs.getDraft).not.toHaveBeenCalled();
  });
});

describe('homepage document DTOs', () => {
  it('requires a nonnegative integer expectedRev and accepts an unknown draft', () => {
    expect(saveDraftSchema.safeParse({ draft: { anything: true }, expectedRev: 0 }).success).toBe(true);
    expect(saveDraftSchema.safeParse({ draft: {}, expectedRev: -1 }).success).toBe(false);
    expect(saveDraftSchema.safeParse({ draft: {}, expectedRev: 1.5 }).success).toBe(false);
  });

  it('defaults optional publish fields and rejects invalid date windows', () => {
    expect(publishSchema.parse({})).toEqual({
      note: null,
      publishAt: null,
      unpublishAt: null,
      confirmWarnings: false,
    });
    expect(
      publishSchema.safeParse({
        note: null,
        publishAt: '2026-10-01T00:00:00+08:00',
        unpublishAt: '2026-09-30T23:00:00+08:00',
      }).success,
    ).toBe(false);
    expect(
      publishSchema.safeParse({
        note: null,
        publishAt: '2026-10-01T00:00:00',
        unpublishAt: '2026-10-02T00:00:00+08:00',
      }).success,
    ).toBe(false);
  });

  it('keeps empty bodies valid for restore, unpublish, and preview token actions', () => {
    expect(restoreSchema.safeParse({}).success).toBe(true);
    expect(unpublishSchema.safeParse({}).success).toBe(true);
    expect(previewTokenSchema.safeParse({}).success).toBe(true);
  });
});

describe('CmsModule homepage providers', () => {
  it('registers the canonical document service, validator, and link lookup provider', () => {
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, CmsModule) as unknown[];
    expect(providers).toContain(HomepageDocumentService);
    expect(providers).toContain(PrismaLinkLookup);
    expect(providers).toContainEqual(
      expect.objectContaining({
        provide: HomepageValidator,
        inject: [PrismaLinkLookup],
      }),
    );
    expect(providers).toContainEqual(
      expect.objectContaining({
        provide: DOCUMENT_VALIDATOR,
        useExisting: HomepageValidator,
      }),
    );
  });
});
