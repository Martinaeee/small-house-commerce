import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CACHE_TAGS, revalidateCache } from '../../common/revalidation.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  DOCUMENT_VALIDATOR,
  homepageDocumentSchema,
  normalizeLegacyDocument,
  type DocumentValidator,
  type HomepageDocument,
} from './homepage-document.js';

/**
 * The single write path for the homepage V2 document (spec §3.2/§5.1).
 *
 * `homepage_documents` holds exactly one row (`SINGLETON_ID`, enforced by a DB
 * CHECK): the working draft behind a rev lock. Publishing snapshots the draft
 * into `homepage_versions`, and the storefront resolves the live page from the
 * version whose publishAt/unpublishAt window covers "now" — never from the
 * `publishedVersionId` pointer, which is display metadata only (the migration
 * backfill left it NULL while version 1 was already effective).
 *
 * Cache discipline: every mutation except `saveDraft` refreshes the storefront
 * tag — a draft never reaches the storefront.
 */

export type VersionStatus = 'SCHEDULED' | 'LIVE' | 'ENDED' | 'SUPERSEDED';

export type DraftSnapshot = {
  draft: HomepageDocument;
  draftRev: number;
  draftUpdatedAt: string;
  draftUpdatedById: string | null;
  published: { versionNo: number; publishAt: string } | null;
};

export type VersionMeta = {
  id: string;
  versionNo: number;
  note: string | null;
  createdById: string | null;
  createdAt: string;
  publishAt: string;
  unpublishAt: string | null;
  status: VersionStatus;
};

export type PublishOptions = {
  note: string | null;
  publishAt: string | null;
  unpublishAt: string | null;
  confirmWarnings: boolean;
  userId: string | null;
};

/** The publish-window projection every status derivation works on. */
type VersionWindowRow = {
  versionNo: number;
  publishAt: Date;
  unpublishAt: Date | null;
};

type VersionMetaRow = VersionWindowRow & {
  id: string;
  note: string | null;
  createdById: string | null;
  createdAt: Date;
};

@Injectable()
export class HomepageDocumentService {
  /** Fixed id of the singleton `homepage_documents` row. */
  static readonly SINGLETON_ID = '00000000-0000-0000-0000-000000000001';

  private static readonly VERSION_ORDER: Prisma.HomepageVersionOrderByWithRelationInput[] =
    [{ publishAt: 'desc' }, { versionNo: 'desc' }];

  constructor(
    private readonly prisma: PrismaService,
    @Inject(DOCUMENT_VALIDATOR) private readonly validator: DocumentValidator,
  ) {}

  // --- draft ---------------------------------------------------------------

  /**
   * The editor's read: always a v2 document (legacy HERO payloads are
   * normalized on the way out) plus the effective version's meta, so the
   * status bar can show what is currently live.
   */
  async getDraft(): Promise<DraftSnapshot> {
    const row = await this.prisma.homepageDocument.findUniqueOrThrow({
      where: { id: HomepageDocumentService.SINGLETON_ID },
    });
    const effective = await this.findEffectiveVersionRow(new Date());
    return {
      draft: normalizeLegacyDocument(row.draft),
      draftRev: row.draftRev,
      draftUpdatedAt: row.updatedAt.toISOString(),
      draftUpdatedById: row.draftUpdatedById,
      published: effective
        ? {
            versionNo: effective.versionNo,
            publishAt: effective.publishAt.toISOString(),
          }
        : null,
    };
  }

  /** Read only the current draft and revision for a preview request. */
  async getDraftForPreview(): Promise<{
    draft: HomepageDocument;
    draftRev: number;
  }> {
    const row = await this.prisma.homepageDocument.findUniqueOrThrow({
      where: { id: HomepageDocumentService.SINGLETON_ID },
    });
    return {
      draft: normalizeLegacyDocument(row.draft),
      draftRev: row.draftRev,
    };
  }

