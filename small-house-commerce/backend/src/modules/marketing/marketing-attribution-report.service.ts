import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { assertVisible, scopeFor, type MarketingAccount } from './marketing-access.js';
import type { MarketingReportQuery } from './dto/marketing-report.dto.js';
import { marketingOrderFactsSql, marketingOrderTotalsSql, verifiedAttributionSql } from './marketing-report-facts.js';
import { serializeMarketingReportRow, type MarketingReportRawRow } from './marketing-report-metrics.js';

/**
 * Attribution-first report dimensions.
 *
 * LINK/PAGE/PRODUCT/OWNER keep the registered-link accounting in
 * MarketingReportService. These two views answer different questions:
 *   - ADID: which Meta ad on a CL link produced the visits and orders.
 *   - AID: which optimizer produced paid touches, including AID-only traffic
 *     that has no campaign link.
 *
 * CL registered visits cannot be split by AdID (campaign_link_visits stores no
 * ad id), so those rows expose `visits = NULL` and never add AdID visits to it.
 */
@Injectable()
export class MarketingAttributionReportService {
  constructor(private readonly prisma: PrismaService) {}

  async report(query: MarketingReportQuery, account: MarketingAccount) {
    const scope = scopeFor(account);
    if (query.ownerUserId) assertVisible(scope, query.ownerUserId);
    const owner = scope.all ? query.ownerUserId ?? null : account.id;
    const from = new Date(new Date(`${query.from}T00:00:00.000Z`).getTime() - 8 * 3600_000);
    const end = new Date(new Date(`${query.to}T00:00:00.000Z`).getTime() + 16 * 3600_000);
    const linkIds = query.linkIds?.map((id) => Prisma.sql`${id}::uuid`);
    const orderWhere = Prisma.sql`(((${verifiedAttributionSql}) AND a.touched_at >= ${from}::timestamptz AND a.touched_at < ${end}::timestamptz)
          OR (NOT COALESCE((${verifiedAttributionSql}), false) AND o.created_at >= ${from}::timestamptz AND o.created_at < ${end}::timestamptz))
          ${owner ? Prisma.sql`AND COALESCE(a.optimizer_id, o.optimizer_id) = ${owner}::uuid` : Prisma.empty}
          ${query.productId ? Prisma.sql`AND COALESCE(a.product_id, p.product_id) = ${query.productId}::uuid` : Prisma.empty}
          ${query.landingPageId ? Prisma.sql`AND a.landing_page_id = ${query.landingPageId}` : Prisma.empty}
          ${linkIds ? Prisma.sql`AND a.link_id IN (${Prisma.join(linkIds)})` : Prisma.empty}`;

    const raw = query.groupBy === 'AID'
      ? await this.aidRows(query, owner, from, end, linkIds, orderWhere)
      : await this.adRows(query, owner, end, linkIds, orderWhere);

    const rows = raw.map((row) => serializeMarketingReportRow(row));
    return {
      from: query.from, to: query.to, groupBy: query.groupBy, mode: query.mode,
      sortBy: query.sortBy, sortDirection: query.sortDirection,
      asOf: new Date().toISOString(), page: query.page, pageSize: query.pageSize,
      total: rows.length,
      rows: rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
      otherSources: [],
    };
  }

