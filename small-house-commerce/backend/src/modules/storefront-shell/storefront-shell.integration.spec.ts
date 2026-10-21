import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { reconcileStorefrontShellPermission } from '../../../prisma/reconcile-storefront-shell-permission.js';
import {
  PermissionCode,
  Prisma,
  RoleCode,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SITE_SETTINGS_ID } from '../settings/settings.service.js';
import {
  createCurrentLuwagShellDocument,
  normalizeStorefrontShellDocument,
  storefrontShellDocumentSchema,
  type StorefrontShellDocument,
} from './storefront-shell-document.js';
import {
  STOREFRONT_SHELL_ID,
  StorefrontShellService,
} from './storefront-shell.service.js';

const database = process.env.STOREFRONT_SHELL_TEST_DATABASE_URL;
if (database) {
  const url = new URL(database);
  if (
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    url.pathname !== '/small_house_marketing_dev'
  ) {
    throw new Error(
      'Storefront Shell integration tests require the dedicated local marketing database.',
    );
  }
}

const COLLECTION_PREFIX = 'shell-integration-';

type OriginalShell = Awaited<
  ReturnType<PrismaService['storefrontShell']['findUniqueOrThrow']>
>;
type OriginalSettings = Awaited<
  ReturnType<PrismaService['siteSetting']['findUniqueOrThrow']>
>;

