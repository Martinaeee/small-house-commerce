import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type AdCostEntry } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CampaignLinksService } from './campaign-links.service.js';
import { assertManage, assertVisible, scopeFor, type MarketingAccount } from './marketing-access.js';
import { manilaVisitDay } from './marketing-attribution.js';
import type { AdCostInput, AdCostQuery } from './dto/ad-cost.dto.js';

const details = {
  link: { select: { code: true, name: true, aidSnapshot: true, productId: true, landingPageId: true, product: { select: { name: true, productCode: true } }, owner: { select: { name: true, optimizerProfile: { select: { displayName: true } } } } } },
} satisfies Prisma.AdCostEntryInclude;
type CostWithDetails = Prisma.AdCostEntryGetPayload<{ include: typeof details }>;

function snapshot(row: AdCostEntry) {
  return {
    id: row.id, linkId: row.linkId, ownerUserId: row.ownerUserId, costDate: row.costDate.toISOString().slice(0, 10),
    amountUsd: row.amountUsd.toFixed(2), phpPerUsd: row.phpPerUsd?.toFixed(6) ?? null, amountPhp: row.amountPhp.toFixed(2),
    note: row.note, voidedAt: row.voidedAt?.toISOString() ?? null, version: row.version,
  };
}

function conflict() {
  return new ConflictException({ code: 'AD_COST_VERSION_CONFLICT', message: 'The daily expense already exists or changed. Reload the saved version.' });
}

@Injectable()
export class AdCostsService {
  constructor(private readonly prisma: PrismaService, private readonly links: CampaignLinksService) {}

  async upsertCost(input: AdCostInput, account: MarketingAccount) {
    const scope = scopeFor(account);
    const link = await this.links.getLink(input.linkId, account);
    assertManage(scope, link.ownerUserId);
    const costDate = new Date(`${input.costDate}T00:00:00.000Z`);
    if (costDate < manilaVisitDay(link.createdAt) || costDate > manilaVisitDay(new Date())) throw new BadRequestException('Expense date must be between link creation and Manila today.');
    const amountUsd = new Prisma.Decimal(input.amountUsd);
    const phpPerUsd = input.phpPerUsd === undefined || input.phpPerUsd === null ? null : new Prisma.Decimal(input.phpPerUsd);
    if (amountUsd.gt(0) && (!phpPerUsd || phpPerUsd.lte(0))) throw new BadRequestException('Positive expense requires a positive PHP per USD rate.');
    const amountPhp = amountUsd.mul(phpPerUsd ?? 0).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    if (amountPhp.gt('999999999999.99')) throw new BadRequestException('Converted PHP expense exceeds the supported amount.');

    try {
      return await this.prisma.$transaction(async (tx) => {
        const previous = await tx.adCostEntry.findUnique({ where: { linkId_costDate: { linkId: link.id, costDate } } });
        if (previous) {
          if (input.expectedVersion === undefined || input.expectedVersion !== previous.version) throw conflict();
          const result = await tx.adCostEntry.updateMany({ where: { id: previous.id, ownerUserId: link.ownerUserId, version: input.expectedVersion }, data: { amountUsd, phpPerUsd, amountPhp, note: input.note === undefined ? previous.note : input.note, voidedAt: null, updatedById: account.id, version: { increment: 1 } } });
          if (result.count !== 1) throw conflict();
        } else {
          if (input.expectedVersion !== undefined) throw conflict();
          await tx.adCostEntry.create({ data: { linkId: link.id, ownerUserId: link.ownerUserId, costDate, amountUsd, phpPerUsd, amountPhp, note: input.note ?? null, costType: 'ADS_COST', entrySource: 'MANUAL', currency: 'USD', createdById: account.id, updatedById: account.id } });
        }
        const row = (await tx.adCostEntry.findUnique({ where: { linkId_costDate: { linkId: link.id, costDate } }, include: details }))!;
        await tx.adCostAudit.create({ data: { costEntryId: row.id, actorUserId: account.id, action: previous ? 'UPDATE' : 'CREATE', before: previous ? snapshot(previous) : Prisma.DbNull, after: snapshot(row) } });
        return this.serialize(row);
      });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') throw conflict();
      throw error;
    }
  }

  async voidCost(id: string, expectedVersion: number, account: MarketingAccount) {
    const scope = scopeFor(account);
    return this.prisma.$transaction(async (tx) => {
      const previous = await tx.adCostEntry.findUnique({ where: { id }, include: details });
      if (!previous) throw new NotFoundException('Expense not found.');
      assertVisible(scope, previous.ownerUserId); assertManage(scope, previous.ownerUserId);
      if (previous.version !== expectedVersion) throw conflict();
      if (previous.voidedAt) return this.serialize(previous);
      const result = await tx.adCostEntry.updateMany({ where: { id, ownerUserId: previous.ownerUserId, version: expectedVersion }, data: { voidedAt: new Date(), updatedById: account.id, version: { increment: 1 } } });
      if (result.count !== 1) throw conflict();
      const row = (await tx.adCostEntry.findUnique({ where: { id }, include: details }))!;
      await tx.adCostAudit.create({ data: { costEntryId: id, actorUserId: account.id, action: 'VOID', before: snapshot(previous), after: snapshot(row) } });
      return this.serialize(row);
    });
  }

  async listCosts(query: AdCostQuery, account: MarketingAccount) {
    const scope = scopeFor(account);
    const where: Prisma.AdCostEntryWhereInput = scope.all ? {} : { ownerUserId: account.id };
    if (query.ownerUserId) { assertVisible(scope, query.ownerUserId); where.ownerUserId = query.ownerUserId; }
    if (query.linkId) where.linkId = query.linkId;
    if (query.productId || query.landingPageId) where.link = { ...(query.productId ? { productId: query.productId } : {}), ...(query.landingPageId ? { landingPageId: query.landingPageId } : {}) };
    if (!query.includeVoided) where.voidedAt = null;
    if (query.dateFrom || query.dateTo) where.costDate = { ...(query.dateFrom ? { gte: new Date(`${query.dateFrom}T00:00:00Z`) } : {}), ...(query.dateTo ? { lte: new Date(`${query.dateTo}T00:00:00Z`) } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.adCostEntry.findMany({ where, include: details, orderBy: [{ costDate: 'desc' }, { createdAt: 'desc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.adCostEntry.count({ where }),
    ]);
    return { items: rows.map((row) => this.serialize(row)), total, page: query.page, pageSize: query.pageSize };
  }

  async auditHistory(id: string, account: MarketingAccount) {
    const row = await this.prisma.adCostEntry.findUnique({ where: { id }, select: { ownerUserId: true } });
    if (!row) throw new NotFoundException('Expense not found.');
    assertVisible(scopeFor(account), row.ownerUserId);
    return this.prisma.adCostAudit.findMany({ where: { costEntryId: id }, select: { id: true, actorUserId: true, actor: { select: { name: true } }, action: true, before: true, after: true, createdAt: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  }

  private serialize(row: CostWithDetails) {
    const { link, ...entry } = row;
    return { ...entry, ...snapshot(row), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), linkCode: link.code, linkName: link.name, aid: link.aidSnapshot, ownerName: link.owner.optimizerProfile?.displayName ?? link.owner.name, productId: link.productId, productName: link.product.name, productCode: link.product.productCode, landingPageId: link.landingPageId };
  }
}
