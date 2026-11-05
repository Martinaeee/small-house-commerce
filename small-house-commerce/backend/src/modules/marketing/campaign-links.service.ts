import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma, type SourceType } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { effectiveStatus } from '../catalog/landing/landing-page.util.js';
import { adidFor, calendarDayKey, manilaDayKey, type AdidKind } from './adid.js';
import { assertManage, assertVisible, scopeFor, type MarketingAccount } from './marketing-access.js';
import { OptimizersService } from './optimizers.service.js';
import { autoPostName, isFacebookPostUrl, postDateFromDb, postDateToDb } from './marketing-post.js';
import type { CampaignLinkCloneInput, CampaignLinkCreateInput, CampaignLinkGroupQuery, CampaignLinkQuery, CampaignLinkUpdateInput } from './dto/campaign-link.dto.js';

const details = {
  product: {
    select: {
      name: true, productCode: true, slug: true, status: true,
      images: {
        where: { type: 'IMAGE' as const, variantId: null, optionValueId: null },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        take: 1,
        select: { url: true },
      },
    },
  },
  landingPage: { select: { name: true, slug: true, status: true, publishedContent: true, publishedRevision: true, startAt: true, endAt: true } },
  owner: { select: { name: true, status: true, optimizerProfile: { select: { displayName: true, status: true } } } },
} satisfies Prisma.CampaignLinkInclude;
type LinkWithDetails = Prisma.CampaignLinkGetPayload<{ include: typeof details }>;
const attributionFields = ['campaignId', 'adsetId', 'adId', 'utmSource', 'utmMedium', 'utmCampaign', 'utmContent', 'utmTerm'] as const;

export interface CampaignLinkProductGroup {
  product: { id: string; name: string; productCode: string | null; thumbnailUrl: string | null };
  recordCount: number;
  postCount: number;
  lastPostDate: string | null;
  latestCreatedAt: string;
}

function linkPath(row: LinkWithDetails): string {
  const path = row.landingPage ? `/lp/${encodeURIComponent(row.landingPage.slug)}` : `/products/${encodeURIComponent(row.product.slug)}`;
  const params = new URLSearchParams();
  if (row.variantId) params.set('variant', row.variantId);
  params.set('cl', row.code);
  for (const [field, key] of [['utmSource', 'utm_source'], ['utmMedium', 'utm_medium'], ['utmCampaign', 'utm_campaign'], ['utmContent', 'utm_content'], ['utmTerm', 'utm_term']] as const) if (row[field]) params.set(key, row[field]);
  return `${path}?${params}`;
}

@Injectable()
export class CampaignLinksService {
  constructor(private readonly prisma: PrismaService, private readonly optimizers: OptimizersService) {}

  async createLink(input: CampaignLinkCreateInput, account: MarketingAccount) {
    return this.mint(input, account);
  }

  private async mint(input: CampaignLinkCreateInput, account: MarketingAccount, existingOwner?: string) {
    const scope = scopeFor(account);
    const page = input.landingPageId ? await this.prisma.productLandingPage.findUnique({ where: { id: input.landingPageId } }) : null;
    if (input.landingPageId && !page) throw new NotFoundException('Marketing page not found.');
    if (page) {
      assertVisible(scope, page.ownerUserId);
      if (!page.ownerUserId) throw new BadRequestException('Assign the page owner before creating a link.');
      if (page.productId !== input.productId || !page.publishedContent || page.status !== 'ACTIVE' || effectiveStatus(page) === 'ENDED')
        throw new BadRequestException('The target must be a published page of this product.');
    }
    const ownerUserId = page?.ownerUserId ?? existingOwner ?? account.id;
    if (existingOwner && existingOwner !== ownerUserId) throw new BadRequestException('The target page owner changed.');
    assertManage(scope, ownerUserId);
    const product = await this.prisma.product.findUnique({ where: { id: input.productId }, select: { id: true, name: true, status: true } });
    if (!product || product.status !== 'ACTIVE') throw new BadRequestException('The parent product must be active.');
    const variant = input.variantId ? await this.prisma.productVariant.findUnique({ where: { id: input.variantId }, select: { productId: true, name: true, sku: { select: { status: true, price: true } } } }) : null;
    if (input.variantId && (!variant || variant.productId !== input.productId || variant.sku?.status !== 'ACTIVE' || variant.sku.price === null))
      throw new BadRequestException('The target variant is not available for this product.');
    const hasPostField = input.postDate != null || input.postUrl != null;
    if (hasPostField && input.sourceType !== 'FB_POST') throw new BadRequestException('Post fields require a Facebook post source.');
    if (input.postUrl && !isFacebookPostUrl(input.postUrl)) throw new BadRequestException('Use an HTTPS Facebook post URL.');
    const code = randomBytes(12).toString('base64url');
    const postDate = input.postDate ? postDateToDb(input.postDate) : null;
    if (!input.name && (!input.postDate || input.sourceType !== 'FB_POST')) throw new BadRequestException('Name is required.');
    const name = input.name ?? autoPostName(input.postDate!, product.name, code);
    const profile = await this.optimizers.ensureProfileForUser(ownerUserId);
    const row = await this.prisma.$transaction(async (tx) => {
      const adid = await this.nextAdid(tx, {
        ownerUserId,
        aid: profile.aid,
        sourceType: input.sourceType,
        postDate,
        adId: input.adId || null,
      });
      return tx.campaignLink.create({
        data: {
          code, adid, ownerUserId, aidSnapshot: profile.aid,
          productId: input.productId, variantId: input.variantId ?? null, variantNameSnapshot: variant?.name ?? null,
          landingPageId: input.landingPageId ?? null, name, sourceType: input.sourceType,
          postDate, postUrl: input.postUrl || null,
          ...Object.fromEntries(attributionFields.map((field) => [field, input[field] || null])),
        },
        include: details,
      });
    });
    return this.serialize(row);
  }

