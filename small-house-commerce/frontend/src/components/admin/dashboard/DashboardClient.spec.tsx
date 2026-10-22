import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardClient } from "./DashboardClient";

const api = vi.hoisted(() => ({
  overview: vi.fn(),
  products: vi.fn(),
  marketing: vi.fn(),
}));
const navigation = vi.hoisted(() => ({
  query: "",
  replace: vi.fn(),
}));
vi.mock("@/lib/dashboard-api", () => ({ dashboardApi: api }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin",
  useRouter: () => ({ replace: navigation.replace }),
  useSearchParams: () => new URLSearchParams(navigation.query),
}));

vi.mock("@/components/admin/AdminAuthProvider", () => ({
  useAdminAuth: () => ({
    status: "authed",
    admin: {
      id: "admin-1",
      name: "Admin",
      email: "admin@example.com",
      status: "ACTIVE",
      roles: [],
      permissions: ["ORDER_VIEW_ALL", "PRODUCT_MANAGE", "INVENTORY_VIEW"],
    },
    hasPermission: () => true,
    logout: vi.fn(),
  }),
}));

vi.mock("@/lib/admin-i18n", () => ({
  useAdminI18n: () => ({ t: (key: string) => key }),
}));

const overview = {
  range: {
    preset: "LAST_7_DAYS" as const,
    fromDate: "2026-10-15",
    toDate: "2026-10-21",
    days: 7,
    previousFromDate: "2026-10-08",
    previousToDate: "2026-10-14",
  },
  generatedAt: "2026-10-21T02:00:00.000Z",
  currency: "PHP" as const,
  capabilities: {
    sales: true,
    profit: false,
    inventory: true,
    products: true,
    marketing: false,
    content: true,
    customers: true,
  },
  kpis: {
    netSales: { value: 86200, change: { percent: 12.5, direction: "UP" as const } },
    orders: { value: 38, change: { percent: 5, direction: "UP" as const } },
    conversionRate: { value: 0.0342, change: { percent: 0, direction: "FLAT" as const } },
    averageOrderValue: { value: 2268, change: { percent: -3, direction: "DOWN" as const } },
    refundRate: { value: 0.02, change: { percent: 0, direction: "FLAT" as const } },
    grossProfit: {
      value: null,
      change: { percent: null, direction: "UNKNOWN" as const },
      costCoverage: 0.5,
      missing: ["PRODUCT_COST"],
      unavailableReason: "COST_DATA_INCOMPLETE",
    },
  },
  salesSeries: [
    { day: "2026-10-15", label: "Oct 15", revenue: 1000, orders: 2 },
    { day: "2026-10-16", label: "Oct 16", revenue: 2000, orders: 4 },
  ],
  salesTotals: { totalSales: 86200, orders: 38, averageOrderValue: 2268, customers: 30 },
  needsAttention: [
    {
      key: "AWAITING_FULFILLMENT",
      labelKey: "AWAITING_FULFILLMENT",
      count: 18,
      href: "/admin/orders?status=CONFIRMED",
      tone: "amber" as const,
    },
  ],
  ordersOverview: {
    tiles: [
      {
        key: "TO_FULFILL",
        count: 18,
        href: "/admin/orders?status=CONFIRMED",
        tone: "amber" as const,
      },
    ],
    total: 38,
  },
  ordersByLocation: {
    rows: [{ province: "Metro Manila", orders: 20, revenue: 40000 }],
    total: 38,
  },
  customerSnapshot: {
    newCustomers: 12,
    returningCustomers: 18,
    repeatPurchaseRate: 0.4,
    repeatCustomers: 12,
    totalCustomers: 30,
    emailSubscribers: 120,
    newEmailSubscribers: 4,
  },
  scheduledContent: [
    {
      id: "promotion-1",
      kind: "PROMOTION",
      title: "Promo code 10.10",
      status: "SCHEDULED" as const,
      scheduledFor: "2026-10-25T00:00:00.000Z",
      endsAt: null,
      href: "/admin/newsletter?tab=promotions",
    },
  ],
  recentOrders: [
    {
      id: "order-1",
      orderNumber: "LW-1001",
      customerName: "Maria Santos",
      itemCount: 2,
      total: "1299.00",
      currency: "PHP",
      paymentStatus: "COD_PENDING",
      orderStatus: "NEW",
      confirmationStatus: "UNCONFIRMED",
      createdAt: "2026-10-21T01:00:00.000Z",
    },
  ],
  quickCreate: [{ key: "PRODUCT", label: "Add product", href: "/admin/products/new" }],
  dataNotes: [{ key: "TRAFFIC" }],
};

const products = {
  range: overview.range,
  generatedAt: overview.generatedAt,
  capabilities: { products: true, inventory: true },
  thresholds: {
    lowStockUnits: 10,
    stockoutHorizonDays: 14,
    velocityWindowDays: 7,
    lowConversionRate: 0.01,
    minViewsForConversion: 50,
    highCancellationRate: 0.15,
    minOrdersForCancellation: 5,
    lowTrafficViews: 20,
    highRefundRate: 0.05,
    minOrdersForRefund: 5,
  },
  topProducts: [
    {
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
    },
  ],
  productAttention: [
    {
      productId: "product-2",
      name: "Shoe Cabinet",
      imageUrl: null,
      issue: "LOW_CONVERSION" as const,
      value: 0.007,
      orders: 1,
      views: 100,
    },
  ],
  inventoryAlerts: [
    {
      skuId: "sku-1",
      productName: "3-Tier Rolling Cart",
      variantName: "White",
      skuCode: "CART-WH-03",
      imageUrl: null,
      available: 12,
      unitsSold: 28,
      dailyUnits: 4,
      stockoutDays: 3,
      status: "OK" as const,
      restockHref: "/admin/inventory?search=CART-WH-03",
    },
  ],
  codMetrics: {
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
  },
  sort: "revenue" as const,
};

