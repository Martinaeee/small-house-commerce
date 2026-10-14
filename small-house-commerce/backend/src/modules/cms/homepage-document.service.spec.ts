import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CACHE_TAGS, revalidateCache } from '../../common/revalidation.js';
import { emptyDocument, type HomepageDocument } from './homepage-document.js';
import { HomepageDocumentService } from './homepage-document.service.js';

vi.mock('../../common/revalidation.js', () => ({
  CACHE_TAGS: { STOREFRONT: 'storefront' },
  revalidateCache: vi.fn(async () => undefined),
}));

/**
 * HomepageDocumentService is the single write path for the versioned homepage
 * document: draft rev lock, publish snapshots, effective-version resolution
 * and the version history. The hand-written Prisma stub below mirrors the
 * delegates the service uses; `$transaction` runs its callback against the
 * same stub so the max(versionNo)+1 allocation and the pointer update stay
 * observable from the outside.
 */

const DRAFT_UPDATED_AT = new Date('2026-09-28T00:00:00Z');

function createPrismaMock() {
  const docRow = {
    id: HomepageDocumentService.SINGLETON_ID,
    draft: emptyDocument(),
    draftRev: 3,
    draftUpdatedById: null,
    publishedVersionId: null,
    createdAt: DRAFT_UPDATED_AT,
    updatedAt: DRAFT_UPDATED_AT,
  };
  const prisma: any = {
    homepageDocument: {
      findUniqueOrThrow: vi.fn(async () => structuredClone(docRow)),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    homepageVersion: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => [] as unknown[]),
      create: vi.fn(async ({ data }: any) => ({ id: 'version-new', ...data })),
      findUnique: vi.fn(async () => null),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  };
  // Self-reference is safe: the callback runs after the object exists.
  prisma.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return prisma;
}

/** The legacy HERO shape the migration copied verbatim (no `slides` key). */
function legacyDraft(): Record<string, unknown> {
  const doc = emptyDocument() as unknown as {
    sections: Array<Record<string, unknown>>;
  };
  return {
    ...(doc as unknown as Record<string, unknown>),
    sections: doc.sections.map((section) =>
      section.type === 'HERO'
        ? {
            ...section,
            title: 'Legacy headline',
            payload: {
              desktopImage: '/uploads/catalog/2026/hero.jpg',
              ctaPrimaryText: 'Shop now',
              ctaPrimaryLink: 'https://example.com/shop',
            },
          }
        : section,
    ),
  };
}

const validatorStub = {
  validate: vi.fn(async () => ({
    errors: [] as unknown[],
    warnings: [] as unknown[],
  })),
};

function makeService(prisma: unknown, validator: unknown = validatorStub) {
  return new HomepageDocumentService(prisma as never, validator as never);
}

const hoursFromNow = (hours: number) =>
  new Date(Date.now() + hours * 3_600_000);

beforeEach(() => {
  vi.clearAllMocks();
  validatorStub.validate.mockResolvedValue({ errors: [], warnings: [] });
});

