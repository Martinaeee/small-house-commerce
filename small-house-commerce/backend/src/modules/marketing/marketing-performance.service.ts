import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { effectiveStatus } from '../catalog/landing/landing-page.util.js';
import { assertVisible, scopeFor, type MarketingAccount } from './marketing-access.js';
import type { MarketingPerformanceOptionsQuery, MarketingPerformanceQuery } from './dto/marketing-performance.dto.js';
import { serializeMarketingTotals, performanceChange, type MarketingReportRawRow } from './marketing-report-metrics.js';
import { buildPerformanceBuckets, resolvePerformanceWindow } from './marketing-performance-period.js';
import { performanceAggregateSql, performanceOtherSourcesSql, performancePageVisitsSql, type PerformanceAggregateLevel } from './marketing-performance.sql.js';
import type {
  EffectivePageStatus,
  MarketingPerformanceOptions,
  MarketingPerformanceReport,
  PerformanceAggregateRow,
  PerformanceChange,
  PerformanceChanges,
  PerformancePageInfo,
  PerformancePageRow,
  PerformancePageVisitsRow,
  PerformancePeriodResult,
  PerformancePoint,
  PerformanceReadRange,
  PerformanceSort,
  PerformanceSqlScope,
  PerformanceWindow,
} from './marketing-performance.types.js';

export interface PerformanceAssemblyInput {
  query: MarketingPerformanceQuery;
  window: PerformanceWindow;
  onlyOwn: boolean;
  scopeOwnerUserId: string | null;
  directory: PerformancePageInfo[];
  currentPages: PerformanceAggregateRow[];
  currentTotal: PerformanceAggregateRow | null;
  trendRows: PerformanceAggregateRow[];
  currentPageVisits: PerformancePageVisitsRow[];
  totalPageVisits: bigint;
  trendPageVisits: PerformancePageVisitsRow[];
  previousPages: PerformanceAggregateRow[];
  previousTotal: PerformanceAggregateRow | null;
  previousPageVisits: PerformancePageVisitsRow[];
  previousTotalPageVisits: bigint;
  currentOther: MarketingReportRawRow[];
  previousOther: MarketingReportRawRow[] | null;
  now: Date;
}

const unavailable = (): PerformanceChange => ({ state: 'UNAVAILABLE', absolute: null, percent: null });

function periodResult(range: PerformanceReadRange, raw: PerformanceAggregateRow | null | undefined, pageTotalVisits: number): PerformancePeriodResult {
  if (!raw) return { range: { from: range.from, to: range.to }, registeredLinkCount: 0, totals: null };
  const totals = serializeMarketingTotals(raw);
  totals.pageTotalVisits = pageTotalVisits;
  return { range: { from: range.from, to: range.to }, registeredLinkCount: Number(raw.registeredLinkCount), totals };
}

function buildChanges(current: PerformancePeriodResult, previous: PerformancePeriodResult): PerformanceChanges {
  const c = current.totals;
  const p = previous.totals;
  return {
    visits: performanceChange(c?.visits ?? null, p?.visits ?? null, 0),
    validOrders: performanceChange(c?.validOrders ?? null, p?.validOrders ?? null, 0),
    signedOrders: performanceChange(c?.signedOrders ?? null, p?.signedOrders ?? null, 0),
    spendUsd: c && p && c.costCoverageComplete && p.costCoverageComplete ? performanceChange(c.spendUsd, p.spendUsd, 2) : unavailable(),
    orderCpaUsd: performanceChange(c?.orderCpaUsd ?? null, p?.orderCpaUsd ?? null, 2),
    signedGrossPhp: performanceChange(c?.signedGrossPhp ?? null, p?.signedGrossPhp ?? null, 2),
    signedRoas: performanceChange(c?.signedRoas ?? null, p?.signedRoas ?? null, 2),
    conversionRate: performanceChange(c?.conversionRate ?? null, p?.conversionRate ?? null, 4),
  };
}

function sortValue(row: PerformancePageRow, sortBy: PerformanceSort): string | number | null {
  switch (sortBy) {
    case 'name': return row.name;
    case 'visits': return row.current.totals?.visits ?? null;
    case 'validOrders': return row.current.totals?.validOrders ?? null;
    case 'conversionRate': return row.current.totals?.conversionRate ?? null;
    case 'spendUsd': return row.current.totals?.spendUsd ?? null;
    case 'orderCpaUsd': return row.current.totals?.orderCpaUsd ?? null;
    case 'signedRoas': return row.current.totals?.signedRoas ?? null;
  }
}

