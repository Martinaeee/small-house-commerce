"use client";

import Link from "next/link";
import { useAdminI18n } from "@/lib/admin-i18n";
import { Badge } from "@/components/admin/Badge";
import type { RecentOrder } from "@/lib/dashboard-api";
import { CardEmpty, CardSkeleton, DashboardCard } from "./DashboardCard";
import { count, manilaDateTime, money } from "./format";

/** Latest orders inside the selected period; each row opens the order detail. */
export function RecentOrders({
  orders,
  loading,
  canRead,
}: {
  orders: RecentOrder[];
  loading: boolean;
  canRead: boolean;
}) {
  const { t } = useAdminI18n();

  return (
    <DashboardCard
      title={t("dash_recent_orders")}
      action={
        <Link href="/admin/orders" className="text-xs font-medium text-cta hover:underline">
          {t("dash_see_all")}
        </Link>
      }
      bodyClassName="px-0 pb-0"
    >
      {!canRead ? (
        <div className="px-4 pb-4">
          <CardEmpty title={t("dash_no_permission")} />
        </div>
      ) : loading ? (
        <div className="px-4 pb-4">
          <CardSkeleton rows={5} />
        </div>
      ) : orders.length === 0 ? (
        <div className="px-4 pb-4">
          <CardEmpty title={t("dash_recent_empty")} />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-ink-muted">
                <th className="px-4 py-2 font-medium">{t("dash_order_number")}</th>
                <th className="px-2 py-2 font-medium">{t("dash_customer")}</th>
                <th className="px-2 py-2 text-right font-medium">{t("dash_items")}</th>
                <th className="px-2 py-2 text-right font-medium">{t("dash_total")}</th>
                <th className="px-2 py-2 font-medium">{t("dash_payment")}</th>
                <th className="px-2 py-2 font-medium">{t("dash_fulfillment")}</th>
                <th className="px-4 py-2 text-right font-medium">{t("dash_created")}</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr
                  key={order.id}
                  className="border-b border-border last:border-0 transition-colors hover:bg-admin-surface-secondary/50"
                >
                  <td className="px-4 py-2">
                    <Link
                      href={`/admin/orders/${order.id}`}
                      className="font-mono text-xs font-medium text-cta hover:underline"
                    >
                      {order.orderNumber}
                    </Link>
                  </td>
                  <td className="max-w-[160px] truncate px-2 py-2 text-ink">{order.customerName}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink-secondary">
                    {count(order.itemCount)}
                  </td>
                  <td className="px-2 py-2 text-right font-medium tabular-nums text-ink">
                    {money(Number(order.total), true)}
                  </td>
                  <td className="px-2 py-2">
                    <Badge value={order.paymentStatus} />
                  </td>
                  <td className="px-2 py-2">
                    <Badge value={order.orderStatus} />
                  </td>
                  <td className="px-4 py-2 text-right text-xs tabular-nums text-ink-muted">
                    {manilaDateTime(order.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DashboardCard>
  );
}