describe('HomepageDocumentService draft rev lock', () => {
  it('rejects a save whose expectedRev is stale with DRAFT_REV_MISMATCH', async () => {
    const prisma = createPrismaMock();
    const service = makeService(prisma);

    await expect(
      service.saveDraft(emptyDocument(), 2, null), // stored rev is 3
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'DRAFT_REV_MISMATCH' },
    });
    expect(prisma.homepageDocument.updateMany).not.toHaveBeenCalled();
  });

  it('bumps the rev exactly once on a matching save and never revalidates the storefront', async () => {
    const prisma = createPrismaMock();
    const service = makeService(prisma);

    const result = await service.saveDraft(emptyDocument(), 3, 'user-1');

    expect(prisma.homepageDocument.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: HomepageDocumentService.SINGLETON_ID, draftRev: 3 },
        data: expect.objectContaining({
          draftRev: 4,
          draftUpdatedById: 'user-1',
        }),
      }),
    );
    expect(result.draftRev).toBe(4);
    expect(result.draftUpdatedAt).toEqual(expect.any(String));
    // A draft is invisible to the storefront: no cache refresh on save.
    expect(revalidateCache).not.toHaveBeenCalled();
  });

  it('rejects a schema-invalid draft with 400 and the zod issues', async () => {
    const prisma = createPrismaMock();
    const service = makeService(prisma);

    const error = await service
      .saveDraft({ ...emptyDocument(), sections: 'nope' }, 3, null)
      .then(
        () => null,
        (rejection: any) => rejection,
      );

    expect(error?.status).toBe(400);
    expect(error.getResponse().code).toBe('DRAFT_INVALID');
    expect(error.getResponse().issues.length).toBeGreaterThan(0);
    expect(prisma.homepageDocument.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a save that loses the rev race after the pre-check', async () => {
    const prisma = createPrismaMock();
    // The row still reports rev 3 on the read, but the guarded update finds
    // nothing to write (a concurrent save landed in between).
    prisma.homepageDocument.updateMany.mockResolvedValue({ count: 0 });
    const service = makeService(prisma);

    await expect(
      service.saveDraft(emptyDocument(), 3, null),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'DRAFT_REV_MISMATCH' },
    });
    expect(prisma.homepageDocument.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: HomepageDocumentService.SINGLETON_ID, draftRev: 3 },
      }),
    );
  });
});

describe('HomepageDocumentService getDraft', () => {
  it('returns the normalized draft and reports the effective version as published', async () => {
    const prisma = createPrismaMock();
    // Backfill state: the pointer is NULL while version 1 is already live.
    prisma.homepageVersion.findFirst.mockResolvedValue({
      id: 'v1',
      versionNo: 1,
      publishAt: new Date('2026-09-28T00:00:00Z'),
      unpublishAt: null,
    });
    const service = makeService(prisma);

    const snapshot = await service.getDraft();

    expect(snapshot.draftRev).toBe(3);
    expect(snapshot.draftUpdatedAt).toBe('2026-09-28T00:00:00.000Z');
    expect(snapshot.draftUpdatedById).toBeNull();
    expect(snapshot.draft.schemaVersion).toBe(1);
    expect(snapshot.published).toEqual({
      versionNo: 1,
      publishAt: '2026-09-28T00:00:00.000Z',
    });
  });

  it('reports published: null when no version is effective', async () => {
    const prisma = createPrismaMock();
    prisma.homepageVersion.findFirst.mockResolvedValue(null);
    const service = makeService(prisma);

    await expect(service.getDraft()).resolves.toMatchObject({
      published: null,
    });
  });

  it('normalizes a legacy hero payload so the editor always receives v2', async () => {
    const prisma = createPrismaMock();
    const row = await prisma.homepageDocument.findUniqueOrThrow();
    row.draft = legacyDraft();
    prisma.homepageDocument.findUniqueOrThrow.mockResolvedValue(row);
    const service = makeService(prisma);

    const snapshot = await service.getDraft();
    const hero = snapshot.draft.sections.find(
      (section) => section.type === 'HERO',
    );
    const slides = (
      hero?.payload as { slides?: unknown[] } | undefined
    )?.slides;

    expect(slides).toHaveLength(1);
  });
});

