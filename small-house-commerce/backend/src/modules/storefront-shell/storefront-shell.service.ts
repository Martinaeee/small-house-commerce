import { isDeepStrictEqual } from 'node:util';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CACHE_TAGS, revalidateCache } from '../../common/revalidation.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SITE_SETTINGS_ID } from '../settings/settings.service.js';
import {
  createCurrentLuwagShellDocument,
  normalizeStorefrontShellDocument,
  storefrontShellDocumentSchema,
  type DerivedStorefrontTheme,
  type ShellIssue,
  type StorefrontShellDocument,
} from './storefront-shell-document.js';
import { deriveStorefrontTheme } from './storefront-shell-theme.js';
import {
  StorefrontShellTargetResolver,
  type ResolvedTargets,
  type ShellTargetClient,
} from './storefront-shell-targets.js';
import {
  publicProjection,
  validateShellForPublish,
  type PublicAssetView,
  type ResolvedStorefrontShell,
  type ShellAssetLookup,
  type ShellHeaderResolution,
  type ShellValidationContext,
} from './storefront-shell-validation.js';

export const STOREFRONT_SHELL_ID = '00000000-0000-0000-0000-000000000002';

const FALLBACK_SUPPORT_EMAIL = 'hello@luwag.shop';
const FALLBACK_SUPPORT_HOURS = 'Mon–Sat, 9am–6pm (PHT)';

export type AdminShellAsset = {
  id: string;
  kind: 'HORIZONTAL' | 'SQUARE';
  url: string;
  mimeType: 'image/png' | 'image/webp';
  width: number;
  height: number;
  durable: boolean;
  createdAt: string;
};

export type AdminShellSnapshot = {
  document: StorefrontShellDocument;
  version: number;
  publishedRevision: number;
  hasUnpublishedChanges: boolean;
  updatedAt: string;
  publishedAt: string | null;
  issues: ShellIssue[];
  assets: Record<string, AdminShellAsset>;
};

export type AdminShellValidationResult = {
  version: number;
  issues: ShellIssue[];
  derivedTheme: DerivedStorefrontTheme;
};

export type PublishedStorefrontShell = ResolvedStorefrontShell & {
  publishedRevision: number;
  derivedTheme: DerivedStorefrontTheme;
};

export type AdminShellPreviewResult = {
  version: number;
  issues: ShellIssue[];
  shell: PublishedStorefrontShell;
};

type ShellRow = {
  draftDocument: Prisma.JsonValue;
  publishedDocument: Prisma.JsonValue | null;
  version: number;
  publishedRevision: number;
  updatedAt: Date;
  publishedAt: Date | null;
};

type ShellAssetClient = ShellTargetClient & Pick<PrismaService, 'storefrontShellAsset'>;

type AssetRow = {
  id: string;
  kind: 'HORIZONTAL' | 'SQUARE';
  publicUrl: string;
  mimeType: string;
  width: number;
  height: number;
  durable: boolean;
  createdAt: Date;
};

type LoadedAssets = {
  byId: Record<string, AdminShellAsset>;
  lookup: ShellAssetLookup;
  horizontalLogo: PublicAssetView | null;
  squareMark: PublicAssetView | null;
};

@Injectable()
export class StorefrontShellService {
  private readonly logger = new Logger(StorefrontShellService.name);
  private readonly targetResolver: StorefrontShellTargetResolver;

  constructor(private readonly prisma: PrismaService) {
    this.targetResolver = new StorefrontShellTargetResolver(prisma);
  }

  async getAdminDraft(): Promise<AdminShellSnapshot> {
    const row = await this.prisma.storefrontShell.findUniqueOrThrow({
      where: { id: STOREFRONT_SHELL_ID },
    });
    return this.adminSnapshot(row, this.prisma);
  }

  async saveDraft(
    input: unknown,
    expectedVersion: number,
    userId: string,
  ): Promise<AdminShellSnapshot> {
    const document = this.parseDraftInput(input);
    const result = await this.prisma.storefrontShell.updateMany({
      where: { id: STOREFRONT_SHELL_ID, version: expectedVersion },
      data: {
        draftDocument: document as Prisma.InputJsonValue,
        version: { increment: 1 },
        draftUpdatedByUserId: userId,
      },
    });

    if (result.count !== 1) {
      const current = await this.prisma.storefrontShell.findUnique({
        where: { id: STOREFRONT_SHELL_ID },
        select: { version: true },
      });
      throw shellVersionConflict(current?.version ?? null);
    }

    return this.getAdminDraft();
  }

