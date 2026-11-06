import { Prisma } from '../../generated/prisma/client.js';
import { funnelWindow } from './marketing-funnel-metrics.js';
export interface FunnelScopeQuery {from:string;to:string;traffic:'ALL'|'ADS'|'ORGANIC';productId?:string}

/** Scope at the event, not at the product: two owners may promote one product. */
export function funnelFacts(q:FunnelScopeQuery, owner:string|null):Prisma.Sql {
  const w=funnelWindow(q.from,q.to);
  return Prisma.sql`
    ev AS (
      SELECT e.*, l.source_type::text AS source_type
      FROM analytics_events e LEFT JOIN campaign_links l ON l.id=e.campaign_link_id
      WHERE e.event_day BETWEEN ${q.from}::date AND ${q.to}::date
        ${owner ? Prisma.sql`AND l.owner_user_id=${owner}::uuid` : Prisma.empty}
        ${q.traffic==='ADS' ? Prisma.sql`AND e.campaign_link_id IS NOT NULL` : q.traffic==='ORGANIC' ? Prisma.sql`AND e.campaign_link_id IS NULL` : Prisma.empty}
    ), event_facts AS (
      SELECT DISTINCT e.id::text AS id, subject.product_id, e.session_id, e.event_name::text AS stage,
        e.event_day AS day, e.created_at AS at, e.device_type, e.page_path, e.campaign_link_id,
        CASE WHEN e.campaign_link_id IS NULL THEN 'ORGANIC'
          WHEN e.source_type='FB_POST' THEN 'FACEBOOK_POST'
          WHEN e.source_type='META_AD' THEN 'META_AD' ELSE 'OTHER' END AS source,
        e.metadata
      FROM ev e CROSS JOIN LATERAL (
        SELECT e.product_id WHERE e.product_id IS NOT NULL AND e.event_name IN ('PRODUCT_VIEW','ADD_TO_CART')
        UNION
        SELECT p.id FROM products p WHERE e.event_name='PAGE_VIEW' AND p.status='ACTIVE'
          AND (e.page_path='/products/'||p.slug OR e.page_path='/products/'||p.slug||'/')
        UNION
        SELECT lp.product_id FROM product_landing_pages lp WHERE e.event_name='PAGE_VIEW'
          AND (e.page_path='/lp/'||lp.slug OR e.page_path='/lp/'||lp.slug||'/')
        UNION
        SELECT s.product_id FROM skus s WHERE e.event_name IN ('BEGIN_CHECKOUT','CHECKOUT_SUBMIT_ATTEMPT','CHECKOUT_SUBMIT_FAILED')
          AND s.id::text IN (SELECT jsonb_array_elements_text(
            CASE WHEN jsonb_typeof(e.metadata->'skuIds')='array' THEN e.metadata->'skuIds'
              ELSE to_jsonb(string_to_array(coalesce(e.entity_id,''),',')) END))
      ) subject(product_id)
      WHERE subject.product_id IS NOT NULL
        ${q.productId ? Prisma.sql`AND subject.product_id=${q.productId}::uuid` : Prisma.empty}
    ), order_facts AS (
      SELECT DISTINCT 'order:'||o.id::text AS id, oi.product_id,
        coalesce(o.tracking_session_id,'order:'||o.id::text) AS session_id, 'ORDER'::text AS stage,
        (o.created_at AT TIME ZONE 'Asia/Manila')::date AS day, o.created_at AS at,
        'unknown'::text AS device_type, '/order-success/'||o.order_number AS page_path,
        a.link_id AS campaign_link_id,
        CASE WHEN a.link_id IS NULL THEN 'ORGANIC' WHEN l.source_type='FB_POST' THEN 'FACEBOOK_POST'
          WHEN l.source_type='META_AD' THEN 'META_AD' ELSE 'OTHER' END AS source, NULL::jsonb AS metadata
      FROM orders o JOIN order_items oi ON oi.order_id=o.id
      LEFT JOIN order_attributions a ON a.order_id=o.id LEFT JOIN campaign_links l ON l.id=a.link_id
      WHERE o.created_at>=${w.from} AND o.created_at<${w.end} AND oi.product_id IS NOT NULL
        ${owner ? Prisma.sql`AND l.owner_user_id=${owner}::uuid` : Prisma.empty}
        ${q.traffic==='ADS' ? Prisma.sql`AND a.link_id IS NOT NULL` : q.traffic==='ORGANIC' ? Prisma.sql`AND a.link_id IS NULL` : Prisma.empty}
        ${q.productId ? Prisma.sql`AND oi.product_id=${q.productId}::uuid` : Prisma.empty}
    ), facts AS (SELECT * FROM event_facts UNION ALL SELECT * FROM order_facts)
  `;
}

export interface FunnelCounts {
  productId:string; day:string|null; visits:bigint; views:bigint; addToCarts:bigint; checkouts:bigint;
  attempts:bigint; failures:bigint; orders:bigint; orderingSessions:bigint;
  viewHits:bigint; cartHits:bigint; checkoutHits:bigint; attemptHits:bigint; failureHits:bigint; orderHits:bigint;
}
/** Counts and rates use session intersections; Buy Now may skip the cart. */
export function funnelCountsSql(q:FunnelScopeQuery,owner:string|null):Prisma.Sql {
  return Prisma.sql`WITH ${funnelFacts(q,owner)},
    sessions AS (
      SELECT product_id, session_id, day,
        bool_or(stage='PAGE_VIEW') AS visit, bool_or(stage='PRODUCT_VIEW') AS view,
        bool_or(stage='ADD_TO_CART') AS cart, bool_or(stage='BEGIN_CHECKOUT') AS checkout,
        bool_or(stage='CHECKOUT_SUBMIT_ATTEMPT') AS attempt, bool_or(stage='CHECKOUT_SUBMIT_FAILED') AS failure,
        bool_or(stage='ORDER') AS ordered
      FROM facts GROUP BY GROUPING SETS ((product_id,session_id),(product_id,session_id,day))
    ), orders_count AS (
      SELECT product_id,day,count(DISTINCT id) AS n FROM order_facts
      GROUP BY GROUPING SETS ((product_id),(product_id,day))
    )
    SELECT s.product_id::text AS "productId", s.day::text AS day,
      count(*) FILTER(WHERE visit) AS visits, count(*) FILTER(WHERE view) AS views,
      count(*) FILTER(WHERE cart) AS "addToCarts", count(*) FILTER(WHERE checkout) AS checkouts,
      count(*) FILTER(WHERE attempt) AS attempts, count(*) FILTER(WHERE failure) AS failures,
      coalesce(max(o.n),0) AS orders, count(*) FILTER(WHERE ordered) AS "orderingSessions",
      count(*) FILTER(WHERE visit AND view) AS "viewHits", count(*) FILTER(WHERE view AND cart) AS "cartHits",
      count(*) FILTER(WHERE cart AND checkout) AS "checkoutHits", count(*) FILTER(WHERE checkout AND attempt) AS "attemptHits",
      count(*) FILTER(WHERE attempt AND failure) AS "failureHits", count(*) FILTER(WHERE visit AND ordered) AS "orderHits"
    FROM sessions s LEFT JOIN orders_count o ON o.product_id=s.product_id AND o.day IS NOT DISTINCT FROM s.day
    GROUP BY s.product_id,s.day`;
}