  private async adRows(
    query: MarketingReportQuery,
    owner: string | null,
    end: Date,
    linkIds: readonly Prisma.Sql[] | undefined,
    orderWhere: Prisma.Sql,
  ): Promise<MarketingReportRawRow[]> {
    return this.prisma.$queryRaw<MarketingReportRawRow[]>(Prisma.sql`
      WITH scoped_links AS (
        SELECT l.id, l.name AS link_name, l.product_id, l.owner_user_id, l.aid_snapshot, l.adid,
          l.source_type, l.created_at
        FROM campaign_links l
        WHERE l.created_at < ${end}::timestamptz
          ${owner ? Prisma.sql`AND l.owner_user_id = ${owner}::uuid` : Prisma.empty}
          ${query.productId ? Prisma.sql`AND l.product_id = ${query.productId}::uuid` : Prisma.empty}
          ${query.landingPageId ? Prisma.sql`AND l.landing_page_id = ${query.landingPageId}::uuid` : Prisma.empty}
          ${linkIds ? Prisma.sql`AND l.id IN (${Prisma.join(linkIds)})` : Prisma.empty}
      ), ad_events AS (
        SELECT e.campaign_link_id AS link_id, e.ad_id,
          COALESCE(e.optimizer_id, s.owner_user_id) AS optimizer_id,
          COALESCE(e.aid_snapshot, s.aid_snapshot) AS aid_snapshot,
          COUNT(DISTINCT (e.session_id, e.event_day)) FILTER (WHERE e.event_name IN ('PAGE_VIEW','PRODUCT_VIEW')) AS ad_visits,
          COUNT(*) FILTER (WHERE e.event_name = 'PRODUCT_VIEW') AS product_views,
          COUNT(*) FILTER (WHERE e.event_name = 'ADD_TO_CART') AS add_to_carts,
          COUNT(*) FILTER (WHERE e.event_name = 'BEGIN_CHECKOUT') AS checkouts,
          MAX(e.ad_id_source) AS ad_id_source,
          MAX(e.ad_id_missing_reason) AS ad_id_missing_reason
        FROM analytics_events e JOIN scoped_links s ON s.id = e.campaign_link_id
        WHERE e.event_day BETWEEN ${query.from}::date AND ${query.to}::date
        GROUP BY 1, 2, 3, 4
      ), order_facts AS (
        ${marketingOrderFactsSql(orderWhere)}
      ), ad_orders AS (
        SELECT f.link_id, f.ad_id,
          COALESCE(f.optimizer_id, s.owner_user_id) AS optimizer_id,
          COALESCE(f.aid_snapshot, s.aid_snapshot) AS aid_snapshot,
          MAX(f.adid) AS adid, MAX(f.adid_source) AS adid_source,
          MAX(f.adid_missing_reason) AS adid_missing_reason,
          ${marketingOrderTotalsSql}
        FROM order_facts f JOIN scoped_links s ON s.id = f.link_id
        WHERE f.kind = 'REGISTERED'
        GROUP BY f.link_id, f.ad_id,
          COALESCE(f.optimizer_id, s.owner_user_id),
          COALESCE(f.aid_snapshot, s.aid_snapshot)
      ), ad_keys AS (
        SELECT link_id, ad_id, optimizer_id, aid_snapshot FROM ad_events
        UNION
        SELECT link_id, ad_id, optimizer_id, aid_snapshot FROM ad_orders
      )
      SELECT 'REGISTERED'::text AS kind,
        s.id::text || ':' || COALESCE(k.ad_id, 'NO_ADID') AS id,
        COALESCE(k.ad_id, 'Unidentified AdID') AS label,
        s.link_name AS "linkName",
        COALESCE(k.optimizer_id, s.owner_user_id)::text AS "ownerUserId",
        COALESCE(op.display_name, u.name) AS "ownerName",
        COALESCE(k.aid_snapshot, s.aid_snapshot) AS aid,
        s.product_id::text AS "productId", product.name AS "productName", product.product_code AS "productCode",
        NULL::text AS "landingPageId", s.source_type::text AS "sourceType",
        NULL::date AS "postDate", NULL::text AS "postUrl", NULL::timestamptz AS "archivedAt",
        s.created_at AS "createdAt",
        NULL::bigint AS visits, NULL::bigint AS "pageTotalVisits",
        COALESCE(e.add_to_carts, 0) AS "addToCarts", COALESCE(e.checkouts, 0) AS checkouts,
        k.ad_id AS "adId", e.ad_id_source AS "adIdSource",
        COALESCE(e.ad_id_missing_reason, o.adid_missing_reason) AS "adIdMissingReason",
        COALESCE(e.ad_visits, 0) AS "adVisits", COALESCE(e.product_views, 0) AS "productViews",
        NULL::bigint AS "linkCount", NULL::bigint AS "adCount",
        COALESCE(o."submittedOrders", 0) AS "submittedOrders", COALESCE(o."validOrders", 0) AS "validOrders",
        COALESCE(o."confirmedOrders", 0) AS "confirmedOrders", COALESCE(o."signedOrders", 0) AS "signedOrders",
        COALESCE(o."validOrderValuePhp", 0) AS "validOrderValuePhp", COALESCE(o."signedGrossPhp", 0) AS "signedGrossPhp",
        COALESCE(o."duplicateOrders", 0) AS "duplicateOrders", COALESCE(o."riskOrders", 0) AS "riskOrders",
        COALESCE(o."afterSalesOrders", 0) AS "afterSalesOrders", COALESCE(o."refundStatusOrders", 0) AS "refundStatusOrders",
        0::numeric AS "spendUsd", 0::numeric AS "spendPhp",
        0::bigint AS "expectedCostDays", 0::bigint AS "recordedCostDays"
      FROM ad_keys k
      JOIN scoped_links s ON s.id = k.link_id
      LEFT JOIN ad_events e ON e.link_id = k.link_id AND e.ad_id IS NOT DISTINCT FROM k.ad_id
        AND e.optimizer_id IS NOT DISTINCT FROM k.optimizer_id AND e.aid_snapshot IS NOT DISTINCT FROM k.aid_snapshot
      LEFT JOIN ad_orders o ON o.link_id = k.link_id AND o.ad_id IS NOT DISTINCT FROM k.ad_id
        AND o.optimizer_id IS NOT DISTINCT FROM k.optimizer_id AND o.aid_snapshot IS NOT DISTINCT FROM k.aid_snapshot
      JOIN products product ON product.id = s.product_id
      JOIN users u ON u.id = COALESCE(k.optimizer_id, s.owner_user_id)
      LEFT JOIN optimizer_profiles op ON op.user_id = u.id
      ORDER BY "ownerName", s.link_name, k.ad_id NULLS LAST
    `);
  }

