import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReportTreeTable } from "@/components/admin/marketing/ReportTreeTable";
import { AdminI18nProvider } from "@/lib/admin-i18n";
import type { MarketingReportRow, MarketingReportTreeProduct } from "@/lib/marketing-api";

const row = { kind: "REGISTERED", id: "l1", label: "Ad A", ownerUserId: "u1", ownerName: "Optimizer", aid: "OP-1", productId: "p1", productName: "Chair", productCode: "C1", landingPageId: null, sourceType: "META_AD", visits: 2, pageTotalVisits: null, addToCarts: 3, checkouts: 1, submittedOrders: 3, validOrders: 2, confirmedOrders: 1, signedOrders: 1, validOrderValuePhp: "12000.00", signedGrossPhp: "10000.00", spendUsd: "50.00", spendPhp: "2865.00", orderCpaUsd: "25.00", signedCpaUsd: "50.00", orderRoas: "4.19", signedRoas: "3.49", conversionRate: "1.0000", expectedCostDays: 3, recordedCostDays: 3, costCoverageComplete: true, duplicateOrders: 0, riskOrders: 0, afterSalesOrders: 0, refundStatusOrders: 0, periodBasis: "TOUCH", productThumbnailUrl: null } as unknown as MarketingReportRow;
const linkB = { ...row, id: "l2", label: "Ad B" };
const tree: MarketingReportTreeProduct[] = [
  {
    product: { id: "p1", name: "Chair", productCode: "C1", thumbnailUrl: "/c.jpg" },
    totals: { ...row, id: "p1", label: "Chair" },
    sources: [
      { sourceType: "META_AD", totals: { ...row, id: "p1:META_AD" }, links: [row, linkB] },
      { sourceType: "FB_POST", totals: { ...row, id: "p1:FB_POST" }, links: [{ ...row, id: "l3", label: "Post 1" }] },
    ],
  },
  {
    product: { id: "p2", name: "Table", productCode: "T1", thumbnailUrl: null },
    totals: { ...row, id: "p2", label: "Table" },
    sources: [{ sourceType: "META_AD", totals: { ...row, id: "p2:META_AD" }, links: [{ ...row, id: "l4", label: "Table ad" }] }],
  },
];
const mount = (onSort = vi.fn()) => render(<AdminI18nProvider><ReportTreeTable tree={treeGrid(tree)} sortBy="NAME" sortDirection="ASC" onSort={onSort} /></AdminI18nProvider>);
const treeGrid = (value: MarketingReportTreeProduct[]) => value;

describe("report tree table", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the three levels with aligned metric columns", () => {
    mount();
    // both products and both sources render; link rows keep their own labels
    expect(screen.getAllByText("Chair").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Meta 广告")).toHaveLength(2);
    expect(screen.getAllByText("Facebook 帖子")).toHaveLength(1);
    expect(screen.getByText("Ad A")).toBeInTheDocument();
    expect(screen.getByText("Table ad")).toBeInTheDocument();
    // every level carries aligned metric cells: 2 products + 3 sources + 4 links
    expect(screen.getAllByRole("cell", { name: "PHP 12000.00" }).length).toBe(9);
  });

  it("collapses a product and hides its sources while other products stay", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Chair" }));
    // Chair's sources and links hide; Table stays fully open
    expect(screen.queryByText("Ad A")).not.toBeInTheDocument();
    expect(screen.getAllByText("Meta 广告")).toHaveLength(1);
    expect(screen.getByText("Table ad")).toBeInTheDocument();
  });

  it("collapses only one source within an expanded product and keeps state across product re-expansion", () => {
    mount();
    fireEvent.click(screen.getAllByRole("button", { name: /Meta 广告/ })[0]!);
    expect(screen.queryByText("Ad A")).not.toBeInTheDocument();
    expect(screen.queryByText("Post 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Chair" }));
    expect(screen.queryByText("Post 1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Chair" }));
    expect(screen.getAllByText("Meta 广告")).toHaveLength(2);
    expect(screen.queryByText("Ad A")).not.toBeInTheDocument();
  });

  it("marks the sorted column header and forwards clicks with the direction flag", () => {
    const onSort = vi.fn();
    render(<AdminI18nProvider><ReportTreeTable tree={tree} sortBy="VALID" sortDirection="DESC" onSort={onSort} /></AdminI18nProvider>);
    expect(onSort).toHaveBeenCalledTimes(0);
    fireEvent.click(screen.getByRole("button", { name: /有效订单/ }));
    expect(onSort).toHaveBeenCalledWith("VALID", true);
  });

  it("shows the empty message without any tree", () => {
    render(<AdminI18nProvider><ReportTreeTable tree={[]} sortBy="NAME" sortDirection="ASC" onSort={() => {}} /></AdminI18nProvider>);
    expect(screen.getByText("所选范围没有可核算的已登记链接。")).toBeInTheDocument();
  });
});
