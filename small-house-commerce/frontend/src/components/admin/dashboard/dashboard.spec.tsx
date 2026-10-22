import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { KpiValue } from "@/lib/dashboard-api";
import { DashboardKpis } from "./DashboardKpis";
import { CodMetricsCard } from "./CodMetricsCard";
import { InventoryAlertsCard } from "./InventoryAlertsCard";
import { NeedsAttention } from "./NeedsAttention";
import { OrdersOverview } from "./OrdersOverview";
import { ProductPerformanceTable } from "./ProductPerformanceTable";
import { count, money, ratio, untilLabel } from "./format";

vi.mock("@/lib/admin-i18n", () => ({
  useAdminI18n: () => ({
    // The dictionary is mocked out: a key with parameters renders as
    // `key[value]`, so a test can assert the parameter reached the label.
    t: (key: string, params?: Record<string, string | number>) => {
      if (!params) return key;
      const values = Object.entries(params)
        .map(([name, value]) => `${name}=${value}`)
        .join(",");
      return `${key}[${values}]`;
    },
  }),
}));

function kpi(overrides: Partial<KpiValue> = {}): KpiValue {
  return { value: 10, change: { percent: 5, direction: "UP" }, ...overrides };
}

describe("DashboardKpis", () => {
  it("renders every metric with its value and period change", () => {
    render(
      <DashboardKpis
        kpis={{
          netSales: kpi({ value: 12345 }),
          orders: kpi({ value: 42 }),
          conversionRate: kpi({ value: 0.0342 }),
          averageOrderValue: kpi({ value: 294 }),
          refundRate: kpi({ value: 0.02 }),
          grossProfit: { ...kpi({ value: 4000 }), costCoverage: 1, partial: false, missing: [] },
        }}
      />,
    );

    expect(screen.getByText("₱12,345")).toBeVisible();
    expect(screen.getByText("42")).toBeVisible();
    expect(screen.getByText("3.42%")).toBeVisible();
    expect(screen.getByText("₱294.00")).toBeVisible();
    expect(screen.getByText("2.00%")).toBeVisible();
    expect(screen.getByText("₱4,000")).toBeVisible();
    expect(screen.getAllByText(/↑ 5\.0%/).length).toBeGreaterThan(0);
  });

  it("shows a dash and the reason instead of a zero when a metric is unavailable", () => {
    render(
      <DashboardKpis
        kpis={{
          netSales: kpi({ value: null, unavailableReason: "NO_PERMISSION" }),
          orders: kpi({ value: 0 }),
          conversionRate: kpi({ value: null, unavailableReason: "NO_TRAFFIC_DATA" }),
          averageOrderValue: kpi({ value: null, unavailableReason: "NO_ORDERS" }),
          refundRate: kpi({ value: 0 }),
          grossProfit: {
            ...kpi({ value: null, unavailableReason: "COST_DATA_INCOMPLETE" }),
            costCoverage: 0.5,
            partial: false,
            missing: ["PRODUCT_COST"],
          },
        }}
      />,
    );

    expect(screen.getByText("dash_no_permission")).toBeVisible();
    expect(screen.getByText("dash_no_traffic")).toBeVisible();
    expect(screen.getByText("dash_no_orders")).toBeVisible();
    expect(screen.getByText("dash_cost_incomplete")).toBeVisible();
    // A real zero is still a real zero.
    expect(screen.getByText("0")).toBeVisible();
  });

  it("states the reduced profit formula when a cost input was not recorded", () => {
    render(
      <DashboardKpis
        kpis={{
          netSales: kpi(),
          orders: kpi(),
          conversionRate: kpi(),
          averageOrderValue: kpi(),
          refundRate: kpi(),
          grossProfit: {
            ...kpi({ value: 4000 }),
            costCoverage: 1,
            partial: true,
            missing: ["SHIPPING_COST", "PAYMENT_FEE"],
          },
        }}
      />,
    );

    // The number is profitable product margin, not the full formula; the card
    // itself has to say which inputs were left out.
    expect(screen.getByText("₱4,000")).toBeVisible();
    expect(screen.getByText(/dash_kpi_gross_profit_hint_partial/)).toBeVisible();
    expect(screen.queryByText("dash_kpi_gross_profit_hint")).toBeNull();
  });

  it("states the full profit formula once every cost input is recorded", () => {
    render(
      <DashboardKpis
        kpis={{
          netSales: kpi(),
          orders: kpi(),
          conversionRate: kpi(),
          averageOrderValue: kpi(),
          refundRate: kpi(),
          grossProfit: { ...kpi({ value: 4000 }), costCoverage: 1, partial: false, missing: [] },
        }}
      />,
    );

    expect(screen.getByText("dash_kpi_gross_profit_hint")).toBeVisible();
  });
});

