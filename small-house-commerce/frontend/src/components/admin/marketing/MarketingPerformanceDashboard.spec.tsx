import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { marketingApi, type MarketingPerformanceOptions, type MarketingPerformanceReport, type PerformancePageRow, type PerformanceTotals } from "@/lib/marketing-api";
import { MarketingPerformanceDashboard } from "./MarketingPerformanceDashboard";

const auth = vi.hoisted(() => ({ admin: { id: "u1", name: "Operator", permissions: ["MARKETING_VIEW_ALL"] } }));
vi.mock("@/components/admin/AdminAuthProvider", () => ({ useAdminAuth: () => auth }));
vi.mock("@/lib/marketing-api", async (load) => ({ ...await load(), marketingApi: { performance: vi.fn(), performanceOptions: vi.fn(), listLinks: vi.fn() } }));
vi.mock("./PerformanceTrendChart", () => ({ default: () => null }));

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
const allReport = report([
  page("page-a", "省空间视频页", { pageTotalVisits: 30, current: { range, registeredLinkCount: 1, totals: totals({ visits: 12, validOrders: 1 }) } }),
  page("page-b", "草稿页", { effectiveStatus: "DRAFT", current: { range, registeredLinkCount: 0, totals: null } }),
  page("page-c", "无链接页", { notices: ["NO_LINKS"] }),
], {
  current: { range, registeredLinkCount: 2, totals: totals({ visits: 100, pageTotalVisits: 150, validOrders: 5, spendUsd: "10.00", orderCpaUsd: "2.00", signedRoas: "0.52" }) },
  overview: { total: 3, byStatus: { DRAFT: 1, LIVE: 1, SCHEDULED: 0, ENDED: 0, DISABLED: 0 }, byProduct: [] },
  total: 3, pageSize: 2,
});
const options: MarketingPerformanceOptions = {
  onlyOwn: false,
  products: [{ id: "product-1", name: "Chair", productCode: "LUW-001", status: "ACTIVE", thumbnailUrl: "/uploads/chair.jpg", pageCount: 3 }],
  owners: [{ userId: "u1", name: "Optimizer", aid: "OP-1", isActive: true, pageCount: 3 }],
};
const ownOptions: MarketingPerformanceOptions = { ...options, onlyOwn: true, owners: [] };
const mount = (props: Partial<Parameters<typeof MarketingPerformanceDashboard>[0]> = {}) => render(<AdminI18nProvider><MarketingPerformanceDashboard view="PRODUCT" productId="product-1" {...props} /></AdminI18nProvider>);

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve(); });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); setAdminLang("zh"); auth.admin.permissions = ["MARKETING_VIEW_ALL"];
  vi.mocked(marketingApi.performanceOptions).mockResolvedValue(options);
  vi.mocked(marketingApi.performance).mockResolvedValue(allReport);
  vi.mocked(marketingApi.listLinks).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
});

