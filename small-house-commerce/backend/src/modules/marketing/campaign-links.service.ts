import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { effectiveStatus } from '../catalog/landing/landing-page.util.js';
import { assertManage, assertVisible, scopeFor, type MarketingAccount } from './marketing-access.js';
import { OptimizersService } from './optimizers.service.js';
import type { CampaignLinkCloneInput, CampaignLinkCreateInput, CampaignLinkQuery, CampaignLinkUpdateInput } from './dto/campaign-link.dto.js';

const details = {
  product: { select: { name: true, productCode: true, slug: true, status: true } },
  landingPage: { select: { name: true, slug: true, status: true, publishedContent: true, publishedRevision: true, startAt: true, endAt: true } },
  owner: { select: { name: true, status: true, optimizerProfile: { select: { displayName: true, status: true } } } },
} satisfies Prisma.CampaignLinkInclude;
type LinkWithDetails = Prisma.CampaignLinkGetPayload<{ include: typeof details }>;
const attributionFields = ['campaignId', 'adsetId', 'adId', 'utmSource', 'utmMedium', 'utmCampaign', 'utmContent', 'utmTerm'] as const;

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
    const product = await this.prisma.product.findUnique({ where: { id: input.productId }, select: { id: true, status: true } });
    if (!product || product.status !== 'ACTIVE') throw new BadRequestException('The parent product must be active.');
    const variant = input.variantId ? await this.prisma.productVariant.findUnique({ where: { id: input.variantId }, select: { productId: true, name: true, sku: { select: { status: true, price: true } } } }) : null;
    if (input.variantId && (!variant || variant.productId !== input.productId || variant.sku?.status !== 'ACTIVE' || variant.sku.price === null))
      throw new BadRequestException('The target variant is not available for this product.');
    const profile = await this.optimizers.ensureProfileForUser(ownerUserId);
    const row = await this.prisma.campaignLink.create({
      data: {
        code: randomBytes(12).toString('base64url'), ownerUserId, aidSnapshot: profile.aid,
        productId: input.productId, variantId: input.variantId ?? null, variantNameSnapshot: variant?.name ?? null,
        landingPageId: input.landingPageId ?? null, name: input.name, sourceType: input.sourceType,
        ...Object.fromEntries(attributionFields.map((field) => [field, input[field] || null])),
      },
      include: details,
    });
    return this.serialize(row);
  }

  async listLinks(query: CampaignLinkQuery, account: MarketingAccount) {
    const scope = scopeFor(account);
    const where: Prisma.CampaignLinkWhereInput = scope.all ? {} : { ownerUserId: account.id };
    if (query.ownerUserId) { assertVisible(scope, query.ownerUserId); where.ownerUserId = query.ownerUserId; }
    if (query.productId) where.productId = query.productId;
    if (query.landingPageId) where.landingPageId = query.landingPageId;
    if (query.status) where.status = query.status;
    if (query.search) where.OR = [{ name: { contains: query.search, mode: 'insensitive' } }, { aidSnapshot: { contains: query.search, mode: 'insensitive' } }, { adId: { contains: query.search, mode: 'insensitive' } }, { code: { contains: query.search } }];
    const [rows, total] = await Promise.all([
      this.prisma.campaignLink.findMany({ where, include: details, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.campaignLink.count({ where }),
    ]);
    return { items: rows.map((row) => this.serialize(row)), total, page: query.page, pageSize: query.pageSize };
  }

  async getLink(id: string, account: MarketingAccount) {
    const row = await this.prisma.campaignLink.findUnique({ where: { id }, include: details });
    if (!row) throw new NotFoundException('Campaign link not found.');
    assertVisible(scopeFor(account), row.ownerUserId);
    return this.serialize(row);
  }

  async updateLink(id: string, input: CampaignLinkUpdateInput, account: MarketingAccount) {
    return this.mutate(id, input.expectedVersion, account, { name: input.name });
  }

  async disableLink(id: string, expectedVersion: number, account: MarketingAccount) {
    return this.mutate(id, expectedVersion, account, { status: 'DISABLED' });
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
    return this.mint({
      productId: input.productId ?? row.productId,
      variantId: input.variantId === undefined ? row.variantId : input.variantId,
      landingPageId: input.landingPageId === undefined ? row.landingPageId : input.landingPageId,
      sourceType: input.sourceType ?? row.sourceType,
      name: input.name ?? `${row.name.slice(0, 115)} copy`,
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
    return { ...link, aid: row.aidSnapshot, ownerName: owner.optimizerProfile?.displayName ?? owner.name, productName: product.name, productCode: product.productCode, pageName: landingPage?.name ?? null, path: linkPath(row) };
  }
}