describe("NeedsAttention", () => {
  it("links every item to its filtered list", () => {
    render(
      <NeedsAttention
        canRead
        loading={false}
        items={[
          {
            key: "AWAITING_FULFILLMENT",
            labelKey: "AWAITING_FULFILLMENT",
            count: 18,
            href: "/admin/orders?status=CONFIRMED",
            tone: "amber",
          },
        ]}
      />,
    );

    const link = screen.getByRole("link", { name: /dash_attention_awaiting_fulfillment/ });
    expect(link).toHaveAttribute("href", "/admin/orders?status=CONFIRMED");
    expect(within(link).getByText("18")).toBeVisible();
  });

  it("says so when nothing needs attention", () => {
    render(<NeedsAttention canRead loading={false} items={[]} />);
    expect(screen.getByText("dash_all_clear")).toBeVisible();
  });

  it("reports a missing permission instead of an empty list", () => {
    render(<NeedsAttention canRead={false} loading={false} items={[]} />);
    expect(screen.getByText("dash_no_permission")).toBeVisible();
  });
});

describe("OrdersOverview", () => {
  it("renders every pipeline tile with its drill-down link", () => {
    render(
      <OrdersOverview
        canRead
        loading={false}
        total={10}
        tiles={[
          { key: "TO_FULFILL", count: 3, href: "/admin/orders?status=CONFIRMED", tone: "amber" },
          { key: "DELIVERED", count: 7, href: "/admin/orders?status=SIGNED", tone: "green" },
        ]}
      />,
    );

    expect(screen.getByRole("link", { name: /dash_tile_to_fulfill/ })).toHaveAttribute(
      "href",
      "/admin/orders?status=CONFIRMED",
    );
    expect(screen.getByRole("link", { name: /dash_tile_delivered/ })).toHaveAttribute(
      "href",
      "/admin/orders?status=SIGNED",
    );
  });
});

describe("InventoryAlertsCard", () => {
  it("refuses to print a stockout estimate it cannot compute", () => {
    render(
      <InventoryAlertsCard
        canRead
        loading={false}
        velocityWindowDays={7}
        alerts={[
          {
            skuId: "sku-1",
            productName: "3-Tier Rolling Cart",
            variantName: "White",
            skuCode: "CART-WH-03",
            imageUrl: null,
            available: 12,
            unitsSold: 0,
            dailyUnits: 0,
            stockoutDays: null,
            status: "NO_RECENT_SALES",
            restockHref: "/admin/inventory?search=CART-WH-03",
          },
        ]}
      />,
    );

    expect(screen.getByText("CART-WH-03")).toBeVisible();
    expect(screen.getByText("dash_stockout_unknown")).toBeVisible();
    expect(screen.getByRole("link", { name: "dash_restock" })).toHaveAttribute(
      "href",
      "/admin/inventory?search=CART-WH-03",
    );
  });

  it("shows the estimated days when the pace is known", () => {
    render(
      <InventoryAlertsCard
        canRead
        loading={false}
        velocityWindowDays={7}
        alerts={[
          {
            skuId: "sku-2",
            productName: "Folding Chair",
            variantName: "Sand",
            skuCode: "CHAIR-SD-01",
            imageUrl: null,
            available: 12,
            unitsSold: 28,
            dailyUnits: 4,
            stockoutDays: 3,
            status: "OK",
            restockHref: "/admin/inventory?search=CHAIR-SD-01",
          },
        ]}
      />,
    );

    const card = screen.getByText("dash_stockout_days[days=3]").closest("li");
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).queryByText("dash_stockout_unknown")).toBeNull();
    expect(screen.getByText("12")).toBeVisible();
  });
});