  async saveDraft(
    doc: unknown,
    expectedRev: number,
    userId: string | null,
  ): Promise<{ draftRev: number; draftUpdatedAt: string }> {
    const parsed = homepageDocumentSchema.safeParse(doc);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'DRAFT_INVALID',
        message: 'The draft does not match the homepage document schema.',
        issues: parsed.error.issues,
      });
    }

    // Early, friendly conflict: the stored rev already moved on (another tab
    // saved). The guarded update below is the real protection — the early
    // check only avoids writing when the caller is already known to be stale.
    const current = await this.prisma.homepageDocument.findUniqueOrThrow({
      where: { id: HomepageDocumentService.SINGLETON_ID },
    });
    if (current.draftRev !== expectedRev) {
      throw new ConflictException({
        code: 'DRAFT_REV_MISMATCH',
        message: `Draft rev ${expectedRev} is stale (current rev ${current.draftRev}).`,
        currentRev: current.draftRev,
      });
    }

    const { count } = await this.prisma.homepageDocument.updateMany({
      where: {
        id: HomepageDocumentService.SINGLETON_ID,
        draftRev: expectedRev,
      },
      data: {
        draft: parsed.data as Prisma.InputJsonValue,
        draftRev: expectedRev + 1,
        draftUpdatedById: userId,
      },
    });
    if (count === 0) {
      throw new ConflictException({
        code: 'DRAFT_REV_MISMATCH',
        message: 'The draft was modified concurrently; reload and retry.',
      });
    }

    // Deliberately no revalidateCache: a draft is invisible to the storefront.
    return {
      draftRev: expectedRev + 1,
      draftUpdatedAt: new Date().toISOString(),
    };
  }

  // --- publish -------------------------------------------------------------

  async publish(
    opts: PublishOptions,
  ): Promise<{ versionNo: number; publishAt: string }> {
    const row = await this.prisma.homepageDocument.findUniqueOrThrow({
      where: { id: HomepageDocumentService.SINGLETON_ID },
    });
    const document = normalizeLegacyDocument(row.draft);

    const { errors, warnings } = await this.validator.validate(document);
    if (errors.length > 0) {
      throw new UnprocessableEntityException({
        code: 'PUBLISH_VALIDATION_FAILED',
        message: 'The homepage has blocking validation errors.',
        issues: errors,
      });
    }
    if (warnings.length > 0 && !opts.confirmWarnings) {
      throw new UnprocessableEntityException({
        code: 'PUBLISH_WARNINGS_UNCONFIRMED',
        message: 'The homepage has warnings that need explicit confirmation.',
        issues: warnings,
      });
    }

    const publishAt = opts.publishAt ? new Date(opts.publishAt) : new Date();
    const unpublishAt = opts.unpublishAt ? new Date(opts.unpublishAt) : null;

    const version = await this.prisma.$transaction(async (tx) => {
      // max(versionNo) + 1 inside the transaction: the unique constraint is
      // the last line of defence if two publishes ever interleave.
      const latest = await tx.homepageVersion.findFirst({
        orderBy: { versionNo: 'desc' },
        select: { versionNo: true },
      });
      const created = await tx.homepageVersion.create({
        data: {
          versionNo: (latest?.versionNo ?? 0) + 1,
          document: document as Prisma.InputJsonValue,
          note: opts.note,
          createdById: opts.userId,
          publishAt,
          unpublishAt,
        },
      });
      // Display-only pointer: the storefront resolves the effective version
      // from the publish window, this just records the last publish action.
      await tx.homepageDocument.updateMany({
        where: { id: HomepageDocumentService.SINGLETON_ID },
        data: { publishedVersionId: created.id },
      });
      return created;
    });

    await revalidateCache([CACHE_TAGS.STOREFRONT]);
    return {
      versionNo: version.versionNo,
      publishAt: version.publishAt.toISOString(),
    };
  }

  // --- versions ------------------------------------------------------------

  async listVersions(): Promise<VersionMeta[]> {
    const rows = await this.prisma.homepageVersion.findMany({
      orderBy: HomepageDocumentService.VERSION_ORDER,
    });
    const now = new Date();
    return rows.map((row) => this.toVersionMeta(row, rows, now));
  }

  async getVersion(
    id: string,
  ): Promise<VersionMeta & { document: HomepageDocument }> {
    const row = await this.prisma.homepageVersion.findUnique({ where: { id } });
    if (!row) throw this.versionNotFound(id);
    const siblings = await this.prisma.homepageVersion.findMany({
      orderBy: HomepageDocumentService.VERSION_ORDER,
    });
    return {
      ...this.toVersionMeta(row, siblings, new Date()),
      document: normalizeLegacyDocument(row.document),
    };
  }

  /** Copies a version's document into the draft (rev + 1); never publishes. */
  async restoreVersion(
    id: string,
    userId: string | null,
  ): Promise<{ draftRev: number }> {
    const version = await this.prisma.homepageVersion.findUnique({
      where: { id },
    });
    if (!version) throw this.versionNotFound(id);
    const document = normalizeLegacyDocument(version.document);

    // The rev read feeds the guarded update: a concurrent save loses the race
    // instead of being silently clobbered, and the returned rev stays exact.
    const current = await this.prisma.homepageDocument.findUniqueOrThrow({
      where: { id: HomepageDocumentService.SINGLETON_ID },
    });
    const { count } = await this.prisma.homepageDocument.updateMany({
      where: {
        id: HomepageDocumentService.SINGLETON_ID,
        draftRev: current.draftRev,
      },
      data: {
        draft: document as Prisma.InputJsonValue,
        draftRev: current.draftRev + 1,
        draftUpdatedById: userId,
      },
    });
    if (count === 0) {
      throw new ConflictException({
        code: 'DRAFT_REV_MISMATCH',
        message: 'The draft changed while restoring; reload and retry.',
      });
    }

    await revalidateCache([CACHE_TAGS.STOREFRONT]);
    return { draftRev: current.draftRev + 1 };
  }

  /** Takes a version offline; idempotent once its window has already closed. */
  async unpublishVersion(id: string): Promise<void> {
    const row = await this.prisma.homepageVersion.findUnique({ where: { id } });
    if (!row) throw this.versionNotFound(id);

    const now = new Date();
    if (row.unpublishAt !== null && row.unpublishAt.getTime() <= now.getTime()) {
      return;
    }

    const { count } = await this.prisma.homepageVersion.updateMany({
      // Atomic guard: a concurrent unpublish that already closed the window
      // must win; a planned future end remains eligible to be brought forward.
      where: {
        id,
        unpublishAt: row.unpublishAt === null ? null : { gt: now },
      },
      data: { unpublishAt: now },
    });
    if (count > 0) await revalidateCache([CACHE_TAGS.STOREFRONT]);
  }

  // --- effective version ---------------------------------------------------

  /**
   * The version the storefront should serve at `now`: window is
   * [publishAt, unpublishAt) — inclusive start, exclusive end — newest first
   * by (publishAt, versionNo). Null means "fall back to the legacy tables".
   */
  async getEffectiveVersion(
    now: Date,
  ): Promise<{ document: HomepageDocument; versionNo: number } | null> {
    const row = await this.findEffectiveVersionRow(now);
    if (!row) return null;
    return {
      document: normalizeLegacyDocument(row.document),
      versionNo: row.versionNo,
    };
  }

  // --- internals -----------------------------------------------------------

  private findEffectiveVersionRow(now: Date) {
    return this.prisma.homepageVersion.findFirst({
      where: {
        publishAt: { lte: now },
        OR: [{ unpublishAt: null }, { unpublishAt: { gt: now } }],
      },
      orderBy: HomepageDocumentService.VERSION_ORDER,
    });
  }

  private versionNotFound(id: string): NotFoundException {
    return new NotFoundException({
      code: 'VERSION_NOT_FOUND',
      message: `Homepage version ${id} does not exist.`,
    });
  }

  private toVersionMeta(
    row: VersionMetaRow,
    siblings: ReadonlyArray<VersionWindowRow>,
    now: Date,
  ): VersionMeta {
    return {
      id: row.id,
      versionNo: row.versionNo,
      note: row.note,
      createdById: row.createdById,
      createdAt: row.createdAt.toISOString(),
      publishAt: row.publishAt.toISOString(),
      unpublishAt: row.unpublishAt ? row.unpublishAt.toISOString() : null,
      status: this.deriveStatus(row, siblings, now),
    };
  }

  /**
   * Brief order matters: a window closed or cancelled at/before now is ENDED;
   * otherwise a future window is SCHEDULED. An open window is LIVE only when
   * it has the highest storefront precedence (publishAt, then versionNo, both
   * descending); every other open window is SUPERSEDED.
   */
  private deriveStatus(
    row: VersionWindowRow,
    siblings: ReadonlyArray<VersionWindowRow>,
    now: Date,
  ): VersionStatus {
    if (
      row.unpublishAt !== null &&
      row.unpublishAt.getTime() <= now.getTime()
    ) {
      return 'ENDED';
    }
    if (row.publishAt.getTime() > now.getTime()) return 'SCHEDULED';
    const rowPublishAt = row.publishAt.getTime();
    const superseded = siblings.some((other) => {
      const otherPublishAt = other.publishAt.getTime();
      const takesPrecedence =
        otherPublishAt > rowPublishAt ||
        (otherPublishAt === rowPublishAt && other.versionNo > row.versionNo);
      return (
        takesPrecedence &&
        otherPublishAt <= now.getTime() &&
        (other.unpublishAt === null ||
          other.unpublishAt.getTime() > now.getTime())
      );
    });
    return superseded ? 'SUPERSEDED' : 'LIVE';
  }
}
