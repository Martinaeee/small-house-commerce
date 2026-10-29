import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { reportColumns, ReportMetricCells, ProductThumb } from "@/components/admin/marketing/ReportColumns";
import { AdminI18nProvider } from "@/lib/admin-i18n";
import type { MarketingReportRow } from "@/lib/marketing-api";

const row = { kind: "REGISTERED", id: "l1", label: "Ad A", ownerUserId: "u1", ownerName: "Optimizer", aid: "OP-1", productId: "p1", productName: "Chair", productCode: "C1", landingPageId: null, sourceType: "META_AD", visits: 2, pageTotalVisits: null, addToCarts: 3, checkouts: 1, submittedOrders: 3, validOrders: 2, confirmedOrders: 1, signedOrders: 1, validOrderValuePhp: "12000.00", signedGrossPhp: "10000.00", spendUsd: "50.00", spendPhp: "2865.00", orderCpaUsd: "25.00", signedCpaUsd: "50.00", orderRoas: "4.19", signedRoas: "3.49", conversionRate: "1.0000", expectedCostDays: 3, recordedCostDays: 3, costCoverageComplete: true, duplicateOrders: 0, riskOrders: 0, afterSalesOrders: 0, refundStatusOrders: 0, periodBasis: "TOUCH", productThumbnailUrl: null } as unknown as MarketingReportRow;

const cell = (name: string) => screen.getByRole("cell", { name });

describe("shared report column model", () => {
  it("orders columns exactly per spec §5.1 and marks which columns sort", () => {
    expect(reportColumns.map(c => c.key)).toEqual([
      "marketing_internal_name", "marketing_report_visits", "marketing_report_add_to_cart", "marketing_report_checkout",
      "marketing_report_submitted", "marketing_report_valid", "marketing_report_confirmed", "marketing_report_signed",
      "marketing_report_valid_value", "marketing_report_signed_gross", "marketing_cost_usd", "marketing_cost_php",
      "marketing_report_order_cpa", "marketing_report_signed_cpa", "marketing_report_order_roas", "marketing_report_signed_roas",
      "marketing_report_conversion", "marketing_report_coverage",
    ]);
    expect(reportColumns.find(c => c.key === "marketing_report_add_to_cart")?.sortBy).toBe("ADD_TO_CARTS");
    expect(reportColumns.find(c => c.key === "marketing_internal_name")?.sortBy).toBeUndefined();
  });

  it("renders the funnel columns between visits and submitted orders", () => {
    render(<AdminI18nProvider><table><tbody><tr><ReportMetricCells row={{ ...row, addToCarts: 7, checkouts: 5 }} /></tr></tbody></table></AdminI18nProvider>);
    expect(cell("7")).toBeInTheDocument();
    expect(cell("5")).toBeInTheDocument();
    expect(cell("PHP 12000.00")).toBeInTheDocument();
    expect(cell("费用完整（3 / 3 日）")).toBeInTheDocument();
  });

  it("renders dashes for missing ratios", () => {
    render(<AdminI18nProvider><table><tbody><tr><ReportMetricCells row={{ ...row, orderCpaUsd: null, orderRoas: null }} /></tr></tbody></table></AdminI18nProvider>);
    expect(screen.getAllByRole("cell", { name: "—" }).length).toBeGreaterThanOrEqual(2);
  });

  it("renders a 40x40 thumb or a labelled placeholder", () => {
    render(<AdminI18nProvider><><ProductThumb url="/a.jpg" label="Chair" /><ProductThumb url={null} label="Chair" /></></AdminI18nProvider>);
    expect(screen.getByRole("img", { name: "Chair" })).toHaveAttribute("src", "/a.jpg");
    expect(screen.getByRole("img", { name: "商品暂无图片" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Chair" })).toHaveClass("h-10", "w-10");
  });
});