const marketing = {
  range: overview.range,
  generatedAt: overview.generatedAt,
  capabilities: { marketing: false, content: true },
  campaigns: [],
  homepage: {
    sections: [
      {
        sectionId: "section-1",
        sectionType: "HERO",
        title: "Hero",
        impressions: 1200,
        clicks: 96,
        ctr: 0.08,
      },
    ],
    totals: { impressions: 1200, clicks: 96, ctr: 0.08 },
    trackingSince: "2026-10-18",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  navigation.query = "";
  api.overview.mockResolvedValue(overview);
  api.products.mockResolvedValue(products);
  api.marketing.mockResolvedValue(marketing);
});

describe("DashboardClient", () => {
  it("renders every workbench card from the three API groups", async () => {
    render(<DashboardClient />);

    await waitFor(() => {
      expect(screen.getByText("dash_sales_overview")).toBeVisible();
    });

    expect(screen.getByText("dash_needs_attention")).toBeVisible();
    expect(screen.getByText("dash_orders_overview")).toBeVisible();
    expect(screen.getByText("dash_orders_by_location")).toBeVisible();
    expect(screen.getByText("dash_product_performance")).toBeVisible();
    expect(screen.getByText("dash_cod_metrics")).toBeVisible();
    expect(screen.getByText("dash_product_attention")).toBeVisible();
    expect(screen.getByText("dash_inventory_alerts")).toBeVisible();
    expect(screen.getByText("dash_homepage_performance")).toBeVisible();
    expect(screen.getByText("dash_customers")).toBeVisible();
    expect(screen.getByText("dash_scheduled")).toBeVisible();
    expect(screen.getByText("dash_recent_orders")).toBeVisible();
  });

  it("loads the period named in the URL", async () => {
    navigation.query = "range=LAST_MONTH";

    render(<DashboardClient />);

    await waitFor(() => expect(api.overview).toHaveBeenCalled());
    expect(api.overview.mock.calls[0][0]).toEqual({ range: "LAST_MONTH" });
  });

  it("loads the default period on mount", async () => {
    render(<DashboardClient />);

    await waitFor(() => expect(api.overview).toHaveBeenCalled());
    expect(api.overview.mock.calls[0][0]).toEqual({ range: "LAST_7_DAYS" });
  });

  it("keeps the selected period in the URL", async () => {
    render(<DashboardClient />);
    await waitFor(() => expect(api.overview).toHaveBeenCalled());

    await userEvent.selectOptions(
      screen.getByLabelText("dash_range_custom"),
      "LAST_30_DAYS",
    );

    expect(navigation.replace).toHaveBeenCalledWith(
      "/admin?range=LAST_30_DAYS",
      { scroll: false },
    );
  });

  it("reloads every group when the period changes", async () => {
    render(<DashboardClient />);
    await waitFor(() => expect(api.overview).toHaveBeenCalled());

    const select = screen.getByLabelText("dash_range_custom");
    await userEvent.selectOptions(select, "LAST_30_DAYS");

    await waitFor(() => {
      expect(api.overview.mock.calls.at(-1)?.[0]).toEqual({ range: "LAST_30_DAYS" });
    });
    expect(api.products.mock.calls.at(-1)?.[0]).toEqual({
      range: "LAST_30_DAYS",
      sort: "revenue",
    });
    expect(api.marketing.mock.calls.at(-1)?.[0]).toEqual({ range: "LAST_30_DAYS" });
  });

  it("re-reads only the product group when the ranking changes", async () => {
    render(<DashboardClient />);
    await waitFor(() => expect(api.products).toHaveBeenCalled());
    const overviewCalls = api.overview.mock.calls.length;
    const marketingCalls = api.marketing.mock.calls.length;

    await userEvent.selectOptions(
      screen.getByLabelText("dash_sort_by"),
      "signed_rate",
    );

    await waitFor(() => {
      expect(api.products.mock.calls.at(-1)?.[0]).toEqual({
        range: "LAST_7_DAYS",
        sort: "signed_rate",
      });
    });
    // Sales and campaigns do not depend on the ranking.
    expect(api.overview.mock.calls).toHaveLength(overviewCalls);
    expect(api.marketing.mock.calls).toHaveLength(marketingCalls);
  });

  it("keeps the page usable when one group fails", async () => {
    api.marketing.mockRejectedValue(new Error("campaign service down"));

    render(<DashboardClient />);

    await waitFor(() => {
      expect(screen.getByText("dash_sales_overview")).toBeVisible();
    });
    expect(screen.getByRole("alert")).toBeVisible();
    // The failed group says so instead of rendering fake zeroes.
    expect(screen.getAllByText("dash_no_permission").length).toBeGreaterThan(0);
  });
});
