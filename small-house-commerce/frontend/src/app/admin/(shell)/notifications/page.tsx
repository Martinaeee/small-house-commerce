"use client";

import type { ReactNode } from "react";
import { AdminNotificationList } from "@/components/admin/AdminNotificationList";
import { PageHeader } from "@/components/admin/PageHeader";
import { useAdminNotifications } from "@/components/admin/useAdminNotifications";
import { useAdminI18n } from "@/lib/admin-i18n";

export default function AdminNotificationsPage(): ReactNode {
  const { t } = useAdminI18n();
  const notifications = useAdminNotifications();

  return (
    <div className="w-full max-w-none px-4 py-6 md:px-8">
      <PageHeader
        title={t("admin_notifications_title")}
        subtitle={t("admin_notifications_page_subtitle")}
      />

      <div className="mt-6 rounded-xl border border-border bg-card shadow-sm">
        <div className="border-b border-border px-4 py-4 md:px-5">
          <p className="text-sm text-ink-secondary">
            {t("admin_notifications_page_explanation")}
          </p>
          {notifications.status === "ready" && notifications.response ? (
            <p className="mt-1 text-xs font-semibold text-ink">
              {t("admin_notifications_page_count", {
                count: notifications.response.totalCount,
              })}
            </p>
          ) : null}
        </div>

        <section
          role="region"
          aria-label={t("admin_notifications_page_region")}
        >
          {notifications.status === "loading" ? (
            <p role="status" className="p-10 text-center text-sm text-ink-secondary">
              {t("admin_notifications_loading")}
            </p>
          ) : null}
          {notifications.status === "error" ? (
            <div role="alert" className="p-10 text-center text-sm text-error">
              <p>{t("admin_notifications_error")}</p>
              <button
                type="button"
                onClick={notifications.retry}
                className="mt-3 rounded-lg border border-error px-3 py-1.5 text-xs font-semibold"
              >
                {t("admin_notifications_retry")}
              </button>
            </div>
          ) : null}
          {notifications.status === "empty" ? (
            <p role="status" className="p-10 text-center text-sm text-ink-secondary">
              {t("admin_notifications_empty")}
            </p>
          ) : null}
          {notifications.status === "ready" && notifications.response ? (
            <AdminNotificationList
              items={notifications.response.items}
              mode="page"
            />
          ) : null}
        </section>
      </div>
    </div>
  );
}
