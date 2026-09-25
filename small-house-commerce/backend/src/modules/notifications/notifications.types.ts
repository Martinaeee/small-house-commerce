export const ADMIN_NOTIFICATION_HREFS = {
  ORDER_NEEDS_REVIEW: '/admin/orders?confirmation=NEEDS_REVIEW',
  ORDER_UNCONFIRMED: '/admin/orders?confirmation=UNCONFIRMED',
  PRODUCT_MISSING_MEDIA: '/admin/products?attention=missing_media',
  PRODUCT_NO_PRICED_SKU: '/admin/products?attention=no_priced_sku',
  PRODUCT_INCOMPLETE_SHIPPING:
    '/admin/products?attention=incomplete_shipping',
  PRODUCT_STALE_DRAFT: '/admin/products?attention=stale_draft',
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
