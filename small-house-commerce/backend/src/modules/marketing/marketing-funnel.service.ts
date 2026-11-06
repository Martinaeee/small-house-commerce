import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  assertVisible,
  scopeFor,
  type MarketingAccount,
} from './marketing-access.js';
import type {
  MarketingFunnelQuery,
  MarketingFunnelSessionsQuery,
} from './dto/marketing-funnel.dto.js';
import {
  funnelCountsSql,
  funnelFacts,
  type FunnelCounts,
} from './marketing-funnel.sql.js';
import {
  shiftDay,
  stepMetric,
  type FunnelStepKey,
} from './marketing-funnel-metrics.js';
import {
  checkoutMetadata,
  funnelReasons,
} from '../analytics/checkout-metadata.js';

const numberCounts = (r: FunnelCounts) =>
  Object.fromEntries(
    Object.entries(r).map(([k, v]) => [
      k,
      typeof v === 'bigint' ? Number(v) : v,
    ]),
  ) as unknown as NumericCounts;
type NumericCounts = {
  [K in keyof FunnelCounts]: FunnelCounts[K] extends bigint
    ? number
    : FunnelCounts[K];
};
const metrics = [
  ['VIEW', 'viewHits', 'visits'],
  ['ADD_TO_CART', 'cartHits', 'views'],
  ['CHECKOUT', 'checkoutHits', 'addToCarts'],
  ['ATTEMPT', 'attemptHits', 'checkouts'],
  ['FAILURE', 'failureHits', 'attempts'],
  ['ORDER', 'orderHits', 'visits'],
] as const;

