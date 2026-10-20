import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PerformanceFilters } from "@/components/admin/marketing/PerformanceFilters";
import { AdminI18nProvider } from "@/lib/admin-i18n";
import type {
  MarketingPerformanceOptions,
  MarketingPerformanceQuery,
} from "@/lib/marketing-api";

const listProducts = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin-api", () => ({
  adminApi: { listProducts, getProduct: vi.fn() },
}));

listProducts.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });

const query: MarketingPerformanceQuery = {
  view: "PRODUCT",
  preset: "LAST_7_DAYS",
  interval: "DAY",
  compare: false,
  sortBy: "name",
  sortDirection: "asc",
  page: 1,
  pageSize: 20,
};

const options: MarketingPerformanceOptions = {
  onlyOwn: false,
  products: [
    {
      id: "p1",
      name: "Oak Table",
      productCode: "LUW-001",
      status: "ACTIVE",
      thumbnailUrl: "/uploads/oak-table.jpg",
      pageCount: 2,
    },
  ],
  owners: [],
};

const mount = (props: Partial<Parameters<typeof PerformanceFilters>[0]> = {}) =>
  render(
    <AdminI18nProvider>
      <PerformanceFilters
        query={query}
        onChange={() => {}}
        options={options}
        onlyOwn={false}
        loading={false}
        {...props}
      />
    </AdminI18nProvider>,
  );

describe("marketing performance product filter", () => {
  it("shows the chosen product's photo and name", async () => {
    mount({ query: { ...query, productId: "p1" } });
    const current = await screen.findByTestId(
      "marketing-performance-product-current",
    );
    expect(current).toHaveTextContent("Oak Table");
    expect(
      screen.getByTestId("marketing-performance-product-thumb"),
    ).toHaveAttribute("src", "/uploads/oak-table.jpg");
  });

  it("opens the large product page and applies the chosen product", async () => {
    const onChange = vi.fn();
    mount({ onChange });
    await userEvent.click(
      screen.getByTestId("marketing-performance-product-open"),
    );
    const option = await screen.findByTestId("product-picker-option-p1");
    expect(option).toHaveTextContent("Oak Table");
    await userEvent.click(option);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ productId: "p1" }),
    );
  });

  it("clears the chosen product", async () => {
    const onChange = vi.fn();
    mount({ query: { ...query, productId: "p1" }, onChange });
    await userEvent.click(
      await screen.findByTestId("marketing-performance-product-clear"),
    );
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ productId: undefined }),
    );
  });
});