describe("ProductPerformanceTable", () => {
  const product = {
    productId: "product-1",
    name: "3-Tier Rolling Cart",
    slug: "rolling-cart",
    imageUrl: null,
    orders: 12,
    validOrders: 11,
    units: 20,
    revenue: 24000,
    signedOrders: 8,
    signedRate: 0.6667,
    cost: 12000,
    profit: 12000,
    costCoverage: 1,
    change: { percent: 8, direction: "UP" as const },
  };

  it("shows the signed rate and the profit of each product", () => {
    render(
      <ProductPerformanceTable
        canRead
        loading={false}
        products={[product]}
        sort="revenue"
        onSortChange={() => {}}
      />,
    );

    expect(screen.getByText("3-Tier Rolling Cart")).toBeVisible();
    expect(screen.getByText("66.7%")).toBeVisible();
    expect(screen.getByText("₱12,000")).toBeVisible();
    expect(screen.getByText("₱24,000")).toBeVisible();
  });

  it("withholds the profit while the cost snapshot is incomplete", () => {
    render(
      <ProductPerformanceTable
        canRead
        loading={false}
        products={[{ ...product, cost: null, profit: null, costCoverage: 0.5 }]}
        sort="revenue"
        onSortChange={() => {}}
      />,
    );

    const cell = screen.getByText("—");
    expect(cell).toBeVisible();
    expect(screen.queryByText("₱12,000")).toBeNull();
  });

  it("offers the four rankings and reports the chosen one", () => {
    const onSortChange = vi.fn();
    render(
      <ProductPerformanceTable
        canRead
        loading={false}
        products={[product]}
        sort="revenue"
        onSortChange={onSortChange}
      />,
    );

    const select = screen.getByLabelText("dash_sort_by");
    expect(
      within(select).getAllByRole("option").map((option) => option.getAttribute("value")),
    ).toEqual(["revenue", "orders", "signed_rate", "units"]);
  });
});

describe("CodMetricsCard", () => {
  it("shows the fulfilment rates of the period", () => {
    render(
      <CodMetricsCard
        canRead
        loading={false}
        metrics={{
          createdOrders: 38,
          validOrders: 36,
          confirmedOrders: 30,
          shippedOrders: 26,
          signedOrders: 22,
          cancelledOrders: 1,
          deniedOrders: 1,
          confirmationRate: 0.7895,
          signedRate: 0.5789,
          cancelRate: 0.0263,
          deniedRate: 0.0263,
          shippingToSignedRate: 0.8462,
        }}
      />,
    );

    expect(screen.getByText("79.0%")).toBeVisible();
    expect(screen.getByText("57.9%")).toBeVisible();
    expect(screen.getByText("84.6%")).toBeVisible();
    // Cancel and denied happen to have the same rate here.
    expect(screen.getAllByText("2.6%")).toHaveLength(2);
  });

  it("reports a missing permission instead of zeroed rates", () => {
    render(<CodMetricsCard canRead={false} loading={false} metrics={null} />);
    expect(screen.getByText("dash_no_permission")).toBeVisible();
  });
});

describe("format helpers", () => {
  it("formats money, counts and ratios", () => {
    expect(money(12345)).toBe("₱12,345");
    expect(money(1234.5, true)).toBe("₱1,234.50");
    expect(money(null)).toBe("—");
    expect(count(1234)).toBe("1,234");
    expect(ratio(0.0342)).toBe("3.42%");
    expect(ratio(null)).toBe("—");
  });

  it("describes the time left without inventing one", () => {
    const now = new Date("2026-10-21T00:00:00.000Z");
    expect(untilLabel("2026-10-22T06:00:00.000Z", now)).toBe("1d 6h");
    expect(untilLabel("2026-10-20T00:00:00.000Z", now)).toBeNull();
    expect(untilLabel(null, now)).toBeNull();
  });
});
