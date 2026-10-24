import type { TKey } from "@/lib/admin-i18n";
import type { AdminLogisticsEventStatus } from "@/lib/admin-api";

/** Shared labels for the seven normalized carrier states. */
export const LOGISTICS_STATUS_KEYS: Record<AdminLogisticsEventStatus, TKey> = {
  SHIPPED: "orders_logistics_status_shipped",
  IN_TRANSIT: "orders_logistics_status_in_transit",
  OUT_FOR_DELIVERY: "orders_logistics_status_out_for_delivery",
  SIGNED: "orders_logistics_status_signed",
  FAILED_DELIVERY: "orders_logistics_status_failed",
  RETURNING: "orders_logistics_status_returning",
  RETURNED: "orders_logistics_status_returned",
};

export const LOGISTICS_STATUSES = Object.keys(
  LOGISTICS_STATUS_KEYS,
) as AdminLogisticsEventStatus[];
