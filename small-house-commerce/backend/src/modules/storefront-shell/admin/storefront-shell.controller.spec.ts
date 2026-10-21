import {
  BadRequestException,
  RequestMethod,
} from '@nestjs/common';
import {
  GUARDS_METADATA,
  HEADERS_METADATA,
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { Readable } from 'node:stream';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../../app.module.js';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { PERMISSIONS_KEY } from '../../auth/permissions.decorator.js';
import { PermissionsGuard } from '../../auth/permissions.guard.js';
import { UploadsModule } from '../../uploads/uploads.module.js';
import { SettingsModule } from '../../settings/settings.module.js';
import { createCurrentLuwagShellDocument } from '../storefront-shell-document.js';
import { StorefrontShellAssetsService } from '../storefront-shell-assets.service.js';
import { StorefrontShellService } from '../storefront-shell.service.js';
import { StorefrontShellModule } from '../storefront-shell.module.js';
import {
  shellPublishSchema,
  shellUploadQuerySchema,
  shellValidateSchema,
  shellWriteSchema,
} from '../dto/storefront-shell.dto.js';
import { AdminStorefrontShellController } from './storefront-shell.controller.js';

const USER_ID = '00000000-0000-7000-8000-000000000901';
const document = createCurrentLuwagShellDocument({
  rootCategories: [],
  navigationCollections: [],
  supportEmail: 'support@luwag.ph',
  supportHours: 'Mon–Sat, 9am–6pm (PHT)',
});
const snapshot = {
  document,
  version: 7,
  publishedRevision: 4,
  hasUnpublishedChanges: true,
  updatedAt: '2026-10-13T04:00:00.000Z',
  publishedAt: '2026-10-13T03:00:00.000Z',
  issues: [],
  assets: {},
};
const preview = {
  version: 7,
  issues: [],
  shell: {
    publishedRevision: 4,
    brand: { brandName: 'LUWAG', horizontalLogo: null, squareMark: null },
    header: { items: [] },
    footer: {
      tagline: document.footer.tagline,
      description: document.footer.description,
      columns: [],
      copyrightBrand: document.footer.copyrightBrand,
    },
    theme: document.theme,
    derivedTheme: {
      primaryDark: '#b8946a',
      primaryLight: '#e8dccb',
      actionHover: '#5a4130',
      textSecondary: '#666666',
      textMuted: '#999999',
      border: '#e8e2d9',
      focus: '#6b4f3a',
      disabled: '#999999',
      actionForeground: '#ffffff',
    },
  },
};
const asset = {
  id: '10000000-0000-7000-8000-000000000901',
  kind: 'HORIZONTAL' as const,
  url: '/uploads/brand/2026/logo.webp',
  mimeType: 'image/webp' as const,
  width: 600,
  height: 120,
  durable: true,
  createdAt: '2026-10-13T04:00:00.000Z',
};

const ROUTES = [
  { methodName: 'get', method: RequestMethod.GET, path: '/' },
  { methodName: 'save', method: RequestMethod.PATCH, path: '/' },
  { methodName: 'validate', method: RequestMethod.POST, path: 'validate' },
  { methodName: 'publish', method: RequestMethod.POST, path: 'publish' },
  { methodName: 'upload', method: RequestMethod.POST, path: 'upload' },
  { methodName: 'preview', method: RequestMethod.GET, path: 'preview' },
] as const;

function metadata(methodName: string) {
  const handler = AdminStorefrontShellController.prototype[
    methodName as keyof AdminStorefrontShellController
  ];
  return {
    path: Reflect.getMetadata(PATH_METADATA, handler),
    method: Reflect.getMetadata(METHOD_METADATA, handler),
    headers: Reflect.getMetadata(HEADERS_METADATA, handler) as
      | Array<{ name: string; value: string }>
      | undefined,
  };
}

function makeController() {
  const shell = {
    getAdminDraft: vi.fn(async () => snapshot),
    saveDraft: vi.fn(async () => snapshot),
    validateDraft: vi.fn(async () => ({
      version: 7,
      issues: [],
      derivedTheme: preview.shell.derivedTheme,
    })),
    publish: vi.fn(async () => snapshot),
    getSavedPreview: vi.fn(async () => preview),
  };
  const assets = {
    processAndStore: vi.fn(async () => asset),
  };
  return {
    controller: new AdminStorefrontShellController(
      shell as never,
      assets as never,
    ),
    shell,
    assets,
  };
}

function rawRequest(body: Buffer, contentType?: string): Request {
  const stream = Readable.from(body.length === 0 ? [] : [body]);
  Object.assign(stream, {
    headers: contentType === undefined ? {} : { 'content-type': contentType },
  });
  return stream as unknown as Request;
}

const user = { userId: USER_ID, email: 'shell-admin@example.test' };

describe('AdminStorefrontShellController contract', () => {
  it('exposes exactly the six shell routes', () => {
    const handlers = Object.getOwnPropertyNames(
      AdminStorefrontShellController.prototype,
    ).filter((name) => name !== 'constructor');
    expect(handlers.sort()).toEqual(ROUTES.map((route) => route.methodName).sort());

    for (const route of ROUTES) {
      expect(metadata(route.methodName)).toMatchObject({
        path: route.path,
        method: route.method,
      });
    }
  });

  it('requires JWT authentication and STOREFRONT_SHELL_MANAGE for every route', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, AdminStorefrontShellController),
    ).toEqual(expect.arrayContaining([JwtAuthGuard, PermissionsGuard]));
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, AdminStorefrontShellController),
    ).toEqual(['STOREFRONT_SHELL_MANAGE']);
  });

  it('marks admin reads, validation and preview private, with preview referrer isolation', () => {
    for (const methodName of ['get', 'validate', 'preview']) {
      expect(metadata(methodName).headers).toEqual(
        expect.arrayContaining([
          { name: 'Cache-Control', value: 'private, no-store' },
        ]),
      );
    }
    expect(metadata('preview').headers).toEqual(
      expect.arrayContaining([
        { name: 'Referrer-Policy', value: 'no-referrer' },
      ]),
    );
  });

  it('forwards draft save, unsaved validation and publish with the exact actor/version', async () => {
    const { controller, shell } = makeController();

    await expect(
      controller.save({ expectedVersion: 7, document }, user),
    ).resolves.toBe(snapshot);
    await expect(controller.validate(document)).resolves.toMatchObject({
      version: 7,
      issues: [],
    });
    await expect(
      controller.publish({ expectedVersion: 7 }, user),
    ).resolves.toBe(snapshot);

    expect(shell.saveDraft).toHaveBeenCalledWith(document, 7, USER_ID);
    expect(shell.validateDraft).toHaveBeenCalledWith(document);
    expect(shell.publish).toHaveBeenCalledWith(7, USER_ID);
  });

  it('returns version and issues on every successful admin action', async () => {
    const { controller } = makeController();
    const results = await Promise.all([
      controller.get(),
      controller.save({ expectedVersion: 7, document }, user),
      controller.validate(document),
      controller.publish({ expectedVersion: 7 }, user),
      controller.preview(),
      controller.upload(
        { slot: 'horizontal' },
        rawRequest(Buffer.from('jpeg bytes'), 'image/jpeg'),
        user,
      ),
    ]);

    for (const result of results) {
      expect(result).toEqual(
        expect.objectContaining({ version: expect.any(Number), issues: expect.any(Array) }),
      );
    }
    expect(results[5]).toEqual({ version: 7, issues: [], asset });
  });

  it('normalizes admitted image content type and maps the slot to the trusted kind', async () => {
    const { controller, assets } = makeController();
    const body = Buffer.from('decoded by Task 5');

    await controller.upload(
      { slot: 'square' },
      rawRequest(body, 'image/png; charset=binary'),
      user,
    );

    expect(assets.processAndStore).toHaveBeenCalledWith(
      'SQUARE',
      body,
      'image/png',
      USER_ID,
    );
  });

  it('rejects missing/invalid MIME, empty body and an oversized raw body before processing', async () => {
    const { controller, assets } = makeController();

    await expect(
      controller.upload(
        { slot: 'horizontal' },
        rawRequest(Buffer.from('x')),
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.upload(
        { slot: 'horizontal' },
        rawRequest(Buffer.from('x'), 'image/gif'),
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.upload(
        { slot: 'horizontal' },
        rawRequest(Buffer.alloc(0), 'image/png'),
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.upload(
        { slot: 'horizontal' },
        rawRequest(Buffer.alloc(5 * 1024 * 1024 + 1), 'image/png'),
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(assets.processAndStore).not.toHaveBeenCalled();
  });
});

describe('storefront shell DTOs', () => {
  it('accepts exact write/publish/validate shapes and rejects stale scalar forms', () => {
    expect(shellWriteSchema.parse({ expectedVersion: 7, document })).toEqual({
      expectedVersion: 7,
      document,
    });
    expect(shellPublishSchema.parse({ expectedVersion: 7 })).toEqual({
      expectedVersion: 7,
    });
    expect(shellValidateSchema.parse(document)).toEqual(document);
    expect(shellWriteSchema.safeParse({ expectedVersion: 0, document }).success).toBe(false);
    expect(shellPublishSchema.safeParse({ expectedVersion: 'nope' }).success).toBe(false);
  });

  it('accepts only the two explicit upload slots', () => {
    expect(shellUploadQuerySchema.parse({ slot: 'horizontal' })).toEqual({
      slot: 'horizontal',
    });
    expect(shellUploadQuerySchema.parse({ slot: 'square' })).toEqual({
      slot: 'square',
    });
    expect(shellUploadQuerySchema.safeParse({}).success).toBe(false);
    expect(shellUploadQuerySchema.safeParse({ slot: 'favicon' }).success).toBe(false);
  });
});

describe('StorefrontShellModule registration', () => {
  it('registers the admin/public APIs and the shell services without widening unrelated modules', () => {
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      StorefrontShellModule,
    ) as unknown[];
    const imports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      StorefrontShellModule,
    ) as unknown[];
    const controllers = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      StorefrontShellModule,
    ) as unknown[];

    expect(providers).toEqual(
      expect.arrayContaining([StorefrontShellService, StorefrontShellAssetsService]),
    );
    expect(imports).toEqual(expect.arrayContaining([UploadsModule, SettingsModule]));
    expect(controllers).toContain(AdminStorefrontShellController);
    const appImports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      AppModule,
    ) as unknown[];
    expect(appImports).toContain(StorefrontShellModule);
  });
});
