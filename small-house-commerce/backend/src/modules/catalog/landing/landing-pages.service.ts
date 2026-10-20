import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type ProductLandingPage } from '../../../generated/prisma/client.js';
import { assertManage, assertVisible, scopeFor, type MarketingAccount } from '../../marketing/marketing-access.js';
import { normaliseLandingContent } from './landing-content.js';
import { randomBytes } from 'node:crypto';
import { OptimizersService } from '../../marketing/optimizers.service.js';
import { manilaVisitDay } from '../../marketing/marketing-attribution.js';
import { LandingSnapshotService, contentHash, mergeLandingSources } from './landing-snapshot.service.js';
import type { LandingPageStatus } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { CACHE_TAGS, revalidateCache } from '../../../common/revalidation.js';
import { ProductsService } from '../products.service.js';
import type { MediaScopeRequest } from '../product-media.resolver.js';
import type { AdminLandingPageQuery, MarketingProductPickerQuery } from './dto/landing-page.dto.js';
import {
  effectiveStatus,
  type LandingEffectiveStatus,
} from './landing-page.util.js';

const pageDetails = {
  product: { select: { name: true, productCode: true, slug: true, status: true } },
  owner: { select: { name: true, optimizerProfile: { select: { aid: true, displayName: true } } } },
} satisfies Prisma.ProductLandingPageInclude;
type PageWithDetails = Prisma.ProductLandingPageGetPayload<{ include: typeof pageDetails }>;

function pageMetadata(row: Pick<PageWithDetails, 'product' | 'owner' | 'draftContent' | 'publishedContent'>) {
  return {
    productName: row.product.name,
    productCode: row.product.productCode,
    productSlug: row.product.slug,
    productStatus: row.product.status,
    ownerName: row.owner?.optimizerProfile?.displayName ?? row.owner?.name ?? null,
    aid: row.owner?.optimizerProfile?.aid ?? null,
    hasUnpublishedChanges: Boolean(row.draftContent && (!row.publishedContent ||
      contentHash(normaliseLandingContent(row.draftContent)) !== contentHash(normaliseLandingContent(row.publishedContent)))),
  };
}

export interface AdminLandingPageRow extends ReturnType<typeof pageMetadata> {
  id: string;
  productId: string;
  ownerUserId: string | null;
  version: number;
  publishedRevision: number;
  publishedAt: Date | null;
  name: string;
  slug: string;
  adCode: string | null;
  titleOverride: string | null;
  promoEnabled: boolean;
  promoHeadline: string | null;
  promoSubtext: string | null;
  startAt: Date | null;
  endAt: Date | null;
  status: LandingPageStatus;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  effectiveStatus: LandingEffectiveStatus;
  views: number;
  orders: number;
  periodViews: number;
  periodOrders: number;
  conversionRate: number;
  linkCount: number;
}

function nextManilaDay(date: string): Date {
  const [year, month, day] = date.split('-').map(Number) as [
    number,
    number,
    number,
  ];
  return new Date(Date.UTC(year, month - 1, day + 1) - 8 * 60 * 60 * 1000);
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'P2002';
}

