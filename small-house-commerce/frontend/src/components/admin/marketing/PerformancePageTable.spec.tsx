import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { zh } from "@/i18n/zh";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminI18nProvider } from "@/lib/admin-i18n";
import { marketingApi, type MarketingPerformanceReport, type PerformancePageRow, type PerformanceTotals } from "@/lib/marketing-api";
import { PerformancePageTable } from "./PerformancePageTable";

const auth = vi.hoisted(() => ({ admin: { id: "u1", name: "Operator", permissions: ["MARKETING_VIEW_ALL"] } }));
vi.mock("@/components/admin/AdminAuthProvider", () => ({ useAdminAuth: () => auth }));
vi.mock("@/lib/marketing-api", async (load) => ({ ...await load(), marketingApi: { listLinks: vi.fn(), performance: vi.fn(), performanceOptions: vi.fn(), linkContext: vi.fn(async () => ({ products: [] })), ownerOptions: vi.fn(async () => []) } }));

const range = { from: "2026-10-06", to: "2026-10-12" };
function totals(overrides: Partial<PerformanceTotals> = {}): PerformanceTotals {
  return {
    visits: 0, pageTotalVisits: 0, submittedOrders: 0, validOrders: 0, confirmedOrders: 0, signedOrders: 0, duplicateOrders: 0, riskOrders: 0, afterSalesOrders: 0, refundStatusOrders: 0,
    validOrderValuePhp: "0.00", signedGrossPhp: "0.00", spendUsd: "0.00", spendPhp: "0.00", expectedCostDays: 0, recordedCostDays: 0, costCoverageComplete: true,
    orderCpaUsd: null, signedCpaUsd: null, orderRoas: null, signedRoas: null, conversionRate: null, periodBasis: "TOUCH",
    ...overrides,
  };
}
function page(id: string, name: string, overrides: Partial<PerformancePageRow> = {}): PerformancePageRow {
  return {
    id, name, slug: id, productId: "product-1", productName: "Chair", productCode: "LUW-001", productStatus: "ACTIVE",
    ownerUserId: "u1", ownerName: "Optimizer", aid: "OP-1", effectiveStatus: "LIVE", linkCount: 1, createdAt: "2026-10-01T00:00:00.000Z",
    pageTotalVisits: 0, current: { range, registeredLinkCount: 1, totals: totals() }, previous: null, changes: null, notices: [],
    ...overrides,
  };
}
function report(rows: PerformancePageRow[], overrides: Partial<MarketingPerformanceReport> = {}): MarketingPerformanceReport {
  return {
    asOf: "2026-10-13T01:00:00.000Z",
    scope: { view: "PRODUCT", productId: "product-1", ownerUserId: null, landingPageId: null, effectiveStatus: null, onlyOwn: false },
    overview: { total: rows.length, byStatus: { DRAFT: 0, LIVE: rows.length, SCHEDULED: 0, ENDED: 0, DISABLED: 0 }, byProduct: [] },
    current: { range, registeredLinkCount: 0, totals: totals() }, previous: null, changes: null, page: 1, pageSize: 20, total: rows.length, rows,
    trend: { pageId: null, interval: "DAY", points: [] }, otherSources: { current: [], previous: null },
    ...overrides,
  };
}
const rich = page("page-a", "省空间视频页", { pageTotalVisits: 30, current: { range, registeredLinkCount: 2, totals: totals({ visits: 12, validOrders: 2, submittedOrders: 3, confirmedOrders: 2, signedOrders: 1, validOrderValuePhp: "9999.00", signedGrossPhp: "573.00", spendUsd: "10.00", spendPhp: "300.00", orderCpaUsd: "5.00", signedCpaUsd: "5.00", orderRoas: "17.45", signedRoas: "0.52", conversionRate: "0.1667" }) } });
const mount = (props: Partial<Parameters<typeof PerformancePageTable>[0]> = {}) => render(<AdminI18nProvider><PerformancePageTable report={report([rich])} groupByProduct={false} onTrendPage={vi.fn()} {...props} /></AdminI18nProvider>);

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); auth.admin.permissions = ["MARKETING_VIEW_ALL"];
  vi.mocked(marketingApi.listLinks).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
});