@Injectable()
export class MarketingFunnelService {
  constructor(private readonly prisma: PrismaService) {}
  private owner(
    q: { ownerUserId?: string },
    account: MarketingAccount,
  ): string | null {
    const scope = scopeFor(account);
    if (q.ownerUserId) assertVisible(scope, q.ownerUserId);
    return scope.all ? (q.ownerUserId ?? null) : account.id;
  }
  async funnel(q: MarketingFunnelQuery, account: MarketingAccount) {
    const owner = this.owner(q, account);
    const baselineFrom = shiftDay(q.from, -7),
      baselineTo = shiftDay(q.from, -1);
    const [current, baseline] = await Promise.all([
      this.prisma.$queryRaw<FunnelCounts[]>(funnelCountsSql(q, owner)),
      this.prisma.$queryRaw<FunnelCounts[]>(
        funnelCountsSql({ ...q, from: baselineFrom, to: baselineTo }, owner),
      ),
    ]);
    const totals = current.filter((r) => r.day === null).map(numberCounts);
    const history = baseline.filter((r) => r.day !== null).map(numberCounts);
    const ids = totals.map((r) => r.productId);
    const products = ids.length
      ? await this.prisma.$queryRaw<
          Array<{
            productId: string;
            productName: string;
            productCode: string | null;
            thumbnailUrl: string | null;
          }>
        >(Prisma.sql`
      SELECT p.id::text AS "productId",p.name AS "productName",p.product_code AS "productCode",
        (SELECT i.url FROM product_images i WHERE i.product_id=p.id AND i.option_value_id IS NULL AND i.variant_id IS NULL ORDER BY i.sort_order,i.id LIMIT 1) AS "thumbnailUrl"
      FROM products p WHERE p.id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
        ${q.q ? Prisma.sql`AND (p.name ILIKE ${'%' + q.q + '%'} OR p.product_code ILIKE ${'%' + q.q + '%'} OR EXISTS(SELECT 1 FROM skus k WHERE k.product_id=p.id AND k.sku_code ILIKE ${'%' + q.q + '%'}))` : Prisma.empty}`)
      : [];
    const reasons = ids.length ? await this.breakdown(q, owner, 'reason') : [];
    let rows = products.map((p) => {
      const c = totals.find((r) => r.productId === p.productId)!;
      const days = history.filter((r) => r.productId === p.productId);
      const steps = metrics.map(([key, hit, base]) =>
        stepMetric(
          key,
          c[hit],
          c[base],
          days.filter((d) => d[base] > 0).map((d) => d[hit] / d[base]),
        ),
      );
      const failureReasons = Object.fromEntries(
        funnelReasons.map((reason) => [
          reason,
          Number(
            reasons.find(
              (r) => r.productId === p.productId && r.label === reason,
            )?.n ?? 0,
          ),
        ]),
      );
      return {
        ...p,
        visits: c.visits,
        views: c.views,
        addToCarts: c.addToCarts,
        checkouts: c.checkouts,
        attempts: c.attempts,
        failures: c.failures,
        orders: c.orders,
        orderingSessions: c.orderingSessions,
        conversion: steps.find((s) => s.key === 'ORDER')!.rate,
        steps,
        failureReasons,
      };
    });
    if (q.onlyAnomaly === 'true')
      rows = rows.filter((r) => r.steps.some((s) => s.flagged));
    const stepSort: Partial<
      Record<MarketingFunnelQuery['sort'], FunnelStepKey>
    > = {
      ADD_TO_CART_RATE: 'ADD_TO_CART',
      CHECKOUT_RATE: 'CHECKOUT',
      SUBMIT_RATE: 'ATTEMPT',
      FAILURE_RATE: 'FAILURE',
    };
    rows.sort((a, b) => {
      if (q.sort === 'ORDER_COUNT')
        return (
          b.orders - a.orders || a.productName.localeCompare(b.productName)
        );
      if (q.sort === 'VISITS')
        return (
          b.visits - a.visits || a.productName.localeCompare(b.productName)
        );
      const rate = (r: typeof a) =>
        q.sort === 'CONVERSION'
          ? r.conversion
          : (r.steps.find((s) => s.key === stepSort[q.sort])?.rate ?? null);
      const ar = rate(a),
        br = rate(b);
      return ar === null
        ? br === null
          ? 0
          : 1
        : br === null
          ? -1
          : q.sort === 'FAILURE_RATE'
            ? br - ar
            : ar - br;
    });
    return {
      from: q.from,
      to: q.to,
      traffic: q.traffic,
      ownerUserId: owner,
      baselineFrom,
      baselineTo,
      asOf: new Date().toISOString(),
      page: q.page,
      pageSize: q.pageSize,
      total: rows.length,
      rows: rows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize),
    };
  }
  private async breakdown(
    q: MarketingFunnelQuery,
    owner: string | null,
    dimension: 'reason' | 'device' | 'source' | 'message',
  ) {
    const label =
      dimension === 'reason'
        ? Prisma.sql`CASE WHEN metadata->>'reason' IN ('VALIDATION','STOCK','NETWORK','SERVER') THEN metadata->>'reason' ELSE 'UNKNOWN' END`
        : dimension === 'device'
          ? Prisma.sql`device_type`
          : dimension === 'source'
            ? Prisma.sql`source`
            : Prisma.sql`left(metadata->>'message',200)`;
    return this.prisma.$queryRaw<
      Array<{ productId: string; label: string; n: bigint }>
    >(Prisma.sql`
      WITH ${funnelFacts(q, owner)} SELECT product_id::text AS "productId",${label} AS label,
        count(DISTINCT session_id) AS n FROM event_facts WHERE stage='CHECKOUT_SUBMIT_FAILED'
      GROUP BY product_id,label ORDER BY n DESC`);
  }
  async detail(
    productId: string,
    q: MarketingFunnelQuery,
    account: MarketingAccount,
  ) {
    const owner = this.owner(q, account),
      scoped = {
        ...q,
        productId,
        page: 1,
        pageSize: 200,
        onlyAnomaly: 'false' as const,
        q: undefined,
      };
    const [report, counts, reasons, devices, sources, messages] =
      await Promise.all([
        this.funnel(scoped, account),
        this.prisma.$queryRaw<FunnelCounts[]>(funnelCountsSql(scoped, owner)),
        this.breakdown(scoped, owner, 'reason'),
        this.breakdown(scoped, owner, 'device'),
        this.breakdown(scoped, owner, 'source'),
        this.breakdown(scoped, owner, 'message'),
      ]);
    if (!report.rows.length)
      throw new NotFoundException('Marketing record not found.');
    const serialize = (rows: typeof reasons) =>
      rows
        .filter((r) => r.label)
        .map((r) => ({ label: r.label, count: Number(r.n) }));
    return {
      product: report.rows[0],
      baselineFrom: report.baselineFrom,
      baselineTo: report.baselineTo,
      daily: counts
        .filter((r) => r.day !== null)
        .map(numberCounts)
        .sort((a, b) => a.day!.localeCompare(b.day!)),
      reasons: serialize(reasons),
      devices: serialize(devices),
      sources: serialize(sources),
      messages: serialize(messages).slice(0, 3),
    };
  }
  async sessions(q: MarketingFunnelSessionsQuery, account: MarketingAccount) {
    const owner = this.owner(q, account);
    let cursor: { at: string; id: string } | null = null;
    if (q.cursor) {
      try {
        cursor = JSON.parse(
          Buffer.from(q.cursor, 'base64url').toString('utf8'),
        );
      } catch {
        throw new BadRequestException('Invalid cursor');
      }
      if (
        !cursor ||
        !/^\d{4}-\d\d-\d\dT/.test(cursor.at) ||
        !Number.isFinite(Date.parse(cursor.at)) ||
        typeof cursor.id !== 'string' ||
        cursor.id.length > 100
      )
        throw new BadRequestException('Invalid cursor');
    }
    const candidates = await this.prisma.$queryRaw<
      Array<{ sessionId: string; lastAt: Date }>
    >(Prisma.sql`
      WITH ${funnelFacts(q, owner)}, candidates AS (
        SELECT session_id,max(at) AS last_at FROM facts
        WHERE TRUE
          ${q.device ? Prisma.sql`AND device_type=${q.device}` : Prisma.empty}
          ${q.source ? Prisma.sql`AND source=${q.source}` : Prisma.empty}
          ${q.reason ? Prisma.sql`AND stage='CHECKOUT_SUBMIT_FAILED' AND coalesce(metadata->>'reason','UNKNOWN')=${q.reason}` : Prisma.empty}
        GROUP BY session_id
        ${q.onlyFailures === 'true' ? Prisma.sql`HAVING bool_or(stage='CHECKOUT_SUBMIT_FAILED')` : Prisma.empty}
      ) SELECT session_id AS "sessionId",last_at AS "lastAt" FROM candidates
      ${cursor ? Prisma.sql`WHERE (last_at,session_id)<(${new Date(cursor.at)},${cursor.id})` : Prisma.empty}
      ORDER BY last_at DESC,session_id DESC LIMIT 51`);
    const selected = candidates.slice(0, 50);
    if (!selected.length) return { items: [], nextCursor: null };
    const events = await this.prisma.$queryRaw<
      Array<{
        sessionId: string;
        eventName: string;
        at: Date;
        pagePath: string;
        device: string;
        source: string;
        metadata: unknown;
      }>
    >(Prisma.sql`
      WITH ${funnelFacts(q, owner)}
      SELECT session_id AS "sessionId",stage AS "eventName",at,page_path AS "pagePath",device_type AS device,source,metadata
      FROM facts WHERE session_id IN (${Prisma.join(selected.map((s) => s.sessionId))})
      UNION ALL
      SELECT e.session_id,e.event_name::text,e.created_at,e.page_path,e.device_type,
        CASE WHEN e.campaign_link_id IS NULL THEN 'ORGANIC' WHEN e.source_type='FB_POST' THEN 'FACEBOOK_POST' WHEN e.source_type='META_AD' THEN 'META_AD' ELSE 'OTHER' END,NULL::jsonb
      FROM ev e WHERE e.event_name='PAGE_VIEW' AND e.page_path LIKE '/checkout%'
        AND e.session_id IN (${Prisma.join(selected.map((s) => s.sessionId))})
      ORDER BY at ASC`);
    const items = selected.map((s) => {
      const timeline = events.filter((e) => e.sessionId === s.sessionId);
      return {
        sessionId: s.sessionId,
        lastAt: s.lastAt.toISOString(),
        startedAt: timeline[0]?.at.toISOString(),
        entryPath: timeline[0]?.pagePath,
        device:
          timeline.find((e) => e.device !== 'unknown')?.device ?? 'unknown',
        source: timeline[0]?.source ?? 'ORGANIC',
        events: timeline.map((e) => ({
          eventName: e.eventName,
          at: e.at.toISOString(),
          pagePath: e.pagePath,
          ...(e.eventName.startsWith('CHECKOUT_SUBMIT_')
            ? { diagnostic: checkoutMetadata(e.eventName, e.metadata) }
            : {}),
        })),
      };
    });
    const last = selected.at(-1)!;
    return {
      items,
      nextCursor:
        candidates.length > 50
          ? Buffer.from(
              JSON.stringify({
                at: last.lastAt.toISOString(),
                id: last.sessionId,
              }),
            ).toString('base64url')
          : null,
    };
  }
}