  async validateDraft(input: unknown): Promise<AdminShellValidationResult> {
    const document = this.parseDraftInput(input);
    const row = await this.prisma.storefrontShell.findUniqueOrThrow({
      where: { id: STOREFRONT_SHELL_ID },
      select: { version: true },
    });
    const { validation } = await this.resolveDocument(document, this.prisma);

    return {
      version: row.version,
      issues: validateShellForPublish(document, validation),
      derivedTheme: deriveStorefrontTheme(document.theme),
    };
  }

  async publish(
    expectedVersion: number,
    userId: string,
  ): Promise<AdminShellSnapshot> {
    let snapshot: AdminShellSnapshot;
    try {
      snapshot = await this.prisma.$transaction(
        async (tx) => {
          const row = await tx.storefrontShell.findUniqueOrThrow({
            where: { id: STOREFRONT_SHELL_ID },
          });
          if (row.version !== expectedVersion) {
            throw shellVersionConflict(row.version);
          }

          const parsed = storefrontShellDocumentSchema.safeParse(
            row.draftDocument,
          );
          if (!parsed.success) {
            throw new UnprocessableEntityException({
              code: 'SHELL_PUBLISH_VALIDATION_FAILED',
              issues: schemaIssues(parsed.error.issues),
            });
          }
          const document = normalizeStorefrontShellDocument(parsed.data);
          const { validation } = await this.resolveDocument(document, tx);
          const issues = validateShellForPublish(document, validation);
          if (issues.length > 0) {
            throw new UnprocessableEntityException({
              code: 'SHELL_PUBLISH_VALIDATION_FAILED',
              issues,
            });
          }

          const contact = document.footer.columns.find(
            (column) => column.kind === 'CONTACT',
          );

          const publishedAt = new Date();
          const updated = await tx.storefrontShell.updateMany({
            where: { id: STOREFRONT_SHELL_ID, version: expectedVersion },
            data: {
              publishedDocument: document as Prisma.InputJsonValue,
              version: { increment: 1 },
              publishedRevision: { increment: 1 },
              publishedByUserId: userId,
              publishedAt,
            },
          });
          if (updated.count !== 1) {
            throw shellVersionConflict(null);
          }

          if (contact) {
            await tx.siteSetting.upsert({
              where: { id: SITE_SETTINGS_ID },
              create: {
                id: SITE_SETTINGS_ID,
                supportEmail: contact.supportEmail,
                supportHours: contact.supportHours,
              },
              update: {
                supportEmail: contact.supportEmail,
                supportHours: contact.supportHours,
              },
            });
          }

          const committed = await tx.storefrontShell.findUniqueOrThrow({
            where: { id: STOREFRONT_SHELL_ID },
          });
          return this.adminSnapshot(committed, tx);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      ) {
        const current = await this.prisma.storefrontShell.findUnique({
          where: { id: STOREFRONT_SHELL_ID },
          select: { version: true },
        });
        throw shellVersionConflict(current?.version ?? null);
      }
      throw error;
    }

    try {
      await revalidateCache([CACHE_TAGS.STOREFRONT]);
    } catch (error) {
      this.logger.warn(
        `Storefront shell published but cache revalidation failed: ${errorMessage(error)}`,
      );
    }

    return snapshot;
  }

  async getSavedPreview(): Promise<AdminShellPreviewResult> {
    const row = await this.prisma.storefrontShell.findUniqueOrThrow({
      where: { id: STOREFRONT_SHELL_ID },
    });
    const document = normalizeStorefrontShellDocument(row.draftDocument);
    const { validation, assets } = await this.resolveDocument(document, this.prisma);

    return {
      version: row.version,
      issues: validateShellForPublish(document, validation),
      shell: this.project(document, row.publishedRevision, validation, assets),
    };
  }

  async getPublic(): Promise<PublishedStorefrontShell> {
    let revision = 0;
    try {
      const row = await this.prisma.storefrontShell.findUnique({
        where: { id: STOREFRONT_SHELL_ID },
      });
      revision = row?.publishedRevision ?? 0;
      if (!row?.publishedDocument) {
        return this.fallbackPublic(revision);
      }

      const parsed = storefrontShellDocumentSchema.safeParse(row.publishedDocument);
      if (!parsed.success) {
        return this.fallbackPublic(revision);
      }

      return await this.projectWithClient(parsed.data, revision, this.prisma);
    } catch (error) {
      this.logger.warn(`Storefront shell read failed; using LUWAG fallback: ${errorMessage(error)}`);
      return this.fallbackPublic(revision);
    }
  }

  private parseDraftInput(input: unknown): StorefrontShellDocument {
    const parsed = storefrontShellDocumentSchema.safeParse(input);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'SHELL_DRAFT_INVALID',
        issues: schemaIssues(parsed.error.issues),
      });
    }
    return normalizeStorefrontShellDocument(parsed.data);
  }

  private async adminSnapshot(
    row: ShellRow,
    client: ShellAssetClient,
  ): Promise<AdminShellSnapshot> {
    const document = normalizeStorefrontShellDocument(row.draftDocument);
    const published = storefrontShellDocumentSchema.safeParse(row.publishedDocument);
    const { validation, assets } = await this.resolveDocument(document, client);

    return {
      document,
      version: row.version,
      publishedRevision: row.publishedRevision,
      hasUnpublishedChanges:
        !published.success || !isDeepStrictEqual(document, published.data),
      updatedAt: row.updatedAt.toISOString(),
      publishedAt: row.publishedAt?.toISOString() ?? null,
      issues: validateShellForPublish(document, validation),
      assets: assets.byId,
    };
  }

  private async resolveDocument(
    document: StorefrontShellDocument,
    client: ShellAssetClient,
  ): Promise<{ validation: ShellValidationContext; assets: LoadedAssets }> {
    const [targets, assets] = await Promise.all([
      this.targetResolver.resolve(document, client),
      this.loadAssets(document, client),
    ]);
    return {
      validation: {
        header: headerResolutionMap(targets),
        row: targets.footerLinkByRowId,
        assets: assets.lookup,
      },
      assets,
    };
  }

  private async loadAssets(
    document: StorefrontShellDocument,
    client: Pick<PrismaService, 'storefrontShellAsset'>,
  ): Promise<LoadedAssets> {
    const ids = [
      document.brand.horizontalLogo?.assetId,
      document.brand.squareMark?.assetId,
    ].filter((id): id is string => id !== undefined);

    const rows = ids.length === 0
      ? []
      : await client.storefrontShellAsset.findMany({
          where: { id: { in: [...new Set(ids)] } },
          select: {
            id: true,
            kind: true,
            publicUrl: true,
            mimeType: true,
            width: true,
            height: true,
            durable: true,
            createdAt: true,
          },
        });
    const rowById = new Map(rows.map((row) => [row.id, row as AssetRow]));
    const byId: Record<string, AdminShellAsset> = {};
    for (const row of rows) {
      const asset = adminAsset(row as AssetRow);
      if (asset) byId[asset.id] = asset;
    }

    const horizontal = document.brand.horizontalLogo
      ? rowById.get(document.brand.horizontalLogo.assetId) ?? null
      : null;
    const square = document.brand.squareMark
      ? rowById.get(document.brand.squareMark.assetId) ?? null
      : null;

    return {
      byId,
      lookup: {
        horizontalLogo: horizontal
          ? { id: horizontal.id, kind: horizontal.kind, durable: horizontal.durable }
          : null,
        squareMark: square
          ? { id: square.id, kind: square.kind, durable: square.durable }
          : null,
      },
      horizontalLogo: publicAsset(horizontal, 'HORIZONTAL'),
      squareMark: publicAsset(square, 'SQUARE'),
    };
  }

  private project(
    document: StorefrontShellDocument,
    publishedRevision: number,
    validation: ShellValidationContext,
    assets: LoadedAssets,
  ): PublishedStorefrontShell {
    return {
      publishedRevision,
      ...publicProjection(document, {
        header: validation.header,
        row: validation.row,
        horizontalLogo: assets.horizontalLogo,
        squareMark: assets.squareMark,
      }),
      derivedTheme: deriveStorefrontTheme(document.theme),
    };
  }

  private async projectWithClient(
    document: StorefrontShellDocument,
    publishedRevision: number,
    client: ShellAssetClient,
  ): Promise<PublishedStorefrontShell> {
    const { validation, assets } = await this.resolveDocument(document, client);
    return this.project(document, publishedRevision, validation, assets);
  }

  private async fallbackPublic(publishedRevision: number): Promise<PublishedStorefrontShell> {
    try {
      const [rootCategories, navigationCollections, settings] = await Promise.all([
        this.prisma.category.findMany({
          where: { status: 'ACTIVE', parentId: null },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          select: { id: true, name: true, slug: true, sortOrder: true },
        }),
        this.prisma.collection.findMany({
          where: { status: 'ACTIVE', type: 'NAVIGATION' },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          select: { id: true, name: true, slug: true, sortOrder: true },
        }),
        this.prisma.siteSetting.findFirst({
          select: { supportEmail: true, supportHours: true },
        }),
      ]);

      const document = createCurrentLuwagShellDocument({
        rootCategories: rootCategories.map((category) => ({
          id: category.id,
          name: category.name || humanizeSlug(category.slug),
          sortOrder: category.sortOrder ?? 0,
        })),
        navigationCollections: navigationCollections.map((collection) => ({
          id: collection.id,
          name: collection.name || humanizeSlug(collection.slug),
          slug: collection.slug,
          sortOrder: collection.sortOrder ?? 0,
        })),
        supportEmail: settings?.supportEmail || FALLBACK_SUPPORT_EMAIL,
        supportHours: settings?.supportHours || FALLBACK_SUPPORT_HOURS,
      });
      return await this.projectWithClient(document, publishedRevision, this.prisma);
    } catch (error) {
      this.logger.warn(`Live LUWAG fallback failed; using built-in shell: ${errorMessage(error)}`);
      const document = builtInFallbackDocument();
      const targets = await this.targetResolver.resolve(document, this.prisma);
      const validation: ShellValidationContext = {
        header: headerResolutionMap(targets),
        row: targets.footerLinkByRowId,
        assets: { horizontalLogo: null, squareMark: null },
      };
      return this.project(document, publishedRevision, validation, emptyAssets());
    }
  }
}

