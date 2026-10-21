import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import type { MarketingPerformanceReport, PerformanceChanges, PerformancePoint, PerformanceTotals } from "@/lib/marketing-api";
import { PerformanceTrend, trendValue } from "./PerformanceTrend";

const chart = vi.hoisted(() => ({ props: [] as unknown[] }));
vi.mock("next/dynamic", () => ({
  default: () => {
    const Component = (props: unknown) => {
      chart.props.push(props);
      return null;
    };
    return Component;
  },
}));

function totals(overrides: Partial<PerformanceTotals> = {}): PerformanceTotals {
  return {
    visits: 0, pageTotalVisits: 0, submittedOrders: 0, validOrders: 0, confirmedOrders: 0, signedOrders: 0, duplicateOrders: 0, riskOrders: 0, afterSalesOrders: 0, refundStatusOrders: 0,
    validOrderValuePhp: "0.00", signedGrossPhp: "0.00", spendUsd: "0.00", spendPhp: "0.00", expectedCostDays: 0, recordedCostDays: 0, costCoverageComplete: true,
    orderCpaUsd: null, signedCpaUsd: null, orderRoas: null, signedRoas: null, conversionRate: null, periodBasis: "TOUCH",
    ...overrides,
  };
}
function point(overrides: Partial<PerformancePoint> = {}): PerformancePoint {
  return {
    key: "2026-09-28", from: "2026-09-30", to: "2026-10-04", partialWeek: true, includesToday: false, registeredLinkCount: 1, totals: totals(),
    ...overrides,
  };
}
function changes(overrides: Partial<PerformanceChanges> = {}): PerformanceChanges {
  return {
    visits: { state: "COMPARABLE", absolute: "40", percent: "40.00" },
    validOrders: { state: "COMPARABLE", absolute: "2", percent: "40.00" },
    signedOrders: { state: "COMPARABLE", absolute: "1", percent: "50.00" },
    spendUsd: { state: "COMPARABLE", absolute: "5.00", percent: "100.00" },
    orderCpaUsd: { state: "COMPARABLE", absolute: "0.50", percent: "25.00" },
    signedGrossPhp: { state: "COMPARABLE", absolute: "100.00", percent: "10.00" },
    signedRoas: { state: "COMPARABLE", absolute: "0.20", percent: "15.38" },
    conversionRate: { state: "COMPARABLE", absolute: "0.01", percent: "16.67" },
    ...overrides,
  };
}
function trendReport(overrides: Partial<MarketingPerformanceReport> = {}): MarketingPerformanceReport {
  return {
    asOf: "2026-10-13T01:00:00.000Z",
    scope: { view: "PRODUCT", productId: "product-1", ownerUserId: null, landingPageId: null, effectiveStatus: null, onlyOwn: false },
    overview: { total: 1, byStatus: { DRAFT: 0, LIVE: 1, SCHEDULED: 0, ENDED: 0, DISABLED: 0 }, byProduct: [] },
    current: { range: { from: "2026-09-30", to: "2026-10-07" }, registeredLinkCount: 1, totals: totals({ visits: 140, validOrders: 7, signedOrders: 4, spendUsd: "15.00", spendPhp: "870.00", orderCpaUsd: "2.14", signedRoas: "1.40" }) },
    previous: { range: { from: "2026-09-23", to: "2026-09-29" }, registeredLinkCount: 1, totals: totals({ visits: 100, validOrders: 5, signedOrders: 3, spendUsd: "8.00", spendPhp: "464.00", orderCpaUsd: "1.60", signedRoas: "1.50" }) },
    changes: changes(),
    page: 1, pageSize: 20, total: 1,
    rows: [],
    trend: {
      pageId: null, interval: "WEEK",
      points: [
        point({ key: "2026-09-28", from: "2026-09-30", to: "2026-10-04", totals: totals({ visits: 100, validOrders: 5, signedOrders: 3, spendUsd: "10.00", spendPhp: "580.00", orderCpaUsd: "2.00", signedRoas: "1.50" }) }),
        point({ key: "2026-10-05", from: "2026-10-05", to: "2026-10-07", partialWeek: true, includesToday: true, totals: totals({ visits: 40, validOrders: 2, signedOrders: 1, spendUsd: "5.00", spendPhp: "290.00", orderCpaUsd: "2.50", signedRoas: "1.20" }) }),
      ],
    },
    otherSources: { current: [], previous: null },
    ...overrides,
  };
}
const mount = (report: MarketingPerformanceReport, onInterval = vi.fn(), onClearPage = vi.fn()) => render(<AdminI18nProvider><PerformanceTrend report={report} onInterval={onInterval} onClearPage={onClearPage} /></AdminI18nProvider>);

beforeEach(() => {
  chart.props = []; localStorage.clear(); setAdminLang("zh");
});

describe("trendValue projection", () => {
  it("keeps unknown spend as a gap instead of a zero and never invents a value for missing totals", () => {
    const incompleteCost = point({ key: "2026-10-06", from: "2026-10-06", to: "2026-10-06", partialWeek: false, includesToday: false, totals: totals({ visits: 3, spendUsd: "10.00", spendPhp: "580.00", expectedCostDays: 7, recordedCostDays: 2, costCoverageComplete: false }) });
    const explicitZero = point({ key: "2026-10-07", from: "2026-10-07", to: "2026-10-07", partialWeek: false, includesToday: false, totals: totals({ visits: 3, spendUsd: "0.00", spendPhp: "0.00", expectedCostDays: 7, recordedCostDays: 7, costCoverageComplete: true }) });
    const noLink = point({ key: "2026-10-08", from: "2026-10-08", to: "2026-10-08", partialWeek: false, includesToday: false, totals: null });
    const knownEmpty = point({ key: "2026-10-09", from: "2026-10-09", to: "2026-10-09", partialWeek: false, includesToday: false, totals: totals({ visits: 0, validOrders: 0 }) });
    expect(trendValue(incompleteCost, "spendUsd")).toBeNull();
    expect(trendValue(explicitZero, "spendUsd")).toBe(0);
    expect(trendValue(noLink, "visits")).toBeNull();
    expect(trendValue(knownEmpty, "visits")).toBe(0);
    expect(trendValue(knownEmpty, "orderCpaUsd")).toBeNull();
  });
});

