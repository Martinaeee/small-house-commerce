import { BadRequestException, ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { revalidateCache } from '../../common/revalidation.js';
import { Prisma } from '../../generated/prisma/client.js';
import { createCurrentLuwagShellDocument } from './storefront-shell-document.js';
import { STOREFRONT_SHELL_ID, StorefrontShellService } from './storefront-shell.service.js';

vi.mock('../../common/revalidation.js', () => ({
  CACHE_TAGS: { STOREFRONT: 'storefront' },
  revalidateCache: vi.fn(async () => undefined),
}));

const ROOT_CATEGORY = '00000000-0000-7000-8000-000000000601';
const COLLECTION = '00000000-0000-7000-8000-000000000602';
const UPDATED_AT = new Date('2026-10-13T01:00:00Z');
const PUBLISHED_AT = new Date('2026-10-13T02:00:00Z');

function seedDocument() {
  return createCurrentLuwagShellDocument({
    rootCategories: [{ id: ROOT_CATEGORY, name: 'Living', sortOrder: 10 }],
    navigationCollections: [
      { id: COLLECTION, name: 'New Arrivals', slug: 'new-arrivals', sortOrder: 0 },
    ],
    supportEmail: 'support@luwag.ph',
    supportHours: 'Mon–Sat, 9am–6pm (PHT)',
  });
}

/**
 * The service owns the single write path for the storefront shell: CAS draft
 * saves, strict publish validation, one Serializable publish transaction and
 * the public projection with its fallbacks. The stub mirrors only the
 * delegates the service uses; `$transaction` runs the callback against the same
 * stub so the in-transaction reads and writes stay observable.
 */
function createPrismaMock(overrides: Record<string, unknown> = {}) {
  const shellRow: any = {
    id: STOREFRONT_SHELL_ID,
    schemaVersion: 1,
    draftDocument: seedDocument(),
    publishedDocument: seedDocument(),
    version: 1,
    publishedRevision: 1,
    draftUpdatedByUserId: null,
    publishedByUserId: null,
    createdAt: UPDATED_AT,
    updatedAt: UPDATED_AT,
    publishedAt: PUBLISHED_AT,
    ...overrides,
  };

  const prisma: any = {
    storefrontShell: {
      findUnique: vi.fn(async () => structuredClone(shellRow)),
      findUniqueOrThrow: vi.fn(async () => structuredClone(shellRow)),
      // Mirrors the real CAS: only a matching version is written, and the row
      // mutates so a post-write re-read observes the new state.
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (where.id !== shellRow.id || where.version !== shellRow.version) return { count: 0 };
        shellRow.version += data.version?.increment ?? 0;
        shellRow.publishedRevision += data.publishedRevision?.increment ?? 0;
        if (data.draftDocument !== undefined) shellRow.draftDocument = data.draftDocument;
        if (data.publishedDocument !== undefined) shellRow.publishedDocument = data.publishedDocument;
        if (data.draftUpdatedByUserId !== undefined) shellRow.draftUpdatedByUserId = data.draftUpdatedByUserId;
        if (data.publishedByUserId !== undefined) shellRow.publishedByUserId = data.publishedByUserId;
        if (data.publishedAt !== undefined) shellRow.publishedAt = data.publishedAt;
        return { count: 1 };
      }),
    },
    storefrontShellAsset: {
      findMany: vi.fn(async () => [] as unknown[]),
    },
    siteSetting: {
      findFirst: vi.fn(async () => ({
        supportEmail: 'support@luwag.ph',
        supportHours: 'Mon–Sat, 9am–6pm (PHT)',
      })),
      upsert: vi.fn(async () => ({})),
    },
    category: {
      findMany: vi.fn(async () => [
        { id: ROOT_CATEGORY, slug: 'living', status: 'ACTIVE', parentId: null },
      ]),
    },
    collection: {
      findMany: vi.fn(async () => [
        { id: COLLECTION, slug: 'new-arrivals', status: 'ACTIVE' },
      ]),
    },
    product: { findMany: vi.fn(async () => []) },
    productLandingPage: { findMany: vi.fn(async () => []) },
  };
  prisma.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return prisma;
}

function createService(prisma: any) {
  return new StorefrontShellService(prisma);
}

describe('StorefrontShellService.getAdminDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the saved draft, version metadata and strict publication issues', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);

    const snapshot = await service.getAdminDraft();

    expect(snapshot).toMatchObject({
      document: expect.objectContaining({ brand: expect.objectContaining({ brandName: 'LUWAG' }) }),
      version: 1,
      publishedRevision: 1,
      hasUnpublishedChanges: false,
      updatedAt: UPDATED_AT.toISOString(),
      publishedAt: PUBLISHED_AT.toISOString(),
      issues: [],
      assets: {},
    });
  });
});