function compareRows(sortBy: PerformanceSort, sortDirection: 'asc' | 'desc') {
  const factor = sortDirection === 'asc' ? 1 : -1;
  return (left: PerformancePageRow, right: PerformancePageRow): number => {
    const a = sortValue(left, sortBy);
    const b = sortValue(right, sortBy);
    const tie = left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    if (a === null && b === null) return tie;
    if (a === null) return 1;
    if (b === null) return -1;
    let compared: number;
    if (typeof a === 'number' && typeof b === 'number') compared = a - b;
    else if (sortBy === 'name') compared = String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
    else compared = new Prisma.Decimal(a).cmp(new Prisma.Decimal(b));
    return compared === 0 ? tie : compared * factor;
  };
}

export function assemblePerformanceReport(input: PerformanceAssemblyInput): MarketingPerformanceReport {
  const { query, window, onlyOwn, directory } = input;
  const currentByPage = new Map(input.currentPages.map(row => [row.id, row]));
  const previousByPage = new Map(input.previousPages.map(row => [row.id, row]));
  const currentVisitByPage = new Map(input.currentPageVisits.map(row => [row.id, Number(row.visits)]));
  const previousVisitByPage = new Map(input.previousPageVisits.map(row => [row.id, Number(row.visits)]));

  const rows: PerformancePageRow[] = directory.map(page => {
    const currentRaw = currentByPage.get(page.id);
    const currentVisits = currentVisitByPage.get(page.id) ?? 0;
    const current = periodResult(window.current, currentRaw, currentVisits);
    const previous = window.previous ? periodResult(window.previous, previousByPage.get(page.id), previousVisitByPage.get(page.id) ?? 0) : null;
    const notices: PerformancePageRow['notices'] = [];
    if (page.linkCount === 0) notices.push('NO_LINKS');
    else if (!currentRaw) notices.push('NOT_STARTED');
    if (current.totals) {
      if (current.totals.visits === 0) notices.push('NO_TRAFFIC');
      if (!current.totals.costCoverageComplete) notices.push('COSTS_INCOMPLETE');
    }
    if (page.productStatus !== 'ACTIVE') notices.push('PARENT_INACTIVE');
    return { ...page, pageTotalVisits: currentVisits, current, previous, changes: previous ? buildChanges(current, previous) : null, notices };
  });

  const sorted = [...rows].sort(compareRows(query.sortBy, query.sortDirection));
  const byStatus: Record<EffectivePageStatus, number> = { DRAFT: 0, LIVE: 0, SCHEDULED: 0, ENDED: 0, DISABLED: 0 };
  for (const page of directory) byStatus[page.effectiveStatus] += 1;
  const productGroups = new Map<string, { productId: string; productName: string; productCode: string | null; pageCount: number }>();
  for (const page of directory) {
    const group = productGroups.get(page.productId) ?? { productId: page.productId, productName: page.productName, productCode: page.productCode, pageCount: 0 };
    group.pageCount += 1;
    productGroups.set(page.productId, group);
  }
  const byProduct = [...productGroups.values()].sort((a, b) => a.productName < b.productName ? -1 : a.productName > b.productName ? 1 : a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0);

  const trendByKey = new Map(input.trendRows.map(row => [row.id, row]));
  const trendVisitByKey = new Map(input.trendPageVisits.map(row => [row.id, Number(row.visits)]));
  const points: PerformancePoint[] = buildPerformanceBuckets({ from: window.current.from, to: window.current.to }, query.interval, input.now).map(bucket => {
    const raw = trendByKey.get(bucket.key);
    const totals = raw ? serializeMarketingTotals(raw) : null;
    if (totals) totals.pageTotalVisits = trendVisitByKey.get(bucket.key) ?? 0;
    return { ...bucket, registeredLinkCount: raw ? Number(raw.registeredLinkCount) : 0, totals };
  });

  const current = periodResult(window.current, input.currentTotal, Number(input.totalPageVisits));
  const previous = window.previous ? periodResult(window.previous, input.previousTotal, Number(input.previousTotalPageVisits)) : null;

  return {
    asOf: window.asOf.toISOString(),
    scope: { view: query.view, productId: query.productId ?? null, ownerUserId: input.scopeOwnerUserId, landingPageId: query.landingPageId ?? null, effectiveStatus: query.effectiveStatus ?? null, onlyOwn },
    overview: { total: directory.length, byStatus, byProduct },
    current,
    previous,
    changes: previous ? buildChanges(current, previous) : null,
    page: query.page,
    pageSize: query.pageSize,
    total: sorted.length,
    rows: sorted.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
    trend: { pageId: query.trendPageId ?? null, interval: query.interval, points },
    otherSources: {
      current: input.currentOther.map(row => ({ kind: row.kind as 'DIRECT' | 'LEGACY' | 'UNVERIFIED', totals: serializeMarketingTotals(row) })),
      previous: input.previousOther ? input.previousOther.map(row => ({ kind: row.kind as 'DIRECT' | 'LEGACY' | 'UNVERIFIED', totals: serializeMarketingTotals(row) })) : null,
    },
  };
}

