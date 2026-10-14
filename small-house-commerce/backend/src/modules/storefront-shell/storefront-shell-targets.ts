import { PrismaService } from '../../prisma/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import {
  isSafeInternalPath,
  httpsExternalUrlSchema,
  type StorefrontShellDocument,
  type StructuredLink,
} from './storefront-shell-document.js';

/**
 * Batch-resolves every entity-backed link in a shell document to a *current*
 * href (spec §7.2, §12.3). Stored hrefs are never trusted and never persisted:
 * a renamed slug must not leave a stale URL behind, and a target that has gone
 * away must be omitted rather than rendered as a dead link.
 */

export type ResolvedLink = { available: true; href: string } | { available: false; reason: string };

export type ResolvedHeaderItem =
  | { id: string; kind: 'CATEGORY_ROOT'; categoryId: string; label: string }
  | { id: string; kind: 'LINK'; label: string; href: string };

export type ResolvedTargets = {
  headerByItemId: ReadonlyMap<string, ResolvedHeaderItem>;
  footerLinkByRowId: ReadonlyMap<string, ResolvedLink>;
  unavailableByItemId: ReadonlyMap<string, string>;
  unavailableByRowId: ReadonlyMap<string, string>;
};

/** The subset of PrismaService the resolver needs; a transaction client satisfies it. */
export type ShellTargetClient = Pick<
  PrismaService,
  'product' | 'collection' | 'category' | 'productLandingPage'
>;

type CategoryRow = { id: string; slug: string; status: 'ACTIVE' | 'DISABLED'; parentId: string | null };
type ProductRow = { id: string; slug: string; status: 'ACTIVE' | 'DRAFT' | 'DISABLED' };
type CollectionRow = { id: string; slug: string; status: 'ACTIVE' | 'DISABLED' };
type LandingRow = {
  id: string;
  slug: string;
  status: 'DRAFT' | 'ACTIVE' | 'DISABLED';
  publishedContent: unknown;
  startAt: Date | null;
  endAt: Date | null;
  product: { status: 'ACTIVE' | 'DRAFT' | 'DISABLED' };
};

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

/**
 * CONTACT columns carry a structured Track Order link but no row id, so its
 * resolution is keyed by column instead of row. Shared here so the resolver,
 * the publish gate and the public projection agree on one key.
 */
export function trackOrderResolutionKey(columnId: string): string {
  return `${columnId}:trackOrder`;
}