describe('StorefrontShellService.saveDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes the normalized draft with a version CAS and returns the new version', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);
    const draft = {
      ...seedDocument(),
      brand: { ...seedDocument().brand, brandName: '  LUWAG Studio  ' },
    };

    const snapshot = await service.saveDraft(draft, 1, 'user-1');

    expect(prisma.storefrontShell.updateMany).toHaveBeenCalledTimes(1);
    const call = prisma.storefrontShell.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: STOREFRONT_SHELL_ID, version: 1 });
    expect(call.data.version).toEqual({ increment: 1 });
    expect(call.data.draftUpdatedByUserId).toBe('user-1');
    expect((call.data.draftDocument as { brand: { brandName: string } }).brand.brandName).toBe('LUWAG Studio');
    expect(snapshot.version).toBe(2);
    expect(snapshot.hasUnpublishedChanges).toBe(true);
  });

  it('never touches the published document, revision, settings or cache on save', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);

    await service.saveDraft(seedDocument(), 1, 'user-1');

    const data = prisma.storefrontShell.updateMany.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('publishedDocument');
    expect(data).not.toHaveProperty('publishedRevision');
    expect(prisma.siteSetting.upsert).not.toHaveBeenCalled();
    expect(revalidateCache).not.toHaveBeenCalled();
  });

  it('rejects a stale version with the conflict code and the current version', async () => {
    const prisma = createPrismaMock({ version: 4 });
    const service = createService(prisma);

    const error = await service.saveDraft(seedDocument(), 1, 'user-1').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: 'SHELL_VERSION_MISMATCH',
      currentVersion: 4,
    });
  });

  it('rejects a malformed document without writing', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);

    const error = await service
      .saveDraft({ ...seedDocument(), theme: { primary: 'red;--x:1' } }, 1, 'user-1')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({ code: 'SHELL_DRAFT_INVALID' });
    expect(prisma.storefrontShell.updateMany).not.toHaveBeenCalled();
  });
});

describe('StorefrontShellService.validateDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports issues and derived theme for unsaved input without persisting', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);
    const doc = seedDocument();

    const result = await service.validateDraft(doc);

    expect(result.version).toBe(1);
    expect(result.issues).toEqual([]);
    expect(result.derivedTheme.primaryDark).toBe('#b8946a');
    expect(prisma.storefrontShell.updateMany).not.toHaveBeenCalled();
    expect(prisma.siteSetting.upsert).not.toHaveBeenCalled();
    expect(revalidateCache).not.toHaveBeenCalled();
  });

  it('reports publication-blocking issues for an incomplete draft', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);
    const doc = seedDocument();

    const result = await service.validateDraft({
      ...doc,
      header: { items: doc.header.items.map((item) => ({ ...item, enabled: false })) },
    });

    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'SHELL_NO_ENABLED_HEADER_ITEM' }),
    );
  });
});

describe('StorefrontShellService.publish', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(revalidateCache).mockResolvedValue(undefined);
  });

  it('copies the validated draft, bumps version and revision, and mirrors support contact', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);

    const snapshot = await service.publish(1, 'user-1');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: 'Serializable' },
    );
    const call = prisma.storefrontShell.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: STOREFRONT_SHELL_ID, version: 1 });
    expect(call.data.version).toEqual({ increment: 1 });
    expect(call.data.publishedRevision).toEqual({ increment: 1 });
    expect(call.data.publishedByUserId).toBe('user-1');
    expect(call.data.publishedAt).toBeInstanceOf(Date);
    expect(prisma.siteSetting.upsert).toHaveBeenCalledTimes(1);
    const settings = prisma.siteSetting.upsert.mock.calls[0][0];
    expect(settings.update).toMatchObject({
      supportEmail: 'support@luwag.ph',
      supportHours: 'Mon–Sat, 9am–6pm (PHT)',
    });
    expect(revalidateCache).toHaveBeenCalledWith(['storefront']);
    expect(snapshot.publishedRevision).toBe(2);
  });

  it('publishes without a CONTACT column and preserves existing site settings', async () => {
    const doc = seedDocument();
    const withoutContact = {
      ...doc,
      footer: {
        ...doc.footer,
        columns: doc.footer.columns.filter((column) => column.kind !== 'CONTACT'),
      },
    };
    const prisma = createPrismaMock({ draftDocument: withoutContact });
    const service = createService(prisma);

    await expect(service.publish(1, 'user-1')).resolves.toMatchObject({
      publishedRevision: 2,
    });

    expect(prisma.siteSetting.upsert).not.toHaveBeenCalled();
    const published = prisma.storefrontShell.updateMany.mock.calls[0][0].data
      .publishedDocument;
    expect(published.footer.columns).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ kind: 'CONTACT' })]),
    );
  });

  it('refuses to publish an invalid draft and leaves every published field untouched', async () => {
    const doc = seedDocument();
    const invalid = {
      ...doc,
      theme: { ...doc.theme, text: '#cccccc' },
    };
    const prisma = createPrismaMock({ draftDocument: invalid });
    const service = createService(prisma);

    const error = await service.publish(1, 'user-1').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect((error as UnprocessableEntityException).getResponse()).toMatchObject({
      code: 'SHELL_PUBLISH_VALIDATION_FAILED',
    });
    expect(prisma.storefrontShell.updateMany).not.toHaveBeenCalled();
    expect(prisma.siteSetting.upsert).not.toHaveBeenCalled();
    expect(revalidateCache).not.toHaveBeenCalled();
  });

  it('rejects a stale expected version inside the transaction', async () => {
    const prisma = createPrismaMock({ version: 5 });
    const service = createService(prisma);

    const error = await service.publish(1, 'user-1').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: 'SHELL_VERSION_MISMATCH',
      currentVersion: 5,
    });
    expect(prisma.storefrontShell.updateMany).not.toHaveBeenCalled();
  });

  it('maps a Serializable transaction conflict to the current CAS version', async () => {
    const prisma = createPrismaMock({ version: 6 });
    prisma.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError(
        'Transaction failed due to a write conflict or a deadlock',
        { code: 'P2034', clientVersion: 'test' },
      ),
    );
    const service = createService(prisma);

    const error = await service.publish(6, 'user-1').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: 'SHELL_VERSION_MISMATCH',
      currentVersion: 6,
    });
    expect(revalidateCache).not.toHaveBeenCalled();
  });

  it('still reports success when cache revalidation fails', async () => {
    vi.mocked(revalidateCache).mockRejectedValue(new Error('network down'));
    const prisma = createPrismaMock();
    const service = createService(prisma);

    await expect(service.publish(1, 'user-1')).resolves.toMatchObject({ publishedRevision: 2 });
  });
});

