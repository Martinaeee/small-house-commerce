import { z } from 'zod';
import { parseArgs } from 'node:util';
import { ConflictException } from '@nestjs/common';
import { Prisma, type ProductLandingPage } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { contentHash, LandingSnapshotService } from '../catalog/landing/landing-snapshot.service.js';
import { landingMediaSchema, normaliseLandingContent, type LandingContent } from '../catalog/landing/landing-content.js';

export type LegacyLandingOverrides = Pick<ProductLandingPage, 'titleOverride' | 'imagesOverride' | 'seoTitle' | 'seoDescription' | 'promoEnabled' | 'promoHeadline' | 'promoSubtext' | 'startAt' | 'endAt'>;

export function freezeLegacyLandingContent(page: LegacyLandingOverrides, source: LandingContent, parentDescription: string | null): LandingContent {
  const content = structuredClone(source);
  const hero = content.blocks.find(block => block.type === 'hero')!;
  if (hero.type === 'hero') {
    hero.props.title = page.titleOverride?.trim() || hero.props.title;
    hero.props.promoHeadline = page.promoEnabled ? page.promoHeadline : null;
    hero.props.promoSubtext = page.promoEnabled ? page.promoSubtext : null;
    content.seoTitle = page.seoTitle ?? hero.props.title;
  }
  content.seoDescription = page.seoDescription ?? parentDescription?.slice(0, 300) ?? null;
  content.startAt = page.startAt?.toISOString() ?? null;
  content.endAt = page.endAt?.toISOString() ?? null;
  const gallery = content.blocks.find(block => block.type === 'gallery');
  if (page.imagesOverride !== null) {
    const overrides = z.array(z.object({ url: landingMediaSchema, altText: z.string().max(200).nullable().optional() })).parse(page.imagesOverride);
    if (overrides.length && gallery?.type === 'gallery') {
      gallery.props.media = [
        ...overrides.map(image => ({ ...image, type: 'IMAGE' as const, altText: image.altText ?? null, optionValueId: null, variantId: null })),
        ...gallery.props.media.filter(image => image.variantId || image.optionValueId),
      ];
    }
  }
  return normaliseLandingContent(content);
}

export function parseLegacyBackfillCommand(args: string[], databaseUrl: string | undefined): { apply: boolean; pageIds?: string[] } {
  let database: URL;
  try { database = new URL(databaseUrl ?? ''); } catch { throw new Error('An explicit valid DATABASE_URL is required.'); }
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || (database.searchParams.get('schema') ?? 'public') !== 'public')
    throw new Error('Backfill requires a PostgreSQL public-schema target.');
  const { values } = parseArgs({ args, options: { apply: { type: 'boolean', default: false }, 'confirm-database': { type: 'string' }, 'page-id': { type: 'string', multiple: true } } });
  if (values.apply && values['confirm-database'] !== `${database.host}${database.pathname}`)
    throw new Error('Apply requires --confirm-database matching the DATABASE_URL host, port and database.');
  const pageIds = values['page-id'] === undefined ? undefined : z.array(z.string().uuid()).min(1).parse(values['page-id']);
  return { apply: Boolean(values.apply), ...(pageIds !== undefined ? { pageIds } : {}) };
}

export async function backfillLegacyLandingPages(prisma: PrismaService, options: { apply?: boolean; pageIds?: string[] } = {}) {
  const snapshots = new LandingSnapshotService(prisma);
  const emptyPublished: Prisma.ProductLandingPageWhereInput = { OR: [
    { publishedContent: { equals: Prisma.DbNull } },
    { publishedContent: { equals: Prisma.JsonNull } },
  ] };
  return prisma.$transaction(async tx => {
    const pages = await tx.productLandingPage.findMany({
      where: { ...emptyPublished, status: { in: ['ACTIVE', 'DISABLED'] }, ...(options.pageIds !== undefined ? { id: { in: options.pageIds } } : {}) },
      orderBy: { id: 'asc' },
    });
    const rows: { id: string; slug: string; ownerUserId: string | null; publishedContentHash: string; preservedDraft: boolean; seoDescriptionTruncated: boolean }[] = [];
    const publishedAt = new Date();
    for (const page of pages) {
      const source = await snapshots.snapshotFromProduct(page.productId, tx);
      const parent = await tx.product.findUniqueOrThrow({ where: { id: page.productId }, select: { description: true } });
      const content = freezeLegacyLandingContent(page, source, parent.description);
      if (options.apply) {
        const result = await tx.productLandingPage.updateMany({
          where: { ...emptyPublished, id: page.id, ownerUserId: page.ownerUserId, version: page.version, updatedAt: page.updatedAt },
          data: {
            publishedContent: content as Prisma.InputJsonValue,
            ...(page.draftContent === null ? { draftContent: content as Prisma.InputJsonValue } : {}),
            publishedRevision: { increment: 1 }, version: { increment: 1 },
            publishedAt: page.publishedAt ?? publishedAt,
            sourceContentHash: page.sourceContentHash ?? contentHash(source),
          },
        });
        if (result.count !== 1) throw new ConflictException('A legacy page changed during backfill. Retry from a fresh preview.');
      }
      rows.push({ id: page.id, slug: page.slug, ownerUserId: page.ownerUserId, publishedContentHash: contentHash(content), preservedDraft: page.draftContent !== null, seoDescriptionTruncated: page.seoDescription === null && (parent.description?.length ?? 0) > 300 });
    }
    return { applied: Boolean(options.apply), rows };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 60000 });
}
