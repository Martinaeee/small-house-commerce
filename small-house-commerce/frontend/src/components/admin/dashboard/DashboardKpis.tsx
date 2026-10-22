"use client";

import { useAdminI18n } from "@/lib/admin-i18n";
import type { GrossProfitKpi, KpiValue } from "@/lib/dashboard-api";
import { Trend } from "./DashboardCard";
import { count, money, ratio } from "./format";

interface KpiDefinition {
  key: string;
  labelKey: Parameters<ReturnType<typeof useAdminI18n>["t"]>[0];
  hintKey: Parameters<ReturnType<typeof useAdminI18n>["t"]>[0];
  /** Overrides the static hint when the value's formula needs stating. */
  hint?: string;
  value: KpiValue | GrossProfitKpi;
  format: (value: number) => string;
}

export function DashboardKpis({
  kpis,
}: {
  kpis: {
    netSales: KpiValue;
    orders: KpiValue;
    conversionRate: KpiValue;
    averageOrderValue: KpiValue;
    refundRate: KpiValue;
    grossProfit: GrossProfitKpi;
  };
}) {
  const { t } = useAdminI18n();

  // The published profit is net sales minus product cost; shipping and payment
  // fees are not recorded by the platform yet. The card therefore states the
  // formula it actually applied instead of promising the full one.
  const excludedCosts = [
    kpis.grossProfit.missing.includes("SHIPPING_COST") ? t("dash_cost_shipping") : null,
    kpis.grossProfit.missing.includes("PAYMENT_FEE") ? t("dash_cost_payment_fee") : null,
  ].filter((part): part is string => part !== null);
  const profitHint =
    excludedCosts.length > 0
      ? t("dash_kpi_gross_profit_hint_partial", {
          excluded: excludedCosts.join(t("dash_cost_join")),
        })
      : t("dash_kpi_gross_profit_hint");

  const definitions: KpiDefinition[] = [
    { key: "net-sales", labelKey: "dash_kpi_net_sales", hintKey: "dash_kpi_net_sales_hint", value: kpis.netSales, format: (value) => money(value) },
    { key: "orders", labelKey: "dash_kpi_orders", hintKey: "dash_kpi_orders_hint", value: kpis.orders, format: (value) => count(value) },
    { key: "conversion", labelKey: "dash_kpi_conversion", hintKey: "dash_kpi_conversion_hint", value: kpis.conversionRate, format: (value) => ratio(value) },
    { key: "aov", labelKey: "dash_kpi_aov", hintKey: "dash_kpi_aov_hint", value: kpis.averageOrderValue, format: (value) => money(value, true) },
    { key: "refund", labelKey: "dash_kpi_refund_rate", hintKey: "dash_kpi_refund_rate_hint", value: kpis.refundRate, format: (value) => ratio(value) },
    { key: "profit", labelKey: "dash_kpi_gross_profit", hintKey: "dash_kpi_gross_profit_hint", hint: profitHint, value: kpis.grossProfit, format: (value) => money(value) },
  ];

  return (
    <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {definitions.map((definition) => {
        const unavailable = definition.value.value === null;
        const reason = definition.value.unavailableReason;
        const reasonLabel =
          reason === "NO_PERMISSION"
            ? t("dash_no_permission")
            : reason === "COST_DATA_INCOMPLETE"
              ? t("dash_cost_incomplete")
              : reason === "NO_TRAFFIC_DATA"
                ? t("dash_no_traffic")
                : reason === "NO_ORDERS"
                  ? t("dash_no_orders")
                  : null;

        return (
          <div
            key={definition.key}
            className="rounded-xl border border-border bg-card px-4 py-3"
            data-kpi={definition.key}
          >
            <dt className="truncate text-xs font-medium text-ink-secondary" title={t(definition.labelKey)}>
              {t(definition.labelKey)}
            </dt>
            <dd className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-xl font-semibold tabular-nums text-ink">
                {unavailable ? "—" : definition.format(definition.value.value as number)}
              </span>
              {!unavailable ? (
                <Trend change={definition.value.change} label={t("dash_vs_previous")} />
              ) : null}
            </dd>
            <p className="mt-1 truncate text-[11px] text-ink-muted" title={reasonLabel ?? definition.hint ?? t(definition.hintKey)}>
              {reasonLabel ?? definition.hint ?? t(definition.hintKey)}
            </p>
          </div>
        );
      })}
    </dl>
  );
}
