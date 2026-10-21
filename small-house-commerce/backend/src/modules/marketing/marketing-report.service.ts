import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { assertVisible, scopeFor, type MarketingAccount } from './marketing-access.js';
import type { MarketingReportQuery } from './dto/marketing-report.dto.js';
import { marketingOrderFactsSql, marketingOrderTotalsSql, verifiedAttributionSql } from './marketing-report-facts.js';
import { serializeMarketingReportRow, type MarketingReportRawRow } from './marketing-report-metrics.js';

@Injectable()
export class MarketingReportService {
  constructor(private readonly prisma: PrismaService) {}

  async report(query: MarketingReportQuery, account: MarketingAccount) {
    const scope = scopeFor(account);
    if (query.ownerUserId) assertVisible(scope, query.ownerUserId);
    if (query.linkIds) {
      const ids = [...new Set(query.linkIds)];
      const visible = await this.prisma.campaignLink.findMany({ where: { id: { in: ids }, ...(scope.all ? {} : { ownerUserId: account.id }) }, select: { id: true } });
      if (visible.length !== ids.length) throw new NotFoundException('Marketing record not found.');
    }
    const owner = scope.all ? query.ownerUserId : account.id;
    const from = new Date(new Date(`${query.from}T00:00:00.000Z`).getTime() - 8 * 3600_000);
    const end = new Date(new Date(`${query.to}T00:00:00.000Z`).getTime() + 16 * 3600_000);
    const ids = query.linkIds?.map(id => Prisma.sql`${id}::uuid`);
    const groupKey = { LINK: Prisma.sql`l.id::text`, PAGE: Prisma.sql`COALESCE(l.landing_page_id::text, 'PRODUCT:' || l.product_id::text)`, PRODUCT: Prisma.sql`l.product_id::text`, OWNER: Prisma.sql`l.owner_user_id::text` }[query.groupBy];
    const groupLabel = { LINK: Prisma.sql`s.name`, PAGE: Prisma.sql`COALESCE(s.page_name, s.product_name)`, PRODUCT: Prisma.sql`s.product_name`, OWNER: Prisma.sql`s.owner_name` }[query.groupBy];
    const orderWhere = Prisma.sql`(((${verifiedAttributionSql}) AND a.touched_at >= ${from}::timestamptz AND a.touched_at < ${end}::timestamptz)
          OR (NOT COALESCE((${verifiedAttributionSql}), false) AND o.created_at >= ${from}::timestamptz AND o.created_at < ${end}::timestamptz))
          ${owner ? Prisma.sql`AND COALESCE(a.optimizer_id, o.optimizer_id) = ${owner}::uuid` : Prisma.empty}
          ${query.productId ? Prisma.sql`AND COALESCE(a.product_id, p.product_id) = ${query.productId}::uuid` : Prisma.empty}
          ${query.landingPageId ? Prisma.sql`AND a.landing_page_id = ${query.landingPageId}` : Prisma.empty}
          ${ids ? Prisma.sql`AND a.link_id IN (${Prisma.join(ids)})` : Prisma.empty}`;
    const rows = await this.prisma.$queryRaw<MarketingReportRawRow[]>(Prisma.sql`
      WITH scoped_links AS (
        SELECT l.*, ${groupKey} AS group_key, p.name AS page_name,
          product.name AS product_name, product.product_code,
          COALESCE(op.display_name, u.name) AS owner_name
        FROM campaign_links l JOIN products product ON product.id = l.product_id
        JOIN users u ON u.id = l.owner_user_id LEFT JOIN optimizer_profiles op ON op.user_id = u.id
        LEFT JOIN product_landing_pages p ON p.id = l.landing_page_id
        WHERE l.created_at < ${end}::timestamptz
          ${owner ? Prisma.sql`AND l.owner_user_id = ${owner}::uuid` : Prisma.empty}
          ${query.productId ? Prisma.sql`AND l.product_id = ${query.productId}::uuid` : Prisma.empty}
          ${query.landingPageId ? Prisma.sql`AND l.landing_page_id = ${query.landingPageId}::uuid` : Prisma.empty}
          ${ids ? Prisma.sql`AND l.id IN (${Prisma.join(ids)})` : Prisma.empty}
      ), groups AS (
        SELECT s.group_key AS id, MIN(${groupLabel}) AS label,
          CASE WHEN COUNT(DISTINCT s.owner_user_id) = 1 THEN MIN(s.owner_user_id::text) END AS "ownerUserId",
          CASE WHEN COUNT(DISTINCT s.owner_user_id) = 1 THEN MIN(s.owner_name) END AS "ownerName",
          CASE WHEN COUNT(DISTINCT s.aid_snapshot) = 1 THEN MIN(s.aid_snapshot) END AS aid,
          CASE WHEN COUNT(DISTINCT s.product_id) = 1 THEN MIN(s.product_id::text) END AS "productId",
          CASE WHEN COUNT(DISTINCT s.product_id) = 1 THEN MIN(s.product_name) END AS "productName",
          CASE WHEN COUNT(DISTINCT s.product_id) = 1 THEN MIN(s.product_code) END AS "productCode",
          CASE WHEN COUNT(DISTINCT s.landing_page_id) = 1 THEN MIN(s.landing_page_id::text) END AS "landingPageId"
        FROM scoped_links s GROUP BY s.group_key
      ), visits AS (
        SELECT s.group_key, COUNT(DISTINCT (v.visit_key, v.visit_day)) AS count
        FROM campaign_link_visits v JOIN scoped_links s ON s.id = v.link_id
        WHERE v.visit_day BETWEEN ${query.from}::date AND ${query.to}::date GROUP BY s.group_key
      ), page_visits AS (
        SELECT p.id::text AS id, COUNT(DISTINCT (v.visit_key, v.visit_day)) FILTER (WHERE v.id IS NOT NULL) AS count
        FROM product_landing_pages p LEFT JOIN landing_page_visits v ON v.landing_page_id = p.id AND v.visit_day BETWEEN ${query.from}::date AND ${query.to}::date
        WHERE p.id IN (SELECT landing_page_id FROM scoped_links)
          ${owner ? Prisma.sql`AND p.owner_user_id = ${owner}::uuid` : Prisma.empty}
        GROUP BY p.id
      ), expenses AS (
        SELECT s.group_key, SUM(c.amount_usd) AS usd, SUM(c.amount_php) AS php, COUNT(*) AS recorded
        FROM cost_entries c JOIN scoped_links s ON s.id = c.link_id
        WHERE c.voided_at IS NULL AND c.cost_date BETWEEN ${query.from}::date AND ${query.to}::date GROUP BY s.group_key
      ), coverage AS (
        SELECT s.group_key, COUNT(*) AS expected
        FROM scoped_links s CROSS JOIN LATERAL generate_series(GREATEST(${query.from}::date, (s.created_at AT TIME ZONE 'Asia/Manila')::date), ${query.to}::date, INTERVAL '1 day') d
        GROUP BY s.group_key
      ), order_facts AS (
        ${marketingOrderFactsSql(orderWhere)}
      ), registered_orders AS (
        SELECT s.group_key, ${marketingOrderTotalsSql}
        FROM order_facts f JOIN scoped_links s ON s.id = f.link_id WHERE f.kind = 'REGISTERED' GROUP BY s.group_key
      ), other_orders AS (
        SELECT f.kind, ${marketingOrderTotalsSql}
        FROM order_facts f WHERE f.kind <> 'REGISTERED' GROUP BY f.kind
      )
      SELECT 'REGISTERED' AS kind, g.id, g.label, g."ownerUserId", g."ownerName", g.aid, g."productId", g."productName", g."productCode", g."landingPageId",
        COALESCE(v.count, 0) AS visits, ${query.groupBy === 'PAGE' ? Prisma.sql`pv.count` : Prisma.sql`NULL::bigint`} AS "pageTotalVisits",
        COALESCE(o."submittedOrders", 0) AS "submittedOrders", COALESCE(o."validOrders", 0) AS "validOrders", COALESCE(o."confirmedOrders", 0) AS "confirmedOrders", COALESCE(o."signedOrders", 0) AS "signedOrders",
        COALESCE(o."validOrderValuePhp", 0) AS "validOrderValuePhp", COALESCE(o."signedGrossPhp", 0) AS "signedGrossPhp",
        COALESCE(e.usd, 0) AS "spendUsd", COALESCE(e.php, 0) AS "spendPhp", COALESCE(c.expected, 0) AS "expectedCostDays", COALESCE(e.recorded, 0) AS "recordedCostDays",
        COALESCE(o."duplicateOrders", 0) AS "duplicateOrders", COALESCE(o."riskOrders", 0) AS "riskOrders", COALESCE(o."afterSalesOrders", 0) AS "afterSalesOrders", COALESCE(o."refundStatusOrders", 0) AS "refundStatusOrders"
      FROM groups g LEFT JOIN visits v ON v.group_key = g.id LEFT JOIN page_visits pv ON pv.id = g.id
      LEFT JOIN expenses e ON e.group_key = g.id LEFT JOIN coverage c ON c.group_key = g.id LEFT JOIN registered_orders o ON o.group_key = g.id
      UNION ALL
      SELECT o.kind, o.kind, o.kind, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::bigint, NULL::bigint,
        o."submittedOrders", o."validOrders", o."confirmedOrders", o."signedOrders", o."validOrderValuePhp", o."signedGrossPhp", 0::numeric, 0::numeric, 0::bigint, 0::bigint,
        o."duplicateOrders", o."riskOrders", o."afterSalesOrders", o."refundStatusOrders"
      FROM other_orders o
      ORDER BY kind, label, id
    `);
    const registered = rows.filter(row => row.kind === 'REGISTERED');
    return { from: query.from, to: query.to, groupBy: query.groupBy, asOf: new Date().toISOString(), page: query.page, pageSize: query.pageSize, total: registered.length,
      rows: registered.slice((query.page - 1) * query.pageSize, query.page * query.pageSize).map(serializeMarketingReportRow), otherSources: rows.filter(row => row.kind !== 'REGISTERED').map(serializeMarketingReportRow) };
  }
}
