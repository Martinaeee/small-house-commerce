"use client";

import Link from "next/link";
import { useAdminI18n } from "@/lib/admin-i18n";
import type { ProductPerformanceSort, TopProduct } from "@/lib/dashboard-api";
import { CardEmpty, CardSkeleton, DashboardCard, Trend } from "./DashboardCard";
import { count, money, ratio } from "./format";

const SORTS: { value: ProductPerformanceSort; key: "dash_sort_revenue" | "dash_sort_orders" | "dash_sort_signed_rate" | "dash_sort_units" }[] = [
  { value: "revenue", key: "dash_sort_revenue" },
  { value: "orders", key: "dash_sort_orders" },
  { value: "signed_rate", key: "dash_sort_signed_rate" },
  { value: "units", key: "dash_sort_units" },
];

/**
 * Product performance for the selected period.
 *
 * Three things an operator needs to answer "what sold best":
 *   - what it brought in (revenue, net of the order-level discount that is
 *     allocated to the lines in proportion to their amount);
 *   - how well it was delivered (signed rate — signed orders ÷ all created
 *     orders, so cancelled and denied orders stay in the denominator);
 *   - what it left behind (profit), which is only shown when every line of
 *     that product carries a cost snapshot.
 */
export function ProductPerformanceTable({
  products,
  loading,
  canRead,
  sort,
  onSortChange,
}: {
  products: TopProduct[];
  loading: boolean;
  canRead: boolean;
  sort: ProductPerformanceSort;
  onSortChange: (sort: ProductPerformanceSort) => void;
}) {
  const { t } = useAdminI18n();

  return (
    <DashboardCard
      title={t("dash_product_performance")}
      subtitle={t("dash_product_performance_hint")}
      action={
        <label className="flex items-center gap-1.5 text-[11px] text-ink-muted">
          <span className="sr-only sm:not-sr-only">{t("dash_sort_by")}</span>
          <select
            aria-label={t("dash_sort_by")}
            className="h-8 rounded-lg border border-border bg-card px-2 text-xs text-ink focus:border-primary focus:outline-none"
            value={sort}
            onChange={(event) => onSortChange(event.target.value as ProductPerformanceSort)}
          >
            {SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.key)}
              </option>
            ))}
          </select>
        </label>
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
      ) : products.length === 0 ? (
        <div className="px-4 pb-4">
          <CardEmpty title={t("dash_products_empty")} />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-ink-muted">
                <th className="px-4 py-2 font-medium">{t("dash_product")}</th>
                <th className="px-2 py-2 text-right font-medium">{t("dash_sales_orders")}</th>
                <th className="px-2 py-2 text-right font-medium">{t("dash_units")}</th>
                <th className="px-2 py-2 text-right font-medium">{t("dash_revenue")}</th>
                <th className="px-2 py-2 text-right font-medium">{t("dash_signed_rate")}</th>
                <th className="px-2 py-2 text-right font-medium">{t("dash_profit")}</th>
                <th className="px-4 py-2 text-right font-medium">{t("dash_growth")}</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr
                  key={product.productId}
                  className="border-b border-border last:border-0 transition-colors hover:bg-admin-surface-secondary/50"
                >
                  <td className="px-4 py-2">
                    <Link
                      href={`/admin/products/${product.productId}/edit`}
                      className="group flex min-w-0 items-center gap-2"
                    >
                      {product.imageUrl ? (
                        // Local/R2 uploads are not whitelisted for next/image.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={product.imageUrl}
                          alt=""
                          loading="lazy"
                          className="h-8 w-8 shrink-0 rounded-md border border-border object-cover"
                        />
                      ) : (
                        <span
                          className="h-8 w-8 shrink-0 rounded-md bg-admin-neutral-soft"
                          aria-hidden
                        />
                      )}
                      <span className="min-w-0 truncate text-ink group-hover:text-cta">
                        {product.name}
                      </span>
                    </Link>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink-secondary">
                    {count(product.orders)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink-secondary">
                    {count(product.units)}
                  </td>
                  <td className="px-2 py-2 text-right font-medium tabular-nums text-ink">
                    {money(product.revenue)}
                  </td>
                  <td
                    className="px-2 py-2 text-right tabular-nums text-ink-secondary"
                    title={t("dash_signed_rate_hint")}
                  >
                    {ratio(product.signedRate, 1)}
                  </td>
                  <td
                    className="px-2 py-2 text-right tabular-nums"
                    title={
                      product.profit === null
                        ? t("dash_profit_incomplete")
                        : t("dash_profit_value", {
                            cost: money(product.cost ?? 0),
                            revenue: money(product.revenue),
                          })
                    }
                  >
                    {product.profit === null ? (
                      <span className="text-ink-muted">—</span>
                    ) : (
                      <span
                        className={
                          product.profit >= 0 ? "font-medium text-ink" : "font-medium text-admin-error"
                        }
                      >
                        {money(product.profit)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Trend change={product.change} label={t("dash_vs_previous")} />
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
