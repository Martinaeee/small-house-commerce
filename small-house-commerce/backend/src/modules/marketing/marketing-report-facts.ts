import { Prisma } from '../../generated/prisma/client.js';

export const verifiedAttributionSql = Prisma.sql`a.touched_at IS NOT NULL AND a.legacy IS NOT NULL`;

export const marketingOrderTotalsSql = Prisma.sql`
  COUNT(*) AS "submittedOrders",
  COUNT(*) FILTER (WHERE f.valid) AS "validOrders",
  COUNT(*) FILTER (WHERE f.valid AND f.confirmed) AS "confirmedOrders",
  COUNT(*) FILTER (WHERE f.signed) AS "signedOrders",
  COALESCE(SUM(f.grand_total) FILTER (WHERE f.valid), 0) AS "validOrderValuePhp",
  COALESCE(SUM(f.grand_total) FILTER (WHERE f.signed), 0) AS "signedGrossPhp",
  COUNT(*) FILTER (WHERE f.duplicate) AS "duplicateOrders",
  COUNT(*) FILTER (WHERE f.risk) AS "riskOrders",
  COUNT(*) FILTER (WHERE f.after_sales) AS "afterSalesOrders",
  COUNT(*) FILTER (WHERE f.refund_status) AS "refundStatusOrders"`;

export function marketingOrderFactsSql(where: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    SELECT o.id, o.grand_total, a.link_id, a.optimizer_id, a.aid_snapshot, a.owner_name_snapshot,
      COALESCE(a.product_id, p.product_id) AS product_id, a.product_name_snapshot, a.product_code_snapshot, a.landing_page_id,
      CASE WHEN ${verifiedAttributionSql} THEN CASE WHEN a.link_id IS NOT NULL AND a.legacy = false THEN 'REGISTERED' WHEN a.legacy THEN 'LEGACY' ELSE 'DIRECT' END ELSE 'UNVERIFIED' END AS kind,
      (CASE WHEN ${verifiedAttributionSql} THEN (a.touched_at AT TIME ZONE 'Asia/Manila')::date ELSE (o.created_at AT TIME ZONE 'Asia/Manila')::date END) AS "cohortDay",
      o.order_status NOT IN ('CANCELLED', 'DENIED') AS valid,
      (o.confirmed_at IS NOT NULL OR EXISTS (SELECT 1 FROM order_status_history h WHERE h.order_id = o.id AND h.status_domain = 'CONFIRMATION_STATUS' AND h.new_status = 'CONFIRMED')) AS confirmed,
      (EXISTS (SELECT 1 FROM shipments sh WHERE sh.order_id = o.id) AND NOT EXISTS (SELECT 1 FROM shipments sh WHERE sh.order_id = o.id AND (sh.status <> 'SIGNED' OR sh.signed_at IS NULL))) AS signed,
      EXISTS (SELECT 1 FROM order_risk_flags r WHERE r.order_id = o.id AND r.flag_type = 'POSSIBLE_DUPLICATE') AS duplicate,
      o.customer_classification IN ('RPT', 'RECHECK') AS risk,
      o.order_status = 'AFTER_SALES' AS after_sales,
      o.payment_status IN ('REFUNDED', 'PARTIALLY_REFUNDED') AS refund_status
    FROM orders o LEFT JOIN order_attributions a ON a.order_id = o.id
    LEFT JOIN product_landing_pages p ON p.id::text = a.landing_page_id
    WHERE ${where}`;
}
