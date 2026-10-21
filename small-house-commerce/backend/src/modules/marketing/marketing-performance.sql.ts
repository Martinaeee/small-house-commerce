import { Prisma } from '../../generated/prisma/client.js';
import { marketingOrderFactsSql, marketingOrderTotalsSql, verifiedAttributionSql } from './marketing-report-facts.js';
import type { PerformanceReadRange, PerformanceSqlScope } from './marketing-performance.types.js';

export type PerformanceAggregateLevel = 'PAGE' | 'TOTAL' | 'DAY' | 'WEEK';

const scopedPagesSql = (pageIds: string[]): Prisma.Sql => Prisma.sql`scoped_pages AS (
  SELECT p.id FROM product_landing_pages p WHERE p.id IN (${Prisma.join(pageIds.map(id => Prisma.sql`${id}::uuid`))})
)`;

const scopedLinksSql = (scope: PerformanceSqlScope, range: PerformanceReadRange): Prisma.Sql => Prisma.sql`scoped_links AS (
  SELECT l.id, l.landing_page_id, l.created_at FROM campaign_links l
  JOIN scoped_pages p ON p.id = l.landing_page_id
  WHERE l.created_at < ${range.endAt}::timestamptz
    ${scope.ownerUserId ? Prisma.sql`AND l.owner_user_id = ${scope.ownerUserId}::uuid` : Prisma.empty}
)`;

const orderWhereSql = (scope: PerformanceSqlScope, range: PerformanceReadRange): Prisma.Sql => Prisma.sql`
  (((${verifiedAttributionSql}) AND a.touched_at >= ${range.startAt}::timestamptz AND a.touched_at < ${range.endAt}::timestamptz)
    OR (NOT COALESCE((${verifiedAttributionSql}), false) AND o.created_at >= ${range.startAt}::timestamptz AND o.created_at < ${range.endAt}::timestamptz))
  ${scope.ownerUserId ? Prisma.sql`AND COALESCE(a.optimizer_id, o.optimizer_id) = ${scope.ownerUserId}::uuid` : Prisma.empty}
  ${scope.productId ? Prisma.sql`AND COALESCE(a.product_id, p.product_id) = ${scope.productId}::uuid` : Prisma.empty}
  ${scope.landingPageId ? Prisma.sql`AND a.landing_page_id = ${scope.landingPageId}` : Prisma.empty}`;

const pageKey = Prisma.sql`l.landing_page_id::text`;
const allKey = Prisma.sql`'ALL'`;

const bucketKey = (column: Prisma.Sql, level: PerformanceAggregateLevel): Prisma.Sql =>
  level === 'DAY' ? Prisma.sql`${column}::text` : Prisma.sql`(date_trunc('week', ${column})::date)::text`;

const dateKey = (column: Prisma.Sql, level: PerformanceAggregateLevel): Prisma.Sql =>
  level === 'PAGE' ? pageKey : level === 'TOTAL' ? allKey : bucketKey(column, level);