describe('StorefrontShellService.getSavedPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('projects the saved draft without exposing or replacing the published document', async () => {
    const draft = seedDocument();
    const published = seedDocument();
    const prisma = createPrismaMock({
      draftDocument: { ...draft, brand: { ...draft.brand, brandName: 'Preview Brand' } },
      publishedDocument: { ...published, brand: { ...published.brand, brandName: 'Published Brand' } },
      version: 3,
      publishedRevision: 2,
    });
    const service = createService(prisma);

    const preview = await service.getSavedPreview();

    expect(preview).toMatchObject({
      version: 3,
      issues: [],
      shell: {
        publishedRevision: 2,
        brand: { brandName: 'Preview Brand' },
        derivedTheme: { primaryDark: '#b8946a' },
      },
    });
    expect(prisma.storefrontShell.updateMany).not.toHaveBeenCalled();
  });
});

describe('StorefrontShellService.getPublic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('projects the published document with current slugs', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);

    const shell = await service.getPublic();

    expect(shell.header.items).toEqual([
      expect.objectContaining({ kind: 'LINK', label: 'New Arrivals', href: '/collections/new-arrivals' }),
      expect.objectContaining({ kind: 'CATEGORY_ROOT', categoryId: ROOT_CATEGORY }),
    ]);
    expect(shell.publishedRevision).toBe(1);
    expect(shell.derivedTheme.primaryDark).toBe('#b8946a');
    expect(shell.footer.columns[1]).toMatchObject({ kind: 'CONTACT', trackOrderHref: '/track-order' });
    expect(shell.theme.primary).toBe('#c9a77b');
  });

  it('omits a target disabled after publication and keeps its neighbours', async () => {
    const prisma = createPrismaMock();
    prisma.collection.findMany.mockResolvedValue([{ id: COLLECTION, slug: 'new-arrivals', status: 'DISABLED' }]);
    const service = createService(prisma);

    const shell = await service.getPublic();

    expect(shell.header.items.map((item) => item.kind)).toEqual(['CATEGORY_ROOT']);
  });

  it('falls back to the legacy shell when the published document is malformed', async () => {
    const prisma = createPrismaMock({ publishedDocument: { not: 'a document' } });
    const service = createService(prisma);

    const shell = await service.getPublic();

    // Legacy projection is rebuilt from live entities, not from the bad row.
    expect(shell.header.items).toHaveLength(2);
    expect(shell.theme.primary).toBe('#c9a77b');
  });

  it('returns the built-in LUWAG default when reading fails and never throws', async () => {
    const prisma = createPrismaMock();
    prisma.storefrontShell.findUnique.mockRejectedValue(new Error('database is down'));
    prisma.category.findMany.mockRejectedValue(new Error('database is down'));
    const service = createService(prisma);

    const shell = await service.getPublic();

    expect(shell.brand.brandName).toBe('LUWAG');
    expect(shell.theme).toMatchObject({ primary: '#c9a77b', action: '#244c3c' });
    expect(shell.footer.columns[1]).toMatchObject({
      kind: 'CONTACT',
      supportEmail: 'hello@luwag.shop',
    });
  });

  it('never exposes draft content, audit fields or storage metadata', async () => {
    const prisma = createPrismaMock({
      draftDocument: { ...seedDocument(), brand: { brandName: 'DRAFT ONLY', horizontalLogo: null, squareMark: null } },
    });
    const service = createService(prisma);

    const shell = await service.getPublic();

    expect(JSON.stringify(shell)).not.toContain('DRAFT ONLY');
    expect(JSON.stringify(shell)).not.toContain('draftUpdatedByUserId');
  });
});
