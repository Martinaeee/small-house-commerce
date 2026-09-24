import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";

/**
 * Task 3 — the products list joins the admin i18n: status badges and filter
 * options translate the raw DRAFT/ACTIVE/DISABLED enums (option values and
 * row data stay wire values), and core actions/labels are localized.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/admin/products",
  useSearchParams: () => new URLSearchParams(""),
}));

const listProducts = vi.fn();
const listCategories = vi.fn();

vi.mock("@/lib/admin-api", () => ({
  adminApi: {
    listProducts: (...args: unknown[]) => listProducts(...args),
    listCategories: (...args: unknown[]) => listCategories(...args),
    deleteProduct: vi.fn(),
  },
  formatAmount: (value: unknown) => (value === null || value === undefined ? "—" : `₱${value}`),
}));

vi.mock("@/components/admin/AdminAuthProvider", () => ({
  useAdminAuth: () => ({ hasPermission: () => true }),
}));

import type { AdminProduct, Paged } from "@/lib/admin-api";
import AdminProductsPage from "./page";

const ROW: AdminProduct = {
  id: "p1",
  name: "Chair",
  slug: "chair",
  description: null,
  tagline: null,
  categoryId: "c1",
  status: "DRAFT",
  room: null,
  internalRole: null,
  solutions: [],
  width: null,
  height: null,
  depth: null,
  foldedWidth: null,
  foldedHeight: null,
  foldedDepth: null,
  materials: null,
  features: null,
  images: [],
  detailBlocks: [],
  variants: [
    {
      id: "v1",
      name: "Default",
      position: 0,
      sku: {
        id: "sku-1",
        skuCode: "SH-1",
        status: "ACTIVE",
        supplierId: null,
        supplierSku: null,
        supplierCost: null,
        costCurrency: null,
        landedCost: null,
        price: "1299",
        compareAtPrice: null,
        productWeight: null,
        packageWidth: null,
        packageHeight: null,
        packageDepth: null,
        packageWeight: null,
        volumetricWeight: null,
        onHand: 0,
        reserved: 0,
        availableInventory: 0,
      },
    },
  ],
  updatedAt: "2026-09-23T00:00:00.000Z",
} as unknown as AdminProduct;

function renderListPage() {
  return render(
    <AdminI18nProvider>
      <AdminProductsPage />
    </AdminI18nProvider>,
  );
}

describe("AdminProductsPage localization", () => {
  beforeEach(() => {
    setAdminLang("zh");
    listProducts.mockReset().mockResolvedValue({
      items: [ROW],
      total: 1,
      page: 1,
      pageSize: 20,
    } satisfies Paged<AdminProduct>);
    listCategories.mockReset().mockResolvedValue([]);
  });

  afterEach(cleanup);

  it("renders translated status badges and filter options while the values stay wire enums", async () => {
    renderListPage();

    expect((await screen.findAllByText("Chair")).length).toBeGreaterThan(0);
    // The DRAFT row badge and the filter option both render 草稿; nothing
    // shows the raw enum anymore.
    expect(screen.getAllByText("草稿").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("DRAFT")).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "草稿" })).toHaveAttribute("value", "DRAFT");
    expect(screen.getByRole("option", { name: "上架" })).toHaveAttribute("value", "ACTIVE");
    expect(screen.getByRole("option", { name: "下架" })).toHaveAttribute("value", "DISABLED");
    expect(screen.getByRole("link", { name: "新建商品" })).toHaveAttribute(
      "href",
      "/admin/products/new",
    );
    expect(screen.getByRole("link", { name: "编辑" })).toHaveAttribute(
      "href",
      "/admin/products/p1/edit",
    );
  });

  it("renders a coherent English list through the same provider", async () => {
    setAdminLang("en");
    renderListPage();

    expect((await screen.findAllByText("Chair")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Draft").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("DRAFT")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "New product" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Edit" })).toBeInTheDocument();
  });
});