describe.skipIf(!database)('StorefrontShellService PostgreSQL lifecycle', () => {
  let prisma: PrismaService;
  let competingPrisma: PrismaService;
  let service: StorefrontShellService;
  let competingService: StorefrontShellService;
  let actorId: string;
  let createdSuperAdminRoleId: string | null = null;
  let originalShell: OriginalShell;
  let originalSettings: OriginalSettings;

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService({ database: { url: database } }),
    );
    competingPrisma = new PrismaService(
      new ConfigService({ database: { url: database } }),
    );
    await Promise.all([prisma.$connect(), competingPrisma.$connect()]);

    originalShell = await prisma.storefrontShell.findUniqueOrThrow({
      where: { id: STOREFRONT_SHELL_ID },
    });
    originalSettings = await prisma.siteSetting.findUniqueOrThrow({
      where: { id: SITE_SETTINGS_ID },
    });

    const superAdmin = await prisma.role.findUnique({
      where: { code: RoleCode.SUPER_ADMIN },
      select: { id: true },
    });
    if (!superAdmin) {
      createdSuperAdminRoleId = (
        await prisma.role.create({
          data: {
            code: RoleCode.SUPER_ADMIN,
            name: 'Super Admin',
            description: 'Full access, including storefront shell management.',
          },
        })
      ).id;
    }
    await reconcileStorefrontShellPermission(prisma);
    actorId = (
      await prisma.user.create({
        data: {
          name: 'Storefront Shell integration actor',
          email: `${COLLECTION_PREFIX}${randomUUID()}@example.test`,
          passwordHash: 'integration-only-not-a-login-password',
        },
      })
    ).id;
    service = new StorefrontShellService(prisma);
    competingService = new StorefrontShellService(competingPrisma);
  }, 20_000);

  beforeEach(async () => {
    await restoreOriginalState();
  });

  afterEach(async () => {
    await prisma.collection.deleteMany({
      where: { slug: { startsWith: COLLECTION_PREFIX } },
    });
    await restoreOriginalState();
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.collection.deleteMany({
      where: { slug: { startsWith: COLLECTION_PREFIX } },
    });
    if (originalShell && originalSettings) await restoreOriginalState();
    if (actorId) await prisma.user.deleteMany({ where: { id: actorId } });
    if (createdSuperAdminRoleId) {
      await prisma.role.deleteMany({ where: { id: createdSuperAdminRoleId } });
    }
    await Promise.all([prisma.$disconnect(), competingPrisma.$disconnect()]);
  });

  async function restoreOriginalState(): Promise<void> {
    await prisma.storefrontShell.update({
      where: { id: STOREFRONT_SHELL_ID },
      data: {
        schemaVersion: originalShell.schemaVersion,
        draftDocument: originalShell.draftDocument as Prisma.InputJsonValue,
        publishedDocument: originalShell.publishedDocument as Prisma.InputJsonValue,
        version: originalShell.version,
        publishedRevision: originalShell.publishedRevision,
        draftUpdatedByUserId: originalShell.draftUpdatedByUserId,
        publishedByUserId: originalShell.publishedByUserId,
        publishedAt: originalShell.publishedAt,
        updatedAt: originalShell.updatedAt,
      },
    });
    await prisma.siteSetting.update({
      where: { id: SITE_SETTINGS_ID },
      data: {
        supportEmail: originalSettings.supportEmail,
        supportHours: originalSettings.supportHours,
      },
    });
  }

  it('keeps a saved draft private and preserves publication, settings and revision', async () => {
    const document = integrationDocument(
      'Draft Only',
      'draft-only@luwag.ph',
      'Weekdays only',
    );

    const snapshot = await service.saveDraft(
      document,
      originalShell.version,
      actorId,
    );
    const row = await prisma.storefrontShell.findUniqueOrThrow({
      where: { id: STOREFRONT_SHELL_ID },
    });
    const settings = await prisma.siteSetting.findUniqueOrThrow({
      where: { id: SITE_SETTINGS_ID },
    });
    const publicShell = await service.getPublic();

    expect(snapshot.version).toBe(originalShell.version + 1);
    expect(row.draftDocument).toEqual(document);
    expect(row.publishedDocument).toEqual(originalShell.publishedDocument);
    expect(row.publishedRevision).toBe(originalShell.publishedRevision);
    expect(settings.supportEmail).toBe(originalSettings.supportEmail);
    expect(settings.supportHours).toBe(originalSettings.supportHours);
    expect(publicShell.brand.brandName).not.toBe('Draft Only');
  });

  it('allows exactly one of two competing clients to save the same version', async () => {
    const left = integrationDocument('CAS Left');
    const right = integrationDocument('CAS Right');

    const results = await Promise.allSettled([
      service.saveDraft(left, originalShell.version, actorId),
      competingService.saveDraft(right, originalShell.version, actorId),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: expect.any(ConflictException),
    });
    if (rejected?.status === 'rejected') {
      expect((rejected.reason as ConflictException).getResponse()).toMatchObject({
        code: 'SHELL_VERSION_MISMATCH',
        currentVersion: originalShell.version + 1,
      });
    }

    const row = await prisma.storefrontShell.findUniqueOrThrow({
      where: { id: STOREFRONT_SHELL_ID },
    });
    expect(row.version).toBe(originalShell.version + 1);
    expect(['CAS Left', 'CAS Right']).toContain(
      storefrontShellDocumentSchema.parse(row.draftDocument).brand.brandName,
    );
  });

  it('validates unsaved input without persisting it', async () => {
    const document = integrationDocument('Unsaved');
    const disabled: StorefrontShellDocument = {
      ...document,
      header: {
        items: document.header.items.map((item) => ({ ...item, enabled: false })),
      },
    };

    const result = await service.validateDraft(disabled);
    const after = await prisma.storefrontShell.findUniqueOrThrow({
      where: { id: STOREFRONT_SHELL_ID },
    });

    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'SHELL_NO_ENABLED_HEADER_ITEM' }),
    );
    expect(after.draftDocument).toEqual(originalShell.draftDocument);
    expect(after.version).toBe(originalShell.version);
  });

  it('publishes the document and support mirror in one committed version', async () => {
    const document = integrationDocument(
      'Published Shell',
      'published@luwag.ph',
      'Daily, 8am–8pm',
    );
    const saved = await service.saveDraft(
      document,
      originalShell.version,
      actorId,
    );

    const published = await service.publish(saved.version, actorId);
    const row = await prisma.storefrontShell.findUniqueOrThrow({
      where: { id: STOREFRONT_SHELL_ID },
    });
    const settings = await prisma.siteSetting.findUniqueOrThrow({
      where: { id: SITE_SETTINGS_ID },
    });

    expect(row.publishedDocument).toEqual(document);
    expect(row.version).toBe(originalShell.version + 2);
    expect(row.publishedRevision).toBe(originalShell.publishedRevision + 1);
    expect(row.publishedByUserId).toBe(actorId);
    expect(row.publishedAt).toBeInstanceOf(Date);
    expect(settings).toMatchObject({
      supportEmail: 'published@luwag.ph',
      supportHours: 'Daily, 8am–8pm',
    });
    expect(published).toMatchObject({
      version: originalShell.version + 2,
      publishedRevision: originalShell.publishedRevision + 1,
      hasUnpublishedChanges: false,
    });
  });

  it('rolls back an invalid publication without changing any published fact', async () => {
    const document = integrationDocument('Invalid Publish');
    const invalid: StorefrontShellDocument = {
      ...document,
      header: {
        items: document.header.items.map((item) => ({ ...item, enabled: false })),
      },
    };
    const saved = await service.saveDraft(
      invalid,
      originalShell.version,
      actorId,
    );
    const before = await prisma.storefrontShell.findUniqueOrThrow({
      where: { id: STOREFRONT_SHELL_ID },
    });
    const settingsBefore = await prisma.siteSetting.findUniqueOrThrow({
      where: { id: SITE_SETTINGS_ID },
    });

    await expect(service.publish(saved.version, actorId)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );

    const after = await prisma.storefrontShell.findUniqueOrThrow({
      where: { id: STOREFRONT_SHELL_ID },
    });
    const settingsAfter = await prisma.siteSetting.findUniqueOrThrow({
      where: { id: SITE_SETTINGS_ID },
    });
    expect(after.publishedDocument).toEqual(before.publishedDocument);
    expect(after.publishedRevision).toBe(before.publishedRevision);
    expect(after.version).toBe(before.version);
    expect(after.publishedByUserId).toBe(before.publishedByUserId);
    expect(settingsAfter.supportEmail).toBe(settingsBefore.supportEmail);
    expect(settingsAfter.supportHours).toBe(settingsBefore.supportHours);
  });

  it('omits a target disabled after publication while keeping its neighbour', async () => {
    const collection = await prisma.collection.create({
      data: {
        name: 'Shell integration target',
        slug: `${COLLECTION_PREFIX}${randomUUID()}`,
        type: 'MARKETING',
      },
    });
    const document = integrationDocument('Target Disablement');
    document.header.items.push({
      id: 'integration-collection',
      kind: 'STRUCTURED_LINK',
      label: 'Campaign',
      enabled: true,
      link: { type: 'COLLECTION', id: collection.id },
    });
    const saved = await service.saveDraft(
      document,
      originalShell.version,
      actorId,
    );
    await service.publish(saved.version, actorId);

    await prisma.collection.update({
      where: { id: collection.id },
      data: { status: 'DISABLED' },
    });
    const shell = await service.getPublic();

    expect(shell.header.items).toEqual([
      expect.objectContaining({ label: 'Home', href: '/' }),
    ]);
  });

  it('keeps the migration seed equivalent to the current LUWAG factory', async () => {
    const [rootCategories, navigationCollections, settings, row] = await Promise.all([
      prisma.category.findMany({
        where: { status: 'ACTIVE', parentId: null },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, sortOrder: true },
      }),
      prisma.collection.findMany({
        where: { status: 'ACTIVE', type: 'NAVIGATION' },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, slug: true, sortOrder: true },
      }),
      prisma.siteSetting.findUniqueOrThrow({
        where: { id: SITE_SETTINGS_ID },
        select: { supportEmail: true, supportHours: true },
      }),
      prisma.storefrontShell.findUniqueOrThrow({
        where: { id: STOREFRONT_SHELL_ID },
      }),
    ]);
    const expected = createCurrentLuwagShellDocument({
      rootCategories,
      navigationCollections,
      supportEmail: settings.supportEmail,
      supportHours: settings.supportHours,
    });

    expect(storefrontShellDocumentSchema.parse(row.draftDocument)).toEqual(expected);
    expect(storefrontShellDocumentSchema.parse(row.publishedDocument)).toEqual(expected);
  });

  it('persists the permission row and grants it only to SUPER_ADMIN', async () => {
    const permission = await prisma.permission.findUniqueOrThrow({
      where: { code: PermissionCode.STOREFRONT_SHELL_MANAGE },
      select: {
        id: true,
        roles: { select: { role: { select: { code: true } } } },
      },
    });

    expect(permission.roles.map((grant) => grant.role.code)).toEqual([
      RoleCode.SUPER_ADMIN,
    ]);
  });
});

function integrationDocument(
  brandName: string,
  supportEmail = 'support@luwag.ph',
  supportHours = 'Mon–Sat, 9am–6pm (PHT)',
): StorefrontShellDocument {
  const base = createCurrentLuwagShellDocument({
    rootCategories: [],
    navigationCollections: [],
    supportEmail,
    supportHours,
  });
  return normalizeStorefrontShellDocument({
    ...base,
    brand: { ...base.brand, brandName },
    header: {
      items: [
        {
          id: 'integration-home',
          kind: 'STRUCTURED_LINK',
          label: 'Home',
          enabled: true,
          link: { type: 'INTERNAL', path: '/' },
        },
      ],
    },
  });
}