describe('HomepageDocumentService effective version', () => {
  const v = (versionNo: number, publishAt: string, unpublishAt: string | null) => ({
    id: `v${versionNo}`,
    versionNo,
    document: emptyDocument(),
    publishAt: new Date(publishAt),
    unpublishAt: unpublishAt ? new Date(unpublishAt) : null,
  });

  it('picks the newest version whose window covers now (inclusive start, exclusive end)', async () => {
    const prisma = createPrismaMock();
    prisma.homepageVersion.findFirst.mockResolvedValue(
      v(2, '2026-10-09T12:00:00Z', '2026-10-11T16:00:00Z'),
    );
    const service = makeService(prisma);

    await service.getEffectiveVersion(new Date('2026-10-09T12:00:00Z')); // == publishAt → effective
    expect(prisma.homepageVersion.findFirst).toHaveBeenCalledWith({
      where: {
        publishAt: { lte: new Date('2026-10-09T12:00:00Z') },
        OR: [
          { unpublishAt: null },
          { unpublishAt: { gt: new Date('2026-10-09T12:00:00Z') } },
        ],
      },
      orderBy: [{ publishAt: 'desc' }, { versionNo: 'desc' }],
    });

    prisma.homepageVersion.findFirst.mockClear();
    await service.getEffectiveVersion(new Date('2026-10-11T16:00:00Z')); // == unpublishAt → expired
    expect(prisma.homepageVersion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { unpublishAt: null },
            { unpublishAt: { gt: new Date('2026-10-11T16:00:00Z') } },
          ],
        }),
      }),
    );
  });

  it('returns the normalized document of the effective version', async () => {
    const prisma = createPrismaMock();
    prisma.homepageVersion.findFirst.mockResolvedValue({
      id: 'v2',
      versionNo: 2,
      document: emptyDocument(),
      publishAt: new Date('2026-10-09T12:00:00Z'),
      unpublishAt: null,
    });
    const service = makeService(prisma);

    const effective = await service.getEffectiveVersion(new Date('2026-10-10T00:00:00Z'));

    expect(effective?.versionNo).toBe(2);
    expect(effective?.document.schemaVersion).toBe(1);
  });

  it('returns null when nothing is effective so callers can fall back to the legacy tables', async () => {
    const prisma = createPrismaMock();
    prisma.homepageVersion.findFirst.mockResolvedValue(null);
    const service = makeService(prisma);

    await expect(service.getEffectiveVersion(new Date())).resolves.toBeNull();
  });
});

