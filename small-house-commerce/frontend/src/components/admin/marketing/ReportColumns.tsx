"use client";

import type { ReactNode } from "react";
import { useAdminI18n } from "@/lib/admin-i18n";
import type { MarketingReportRow } from "@/lib/marketing-api";

type ColumnLabel = Parameters<ReturnType<typeof useAdminI18n>["t"]>[0];

export interface ReportColumn {
  key: ColumnLabel;
  /** Sort enum the backend understands; undefined = column does not sort. */
  sortBy?: string;
  numeric?: boolean;
}

/**
 * The report table's column model, shared by the flat table and the tree so
 * metric cells can never drift between the two views. Order is spec §5.1.
 */
export const reportColumns: ReportColumn[] = [
  { key: "marketing_internal_name" },
  { key: "marketing_report_visits", sortBy: "VISITS", numeric: true },
  { key: "marketing_report_add_to_cart", sortBy: "ADD_TO_CARTS", numeric: true },
  { key: "marketing_report_checkout", sortBy: "CHECKOUTS", numeric: true },
  { key: "marketing_report_submitted", sortBy: "SUBMITTED", numeric: true },
  { key: "marketing_report_valid", sortBy: "VALID", numeric: true },
  { key: "marketing_report_confirmed", sortBy: "CONFIRMED", numeric: true },
  { key: "marketing_report_signed", sortBy: "SIGNED", numeric: true },
  { key: "marketing_report_valid_value", sortBy: "VALID_VALUE", numeric: true },
  { key: "marketing_report_signed_gross", sortBy: "SIGNED_GROSS", numeric: true },
  { key: "marketing_cost_usd", sortBy: "SPEND_USD", numeric: true },
  { key: "marketing_cost_php", sortBy: "SPEND_PHP", numeric: true },
  { key: "marketing_report_order_cpa", sortBy: "ORDER_CPA", numeric: true },
  { key: "marketing_report_signed_cpa", sortBy: "SIGNED_CPA", numeric: true },
  { key: "marketing_report_order_roas", sortBy: "ORDER_ROAS", numeric: true },
  { key: "marketing_report_signed_roas", sortBy: "SIGNED_ROAS", numeric: true },
  { key: "marketing_report_conversion", sortBy: "CONVERSION", numeric: true },
  { key: "marketing_report_coverage" },
];

/** 40×40 product thumbnail; the placeholder keeps the row height stable. */
export function ProductThumb({ url, label }: { url: string | null; label: string }) {
  const { t } = useAdminI18n();
  if (url === null) return <span className="mt-0.5 inline-block h-10 w-10 shrink-0 rounded bg-slate-100 align-top text-slate-300" role="img" aria-label={t("marketing_report_thumbnail_missing")} />;
  // eslint-disable-next-line @next/next/no-img-element -- admin panel sees trusted upload URLs; next/image adds nothing here
  return <img src={url} alt={label} className="mt-0.5 h-10 w-10 shrink-0 rounded object-cover" />;
}

/** Every metric <td> after the caller's identity column. */
export function ReportMetricCells({ row }: { row: MarketingReportRow }): ReactNode {
  const { t } = useAdminI18n();
  return <>
    <td className="px-3 py-3 tabular-nums">{row.visits ?? "—"}</td>
    <td className="px-3 py-3 tabular-nums">{row.addToCarts}</td>
    <td className="px-3 py-3 tabular-nums">{row.checkouts}</td>
    <td className="px-3 py-3 tabular-nums">{row.submittedOrders}</td>
    <td className="px-3 py-3 tabular-nums">{row.validOrders}</td>
    <td className="px-3 py-3 tabular-nums">{row.confirmedOrders}</td>
    <td className="px-3 py-3 tabular-nums">{row.signedOrders}</td>
    <td className="whitespace-nowrap px-3 py-3">PHP {row.validOrderValuePhp}</td>
    <td className="whitespace-nowrap px-3 py-3">PHP {row.signedGrossPhp}</td>
    <td className="whitespace-nowrap px-3 py-3">USD {row.spendUsd}</td>
    <td className="whitespace-nowrap px-3 py-3">PHP {row.spendPhp}</td>
    <td className="whitespace-nowrap px-3 py-3">{row.orderCpaUsd === null ? "—" : `USD ${row.orderCpaUsd}`}</td>
    <td className="whitespace-nowrap px-3 py-3">{row.signedCpaUsd === null ? "—" : `USD ${row.signedCpaUsd}`}</td>
    <td className="px-3 py-3">{row.orderRoas ?? "—"}</td>
    <td className="px-3 py-3">{row.signedRoas ?? "—"}</td>
    <td className="px-3 py-3">{row.conversionRate === null ? "—" : `${(Number(row.conversionRate) * 100).toFixed(2)}%`}</td>
    <td className="min-w-48 px-3 py-3 text-xs"><span className={row.costCoverageComplete ? "text-emerald-700" : "text-amber-800"}>{t(row.costCoverageComplete ? "marketing_report_complete" : "marketing_report_incomplete", { recorded: String(row.recordedCostDays), expected: String(row.expectedCostDays) })}</span></td>
  </>;
}
