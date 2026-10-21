"use client";

import { useAdminI18n } from "@/lib/admin-i18n";
import type { CodMetrics } from "@/lib/dashboard-api";
import { CardEmpty, CardSkeleton, DashboardCard } from "./DashboardCard";
import { count, ratio } from "./format";

/**
 * Period fulfilment metrics (ADMIN_SPEC §6.2).
 *
 * The signed rate follows the project definition (BUSINESS_RULES §11): signed
 * orders ÷ every order created in the period, so cancelled and denied
 * orders stay in the denominator. The shipping-to-signed rate is a DIFFERENT
 * metric and is shown separately, never under the signed-rate label.
 */
export function CodMetricsCard({
  metrics,
  loading,
  canRead,
}: {
  metrics: CodMetrics | null;
  loading: boolean;
  canRead: boolean;
}) {
  const { t } = useAdminI18n();

  return (
    <DashboardCard title={t("dash_cod_metrics")} subtitle={t("dash_signed_rate_hint")}>
      {!canRead ? (
        <CardEmpty title={t("dash_no_permission")} />
      ) : loading ? (
        <CardSkeleton rows={2} />
      ) : !metrics ? (
        <CardEmpty title={t("dash_no_permission")} />
      ) : (
        <div>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Metric
              label={t("dash_confirmation_rate")}
              value={ratio(metrics.confirmationRate, 1)}
              hint={`${count(metrics.confirmedOrders)} / ${count(metrics.createdOrders)}`}
            />
            <Metric
              label={t("dash_signed_rate")}
              value={ratio(metrics.signedRate, 1)}
              hint={`${count(metrics.signedOrders)} / ${count(metrics.createdOrders)}`}
            />
            <Metric
              label={t("dash_shipping_to_signed_rate")}
              value={ratio(metrics.shippingToSignedRate, 1)}
              hint={`${count(metrics.signedOrders)} / ${count(metrics.shippedOrders)}`}
            />
            <Metric
              label={t("dash_cancel_rate")}
              value={ratio(metrics.cancelRate, 1)}
              hint={count(metrics.cancelledOrders)}
              tone="red"
            />
            <Metric
              label={t("dash_denied_rate")}
              value={ratio(metrics.deniedRate, 1)}
              hint={count(metrics.deniedOrders)}
              tone="red"
            />
            <Metric
              label={t("dash_valid_orders")}
              value={count(metrics.validOrders)}
              hint={t("dash_of_created", { count: count(metrics.createdOrders) })}
            />
          </dl>
          <p className="mt-3 text-[11px] text-ink-muted">{t("dash_cod_metrics_hint")}</p>
        </div>
      )}
    </DashboardCard>
  );
}

function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "red";
}) {
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <dt className="truncate text-[11px] text-ink-muted" title={label}>
        {label}
      </dt>
      <dd
        className={`mt-0.5 text-lg font-semibold tabular-nums ${
          tone === "red" ? "text-admin-error" : "text-ink"
        }`}
      >
        {value}
      </dd>
      <p className="text-[10px] tabular-nums text-ink-muted">{hint}</p>
    </div>
  );
}