describe('HomepageDocumentService publish', () => {
  it('blocks publish on validation errors with PUBLISH_VALIDATION_FAILED', async () => {
    const prisma = createPrismaMock();
    const validator = {
      validate: vi.fn(async () => ({
        errors: [
          { severity: 'ERROR', code: 'HERO_MEDIA_MISSING', message: 'x' },
        ],
        warnings: [],
      })),
    };
    const service = makeService(prisma, validator);

    await expect(
      service.publish({
        note: null,
        publishAt: null,
        unpublishAt: null,
        confirmWarnings: false,
        userId: null,
      }),
    ).rejects.toMatchObject({
      status: 422,
      response: { code: 'PUBLISH_VALIDATION_FAILED' },
    });
    expect(prisma.homepageVersion.create).not.toHaveBeenCalled();
    expect(revalidateCache).not.toHaveBeenCalled();
  });

  it('requires explicit warning confirmation before publishing', async () => {
    const prisma = createPrismaMock();
    const validator = {
      validate: vi.fn(async () => ({
        errors: [],
        warnings: [{ severity: 'WARNING', code: 'ALT_MISSING', message: 'x' }],
      })),
    };
    const service = makeService(prisma, validator);

    await expect(
      service.publish({
        note: null,
        publishAt: null,
        unpublishAt: null,
        confirmWarnings: false,
        userId: null,
      }),
    ).rejects.toMatchObject({
      status: 422,
      response: { code: 'PUBLISH_WARNINGS_UNCONFIRMED' },
    });
    expect(revalidateCache).not.toHaveBeenCalled();

    const ok = await service.publish({
      note: 'n',
      publishAt: null,
      unpublishAt: null,
      confirmWarnings: true,
      userId: 'u',
    });
    expect(ok.versionNo).toBeGreaterThanOrEqual(1);
    expect(prisma.homepageVersion.create).toHaveBeenCalledTimes(1);
    expect(revalidateCache).toHaveBeenCalledWith([CACHE_TAGS.STOREFRONT]);
  });

  it('defaults publishAt to now, updates the published pointer and revalidates after commit', async () => {
    const prisma = createPrismaMock();
    const service = makeService(prisma);

    const before = Date.now();
    const result = await service.publish({
      note: null,
      publishAt: null,
      unpublishAt: null,
      confirmWarnings: true,
      userId: 'user-1',
    });
    const after = Date.now();

    const created = prisma.homepageVersion.create.mock.calls[0][0].data;
    expect(created.publishAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(created.publishAt.getTime()).toBeLessThanOrEqual(after);
    expect(created.unpublishAt).toBeNull();
    expect(created.createdById).toBe('user-1');
    expect(created.note).toBeNull();
    expect(result).toEqual({
      versionNo: 1,
      publishAt: created.publishAt.toISOString(),
    });
    expect(prisma.homepageDocument.updateMany).toHaveBeenCalledWith({
      where: { id: HomepageDocumentService.SINGLETON_ID },
      data: { publishedVersionId: 'version-new' },
    });
    expect(revalidateCache).toHaveBeenCalledWith([CACHE_TAGS.STOREFRONT]);
  });

  it('allocates versionNo = max + 1 inside the transaction', async () => {
    const prisma = createPrismaMock();
    prisma.homepageVersion.findFirst.mockResolvedValue({ versionNo: 4 });
    const service = makeService(prisma);

    const result = await service.publish({
      note: 'v5',
      publishAt: null,
      unpublishAt: null,
      confirmWarnings: true,
      userId: null,
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.homepageVersion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { versionNo: 'desc' } }),
    );
    expect(prisma.homepageVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ versionNo: 5 }),
      }),
    );
    expect(result.versionNo).toBe(5);
  });

  it('schedules a future version without publishing it immediately', async () => {
    const prisma = createPrismaMock();
    prisma.homepageVersion.findFirst.mockResolvedValue(null); // max versionNo
    const service = makeService(prisma);

    const future = '2026-10-09T20:00:00+08:00';
    await service.publish({
      note: '10.10',
      publishAt: future,
      unpublishAt: '2026-10-11T00:00:00+08:00',
      confirmWarnings: true,
      userId: null,
    });

    expect(prisma.homepageVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          publishAt: new Date(future),
          unpublishAt: new Date('2026-10-11T00:00:00+08:00'),
        }),
      }),
    );
  });

  it('validates and snapshots the normalized draft, not the legacy payload', async () => {
    const prisma = createPrismaMock();
    const row = await prisma.homepageDocument.findUniqueOrThrow();
    row.draft = legacyDraft();
    prisma.homepageDocument.findUniqueOrThrow.mockResolvedValue(row);
    const validator = {
      validate: vi.fn(async (_document: HomepageDocument) => ({
        errors: [] as unknown[],
        warnings: [] as unknown[],
      })),
    };
    const service = makeService(prisma, validator);

    await service.publish({
      note: null,
      publishAt: null,
      unpublishAt: null,
      confirmWarnings: true,
      userId: null,
    });

    const validated = validator.validate.mock.calls[0][0];
    const validatedHero = validated.sections.find((s) => s.type === 'HERO');
    const validatedSlides = (
      validatedHero?.payload as { slides?: unknown[] } | undefined
    )?.slides;
    expect(validatedSlides).toHaveLength(1);

    const created = prisma.homepageVersion.create.mock.calls[0][0].data;
    const snapshotHero = created.document.sections.find(
      (s: { type: string }) => s.type === 'HERO',
    );
    expect(snapshotHero.payload.slides).toHaveLength(1);
  });
});

