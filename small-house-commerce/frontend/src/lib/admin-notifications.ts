export const ADMIN_NOTIFICATION_HREFS = {
  ORDER_NEEDS_REVIEW: "/admin/orders?confirmation=NEEDS_REVIEW",
  ORDER_UNCONFIRMED: "/admin/orders?confirmation=UNCONFIRMED",
  PRODUCT_MISSING_MEDIA: "/admin/products?attention=missing_media",
  PRODUCT_NO_PRICED_SKU: "/admin/products?attention=no_priced_sku",
  PRODUCT_INCOMPLETE_SHIPPING:
    "/admin/products?attention=incomplete_shipping",
  PRODUCT_STALE_DRAFT: "/admin/products?attention=stale_draft",
} as const;

export type AdminNotificationKind = keyof typeof ADMIN_NOTIFICATION_HREFS;

export interface AdminNotificationItem {
  kind: AdminNotificationKind;
  count: number;
  href: (typeof ADMIN_NOTIFICATION_HREFS)[AdminNotificationKind];
}

export interface AdminNotificationsResponse {
  totalCount: number;
  items: AdminNotificationItem[];
}

const INVALID_RESPONSE = "Invalid admin notifications response";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNotificationKind(value: unknown): value is AdminNotificationKind {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(ADMIN_NOTIFICATION_HREFS, value)
  );
}

function invalidResponse(): never {
  throw new Error(INVALID_RESPONSE);
}

export function adminNotificationHref(
  item: AdminNotificationItem,
): string | null {
  if (!isNotificationKind(item.kind)) return null;

  const href = ADMIN_NOTIFICATION_HREFS[item.kind];
  return item.href === href ? href : null;
}

export function parseAdminNotificationsResponse(
  value: unknown,
): AdminNotificationsResponse {
  if (!isRecord(value) || !Array.isArray(value.items)) invalidResponse();
  if (
    !Number.isInteger(value.totalCount) ||
    (value.totalCount as number) < 0
  ) {
    invalidResponse();
  }

  const seen = new Set<AdminNotificationKind>();
  const items = value.items.map((rawItem) => {
    if (!isRecord(rawItem) || !isNotificationKind(rawItem.kind)) {
      invalidResponse();
    }
    if (
      !Number.isInteger(rawItem.count) ||
      (rawItem.count as number) < 0 ||
      seen.has(rawItem.kind)
    ) {
      invalidResponse();
    }

    const href = ADMIN_NOTIFICATION_HREFS[rawItem.kind];
    if (rawItem.href !== href) invalidResponse();

    seen.add(rawItem.kind);
    return {
      kind: rawItem.kind,
      count: rawItem.count as number,
      href,
    };
  });

  const totalCount = value.totalCount as number;
  if (items.reduce((sum, item) => sum + item.count, 0) !== totalCount) {
    invalidResponse();
  }

  return { totalCount, items };
}