describe("performance trend table", () => {
  it("lists weekly points in order with the actual coverage and a today note", () => {
    mount(trendReport());
    expect(screen.getByText("整体趋势")).toBeInTheDocument();
    expect(screen.getByText("2026-09-30～10-04")).toBeInTheDocument();
    expect(screen.getByText("2026-10-05～10-07")).toBeInTheDocument();
    const rows = screen.getAllByRole("row");
    expect(rows[1]).toHaveTextContent("2026-09-30～10-04");
    expect(rows[2]).toHaveTextContent("2026-10-05～10-07");
    expect(screen.getAllByText("部分周")).toHaveLength(2);
    expect(screen.getByText("今日数据尚未完整")).toBeInTheDocument();
    expect(screen.getByText(/转化及签收仍可能继续发生/)).toBeInTheDocument();
  });

  it("shows an em dash for missing totals and the recorded amount with a costs note for unknown fees", () => {
    const report = trendReport({ trend: { pageId: null, interval: "WEEK", points: [
      point({ key: "2026-09-28", from: "2026-09-30", to: "2026-10-04", totals: null }),
      point({ key: "2026-10-05", from: "2026-10-05", to: "2026-10-07", partialWeek: true, includesToday: true, totals: totals({ visits: 40, spendUsd: "10.00", spendPhp: "580.00", expectedCostDays: 7, recordedCostDays: 2, costCoverageComplete: false }) }),
    ] } });
    mount(report);
    fireEvent.change(screen.getByLabelText("指标"), { target: { value: "spendUsd" } });
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("10.00")).toBeInTheDocument();
    expect(screen.getByText("费用待补")).toBeInTheDocument();
    const lastChartProps = chart.props[chart.props.length - 1] as { points: Array<{ value: number | null }> };
    expect(lastChartProps.points[1].value).toBeNull();
  });

  it("switches the plotted metric locally without asking for a new interval or scope", () => {
    const onInterval = vi.fn();
    mount(trendReport(), onInterval);
    fireEvent.change(screen.getByLabelText("指标"), { target: { value: "signedOrders" } });
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(onInterval).not.toHaveBeenCalled();
  });

  it("changes only the interval when the interval selector is used", () => {
    const onInterval = vi.fn();
    mount(trendReport(), onInterval);
    fireEvent.change(screen.getByLabelText("趋势间隔"), { target: { value: "DAY" } });
    expect(onInterval).toHaveBeenCalledWith("DAY");
  });

  it("explains an unplottable trend but keeps the equivalent table", () => {
    const report = trendReport({ trend: { pageId: null, interval: "WEEK", points: [point({ totals: null }), point({ key: "2026-10-05", from: "2026-10-05", to: "2026-10-07", totals: null })] } });
    mount(report);
    expect(screen.getByText(/无可绘制数据/)).toBeInTheDocument();
    expect(screen.getByText("2026-09-30～10-04")).toBeInTheDocument();
  });
});

describe("previous period comparison", () => {
  it("labels a new baseline instead of dividing by zero and never marks cost growth as a win", () => {
    const report = trendReport({ previous: { range: { from: "2026-09-23", to: "2026-09-29" }, registeredLinkCount: 1, totals: totals({ visits: 0 }) }, changes: changes({ visits: { state: "NEW", absolute: null, percent: null } }) });
    mount(report);
    expect(screen.getByText(/本期 2026-09-30～10-07/)).toBeInTheDocument();
    expect(screen.getByText(/上期 2026-09-23～09-29/)).toBeInTheDocument();
    expect(screen.getByText("新增／无可比基数")).toBeInTheDocument();
    expect(screen.queryByText(/胜出|更优|获胜/)).not.toBeInTheDocument();
  });

  it("shows only a direction for comparable changes and a not-comparable reason for incomplete costs", () => {
    const report = trendReport({ changes: changes({ visits: { state: "COMPARABLE", absolute: "40", percent: "40.00" }, spendUsd: { state: "UNAVAILABLE", absolute: null, percent: null } }) });
    mount(report);
    expect(screen.getByText(/较上期 ↑ 40\.00%/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("指标"), { target: { value: "spendUsd" } });
    expect(screen.getByText("不可比较")).toBeInTheDocument();
  });

  it("leaves no stale previous change when the comparison is switched off", () => {
    mount(trendReport({ previous: null, changes: null }));
    expect(screen.queryByText(/上期/)).not.toBeInTheDocument();
    expect(screen.queryByText(/较上期/)).not.toBeInTheDocument();
  });

  it("lets a single-page trend go back to the overall trend", () => {
    const onClearPage = vi.fn();
    mount(trendReport({ trend: { pageId: "page-a", interval: "WEEK", points: [] } }), vi.fn(), onClearPage);
    expect(screen.getByText("本页 的趋势")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看整体趋势" }));
    expect(onClearPage).toHaveBeenCalled();
  });
});