  private async aidRows(
    query: MarketingReportQuery,
    owner: string | null,
    from: Date,
    end: Date,
    linkIds: readonly Prisma.Sql[] | undefined,
    orderWhere: Prisma.Sql,
  ): Promise<MarketingReportRawRow[]> {
    return this.prisma.$queryRaw<MarketingReportRawRow[]>(Prisma.sql`
      WITH order_facts AS (
        ${marketingOrderFactsSql(orderWhere)}
      ), aid_events AS (
        SELECT e.optimizer_id, e.aid_snapshot,
          COUNT(DISTINCT (e.session_id, e.event_day)) FILTER (WHERE e.event_name IN ('PAGE_VIEW','PRODUCT_VIEW')) AS ad_visits,
          COUNT(*) FILTER (WHERE e.event_name = 'PRODUCT_VIEW') AS product_views,
          COUNT(*) FILTER (WHERE e.event_name = 'ADD_TO_CART') AS add_to_carts,
          COUNT(*) FILTER (WHERE e.event_name = 'BEGIN_CHECKOUT') AS checkouts
        FROM analytics_events e
        WHERE e.event_day BETWEEN ${query.from}::date AND ${query.to}::date
          AND e.optimizer_id IS NOT NULL AND e.attribution_paid = true
          ${owner ? Prisma.sql`AND e.optimizer_id = ${owner}::uuid` : Prisma.empty}
          ${query.productId ? Prisma.sql`AND e.product_id = ${query.productId}::uuid` : Prisma.empty}
          ${linkIds ? Prisma.sql`AND e.campaign_link_id IN (${Prisma.join(linkIds)})` : Prisma.empty}
        GROUP BY 1, 2
      ), aid_orders AS (
        SELECT f.optimizer_id, f.aid_snapshot, ${marketingOrderTotalsSql}
        FROM order_facts f
        WHERE f.kind = 'REGISTERED' AND f.optimizer_id IS NOT NULL
        GROUP BY f.optimizer_id, f.aid_snapshot
      ), aid_keys AS (
        SELECT optimizer_id, aid_snapshot FROM aid_events
        UNION
        SELECT optimizer_id, aid_snapshot FROM aid_orders
      ), aid_link_keys AS (
        SELECT DISTINCT e.optimizer_id, e.aid_snapshot, e.campaign_link_id AS link_id
        FROM analytics_events e
        WHERE e.event_day BETWEEN ${query.from}::date AND ${query.to}::date
          AND e.optimizer_id IS NOT NULL AND e.attribution_paid = true AND e.campaign_link_id IS NOT NULL
          ${owner ? Prisma.sql`AND e.optimizer_id = ${owner}::uuid` : Prisma.empty}
          ${query.productId ? Prisma.sql`AND e.product_id = ${query.productId}::uuid` : Prisma.empty}
          ${linkIds ? Prisma.sql`AND e.campaign_link_id IN (${Prisma.join(linkIds)})` : Prisma.empty}
        UNION
        SELECT DISTINCT f.optimizer_id, f.aid_snapshot, f.link_id
        FROM order_facts f
        WHERE f.kind = 'REGISTERED' AND f.optimizer_id IS NOT NULL AND f.link_id IS NOT NULL
      ), aid_ad_keys AS (
        SELECT DISTINCT e.optimizer_id, e.aid_snapshot, e.ad_id
        FROM analytics_events e
        WHERE e.event_day BETWEEN ${query.from}::date AND ${query.to}::date
          AND e.optimizer_id IS NOT NULL AND e.attribution_paid = true AND e.ad_id IS NOT NULL
          ${owner ? Prisma.sql`AND e.optimizer_id = ${owner}::uuid` : Prisma.empty}
          ${query.productId ? Prisma.sql`AND e.product_id = ${query.productId}::uuid` : Prisma.empty}
          ${linkIds ? Prisma.sql`AND e.campaign_link_id IN (${Prisma.join(linkIds)})` : Prisma.empty}
        UNION
        SELECT DISTINCT f.optimizer_id, f.aid_snapshot, f.ad_id
        FROM order_facts f
        WHERE f.kind = 'REGISTERED' AND f.optimizer_id IS NOT NULL AND f.ad_id IS NOT NULL
      ), aid_links AS (
        SELECT optimizer_id, aid_snapshot, COUNT(*) AS link_count
        FROM aid_link_keys GROUP BY 1, 2
      ), aid_ads AS (
        SELECT optimizer_id, aid_snapshot, COUNT(*) AS ad_count
        FROM aid_ad_keys GROUP BY 1, 2
      )
      SELECT 'REGISTERED'::text AS kind,
        k.optimizer_id::text AS id,
        COALESCE(op.display_name, u.name) AS label,
        NULL::text AS "linkName",
        k.optimizer_id::text AS "ownerUserId",
        COALESCE(op.display_name, u.name) AS "ownerName",
        k.aid_snapshot AS aid,
        NULL::text AS "productId", NULL::text AS "productName", NULL::text AS "productCode",
        NULL::text AS "landingPageId", NULL::text AS "sourceType",
        NULL::date AS "postDate", NULL::text AS "postUrl", NULL::timestamptz AS "archivedAt",
        NULL::timestamptz AS "createdAt",
        NULL::bigint AS visits, NULL::bigint AS "pageTotalVisits",
        COALESCE(e.add_to_carts, 0) AS "addToCarts", COALESCE(e.checkouts, 0) AS checkouts,
        NULL::text AS "adId", NULL::text AS "adIdSource", NULL::text AS "adIdMissingReason",
        COALESCE(e.ad_visits, 0) AS "adVisits", COALESCE(e.product_views, 0) AS "productViews",
        COALESCE(l.link_count, 0) AS "linkCount", COALESCE(a.ad_count, 0) AS "adCount",
        COALESCE(o."submittedOrders", 0) AS "submittedOrders", COALESCE(o."validOrders", 0) AS "validOrders",
        COALESCE(o."confirmedOrders", 0) AS "confirmedOrders", COALESCE(o."signedOrders", 0) AS "signedOrders",
        COALESCE(o."validOrderValuePhp", 0) AS "validOrderValuePhp", COALESCE(o."signedGrossPhp", 0) AS "signedGrossPhp",
        COALESCE(o."duplicateOrders", 0) AS "duplicateOrders", COALESCE(o."riskOrders", 0) AS "riskOrders",
        COALESCE(o."afterSalesOrders", 0) AS "afterSalesOrders", COALESCE(o."refundStatusOrders", 0) AS "refundStatusOrders",
        0::numeric AS "spendUsd", 0::numeric AS "spendPhp",
        0::bigint AS "expectedCostDays", 0::bigint AS "recordedCostDays"
      FROM aid_keys k
      LEFT JOIN aid_events e ON e.optimizer_id = k.optimizer_id AND e.aid_snapshot IS NOT DISTINCT FROM k.aid_snapshot
      LEFT JOIN aid_links l ON l.optimizer_id = k.optimizer_id AND l.aid_snapshot IS NOT DISTINCT FROM k.aid_snapshot
      LEFT JOIN aid_ads a ON a.optimizer_id = k.optimizer_id AND a.aid_snapshot IS NOT DISTINCT FROM k.aid_snapshot
      LEFT JOIN aid_orders o ON o.optimizer_id = k.optimizer_id AND o.aid_snapshot IS NOT DISTINCT FROM k.aid_snapshot
      JOIN users u ON u.id = k.optimizer_id
      LEFT JOIN optimizer_profiles op ON op.user_id = u.id
      ORDER BY "ownerName", k.aid_snapshot NULLS LAST
    `);
  }
}