export function performanceAggregateSql(scope: PerformanceSqlScope, range: PerformanceReadRange, level: PerformanceAggregateLevel): Prisma.Sql {
  const linkKeys = Prisma.sql`SELECT ${level === 'PAGE' ? pageKey : level === 'TOTAL' ? allKey : bucketKey(Prisma.sql`d::date`, level)} AS key, COUNT(DISTINCT l.id) AS "registeredLinkCount", COUNT(*) AS "expectedCostDays"
        FROM scoped_links l CROSS JOIN LATERAL generate_series(GREATEST(${range.from}::date, (l.created_at AT TIME ZONE 'Asia/Manila')::date), ${range.to}::date, INTERVAL '1 day') d GROUP BY 1`;
  return Prisma.sql`
    WITH ${scopedPagesSql(scope.pageIds)}, ${scopedLinksSql(scope, range)},
    link_keys AS (${linkKeys}),
    visits AS (
      SELECT ${dateKey(Prisma.sql`v.visit_day`, level)} AS key, COUNT(DISTINCT (v.visit_key, v.visit_day)) AS visits
      FROM campaign_link_visits v JOIN scoped_links l ON l.id = v.link_id
      WHERE v.visit_day BETWEEN ${range.from}::date AND ${range.to}::date GROUP BY 1
    ),
    expenses AS (
      SELECT ${dateKey(Prisma.sql`c.cost_date`, level)} AS key, SUM(c.amount_usd) AS "spendUsd", SUM(c.amount_php) AS "spendPhp", COUNT(*) AS "recordedCostDays"
      FROM cost_entries c JOIN scoped_links l ON l.id = c.link_id
      WHERE c.voided_at IS NULL AND c.cost_date BETWEEN ${range.from}::date AND ${range.to}::date GROUP BY 1
    ),
    order_facts AS (${marketingOrderFactsSql(orderWhereSql(scope, range))}),
    registered_orders AS (
      SELECT ${dateKey(Prisma.sql`f."cohortDay"`, level)} AS key, ${marketingOrderTotalsSql}
      FROM order_facts f JOIN scoped_links l ON l.id = f.link_id WHERE f.kind = 'REGISTERED' GROUP BY 1
    )
    SELECT k.key AS id, k.key AS label, 'REGISTERED' AS kind, k."registeredLinkCount", k."expectedCostDays",
      COALESCE(v.visits, 0) AS visits,
      COALESCE(o."submittedOrders", 0) AS "submittedOrders", COALESCE(o."validOrders", 0) AS "validOrders", COALESCE(o."confirmedOrders", 0) AS "confirmedOrders", COALESCE(o."signedOrders", 0) AS "signedOrders",
      COALESCE(o."validOrderValuePhp", 0) AS "validOrderValuePhp", COALESCE(o."signedGrossPhp", 0) AS "signedGrossPhp",
      COALESCE(e."spendUsd", 0) AS "spendUsd", COALESCE(e."spendPhp", 0) AS "spendPhp", COALESCE(e."recordedCostDays", 0) AS "recordedCostDays",
      COALESCE(o."duplicateOrders", 0) AS "duplicateOrders", COALESCE(o."riskOrders", 0) AS "riskOrders", COALESCE(o."afterSalesOrders", 0) AS "afterSalesOrders", COALESCE(o."refundStatusOrders", 0) AS "refundStatusOrders"
    FROM link_keys k
    LEFT JOIN visits v ON v.key = k.key
    LEFT JOIN expenses e ON e.key = k.key
    LEFT JOIN registered_orders o ON o.key = k.key
    ORDER BY k.key`;
}

export function performancePageVisitsSql(scope: PerformanceSqlScope, range: PerformanceReadRange, level: PerformanceAggregateLevel): Prisma.Sql {
  const key = level === 'PAGE' ? Prisma.sql`v.landing_page_id::text` : level === 'TOTAL' ? allKey : bucketKey(Prisma.sql`v.visit_day`, level);
  return Prisma.sql`
    WITH ${scopedPagesSql(scope.pageIds)}
    SELECT ${key} AS id, COUNT(DISTINCT (v.visit_key, v.visit_day)) AS visits
    FROM landing_page_visits v JOIN scoped_pages p ON p.id = v.landing_page_id
    WHERE v.visit_day BETWEEN ${range.from}::date AND ${range.to}::date
    GROUP BY 1`;
}

export function performanceOtherSourcesSql(scope: PerformanceSqlScope, range: PerformanceReadRange): Prisma.Sql {
  return Prisma.sql`
    WITH order_facts AS (${marketingOrderFactsSql(orderWhereSql(scope, range))})
    SELECT f.kind AS kind, f.kind AS id, f.kind AS label, NULL::bigint AS visits, NULL::bigint AS "pageTotalVisits",
      ${marketingOrderTotalsSql},
      0::numeric AS "spendUsd", 0::numeric AS "spendPhp", 0::bigint AS "expectedCostDays", 0::bigint AS "recordedCostDays"
    FROM order_facts f WHERE f.kind <> 'REGISTERED' GROUP BY f.kind
    ORDER BY f.kind`;
}