function shellVersionConflict(currentVersion: number | null): ConflictException {
  return new ConflictException({
    code: 'SHELL_VERSION_MISMATCH',
    message: 'The storefront shell draft changed in another session',
    currentVersion,
  });
}

function headerResolutionMap(
  targets: ResolvedTargets,
): ReadonlyMap<string, ShellHeaderResolution> {
  const result = new Map<string, ShellHeaderResolution>();
  for (const [id, resolved] of targets.headerByItemId) {
    result.set(
      id,
      resolved.kind === 'CATEGORY_ROOT'
        ? { href: null, categoryId: resolved.categoryId, reason: null }
        : { href: resolved.href, categoryId: null, reason: null },
    );
  }
  for (const [id, reason] of targets.unavailableByItemId) {
    if (!result.has(id)) result.set(id, { href: null, categoryId: null, reason });
  }
  return result;
}

function schemaIssues(
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>,
): ShellIssue[] {
  return issues.map((entry) => ({
    code: 'SHELL_DRAFT_INVALID',
    path: entry.path.map(String),
    message: entry.message,
  }));
}

function adminAsset(row: AssetRow): AdminShellAsset | null {
  if (row.mimeType !== 'image/png' && row.mimeType !== 'image/webp') return null;
  return {
    id: row.id,
    kind: row.kind,
    url: row.publicUrl,
    mimeType: row.mimeType,
    width: row.width,
    height: row.height,
    durable: row.durable,
    createdAt: row.createdAt.toISOString(),
  };
}

