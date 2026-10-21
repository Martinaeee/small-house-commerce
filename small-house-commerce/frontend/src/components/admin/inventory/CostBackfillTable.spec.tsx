import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CostBackfillTable } from "./CostBackfillTable";

const api = vi.hoisted(() => ({
  inventoryCosts: vi.fn(),
  setInventoryCosts: vi.fn(),
}));
vi.mock("@/lib/admin-api", () => ({ adminApi: api }));
vi.mock("@/components/admin/AdminAuthProvider", () => ({
  useAdminAuth: () => ({ hasPermission: () => true }),
}));
vi.mock("@/lib/admin-i18n", () => ({
  useAdminI18n: () => ({
    t: (key: string, vars?: Record<string, string | number>) => {
      if (!vars) return key;
      const values = Object.entries(vars)
        .map(([name, value]) => `${name}=${value}`)
        .join(",");
      return `${key}[${values}]`;
    },
  }),
}));

const rows = [
  {
    skuId: "sku-1",
    skuCode: "CART-WH-03",
    productId: "p1",
    productName: "3-Tier Rolling Cart",
    variantName: "White",
    supplierCost: 400,
    landedCost: null,
    costCurrency: "PHP",
    onHand: 12,
    reserved: 2,
    available: 10,
    unitsSold30d: 28,
  },
  {
    skuId: "sku-2",
    skuCode: "CHAIR-SD-01",
    productId: "p2",
    productName: "Folding Chair",
    variantName: "Sand",
    supplierCost: 300,
    landedCost: 380,
    costCurrency: "PHP",
    onHand: 5,
    reserved: 0,
    available: 5,
    unitsSold30d: 3,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  api.inventoryCosts.mockResolvedValue(rows);
  api.setInventoryCosts.mockResolvedValue([
    { skuId: "sku-1", ok: true, landedCost: 520.5, supplierCost: 400, costCurrency: "PHP" },
  ]);
});

describe("CostBackfillTable", () => {
  it("lists only the SKUs that still miss a cost by default", async () => {
    render(<CostBackfillTable />);

    await waitFor(() => expect(screen.getByText("3-Tier Rolling Cart")).toBeVisible());
    expect(screen.getByText("CART-WH-03")).toBeVisible();
    expect(screen.queryByText("Folding Chair")).toBeNull();
  });

  it("shows every SKU when the missing-cost filter is off", async () => {
    render(<CostBackfillTable />);
    await waitFor(() => expect(screen.getByText("3-Tier Rolling Cart")).toBeVisible());

    await userEvent.click(screen.getByRole("checkbox"));

    expect(screen.getByText("Folding Chair")).toBeVisible();
  });

  it("saves only the rows the operator changed", async () => {
    render(<CostBackfillTable />);
    await waitFor(() => expect(screen.getByText("3-Tier Rolling Cart")).toBeVisible());

    await userEvent.type(screen.getByPlaceholderText("—"), "520.5");
    await userEvent.click(screen.getByRole("button", { name: /cost_save/ }));

    await waitFor(() => {
      expect(api.setInventoryCosts).toHaveBeenCalledWith({
        items: [{ skuId: "sku-1", landedCost: 520.5 }],
      });
    });
  });

  it("reports a row that failed to save", async () => {
    api.setInventoryCosts.mockResolvedValue([
      { skuId: "sku-1", ok: false, error: "SKU not found" },
    ]);
    render(<CostBackfillTable />);
    await waitFor(() => expect(screen.getByText("3-Tier Rolling Cart")).toBeVisible());

    await userEvent.type(screen.getByPlaceholderText("—"), "520.5");
    await userEvent.click(screen.getByRole("button", { name: /cost_save/ }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("CART-WH-03: SKU not found");
    });
  });

  it("keeps the search box filtering the grid", async () => {
    render(<CostBackfillTable />);
    await waitFor(() => expect(screen.getByText("3-Tier Rolling Cart")).toBeVisible());

    // Show every SKU first, otherwise the missing-cost filter already hides
    // the row this search is looking for.
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.type(screen.getByLabelText("cost_search"), "chair");

    expect(screen.queryByText("3-Tier Rolling Cart")).toBeNull();
    expect(screen.getByText("Folding Chair")).toBeVisible();
  });
});
