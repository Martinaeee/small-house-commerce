"use client";

import type { MarketingReportRow } from "@/lib/marketing-api";
import { useAdminI18n } from "@/lib/admin-i18n";
import { ProductThumb } from "./ReportColumns";

/**
 * Verified-attribution view. CL registered visits cannot be split by AdID, so
 * the visit column is deliberately empty here; AdID visits are deduplicated
 * browser sessions and must never be added to campaign_link_visits.
 */
export function ReportAttributionTable({ rows, dimension }: { rows: MarketingReportRow[]; dimension: "ADID" | "AID" }) {
  const { t } = useAdminI18n();
  return <div className="overflow-x-auto rounded-xl border border-admin-border bg-white">
    <table className="w-full min-w-[1100px] text-left text-sm">
      <thead className="bg-slate-50 text-xs text-admin-muted"><tr>
        <th className="px-3 py-2">{t(dimension === "ADID" ? "marketing_report_adid" : "marketing_report_aid")}</th>
        <th className="px-3 py-2 text-right">{t("marketing_report_visits")}</th>
        <th className="px-3 py-2 text-right">{t("marketing_report_ad_visits")}</th>
        <th className="px-3 py-2 text-right">{t("marketing_report_product_views")}</th>
        <th className="px-3 py-2 text-right">{t("marketing_report_add_to_cart")}</th>
        <th className="px-3 py-2 text-right">{t("marketing_report_checkout")}</th>
        <th className="px-3 py-2 text-right">{t("marketing_report_submitted")}</th>
        <th className="px-3 py-2 text-right">{t("marketing_report_valid")}</th>
        <th className="px-3 py-2 text-right">{t("marketing_report_confirmed")}</th>
        <th className="px-3 py-2 text-right">{t("marketing_report_signed")}</th>
        <th className="px-3 py-2 text-right">{t("marketing_report_valid_value")}</th>
        <th className="px-3 py-2 text-right">{t("marketing_report_signed_gross")}</th>
      </tr></thead>
      <tbody className="divide-y divide-admin-border">
        {rows.map((row) => <tr key={row.id}>
          <td className="min-w-64 px-3 py-3">
            <div className="flex items-start gap-2">
              <ProductThumb url={row.productThumbnailUrl} label={row.productName ?? row.label} />
              <div className="min-w-0">
                <p className="font-mono text-xs font-medium">{dimension === "ADID" ? (row.adId ?? t("marketing_report_adid_unidentified")) : (row.aid ?? t("marketing_report_aid_missing"))}</p>
                {dimension === "ADID" && row.adIdMissingReason && <p className="text-xs text-amber-800">{
                  row.adIdMissingReason === "MISSING_META_AD_ID" ? t("marketing_adid_reason_MISSING_META_AD_ID")
                    : row.adIdMissingReason === "INVALID_META_AD_ID" ? t("marketing_adid_reason_INVALID_META_AD_ID")
                    : row.adIdMissingReason === "ORGANIC_TOUCH" ? t("marketing_adid_reason_ORGANIC_TOUCH")
                    : row.adIdMissingReason
                }</p>}
                {row.linkName && <p className="break-words text-xs text-admin-muted">{row.linkName}</p>}
                {row.productName && <p className="text-xs text-admin-muted">{row.productName} · {row.productCode ?? "—"}</p>}
                <p className="text-xs text-admin-muted">{row.ownerName ?? "—"} · {row.aid ?? "—"}</p>
                <p className="text-[11px] text-admin-muted">
                  {t("marketing_report_attribution_counts", { links: String(row.linkCount ?? 0), ads: String(row.adCount ?? 0) })}
                </p>
              </div>
            </div>
          </td>
          <td className="px-3 py-3 text-right tabular-nums">—</td>
          <td className="px-3 py-3 text-right tabular-nums">{row.adVisits ?? 0}</td>
          <td className="px-3 py-3 text-right tabular-nums">{row.productViews ?? 0}</td>
          <td className="px-3 py-3 text-right tabular-nums">{row.addToCarts}</td>
          <td className="px-3 py-3 text-right tabular-nums">{row.checkouts}</td>
          <td className="px-3 py-3 text-right tabular-nums">{row.submittedOrders}</td>
          <td className="px-3 py-3 text-right tabular-nums">{row.validOrders}</td>
          <td className="px-3 py-3 text-right tabular-nums">{row.confirmedOrders}</td>
          <td className="px-3 py-3 text-right tabular-nums">{row.signedOrders}</td>
          <td className="whitespace-nowrap px-3 py-3 text-right">PHP {row.validOrderValuePhp}</td>
          <td className="whitespace-nowrap px-3 py-3 text-right">PHP {row.signedGrossPhp}</td>
        </tr>)}
        {rows.length === 0 && <tr><td colSpan={12} className="px-3 py-6 text-center text-admin-muted">{t("marketing_links_empty")}</td></tr>}
      </tbody>
    </table>
    <p className="border-t border-admin-border px-3 py-2 text-xs text-admin-muted">{t("marketing_report_attribution_note")}</p>
  </div>;
}