export class StorefrontShellTargetResolver {
  constructor(
    private readonly prisma: ShellTargetClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async resolve(
    document: StorefrontShellDocument,
    client: ShellTargetClient = this.prisma,
  ): Promise<ResolvedTargets> {
    const links = collectLinks(document);

    // Collected with an explicit switch so each entity id is narrowed to its
    // own link shape; `.filter()` alone would not narrow the union.
    const productIds: string[] = [];
    const collectionIds: string[] = [];
    const categoryIds: string[] = [];
    const landingIds: string[] = [];
    for (const link of links) {
      switch (link.type) {
        case 'PRODUCT':
          productIds.push(link.id);
          break;
        case 'COLLECTION':
          collectionIds.push(link.id);
          break;
        case 'CATEGORY':
          categoryIds.push(link.id);
          break;
        case 'LANDING':
          landingIds.push(link.id);
          break;
        default:
          break;
      }
    }

    const [products, collections, categories, landings] = await Promise.all([
      productIds.length
        ? client.product.findMany({
            where: { id: { in: unique(productIds) } },
            select: { id: true, slug: true, status: true },
          })
        : Promise.resolve([] as ProductRow[]),
      collectionIds.length
        ? client.collection.findMany({
            where: { id: { in: unique(collectionIds) } },
            select: { id: true, slug: true, status: true },
          })
        : Promise.resolve([] as CollectionRow[]),
      categoryIds.length
        ? client.category.findMany({
            where: { id: { in: unique(categoryIds) } },
            select: { id: true, slug: true, status: true, parentId: true },
          })
        : Promise.resolve([] as CategoryRow[]),
      landingIds.length
        ? client.productLandingPage.findMany({
            where: { id: { in: unique(landingIds) } },
            select: {
              id: true,
              slug: true,
              status: true,
              publishedContent: true,
              startAt: true,
              endAt: true,
              product: { select: { status: true } },
            },
          })
        : Promise.resolve([] as LandingRow[]),
    ]);

    const productById = new Map(products.map((row) => [row.id, row]));
    const collectionById = new Map(collections.map((row) => [row.id, row]));
    const categoryById = new Map(categories.map((row) => [row.id, row]));
    const landingById = new Map(landings.map((row) => [row.id, row]));

    const resolveLink = (link: StructuredLink): ResolvedLink => {
      switch (link.type) {
        case 'PRODUCT': {
          const row = productById.get(link.id);
          if (!row) return { available: false, reason: 'TARGET_UNAVAILABLE' };
          if (row.status !== 'ACTIVE') return { available: false, reason: 'TARGET_UNAVAILABLE' };
          return { available: true, href: `/products/${row.slug}` };
        }
        case 'COLLECTION': {
          const row = collectionById.get(link.id);
          if (!row || row.status !== 'ACTIVE') return { available: false, reason: 'TARGET_UNAVAILABLE' };
          return { available: true, href: `/collections/${row.slug}` };
        }
        case 'CATEGORY': {
          const row = categoryById.get(link.id);
          if (!row || row.status !== 'ACTIVE') return { available: false, reason: 'TARGET_UNAVAILABLE' };
          return { available: true, href: `/categories/${row.slug}` };
        }
        case 'LANDING': {
          const row = landingById.get(link.id);
          if (!row) return { available: false, reason: 'TARGET_UNAVAILABLE' };
          if (!isLandingPublic(row, this.now())) {
            return { available: false, reason: 'TARGET_UNAVAILABLE' };
          }
          return { available: true, href: `/lp/${row.slug}` };
        }
        case 'INTERNAL':
          return isSafeInternalPath(link.path)
            ? { available: true, href: link.path }
            : { available: false, reason: 'UNSAFE_INTERNAL_PATH' };
        case 'EXTERNAL':
          return httpsExternalUrlSchema.safeParse(link.url).success
            ? { available: true, href: link.url }
            : { available: false, reason: 'UNSAFE_EXTERNAL_URL' };
      }
    };

    const headerByItemId = new Map<string, ResolvedHeaderItem>();
    const footerLinkByRowId = new Map<string, ResolvedLink>();
    const unavailableByItemId = new Map<string, string>();
    const unavailableByRowId = new Map<string, string>();

    for (const item of document.header.items) {
      if (!item.enabled) continue;

      if (item.kind === 'CATEGORY_ROOT') {
        const row = categoryById.get(item.targetId);
        if (!row || row.status !== 'ACTIVE' || row.parentId !== null) {
          unavailableByItemId.set(item.id, 'CATEGORY_NOT_ROOT');
          continue;
        }
        headerByItemId.set(item.id, {
          id: item.id,
          kind: 'CATEGORY_ROOT',
          categoryId: row.id,
          label: item.labelOverride,
        });
        continue;
      }

      const link: StructuredLink =
        item.kind === 'COLLECTION'
          ? { type: 'COLLECTION', id: item.targetId }
          : item.link;
      const resolved = resolveLink(link);
      if (!resolved.available) {
        unavailableByItemId.set(item.id, resolved.reason);
        continue;
      }
      headerByItemId.set(item.id, { id: item.id, kind: 'LINK', label: labelFor(item), href: resolved.href });
    }

    for (const column of document.footer.columns) {
      if (column.kind !== 'LINKS') {
        const key = trackOrderResolutionKey(column.id);
        const resolved = resolveLink(column.trackOrderLink);
        footerLinkByRowId.set(key, resolved);
        if (!resolved.available) unavailableByRowId.set(key, resolved.reason);
        continue;
      }
      for (const row of column.rows) {
        if (row.kind !== 'LINK') continue;
        const resolved = resolveLink(row.link);
        footerLinkByRowId.set(row.id, resolved);
        if (!resolved.available) unavailableByRowId.set(row.id, resolved.reason);
      }
    }

    return { headerByItemId, footerLinkByRowId, unavailableByItemId, unavailableByRowId };
  }
}

function labelFor(item: StorefrontShellDocument['header']['items'][number]): string {
  return item.kind === 'STRUCTURED_LINK' ? item.label : item.labelOverride;
}

/** A landing page is publicly reachable only while published, live and under an ACTIVE product. */
function isLandingPublic(row: LandingRow, now: Date): boolean {
  if (row.status !== 'ACTIVE') return false;
  if (row.publishedContent === null || row.publishedContent === undefined) return false;
  if (row.product.status !== 'ACTIVE') return false;
  if (row.startAt !== null && row.startAt.getTime() > now.getTime()) return false;
  if (row.endAt !== null && row.endAt.getTime() < now.getTime()) return false;
  return true;
}

function collectLinks(document: StorefrontShellDocument): StructuredLink[] {
  const links: StructuredLink[] = [];
  for (const item of document.header.items) {
    switch (item.kind) {
      case 'STRUCTURED_LINK':
        links.push(item.link);
        break;
      case 'COLLECTION':
        links.push({ type: 'COLLECTION', id: item.targetId });
        break;
      case 'CATEGORY_ROOT':
        links.push({ type: 'CATEGORY', id: item.targetId });
        break;
    }
  }
  for (const column of document.footer.columns) {
    if (column.kind === 'LINKS') {
      for (const row of column.rows) if (row.kind === 'LINK') links.push(row.link);
    } else {
      links.push(column.trackOrderLink);
    }
  }
  return links;
}

/** Prisma transaction clients satisfy the same shape as PrismaService for this read. */
export type ShellTransactionClient = Prisma.TransactionClient;