function publicAsset(
  row: AssetRow | null,
  expectedKind: 'HORIZONTAL' | 'SQUARE',
): PublicAssetView | null {
  if (!row || row.kind !== expectedKind || !row.durable) return null;
  return { id: row.id, url: row.publicUrl, width: row.width, height: row.height };
}

function emptyAssets(): LoadedAssets {
  return {
    byId: {},
    lookup: { horizontalLogo: null, squareMark: null },
    horizontalLogo: null,
    squareMark: null,
  };
}

function builtInFallbackDocument(): StorefrontShellDocument {
  const base = createCurrentLuwagShellDocument({
    rootCategories: [],
    navigationCollections: [],
    supportEmail: FALLBACK_SUPPORT_EMAIL,
    supportHours: FALLBACK_SUPPORT_HOURS,
  });
  return normalizeStorefrontShellDocument({
    ...base,
    header: {
      items: [
        {
          id: 'fallback-new-arrivals',
          kind: 'STRUCTURED_LINK',
          label: 'New Arrivals',
          enabled: true,
          link: { type: 'INTERNAL', path: '/collections/new-arrivals' },
        },
        {
          id: 'fallback-solutions',
          kind: 'STRUCTURED_LINK',
          label: 'Solutions',
          enabled: true,
          link: { type: 'INTERNAL', path: '/collections/small-space-solutions' },
        },
        {
          id: 'fallback-best-sellers',
          kind: 'STRUCTURED_LINK',
          label: 'Best Sellers',
          enabled: true,
          link: { type: 'INTERNAL', path: '/collections/best-sellers' },
        },
      ],
    },
  });
}

function humanizeSlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