  /**
   * The advertising number of a link. A Meta ad keeps the ID the operator
   * recorded; an FB post gets a generated number scoped to its optimizer and
   * Manila post date, so two posts published the same day never collide. The
   * counter upsert is atomic, which matters when links are created together.
   */
  private async nextAdid(
    tx: Prisma.TransactionClient,
    input: {
      ownerUserId: string;
      aid: string;
      sourceType: SourceType;
      postDate: Date | null;
      adId: string | null;
    },
  ): Promise<string | null> {
    if (input.sourceType === 'META_AD' && input.adId) return input.adId;
    const kind: AdidKind | null =
      input.sourceType === 'FB_POST' ? 'FB' : input.sourceType === 'META_AD' ? 'AD' : null;
    if (!kind) return null;
    const dayKey = input.postDate ? calendarDayKey(input.postDate) : manilaDayKey(new Date());
    const [row] = await tx.$queryRaw<Array<{ last_number: number }>>`
      INSERT INTO "adid_counters" ("owner_user_id", "day_key", "kind", "last_number")
      VALUES (${input.ownerUserId}::uuid, ${dayKey}, ${kind}, 1)
      ON CONFLICT ("owner_user_id", "day_key", "kind")
      DO UPDATE SET "last_number" = "adid_counters"."last_number" + 1
      RETURNING "last_number"
    `;
    return adidFor(kind, input.aid, dayKey, Number(row!.last_number));
  }

  async listLinks(query: CampaignLinkQuery, account: MarketingAccount) {
    const scope = scopeFor(account);
    const where = this.listWhere(query, scope);
    const orderBy: Prisma.CampaignLinkOrderByWithRelationInput[] = query.orderBy === 'POST_DATE_DESC'
      ? [{ postDate: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }, { id: 'asc' }]
      : [{ createdAt: 'desc' }, { id: 'desc' }];
    const [rows, total] = await Promise.all([
      this.prisma.campaignLink.findMany({ where, include: details, orderBy, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.campaignLink.count({ where }),
    ]);
    return { items: rows.map((row) => this.serialize(row)), total, page: query.page, pageSize: query.pageSize };
  }

  private listWhere(query: CampaignLinkQuery | CampaignLinkGroupQuery, scope: ReturnType<typeof scopeFor>): Prisma.CampaignLinkWhereInput {
    const where: Prisma.CampaignLinkWhereInput = scope.all ? {} : { ownerUserId: scope.ownerUserId! };
    if (query.ownerUserId) { assertVisible(scope, query.ownerUserId); where.ownerUserId = query.ownerUserId; }
    if (query.productId) where.productId = query.productId;
    if (query.landingPageId) where.landingPageId = query.landingPageId;
    if (query.status) where.status = query.status;
    if (query.sourceType) where.sourceType = query.sourceType;
    if (query.archiveState === 'UNARCHIVED') where.archivedAt = null;
    if (query.archiveState === 'ARCHIVED') where.archivedAt = { not: null };
    const dateFilter = Boolean(query.postDateFrom || query.postDateTo || query.postDateMissingOnly);
    if (dateFilter) where.sourceType = 'FB_POST';
    if (query.postDateMissingOnly) where.postDate = null;
    else if (query.postDateFrom || query.postDateTo) {
      where.postDate = {
        ...(query.postDateFrom ? { gte: postDateToDb(query.postDateFrom) } : {}),
        ...(query.postDateTo ? { lte: postDateToDb(query.postDateTo) } : {}),
      };
    }
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { aidSnapshot: { contains: query.search, mode: 'insensitive' } },
        { adId: { contains: query.search, mode: 'insensitive' } },
        { adid: { contains: query.search, mode: 'insensitive' } },
        { code: { contains: query.search } },
        { postUrl: { contains: query.search, mode: 'insensitive' } },
        { product: { name: { contains: query.search, mode: 'insensitive' } } },
        { product: { productCode: { contains: query.search, mode: 'insensitive' } } },
      ];
    }
    return where;
  }