describe("marketing performance dashboard", () => {
  it("shows the all-filter summary over the paginated rows and pages without moving the summary", async () => {
    mount();
    await screen.findByRole("heading", { name: "商品页面对比" });
    expect(await screen.findByText("省空间视频页")).toBeInTheDocument();
    expect(screen.getByText("待制作草稿")).toBeInTheDocument();
    expect(screen.getByText("未建立投放链接")).toBeInTheDocument();
    const visits = screen.getByLabelText("全部筛选的投放访问");
    expect(visits).toHaveTextContent("100");
    expect(visits).not.toHaveTextContent("20");
    expect(screen.getByText(/统计截至 2026-10-13 09:00/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(marketingApi.performance).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));
    expect(screen.getByLabelText("全部筛选的投放访问")).toHaveTextContent("100");
  });

  it("owns the optimizer view without a chooser and requests only the actor", async () => {
    auth.admin.permissions = ["MARKETING_VIEW_OWN"];
    vi.mocked(marketingApi.performanceOptions).mockResolvedValue(ownOptions);
    mount({ view: "OPTIMIZER" });
    await screen.findByRole("heading", { name: "优化师总览" });
    expect(await screen.findByText("当前仅显示你的页面")).toBeInTheDocument();
    expect(screen.queryByText("选择优化师")).not.toBeInTheDocument();
    await waitFor(() => expect(marketingApi.performance).toHaveBeenCalledWith(expect.objectContaining({ view: "OPTIMIZER", ownerUserId: undefined })));
  });

  it("requires an explicit optimizer when viewing all optimizers", async () => {
    auth.admin.permissions = ["MARKETING_VIEW_ALL"];
    mount({ view: "OPTIMIZER" });
    await screen.findByRole("heading", { name: "优化师总览" });
    expect(await screen.findByText("选择优化师")).toBeInTheDocument();
    expect(marketingApi.performance).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("优化师"), { target: { value: "u1" } });
    await waitFor(() => expect(marketingApi.performance).toHaveBeenCalledWith(expect.objectContaining({ view: "OPTIMIZER", ownerUserId: "u1" })));
  });

  it("shows a retry instead of a zero-filled summary when the request fails", async () => {
    vi.mocked(marketingApi.performance).mockRejectedValue(new Error("offline"));
    mount();
    expect(await screen.findByText("offline")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
    expect(screen.queryByLabelText("全部筛选的投放访问")).not.toBeInTheDocument();
  });

  it("never shows the previous scope's owner after the account loses broad viewing", async () => {
    const slow = deferred<MarketingPerformanceReport>();
    vi.mocked(marketingApi.performance)
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValue(report([page("mine", "我的页面", { ownerName: "Optimizer" })], { scope: { view: "OPTIMIZER", productId: null, ownerUserId: "u1", landingPageId: null, effectiveStatus: null, onlyOwn: true }, overview: { total: 1, byStatus: { DRAFT: 0, LIVE: 1, SCHEDULED: 0, ENDED: 0, DISABLED: 0 }, byProduct: [{ productId: "product-1", productName: "Chair", productCode: "LUW-001", pageCount: 1 }] } }));
    auth.admin.permissions = ["MARKETING_VIEW_ALL"];
    vi.mocked(marketingApi.performanceOptions).mockResolvedValue(options);
    const view = render(<AdminI18nProvider><MarketingPerformanceDashboard view="OPTIMIZER" ownerUserId="u1" /></AdminI18nProvider>);
    await screen.findByRole("heading", { name: "优化师总览" });
    auth.admin.permissions = ["MARKETING_VIEW_OWN"];
    vi.mocked(marketingApi.performanceOptions).mockResolvedValue(ownOptions);
    view.rerender(<AdminI18nProvider><MarketingPerformanceDashboard view="OPTIMIZER" ownerUserId="u1" /></AdminI18nProvider>);
    await flush();
    await act(async () => { slow.resolve(allReport); await slow.promise; });
    await waitFor(() => expect(marketingApi.performance).toHaveBeenLastCalledWith(expect.objectContaining({ view: "OPTIMIZER", ownerUserId: undefined })));
    expect(screen.queryByText("省空间视频页")).not.toBeInTheDocument();
    expect(screen.getByText("我的页面")).toBeInTheDocument();
  });

  it("keeps product, dates, sort, page and expanded rows across a language change", async () => {
    mount();
    await screen.findByText("省空间视频页");
    fireEvent.change(screen.getByLabelText("排序"), { target: { value: "validOrders" } });
    await screen.findByText("省空间视频页");
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(marketingApi.performance).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));
    const callsBefore = vi.mocked(marketingApi.performance).mock.calls.length;
    setAdminLang("en");
    await screen.findByRole("heading", { name: "Compare product pages" });
    expect(screen.getByLabelText("Sort by")).toHaveValue("validOrders");
    expect(vi.mocked(marketingApi.performance).mock.calls.length).toBe(callsBefore);
  });
});