@Injectable()
export class LandingPagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
    private readonly snapshots: LandingSnapshotService,
    private readonly optimizers: OptimizersService,
  ) {}

  async createDraft(productId: string, input: { name: string; slug?: string; ownerUserId?: string }, account: MarketingAccount) {
    const scope = scopeFor(account);
    const ownerUserId = input.ownerUserId ?? account.id;
    assertManage(scope, ownerUserId);
    await this.optimizers.ensureProfileForUser(ownerUserId);
    const content = await this.snapshots.snapshotFromProduct(productId);
    try {
      const row = await this.prisma.productLandingPage.create({ include: pageDetails, data: {
        productId, ownerUserId, name: input.name,
        slug: input.slug ?? `lp-${randomBytes(9).toString('hex')}`,
        status: 'DRAFT', draftContent: content as Prisma.InputJsonValue,
        publishedContent: Prisma.DbNull, sourceContentHash: contentHash(content),
      } });
      return this.serialize(row);
    } catch (error) {
      if (isUniqueViolation(error))
        throw new ConflictException({ code: 'LANDING_SLUG_CONFLICT', message: 'This page address is already in use.' });
      throw error;
    }
  }

  async getDraft(id: string, account: MarketingAccount) {
    const scope = scopeFor(account);
    const row = await this.ensureLandingPage(id);
    assertVisible(scope, row.ownerUserId);
    return this.serialize(row);
  }

  async getPreview(id: string, account: MarketingAccount) {
    const row = await this.prisma.productLandingPage.findUnique({
      where: { id }, include: { product: { select: { slug: true, status: true } } },
    });
    if (!row) throw new NotFoundException('Marketing page not found.');
    assertVisible(scopeFor(account), row.ownerUserId);
    if (row.product.status !== 'ACTIVE')
      throw new BadRequestException({ code: 'LANDING_PARENT_INACTIVE', message: 'The parent product is not active.' });
    return {
      content: normaliseLandingContent(row.draftContent),
      product: await this.products.storefrontGetBySlug(row.product.slug),
      version: row.version,
    };
  }

  async validateDraft(id: string, input: unknown, account: MarketingAccount) {
    const row = await this.prisma.productLandingPage.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Marketing page not found.');
    const scope = scopeFor(account);
    assertVisible(scope, row.ownerUserId);
    assertManage(scope, row.ownerUserId);
    const content = normaliseLandingContent(input);
    await this.snapshots.assertBindings(row.productId, content);
    return content;
  }

  async saveDraft(id: string, content: unknown, expectedVersion: number, account: MarketingAccount, name?: string) {
    return this.mutateDraft(id, expectedVersion, account, async (_tx, row) => {
      const clean = normaliseLandingContent(content);
      await this.snapshots.assertBindings(row.productId, clean);
      return { draftContent: clean as Prisma.InputJsonValue, ...(name !== undefined ? { name } : {}) };
    });
  }

  async sourceComparison(id: string, account: MarketingAccount) {
    const row = await this.getDraft(id, account);
    const content = await this.snapshots.snapshotFromProduct(row.productId);
    const hash = contentHash(content);
    return { content, sourceContentHash: hash, changed: hash !== row.sourceContentHash };
  }

  async resync(id: string, sourceKeys: string[], expectedVersion: number, account: MarketingAccount, insertBeforeId?: string | null) {
    return this.mutateDraft(id, expectedVersion, account, async (_tx, row) => {
      const latest = await this.snapshots.snapshotFromProduct(row.productId);
      const draft = normaliseLandingContent(row.draftContent);
      const content = mergeLandingSources(draft, latest, sourceKeys, insertBeforeId);
      await this.snapshots.assertBindings(row.productId, content);
      return { draftContent: content as Prisma.InputJsonValue, sourceContentHash: contentHash(latest) };
    });
  }

  async publish(id: string, expectedVersion: number, account: MarketingAccount) {
    const result = await this.mutateDraft(id, expectedVersion, account, async (tx, row) => {
      const product = await tx.product.findUnique({ where: { id: row.productId }, select: { id: true, status: true } });
      if (!product || product.status !== 'ACTIVE')
        throw new BadRequestException({ code: 'LANDING_PARENT_NOT_ACTIVE', message: 'Publish requires an active parent product.' });
      const content = normaliseLandingContent(row.draftContent);
      await this.snapshots.assertBindings(row.productId, content);
      return {
        publishedContent: content as Prisma.InputJsonValue,
        publishedRevision: { increment: 1 },
        publishedAt: new Date(),
        startAt: content.startAt ? new Date(content.startAt) : null,
        endAt: content.endAt ? new Date(content.endAt) : null,
        status: 'ACTIVE',
      };
    });
    await revalidateCache([CACHE_TAGS.STOREFRONT]);
    return result;
  }

  async assignOwner(id: string, ownerUserId: string, expectedVersion: number, account: MarketingAccount) {
    return this.mutateDraft(id, expectedVersion, account, async (tx, row) => {
      if (row.ownerUserId !== null)
        throw new ConflictException({ code: 'LANDING_ALREADY_ASSIGNED', message: 'This page already has an owner. Reload the saved version.' });
      const profile = await tx.optimizerProfile.findUnique({
        where: { userId: ownerUserId }, select: { status: true, user: { select: { status: true } } },
      });
      if (!profile || profile.status !== 'ACTIVE' || profile.user.status !== 'ACTIVE')
        throw new BadRequestException('Choose an existing active optimizer.');
      return { ownerUserId };
    });
  }

  async disable(id: string, expectedVersion: number, account: MarketingAccount) {
    const result = await this.mutateDraft(id, expectedVersion, account, async () => ({ status: 'DISABLED' }));
    await revalidateCache([CACHE_TAGS.STOREFRONT]);
    return result;
  }

  private async mutateDraft(
    id: string,
    expectedVersion: number,
    account: MarketingAccount,
    build: (tx: Prisma.TransactionClient, row: ProductLandingPage) => Promise<Prisma.ProductLandingPageUncheckedUpdateManyInput>,
  ) {
    const scope = scopeFor(account);
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.productLandingPage.findUnique({ where: { id } });
      if (!row) throw new NotFoundException('Marketing page not found.');
      assertVisible(scope, row.ownerUserId);
      assertManage(scope, row.ownerUserId);
      const conflict = () => new ConflictException({ code: 'LANDING_VERSION_CONFLICT', message: 'This page changed. Reload the saved version before retrying.' });
      if (row.version !== expectedVersion) throw conflict();
      const data = await build(tx, row);
      const result = await tx.productLandingPage.updateMany({
        where: { id, ownerUserId: row.ownerUserId, version: expectedVersion },
        data: { ...data, version: { increment: 1 } },
      });
      if (result.count !== 1) throw conflict();
      return this.serialize((await tx.productLandingPage.findUnique({ where: { id }, include: pageDetails }))!);
    });
  }

  async adminListForProduct(productId: string, account: MarketingAccount) {
    const scope = scopeFor(account);
    await this.ensureProduct(productId);
    const rows = await this.prisma.productLandingPage.findMany({
      where: { productId, ...(!scope.all ? { ownerUserId: scope.ownerUserId } : {}) },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: pageDetails,
    });
    return rows.map((row) => this.serialize(row));
  }

  async productOptions(query: MarketingProductPickerQuery, account: MarketingAccount) {
    scopeFor(account);
    const search = query.search?.trim();
    const where: Prisma.ProductWhereInput = query.id ? { id: query.id } : search ? { OR: [
      { name: { contains: search, mode: 'insensitive' } },
      { productCode: { contains: search, mode: 'insensitive' } },
    ] } : {};
    const [items, total] = await Promise.all([
      this.prisma.product.findMany({ where, select: { id: true, name: true, productCode: true, slug: true, status: true, images: { where: { type: 'IMAGE', variantId: null, optionValueId: null }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], take: 1, select: { url: true } } }, orderBy: { updatedAt: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.product.count({ where }),
    ]);
    return {
      items: items.map((row) => ({
        id: row.id, name: row.name, productCode: row.productCode,
        slug: row.slug, status: row.status,
        thumbnailUrl: row.images[0]?.url ?? null,
      })),
      total, page: query.page, pageSize: query.pageSize,
    };
  }

  async ownerOptions(account: MarketingAccount) {
    const scope = scopeFor(account);
    const profiles = await this.prisma.optimizerProfile.findMany({
      where: scope.all ? {} : { userId: account.id },
      select: { userId: true, aid: true, displayName: true, status: true, user: { select: { status: true } } },
      orderBy: { displayName: 'asc' },
    });
    return profiles.map(({ user, ...profile }) => ({ ...profile, userStatus: user.status }));
  }

  async adminList(query: AdminLandingPageQuery, account: MarketingAccount) {
    const scope = scopeFor(account);
    const where: Prisma.ProductLandingPageWhereInput = scope.all ? {} : { ownerUserId: scope.ownerUserId };
    if (query.ownerUserId) {
      assertVisible(scope, query.ownerUserId);
      where.ownerUserId = query.ownerUserId;
    }
    if (query.productId) where.productId = query.productId;
    if (query.status) where.status = query.status;
    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { titleOverride: { contains: search, mode: 'insensitive' } },
        { adCode: { contains: search, mode: 'insensitive' } },
        { product: { is: { OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { productCode: { contains: search, mode: 'insensitive' } },
        ] } } },
        { owner: { is: { OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { optimizerProfile: { is: { OR: [
            { aid: { contains: search, mode: 'insensitive' } },
            { displayName: { contains: search, mode: 'insensitive' } },
          ] } } },
        ] } } },
      ];
    }
    if (query.dateFrom || query.dateTo) {
      const updatedAt: Prisma.DateTimeFilter = {};
      if (query.dateFrom)
        updatedAt.gte = new Date(`${query.dateFrom}T00:00:00.000+08:00`);
      if (query.dateTo) updatedAt.lt = nextManilaDay(query.dateTo);
      where.updatedAt = updatedAt;
    }
    if (query.effectiveStatus)
      this.applyEffectiveStatus(where, query.effectiveStatus);

    const orderBy: Prisma.ProductLandingPageOrderByWithRelationInput[] =
      query.sortBy === 'title'
        ? [{ titleOverride: query.sortDir }]
        : [{ updatedAt: query.sortDir }];

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.productLandingPage.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          productId: true,
          name: true,
          slug: true,
          adCode: true,
          titleOverride: true,
          promoEnabled: true,
          promoHeadline: true,
          promoSubtext: true,
          startAt: true,
          endAt: true,
          status: true,
          sortOrder: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { campaignLinks: true } },
          ...pageDetails,
          ownerUserId: true,
          draftContent: true,
          publishedContent: true,
          version: true,
          publishedRevision: true,
          publishedAt: true,
        },
      }),
      this.prisma.productLandingPage.count({ where }),
    ]);

    const ids = rows.map((row) => row.id);
    const periodTo = query.periodTo ?? manilaVisitDay(new Date()).toISOString().slice(0, 10);
    const periodFrom = query.periodFrom ?? new Date(Date.parse(periodTo) - 6 * 864e5).toISOString().slice(0, 10);
    const metricsOwner = query.ownerUserId ?? (scope.all ? undefined : scope.ownerUserId);
    const [visitGroups, orderGroups, periodVisitGroups, periodOrderGroups] = await Promise.all([
      this.prisma.landingPageVisit.groupBy({
        by: ['landingPageId'],
        where: { landingPageId: { in: ids } },
        _count: { _all: true },
      }),
      this.prisma.orderAttribution.groupBy({
        by: ['landingPageId'],
        where: {
          landingPageId: { in: ids },
          order: { orderStatus: { notIn: ['CANCELLED', 'DENIED'] } },
        },
        _count: { _all: true },
      }),
      this.prisma.landingPageVisit.groupBy({
        by: ['landingPageId'],
        where: { landingPageId: { in: ids }, visitDay: { gte: new Date(periodFrom), lte: new Date(periodTo) } },
        _count: { _all: true },
      }),
      this.prisma.orderAttribution.groupBy({
        by: ['landingPageId'],
        where: {
          landingPageId: { in: ids },
          ...(metricsOwner ? { optimizerId: metricsOwner } : {}),
          legacy: false,
          linkId: { not: null },
          touchedAt: { gte: new Date(`${periodFrom}T00:00:00+08:00`), lt: nextManilaDay(periodTo) },
          order: { orderStatus: { notIn: ['CANCELLED', 'DENIED'] } },
        },
        _count: { _all: true },
      }),
    ]);
    const viewCount = new Map(
      visitGroups.map((g) => [g.landingPageId, g._count._all]),
    );
    const orderCount = new Map(
      orderGroups.map((g) => [g.landingPageId, g._count._all]),
    );

    const periodViewCount = new Map(periodVisitGroups.map((group) => [group.landingPageId, group._count._all]));
    const periodOrderCount = new Map(periodOrderGroups.map((group) => [group.landingPageId, group._count._all]));
    const items: AdminLandingPageRow[] = rows.map(({ product, owner, draftContent, publishedContent, _count, ...row }) => {
      const views = viewCount.get(row.id) ?? 0;
      const orders = orderCount.get(row.id) ?? 0;
      return {
        ...row,
        ...pageMetadata({ product, owner, draftContent, publishedContent }),
        linkCount: _count.campaignLinks,
        views,
        orders,
        periodViews: periodViewCount.get(row.id) ?? 0,
        periodOrders: periodOrderCount.get(row.id) ?? 0,
        conversionRate:
          views === 0 ? 0 : Math.round((orders / views) * 10000) / 10000,
        effectiveStatus: effectiveStatus(row),
      };
    });

    return { items, total, page: query.page, pageSize: query.pageSize, period: { from: periodFrom, to: periodTo } };
  }

  // Public composite for /lp/:slug: whitelisted LP fields + the same storefront
  // product payload the PDP uses. Every non-public state collapses to 404 so
  // scheduled/disabled/ended pages are not disclosed.
  async storefrontGetComposite(
    slug: string,
    selectedScope?: MediaScopeRequest,
  ) {
    const lp = await this.prisma.productLandingPage.findUnique({
      where: { slug },
      include: { product: { select: { slug: true, status: true } } },
    });
    if (
      !lp ||
      !lp.publishedContent ||
      lp.product.status !== 'ACTIVE' ||
      effectiveStatus(lp) !== 'LIVE'
    ) {
      throw new NotFoundException(`Landing page #${slug} not found`);
    }
    const product = selectedScope
      ? await this.products.storefrontGetBySlug(lp.product.slug, selectedScope)
      : await this.products.storefrontGetBySlug(lp.product.slug);
    return {
      landingPage: {
        id: lp.id,
        slug: lp.slug,
        content: normaliseLandingContent(lp.publishedContent),
        publishedRevision: lp.publishedRevision,
      },
      product,
    };
  }

  async recordView(slug: string, visitKey: string): Promise<void> {
    const now = new Date();
    const visitDay = manilaVisitDay(now);
    const lp = await this.prisma.productLandingPage.findUnique({
      where: { slug },
      select: {
        id: true,
        status: true,
        startAt: true,
        endAt: true,
        product: { select: { status: true } },
      },
    });
    if (!lp || lp.product.status !== 'ACTIVE' || effectiveStatus(lp) !== 'LIVE')
      return;
    try {
      await this.prisma.landingPageVisit.upsert({
        where: { landingPageId_visitKey_visitDay: { landingPageId: lp.id, visitKey, visitDay } },
        create: { landingPageId: lp.id, visitKey, visitDay, createdAt: now },
        update: {},
      });
    } catch (error) {
      // Concurrent first-hit race: the unique row already exists, count is unchanged.
      if (isUniqueViolation(error)) return;
      throw error;
    }
  }

  private async ensureProduct(productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!product)
      throw new NotFoundException(`Product #${productId} not found`);
  }

  private async ensureLandingPage(id: string) {
    const row = await this.prisma.productLandingPage.findUnique({
      where: { id },
      include: pageDetails,
    });
    if (!row) throw new NotFoundException(`Landing page #${id} not found`);
    return row;
  }

  // Mirror of landing-page.util.effectiveStatus expressed as Prisma filters.
  // LIVE = ACTIVE and (no past/future window edge excludes now).
  private applyEffectiveStatus(
    where: Prisma.ProductLandingPageWhereInput,
    value: NonNullable<AdminLandingPageQuery['effectiveStatus']>,
    now: Date = new Date(),
  ) {
    if (value === 'DRAFT' || value === 'DISABLED') {
      where.status = value;
      return;
    }
    where.status = 'ACTIVE';
    if (value === 'SCHEDULED') {
      where.startAt = { gt: now };
    } else if (value === 'ENDED') {
      where.endAt = { lt: now };
    } else {
      where.AND = [
        { OR: [{ startAt: null }, { startAt: { lte: now } }] },
        { OR: [{ endAt: null }, { endAt: { gte: now } }] },
      ];
    }
  }

  private serialize(row: PageWithDetails) {
    const { product, owner, ...page } = row;
    return { ...page, ...pageMetadata({ product, owner, draftContent: page.draftContent, publishedContent: page.publishedContent }), effectiveStatus: effectiveStatus(row) };
  }
}