describe('HomepageDocumentService listVersions', () => {
  it('derives SCHEDULED / LIVE / SUPERSEDED / ENDED from the publish windows', async () => {
    const prisma = createPrismaMock();
    const past = hoursFromNow(-48);
    const recent = hoursFromNow(-24);
    const ended = hoursFromNow(-1);
    const future = hoursFromNow(24);
    const row = (over: Record<string, unknown>) => ({
      id: `v${over.versionNo}`,
      note: null,
      createdById: null,
      createdAt: past,
      unpublishAt: null,
      ...over,
    });
    prisma.homepageVersion.findMany.mockResolvedValue([
      row({ versionNo: 4, publishAt: future }),
      row({ versionNo: 3, publishAt: recent }),
      row({ versionNo: 2, publishAt: past }),
      row({ versionNo: 1, publishAt: past, unpublishAt: ended }),
    ]);
    const service = makeService(prisma);

    const versions = await service.listVersions();

    expect(versions.map((meta) => [meta.versionNo, meta.status])).toEqual([
      [4, 'SCHEDULED'],
      [3, 'LIVE'],
      [2, 'SUPERSEDED'],
      [1, 'ENDED'],
    ]);
    expect(prisma.homepageVersion.findMany).toHaveBeenCalledWith({
      orderBy: [{ publishAt: 'desc' }, { versionNo: 'desc' }],
    });
    expect(versions[1]).toMatchObject({
      id: 'v3',
      note: null,
      createdById: null,
      createdAt: past.toISOString(),
      publishAt: recent.toISOString(),
      unpublishAt: null,
    });
  });

  it('marks a lower-numbered scheduled version live when its later publish time takes precedence', async () => {
    const prisma = createPrismaMock();
    const earlier = hoursFromNow(-2);
    const later = hoursFromNow(-1);
    const createdAt = hoursFromNow(-3);
    const row = (versionNo: number, publishAt: Date) => ({
      id: `v${versionNo}`,
      versionNo,
      note: null,
      createdById: null,
      createdAt,
      publishAt,
      unpublishAt: null,
    });
    prisma.homepageVersion.findMany.mockResolvedValue([
      row(2, later),
      row(3, earlier),
    ]);
    const service = makeService(prisma);

    const versions = await service.listVersions();

    expect(versions.map((meta) => [meta.versionNo, meta.status])).toEqual([
      [2, 'LIVE'],
      [3, 'SUPERSEDED'],
    ]);
  });

  it('marks a cancelled future version ended instead of scheduled', async () => {
    const prisma = createPrismaMock();
    prisma.homepageVersion.findMany.mockResolvedValue([
      {
        id: 'v4',
        versionNo: 4,
        note: null,
        createdById: null,
        createdAt: hoursFromNow(-1),
        publishAt: hoursFromNow(24),
        unpublishAt: hoursFromNow(-1),
      },
    ]);
    const service = makeService(prisma);

    const versions = await service.listVersions();

    expect(versions[0]?.status).toBe('ENDED');
  });
});

