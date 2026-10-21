import { Prisma } from '../../generated/prisma/client.js';

/**
 * Shared order "fact" predicates.
 *
 * One definition each, used by the marketing report and the admin dashboard,
 * so a signed rate in one surface can never disagree with the other.
 *
 * Signed (DATABASE.md §69/§71): an order counts as signed when it has at
 * least one shipment AND every shipment is SIGNED with a signed timestamp.
 * A partially signed order is still SHIPPING (one order may have many
 * shipments — never assume one tracking number per order).
 *
 * Confirmed: the operator confirmed the order, either via `confirmed_at` or
 * via a CONFIRMATION_STATUS history entry (both are written by the confirm
 * flow, and old rows only have the history).
 */
export const validOrderSql = Prisma.sql`o.order_status NOT IN ('CANCELLED','DENIED')`;

export const confirmedOrderSql = Prisma.sql`(
  o.confirmed_at IS NOT NULL
  OR EXISTS (
    SELECT 1 FROM order_status_history h
    WHERE h.order_id = o.id
      AND h.status_domain = 'CONFIRMATION_STATUS'
      AND h.new_status = 'CONFIRMED'
  )
)`;

export const shippedOrderSql = Prisma.sql`EXISTS (SELECT 1 FROM shipments sh WHERE sh.order_id = o.id)`;

export const signedOrderSql = Prisma.sql`(
  ${shippedOrderSql}
  AND NOT EXISTS (
    SELECT 1 FROM shipments sh
    WHERE sh.order_id = o.id AND (sh.status <> 'SIGNED' OR sh.signed_at IS NULL)
  )
)`;

export const refundStatusOrderSql = Prisma.sql`o.payment_status IN ('REFUNDED','PARTIALLY_REFUNDED')`;

export const afterSalesOrderSql = Prisma.sql`o.order_status = 'AFTER_SALES'`;