describe("performance page table", () => {
  it.each([false, true])("keeps every metric under its matching header when grouped=%s", groupByProduct => {
    mount({
      groupByProduct,
      report: report([rich], {
        overview: { total: 1, byStatus: { DRAFT: 0, LIVE: 1, SCHEDULED: 0, ENDED: 0, DISABLED: 0 }, byProduct: [
          { productId: rich.productId, productName: rich.productName, productCode: rich.productCode, pageCount: 1 },
        ] },
      }),
    });
    const headers = within(screen.getByRole("table")).getAllByRole("columnheader");
    expect(headers.map(header => header.textContent)).toEqual([
      zh.marketing_performance_col_page, zh.common_status,
      zh.marketing_performance_col_visits, zh.marketing_performance_col_valid_orders,
      zh.marketing_performance_col_conversion, zh.marketing_performance_col_spend,
      zh.marketing_performance_col_cpa, zh.marketing_performance_col_roas, zh.common_actions,
    ]);
    const cells = within(screen.getByText(rich.name).closest("tr")!).getAllByRole("cell");
    expect(cells).toHaveLength(headers.length);
    expect(cells[1]).toHaveTextContent("已发布");
    expect(cells[2]).toHaveTextContent("12");
    expect(cells[3]).toHaveTextContent("2");
    expect(cells[5]).toHaveTextContent("10.00");
    expect(cells[7]).toHaveTextContent("0.52");
  });

  it.each([
    ["DIRECT", "125.00"], ["LEGACY", "0.00"], ["UNVERIFIED", "75.00"],
  ] as const)("shows only signed gross for the %s historical source", (kind, signedGrossPhp) => {
    mount({ report: report([rich], { otherSources: {
      current: [{ kind, totals: totals({ validOrderValuePhp: "99999.00", signedGrossPhp }) }], previous: null,
    } }) });
    fireEvent.click(screen.getByRole("button", { name: "详情" }));
    const source = screen.getByText(zh[`marketing_performance_other_${kind}`]).closest("dl")!;
    const label = within(source).getByText(zh.marketing_performance_metric_signed_gross);
    expect(label.nextElementSibling).toHaveTextContent(signedGrossPhp);
  });

  it("shows the page, owner, status and the main funnel columns without inventing ratios", () => {
    mount();
    expect(screen.getByText("省空间视频页")).toBeInTheDocument();
    expect(screen.getByText("Optimizer · OP-1")).toBeInTheDocument();
    expect(screen.getByText("已发布")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("0.1667")).toBeInTheDocument();
    expect(screen.getByText("10.00")).toBeInTheDocument();
    expect(screen.getByText("5.00")).toBeInTheDocument();
    expect(screen.getByText("0.52")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看页面" })).toHaveAttribute("href", "/admin/marketing/page-a/edit");
  });

  it("labels the editor link as editable when the current optimizer owns the page", () => {
    auth.admin.permissions = ["MARKETING_VIEW_ALL", "MARKETING_MANAGE_OWN"];
    mount();

    expect(screen.getByRole("link", { name: "编辑页面" })).toHaveAttribute("href", "/admin/marketing/page-a/edit");
  });

  it("labels draft, disabled, no-links, not-started, incomplete costs and inactive parents distinctly", () => {
    mount({
      report: report([
        page("d", "Draft page", { effectiveStatus: "DRAFT", current: { range, registeredLinkCount: 0, totals: null } }),
        page("nl", "No links page", { notices: ["NO_LINKS"] }),
        page("ns", "Not started page", { notices: ["NOT_STARTED"] }),
        page("ci", "Costs page", { notices: ["COSTS_INCOMPLETE"], current: { range, registeredLinkCount: 2, totals: totals({ expectedCostDays: 7, recordedCostDays: 2, spendUsd: "3.00" }) } }),
        page("pi", "Inactive page", { productStatus: "DISABLED", notices: ["PARENT_INACTIVE"] }),
      ]),
    });
    expect(screen.getByText("待制作草稿")).toBeInTheDocument();
    expect(screen.getByText("未建立投放链接")).toBeInTheDocument();
    expect(screen.getByText("尚未开始投放")).toBeInTheDocument();
    expect(screen.getByText("费用待补")).toBeInTheDocument();
    expect(screen.getByText("母商品未上架")).toBeInTheDocument();
  });

  it("shows an em dash instead of a zero object when the page has no links in the period", () => {
    mount({ report: report([page("none", "No data page", { current: { range, registeredLinkCount: 0, totals: null } })]) });
    const row = screen.getByText("No data page").closest("tr") ?? screen.getByText("No data page").parentElement;
    expect(row).not.toBeNull();
    expect(row!.textContent).toContain("—");
    expect(row!.textContent).not.toContain("0.00");
  });

  it("shows unassigned pages and never invents an owner", () => {
    mount({ report: report([page("u", "Unassigned page", { ownerUserId: null, ownerName: null, aid: null })]) });
    expect(screen.getByText("未分配")).toBeInTheDocument();
  });

  it("keeps same-named pages of different products separate and labels the cross-page group counts", () => {
    const same = (id: string, productId: string, productName: string): PerformancePageRow => page(id, "同名页", { productId, productName, productCode: null });
    mount({
      groupByProduct: true,
      report: report([
        same("pa", "p1", "Chair"),
        same("pb", "p2", "Sofa"),
      ], {
        overview: { total: 3, byStatus: { DRAFT: 0, LIVE: 2, SCHEDULED: 0, ENDED: 0, DISABLED: 0 }, byProduct: [
          { productId: "p1", productName: "Chair", productCode: null, pageCount: 1 },
          { productId: "p2", productName: "Sofa", productCode: null, pageCount: 2 },
        ] },
        total: 3,
      }),
    });
    expect(screen.getAllByText("同名页")).toHaveLength(2);
    expect(screen.getByText("共 1 个页面")).toBeInTheDocument();
    expect(screen.getByText("本页显示 1／该商品共 2")).toBeInTheDocument();
  });

  it("expands a row to show PHP amounts and historical sources without folding them into the main ROI", async () => {
    const otherSources = { current: [{ kind: "DIRECT" as const, totals: totals({ validOrders: 9, validOrderValuePhp: "99999.00" }) }], previous: null };
    mount({ report: report([rich], { otherSources }) });
    fireEvent.click(screen.getByRole("button", { name: "详情" }));
    expect(await screen.findByText("9,999.00")).toBeInTheDocument();
    expect(screen.getByText("573.00")).toBeInTheDocument();
    expect(screen.getByText("直达")).toBeInTheDocument();
    expect(screen.getByText(/历史来源/)).toBeInTheDocument();
    await waitFor(() => expect(marketingApi.listLinks).toHaveBeenCalledWith(expect.objectContaining({ productId: "product-1", landingPageId: "page-a" })));
  });

  it("asks the parent to show the trend for a page", () => {
    const onTrendPage = vi.fn();
    mount({ onTrendPage });
    fireEvent.click(screen.getByRole("button", { name: "查看趋势" }));
    expect(onTrendPage).toHaveBeenCalledWith("page-a");
  });
});