describe('HomepageDocumentService getVersion', () => {
  it('404s for an unknown version id', async () => {
    const prisma = createPrismaMock();
    const service = makeService(prisma);

    await expect(service.getVersion('missing')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('returns the version meta with its normalized document', async () => {
    const prisma = createPrismaMock();
    const publishAt = hoursFromNow(-1);
    const liveRow = {
      id: 'v2',
      versionNo: 2,
      note: 'n',
      createdById: 'user-1',
      createdAt: hoursFromNow(-2),
      publishAt,
      unpublishAt: null,
      document: emptyDocument(),
    };
    prisma.homepageVersion.findUnique.mockResolvedValue(liveRow);
    prisma.homepageVersion.findMany.mockResolvedValue([liveRow]);
    const service = makeService(prisma);

    const version = await service.getVersion('v2');

    expect(version).toMatchObject({
      id: 'v2',
      versionNo: 2,
      note: 'n',
      createdById: 'user-1',
      status: 'LIVE',
      publishAt: publishAt.toISOString(),
      unpublishAt: null,
    });
    expect(version.document.schemaVersion).toBe(1);
  });
});

describe('HomepageDocumentService restoreVersion', () => {
  it('restores a version into the draft without publishing it', async () => {
    const prisma = createPrismaMock();
    prisma.homepageVersion.findUnique.mockResolvedValue({
      id: 'v9',
      versionNo: 9,
      document: emptyDocument(),
    });
    const service = makeService(prisma);

    const result = await service.restoreVersion('v9', 'u');

    expect(prisma.homepageDocument.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: HomepageDocumentService.SINGLETON_ID, draftRev: 3 },
        data: expect.objectContaining({
          draft: expect.anything(),
          draftRev: 4,
          draftUpdatedById: 'u',
        }),
      }),
    );
    expect(prisma.homepageVersion.create).not.toHaveBeenCalled();
    expect(result).toEqual({ draftRev: 4 });
    expect(revalidateCache).toHaveBeenCalledWith([CACHE_TAGS.STOREFRONT]);
  });

  it('404s for an unknown version id', async () => {
    const prisma = createPrismaMock();
    const service = makeService(prisma);

    await expect(
      service.restoreVersion('missing', null),
    ).rejects.toMatchObject({ status: 404 });
    expect(prisma.homepageDocument.updateMany).not.toHaveBeenCalled();
  });
});

describe('HomepageDocumentService unpublishVersion', () => {
  it('stamps unpublishAt and refreshes the storefront cache', async () => {
    const prisma = createPrismaMock();
    prisma.homepageVersion.findUnique.mockResolvedValue({
      id: 'v2',
      versionNo: 2,
      publishAt: hoursFromNow(-1),
      unpublishAt: null,
    });
    const service = makeService(prisma);

    const before = Date.now();
    await service.unpublishVersion('v2');
    const after = Date.now();

    const call = prisma.homepageVersion.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'v2', unpublishAt: null });
    expect(call.data.unpublishAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(call.data.unpublishAt.getTime()).toBeLessThanOrEqual(after);
    expect(revalidateCache).toHaveBeenCalledWith([CACHE_TAGS.STOREFRONT]);
  });

  it('brings a planned future unpublish time forward to now', async () => {
    const prisma = createPrismaMock();
    const planned = hoursFromNow(24);
    prisma.homepageVersion.findUnique.mockResolvedValue({
      id: 'v2',
      versionNo: 2,
      publishAt: hoursFromNow(-1),
      unpublishAt: planned,
    });
    const service = makeService(prisma);

    const before = Date.now();
    await service.unpublishVersion('v2');
    const after = Date.now();

    const call = prisma.homepageVersion.updateMany.mock.calls[0][0];
    expect(call.data.unpublishAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(call.data.unpublishAt.getTime()).toBeLessThanOrEqual(after);
    expect(call.data.unpublishAt.getTime()).toBeLessThan(planned.getTime());
    expect(revalidateCache).toHaveBeenCalledWith([CACHE_TAGS.STOREFRONT]);
  });

  it('is idempotent when the version is already unpublished', async () => {
    const prisma = createPrismaMock();
    prisma.homepageVersion.findUnique.mockResolvedValue({
      id: 'v2',
      versionNo: 2,
      publishAt: hoursFromNow(-2),
      unpublishAt: hoursFromNow(-1),
    });
    const service = makeService(prisma);

    await expect(service.unpublishVersion('v2')).resolves.toBeUndefined();
    expect(prisma.homepageVersion.updateMany).not.toHaveBeenCalled();
    expect(revalidateCache).not.toHaveBeenCalled();
  });

  it('404s for an unknown version id', async () => {
    const prisma = createPrismaMock();
    const service = makeService(prisma);

    await expect(service.unpublishVersion('missing')).rejects.toMatchObject({
      status: 404,
    });
    expect(prisma.homepageVersion.updateMany).not.toHaveBeenCalled();
  });
});
