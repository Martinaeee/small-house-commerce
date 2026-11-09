"use client";

import { useAdminI18n } from "@/lib/admin-i18n";
import { fullDateTime } from "./format";

export function OrderProcessTimes({
  order,
}: {
  order: { draftStartedAt?: string | null; createdAt: string };
}) {
  const { t } = useAdminI18n();
  if (!order.draftStartedAt) return null;
  return (
    <dl className="my-3 space-y-1 rounded-lg border border-border bg-background p-3 text-xs text-ink-secondary">
      <div className="flex flex-wrap gap-x-3">
        <dt>{t("orders_draft_started")}</dt>
        <dd>
          <time dateTime={order.draftStartedAt}>
            {fullDateTime(order.draftStartedAt)}
          </time>
        </dd>
      </div>
      <div className="flex flex-wrap gap-x-3">
        <dt>{t("orders_draft_converted")}</dt>
        <dd>
          <time dateTime={order.createdAt}>
            {fullDateTime(order.createdAt)}
          </time>
        </dd>
      </div>
    </dl>
  );
}