  async listProductGroups(query: CampaignLinkGroupQuery, account: MarketingAccount) {
    const scope = scopeFor(account);
    const where = this.listWhere(query, scope);
    const [groups, posts] = await Promise.all([
      this.prisma.campaignLink.groupBy({ by: ['productId'], where, _count: { _all: true }, _max: { createdAt: true } }),
      this.prisma.campaignLink.groupBy({
        by: ['productId'],
        where: { AND: [where, { sourceType: 'FB_POST' }] },
        _count: { _all: true },
        _max: { postDate: true },
      }),
    ]);
    const postMap = new Map(posts.map((row) => [row.productId, row]));
    const all = groups.map((row): CampaignLinkProductGroup & { latest: Date } => {
      const post = postMap.get(row.productId);
      return {
        product: { id: row.productId, name: '', productCode: null, thumbnailUrl: null },
        recordCount: row._count._all,
        postCount: post?._count._all ?? 0,
        lastPostDate: postDateFromDb(post?._max.postDate ?? null),
        latestCreatedAt: (row._max.createdAt ?? new Date(0)).toISOString(),
        latest: row._max.createdAt ?? new Date(0),
      };
    });
    all.sort((a, b) => {
      if (a.lastPostDate && b.lastPostDate) {
        const byDate = b.lastPostDate.localeCompare(a.lastPostDate);
        if (byDate) return byDate;
      } else if (a.lastPostDate) return -1;
      else if (b.lastPostDate) return 1;
      const byCreated = b.latest.getTime() - a.latest.getTime();
      return byCreated || a.product.id.localeCompare(b.product.id);
    });
    const total = all.length;
    const pageRows = all.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
    const products = await this.prisma.product.findMany({
      where: { id: { in: pageRows.map((row) => row.product.id) } },
      select: {
        id: true, name: true, productCode: true,
        images: { where: { type: 'IMAGE', variantId: null, optionValueId: null }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], take: 1, select: { url: true } },
      },
    });
    const productMap = new Map(products.map((product) => [product.id, product]));
    const items = pageRows.map((row) => {
      const product = productMap.get(row.product.id);
      return {
        product: {
          id: row.product.id,
          name: product?.name ?? row.product.id,
          productCode: product?.productCode ?? null,
          thumbnailUrl: product?.images[0]?.url ?? null,
        },
        recordCount: row.recordCount,
        postCount: row.postCount,
        lastPostDate: row.lastPostDate,
        latestCreatedAt: row.latestCreatedAt,
      };
    });
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async getLink(id: string, account: MarketingAccount) {
    const row = await this.prisma.campaignLink.findUnique({ where: { id }, include: details });
    if (!row) throw new NotFoundException('Campaign link not found.');
    assertVisible(scopeFor(account), row.ownerUserId);
    return this.serialize(row);
  }