@Injectable()
export class MarketingPerformanceService {
  constructor(private readonly prisma: PrismaService) {}

  async performance(query: MarketingPerformanceQuery, account: MarketingAccount): Promise<MarketingPerformanceReport> {
    const scope = scopeFor(account);
    if (query.ownerUserId) assertVisible(scope, query.ownerUserId);
    if (query.view === 'OPTIMIZER' && scope.all && !query.ownerUserId) throw new BadRequestException('Choose an optimizer for this view.');
    const owner = scope.all ? (query.ownerUserId ?? null) : account.id;
    const now = new Date();
    const window = resolvePerformanceWindow(query, now);
    return this.prisma.$transaction(async tx => {
      const base = await this.loadPages(tx, scope.all ? null : account.id, window.asOf);
      const baseIds = new Set(base.map(page => page.id));
      if (query.landingPageId && !baseIds.has(query.landingPageId)) throw new NotFoundException('Marketing record not found.');
      if (query.trendPageId && !baseIds.has(query.trendPageId)) throw new NotFoundException('Marketing record not found.');
      const directory = base.filter(page =>
        (!owner || page.ownerUserId === owner) &&
        (!query.productId || page.productId === query.productId) &&
        (!query.effectiveStatus || page.effectiveStatus === query.effectiveStatus) &&
        (!query.landingPageId || page.id === query.landingPageId));
      if (query.landingPageId && directory.length === 0) throw new NotFoundException('Marketing record not found.');
      if (query.trendPageId && !directory.some(page => page.id === query.trendPageId)) throw new NotFoundException('Marketing record not found.');

      const sqlScope: PerformanceSqlScope = { pageIds: directory.map(page => page.id), ownerUserId: owner, productId: query.productId ?? null, landingPageId: query.landingPageId ?? null };
      const trendScope: PerformanceSqlScope = query.trendPageId ? { ...sqlScope, pageIds: [query.trendPageId], landingPageId: query.trendPageId } : sqlScope;

      const currentPages = await this.aggregate(tx, sqlScope, window.current, 'PAGE');
      const currentTotal = await this.aggregate(tx, sqlScope, window.current, 'TOTAL');
      const trendRows = await this.aggregate(tx, trendScope, window.current, query.interval);
      const currentPageVisits = await this.pageVisits(tx, sqlScope, window.current, 'PAGE');
      const totalPageVisits = (await this.pageVisits(tx, sqlScope, window.current, 'TOTAL'))[0]?.visits ?? 0n;
      const trendPageVisits = await this.pageVisits(tx, trendScope, window.current, query.interval);
      const currentOther = await this.otherSources(tx, sqlScope, window.current);
      const previousPages = window.previous ? await this.aggregate(tx, sqlScope, window.previous, 'PAGE') : [];
      const previousTotal = window.previous ? (await this.aggregate(tx, sqlScope, window.previous, 'TOTAL'))[0] ?? null : null;
      const previousPageVisits = window.previous ? await this.pageVisits(tx, sqlScope, window.previous, 'PAGE') : [];
      const previousTotalPageVisits = window.previous ? (await this.pageVisits(tx, sqlScope, window.previous, 'TOTAL'))[0]?.visits ?? 0n : 0n;
      const previousOther = window.previous ? await this.otherSources(tx, sqlScope, window.previous) : null;

      return assemblePerformanceReport({
        query, window, onlyOwn: !scope.all, scopeOwnerUserId: owner, directory,
        currentPages, currentTotal: currentTotal[0] ?? null, trendRows,
        currentPageVisits, totalPageVisits, trendPageVisits,
        previousPages, previousTotal, previousPageVisits, previousTotalPageVisits,
        currentOther, previousOther, now,
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async options(query: MarketingPerformanceOptionsQuery, account: MarketingAccount): Promise<MarketingPerformanceOptions> {
    const scope = scopeFor(account);
    if (query.ownerUserId) assertVisible(scope, query.ownerUserId);
    const owner = scope.all ? (query.ownerUserId ?? null) : account.id;
    const pages = await this.prisma.productLandingPage.findMany({
      where: owner ? { ownerUserId: owner } : {},
      select: { productId: true, ownerUserId: true, product: { select: { name: true, productCode: true, status: true } } },
    });
    const productGroups = new Map<string, { id: string; name: string; productCode: string | null; status: string; pageCount: number }>();
    const ownerCounts = new Map<string, number>();
    for (const page of pages) {
      const group = productGroups.get(page.productId) ?? { id: page.productId, name: page.product.name, productCode: page.product.productCode, status: page.product.status, pageCount: 0 };
      group.pageCount += 1;
      productGroups.set(page.productId, group);
      if (page.ownerUserId) ownerCounts.set(page.ownerUserId, (ownerCounts.get(page.ownerUserId) ?? 0) + 1);
    }
    const products = [...productGroups.values()].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    let owners: MarketingPerformanceOptions['owners'] = [];
    if (scope.all) {
      const profiles = await this.prisma.optimizerProfile.findMany({ select: { userId: true, displayName: true, aid: true, status: true }, orderBy: { displayName: 'asc' } });
      const profiled = new Set(profiles.map(profile => profile.userId));
      const missing = [...ownerCounts.keys()].filter(userId => !profiled.has(userId));
      const users = missing.length ? await this.prisma.user.findMany({ where: { id: { in: missing } }, select: { id: true, name: true, status: true } }) : [];
      owners = [
        ...profiles.map(profile => ({ userId: profile.userId, name: profile.displayName, aid: profile.aid, isActive: profile.status === 'ACTIVE', pageCount: ownerCounts.get(profile.userId) ?? 0 })),
        ...users.map(user => ({ userId: user.id, name: user.name, aid: null, isActive: user.status === 'ACTIVE', pageCount: ownerCounts.get(user.id) ?? 0 })),
      ];
    }
    return { onlyOwn: !scope.all, products, owners };
  }

  private async loadPages(tx: Prisma.TransactionClient, ownerUserId: string | null, asOf: Date): Promise<PerformancePageInfo[]> {
    const rows = await tx.productLandingPage.findMany({
      where: ownerUserId ? { ownerUserId } : {},
      select: {
        id: true, name: true, slug: true, productId: true, ownerUserId: true, status: true, startAt: true, endAt: true, createdAt: true,
        product: { select: { name: true, productCode: true, status: true } },
        owner: { select: { name: true, optimizerProfile: { select: { displayName: true, aid: true } } } },
        _count: { select: { campaignLinks: ownerUserId ? { where: { ownerUserId } } : true } },
      },
    });
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      productId: row.productId,
      productName: row.product.name,
      productCode: row.product.productCode,
      productStatus: row.product.status,
      ownerUserId: row.ownerUserId,
      ownerName: row.owner?.optimizerProfile?.displayName ?? row.owner?.name ?? null,
      aid: row.owner?.optimizerProfile?.aid ?? null,
      effectiveStatus: effectiveStatus(row, asOf),
      linkCount: row._count.campaignLinks,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  private async aggregate(tx: Prisma.TransactionClient, scope: PerformanceSqlScope, range: PerformanceReadRange, level: PerformanceAggregateLevel): Promise<PerformanceAggregateRow[]> {
    if (scope.pageIds.length === 0) return [];
    return tx.$queryRaw<PerformanceAggregateRow[]>(performanceAggregateSql(scope, range, level));
  }

  private async pageVisits(tx: Prisma.TransactionClient, scope: PerformanceSqlScope, range: PerformanceReadRange, level: PerformanceAggregateLevel): Promise<PerformancePageVisitsRow[]> {
    if (scope.pageIds.length === 0) return [];
    return tx.$queryRaw<PerformancePageVisitsRow[]>(performancePageVisitsSql(scope, range, level));
  }

  private async otherSources(tx: Prisma.TransactionClient, scope: PerformanceSqlScope, range: PerformanceReadRange): Promise<MarketingReportRawRow[]> {
    return tx.$queryRaw<MarketingReportRawRow[]>(performanceOtherSourcesSql(scope, range));
  }
}
