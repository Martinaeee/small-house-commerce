import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";

/**
 * Task 3 — the products list joins the admin i18n: status badges and filter
 * options translate the raw DRAFT/ACTIVE/DISABLED enums (option values and
 * row data stay wire values), and core actions/labels are localized.
 */

const navState = vi.hoisted(() => ({ searchParams: "" }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/admin/products",
  useSearchParams: () => new URLSearchParams(navState.searchParams),
}));

const listProducts = vi.fn();
const listCategories = vi.fn();
const productCounts = vi.fn();

vi.mock("@/lib/admin-api", () => ({
  ADMIN_PRODUCT_ATTENTION: [
    "missing_media",
    "no_priced_sku",
    "incomplete_shipping",
    "stale_draft",
  ],
  adminApi: {
    listProducts: (...args: unknown[]) => listProducts(...args),
    listCategories: (...args: unknown[]) => listCategories(...args),
    productCounts: (...args: unknown[]) => productCounts(...args),
    getProduct: vi.fn(),
    listProductLandingPages: vi.fn(),
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
  productCode: "P-000001",
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
    navState.searchParams = "";
    listProducts.mockReset().mockResolvedValue({
      items: [ROW],
      total: 1,
      page: 1,
      pageSize: 20,
    } satisfies Paged<AdminProduct>);
    listCategories.mockReset().mockResolvedValue([]);
    productCounts.mockReset().mockResolvedValue({
      status: { all: 1, active: 0, draft: 1, disabled: 0 },
      attention: {
        missing_media: 0,
        no_priced_sku: 0,
        incomplete_shipping: 0,
        stale_draft: 0,
      },
    });
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
    expect(screen.getByRole("link", { name: /编辑/ })).toHaveAttribute(
      "href",
      "/admin/products/p1/edit",
    );
  });

  it("keeps an active attention filter visible with a one-click clear", async () => {
    navState.searchParams = "attention=missing_media";
    renderListPage();

    expect(await screen.findByText("当前筛选")).toBeInTheDocument();
    // The preset chip reads as pressed, and the removable tag names the same
    // filter so a filtered list can never look like the whole catalogue.
    expect(
      screen.getByRole("button", { name: /^缺少共享图库/ }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "清除筛选：缺少共享图库" }),
    ).toBeInTheDocument();
  });

  it("summarizes active option groups beside the SKU count", async () => {
    listProducts.mockResolvedValue({
      items: [{ ...ROW, activeOptionNames: ["Color", "Size"] }],
      total: 1,
      page: 1,
      pageSize: 20,
    } satisfies Paged<AdminProduct>);
    renderListPage();

    expect(await screen.findByText("Color × Size")).toBeInTheDocument();
    expect(screen.getAllByText("1 个 SKU").length).toBeGreaterThan(0);
  });

  it("orders compact status and attention controls before filters and the table", async () => {
    const view = renderListPage();
    await screen.findAllByText("Chair");

    const statusSummary = screen.getByRole("region", { name: "商品状态统计" });
    const attentionSummary = screen.getByRole("region", { name: "需要处理" });
    const filters = screen.getByRole("region", { name: "商品筛选" });
    const table = screen.getByRole("table", { name: "商品" });

    expect(
      statusSummary.compareDocumentPosition(attentionSummary) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      attentionSummary.compareDocumentPosition(filters) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      filters.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(view.container.querySelector(".max-w-\\[1200px\\]")).toBeNull();
  });

  it("collapses help, de-emphasizes zero attention counts, and highlights real problems", async () => {
    productCounts.mockResolvedValue({
      status: { all: 3, active: 2, draft: 1, disabled: 0 },
      attention: {
        missing_media: 2,
        no_priced_sku: 0,
        incomplete_shipping: 1,
        stale_draft: 0,
      },
    });
    renderListPage();
    await screen.findAllByText("Chair");

    const help = screen.getByText("商品管理帮助").closest("details");
    expect(help).not.toHaveAttribute("open");
    expect(
      screen.getByRole("button", { name: /^缺少共享图库/ }),
    ).toHaveClass("border-amber-300");
    expect(
      screen.getByRole("button", { name: /^已上架但没有定价 SKU/ }),
    ).toHaveClass("opacity-50");
  });

  it("uses compact storefront badges and icon-only row actions", async () => {
    renderListPage();
    const table = await screen.findByRole("table", { name: "商品" });
    const name = within(table).getByText("Chair", {
      selector: 'span[title="Chair"]',
    });
    const row = name.closest("tr");
    expect(row).not.toBeNull();
    const scoped = within(row!);

    expect(scoped.getByText("Draft")).toBeInTheDocument();
    expect(scoped.getByText(/Sep 23, 2026/)).toHaveTextContent(
      /^Sep 23, 2026$/,
    );
    const quickView = scoped.getByRole("button", { name: "快速查看 Chair" });
    const edit = scoped.getByRole("link", { name: "编辑 Chair" });
    expect(quickView.textContent).toBe("");
    expect(edit.textContent).toBe("");
    expect(scoped.getByRole("button", { name: "更多操作" })).toBeInTheDocument();
  });

  it("renders a coherent English list through the same provider", async () => {
    setAdminLang("en");
    renderListPage();

    expect((await screen.findAllByText("Chair")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Draft").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("DRAFT")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "New product" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Edit/ })).toBeInTheDocument();
  });
});