  async updateLink(id: string, input: CampaignLinkUpdateInput, account: MarketingAccount) {
    const current = await this.prisma.campaignLink.findUnique({ where: { id }, select: { sourceType: true, ownerUserId: true } });
    if (!current) throw new NotFoundException('Campaign link not found.');
    const scope = scopeFor(account);
    assertVisible(scope, current.ownerUserId);
    assertManage(scope, current.ownerUserId);
    if ((input.postDate !== undefined || input.postUrl !== undefined) && current.sourceType !== 'FB_POST')
      throw new BadRequestException('Post metadata is only editable on Facebook post links.');
    const data: Prisma.CampaignLinkUpdateManyMutationInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.postDate !== undefined) data.postDate = input.postDate === null ? null : postDateToDb(input.postDate);
    if (input.postUrl !== undefined) data.postUrl = input.postUrl || null;
    return this.mutate(id, input.expectedVersion, account, data);
  }

  async disableLink(id: string, expectedVersion: number, account: MarketingAccount) {
    return this.mutate(id, expectedVersion, account, { status: 'DISABLED' });
  }

  async archiveLink(id: string, expectedVersion: number, account: MarketingAccount) {
    return this.setArchived(id, expectedVersion, account, true);
  }

  async unarchiveLink(id: string, expectedVersion: number, account: MarketingAccount) {
    return this.setArchived(id, expectedVersion, account, false);
  }

  private async setArchived(id: string, expectedVersion: number, account: MarketingAccount, archived: boolean) {
    const scope = scopeFor(account);
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.campaignLink.findUnique({ where: { id }, include: details });
      if (!row) throw new NotFoundException('Campaign link not found.');
      assertVisible(scope, row.ownerUserId);
      assertManage(scope, row.ownerUserId);
      if (row.version !== expectedVersion) throw new ConflictException({ code: 'CAMPAIGN_LINK_VERSION_CONFLICT', message: 'The link changed. Reload the saved version.' });
      if ((row.archivedAt !== null) === archived) return this.serialize(row);
      const result = await tx.campaignLink.updateMany({
        where: { id, ownerUserId: row.ownerUserId, version: expectedVersion },
        data: { archivedAt: archived ? new Date() : null, version: { increment: 1 } },
      });
      if (result.count !== 1) throw new ConflictException({ code: 'CAMPAIGN_LINK_VERSION_CONFLICT', message: 'The link changed. Reload the saved version.' });
      return this.serialize((await tx.campaignLink.findUnique({ where: { id }, include: details }))!);
    });
  }

  private async mutate(id: string, expectedVersion: number, account: MarketingAccount, data: Prisma.CampaignLinkUpdateManyMutationInput) {
    const scope = scopeFor(account);
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.campaignLink.findUnique({ where: { id } });
      if (!row) throw new NotFoundException('Campaign link not found.');
      assertVisible(scope, row.ownerUserId); assertManage(scope, row.ownerUserId);
      const result = await tx.campaignLink.updateMany({ where: { id, ownerUserId: row.ownerUserId, version: expectedVersion }, data: { ...data, version: { increment: 1 } } });
      if (result.count !== 1) throw new ConflictException({ code: 'CAMPAIGN_LINK_VERSION_CONFLICT', message: 'The link changed. Reload the saved version.' });
      return this.serialize((await tx.campaignLink.findUnique({ where: { id }, include: details }))!);
    });
  }

  async cloneLink(id: string, input: CampaignLinkCloneInput, account: MarketingAccount) {
    const row = await this.getLink(id, account);
    assertManage(scopeFor(account), row.ownerUserId);
    const sourceType = input.sourceType ?? row.sourceType;
    const postDate = input.postDate === undefined ? null : input.postDate;
    const postUrl = input.postUrl === undefined ? null : input.postUrl;
    return this.mint({
      productId: input.productId ?? row.productId,
      variantId: input.variantId === undefined ? row.variantId : input.variantId,
      landingPageId: input.landingPageId === undefined ? row.landingPageId : input.landingPageId,
      sourceType,
      name: input.name ?? (postDate ? undefined : `${row.name.slice(0, 115)} copy`),
      postDate,
      postUrl,
      ...Object.fromEntries(attributionFields.map((field) => [field, input[field] === undefined ? row[field] : input[field]])),
    }, account, row.ownerUserId);
  }

  async resolveTouch(code: string) {
    const row = await this.prisma.campaignLink.findUnique({ where: { code }, include: details });
    if (!row) return null;
    let disabled = row.status !== 'ACTIVE' || row.owner.status !== 'ACTIVE' || row.owner.optimizerProfile?.status !== 'ACTIVE' || row.product.status !== 'ACTIVE' || Boolean(row.landingPage && (!row.landingPage.publishedContent || effectiveStatus(row.landingPage) !== 'LIVE'));
    if (!disabled && row.variantId) {
      const variant = await this.prisma.productVariant.findUnique({ where: { id: row.variantId }, select: { productId: true, sku: { select: { status: true, price: true } } } });
      disabled = !variant || variant.productId !== row.productId || variant.sku?.status !== 'ACTIVE' || variant.sku.price === null;
    }
    return { ...row, disabled };
  }

  private serialize(row: LinkWithDetails) {
    const { owner, product, landingPage, ...link } = row;
    return {
      ...link,
      postDate: postDateFromDb(row.postDate),
      postUrl: row.postUrl ?? null,
      archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
      aid: row.aidSnapshot,
      ownerName: owner.optimizerProfile?.displayName ?? owner.name,
      productName: product.name,
      productCode: product.productCode,
      productThumbnailUrl: product.images?.[0]?.url ?? null,
      pageName: landingPage?.name ?? null,
      path: linkPath(row),
    };
  }
}
