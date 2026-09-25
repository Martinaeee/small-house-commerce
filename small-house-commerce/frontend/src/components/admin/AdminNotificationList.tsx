"use client";

import Link from "next/link";
import { useAdminI18n, type TKey } from "@/lib/admin-i18n";
import {
  adminNotificationHref,
  type AdminNotificationItem,
  type AdminNotificationKind,
} from "@/lib/admin-notifications";

const LABEL_KEYS: Record<AdminNotificationKind, TKey> = {
  ORDER_NEEDS_REVIEW: "admin_notifications_ORDER_NEEDS_REVIEW",
  ORDER_UNCONFIRMED: "admin_notifications_ORDER_UNCONFIRMED",
  PRODUCT_MISSING_MEDIA: "admin_notifications_PRODUCT_MISSING_MEDIA",
  PRODUCT_NO_PRICED_SKU: "admin_notifications_PRODUCT_NO_PRICED_SKU",
  PRODUCT_INCOMPLETE_SHIPPING:
    "admin_notifications_PRODUCT_INCOMPLETE_SHIPPING",
  PRODUCT_STALE_DRAFT: "admin_notifications_PRODUCT_STALE_DRAFT",
};

export interface AdminNotificationListProps {
  items: AdminNotificationItem[];
  mode?: "panel" | "page";
  onNavigate?: () => void;
}

export function AdminNotificationList({
  items,
  mode = "panel",
  onNavigate,
}: AdminNotificationListProps) {
  const { t } = useAdminI18n();
  const pageMode = mode === "page";

  return (
    <ul className={pageMode ? "grid gap-3 p-4 md:grid-cols-2" : "divide-y divide-border"}>
      {items.map((item) => {
        const href = adminNotificationHref(item);
        if (!href) return null;

        return (
          <li
            key={item.kind}
            className={pageMode ? "overflow-hidden rounded-xl border border-border" : undefined}
          >
            <Link
              href={href}
              onClick={onNavigate}
              className={
                pageMode
                  ? "flex min-h-20 items-center gap-4 bg-card px-5 py-4 text-sm shadow-sm hover:bg-admin-surface-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                  : "flex items-center gap-3 px-4 py-3 text-sm hover:bg-admin-surface-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
              }
            >
              <span className="min-w-0 flex-1 font-medium text-ink">
                {t(LABEL_KEYS[item.kind])}
              </span>
              <span className="shrink-0 rounded-full bg-admin-primary-soft px-2 py-0.5 text-xs font-semibold tabular-nums text-admin-primary">
                {t("admin_notifications_item_count", { count: item.count })}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
