import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { AdminApiError } from "@/lib/admin-auth";

/**
 * Task 3 — the products list joins the admin i18n: status badges and filter
 * options translate the raw DRAFT/ACTIVE/DISABLED enums (option values and
 * row data stay wire values), and core actions/labels are localized.
 */

const navState = vi.hoisted(() => ({ searchParams: "" }));
const permState = vi.hoisted(() => ({ canManage: true }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/admin/products",
  useSearchParams: () => new URLSearchParams(navState.searchParams),
}));

const listProducts = vi.fn();
const listCategories = vi.fn();
const productCounts = vi.fn();
const deleteProduct = vi.fn();
const bulkSetProductStatus = vi.fn();

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
    deleteProduct: (...args: unknown[]) => deleteProduct(...args),
    bulkSetProductStatus: (...args: unknown[]) => bulkSetProductStatus(...args),
  },
  formatAmount: (value: unknown) => (value === null || value === undefined ? "—" : `₱${value}`),
}));

vi.mock("@/components/admin/AdminAuthProvider", () => ({
  useAdminAuth: () => ({ hasPermission: () => permState.canManage }),
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

const ROW2: AdminProduct = {
  ...ROW,
  id: "p2",
  name: "Shelf",
  slug: "shelf",
  productCode: "P-000002",
} as unknown as AdminProduct;

describe("AdminProductsPage localization", () => {
  beforeEach(() => {
    setAdminLang("zh");
    navState.searchParams = "";
    permState.canManage = true;
    deleteProduct.mockReset().mockResolvedValue({ ok: true });
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
    expect(
      screen.getByText("管理商品资料、SKU、价格、媒体以及前台展示。"),
    ).toBeInTheDocument();
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
    ).toHaveClass("border-admin-warning/30");
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
    expect(
      screen.getByText(
        "Manage product details, SKUs, pricing, media, and storefront presentation.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Edit/ })).toBeInTheDocument();
  });
});

/**
 * Bulk selection and bulk delete: per-row checkboxes, select-all with an
 * indeterminate state, the bulk bar, the confirm dialog, and honest
 * partial-failure reporting (rows with order/stock history cannot be deleted).
 */
describe("AdminProductsPage bulk delete", () => {
  beforeEach(() => {
    setAdminLang("zh");
    navState.searchParams = "";
    permState.canManage = true;
    deleteProduct.mockReset().mockResolvedValue({ ok: true });
    bulkSetProductStatus.mockReset().mockResolvedValue({ updated: 0, notFound: 0 });
    listProducts.mockReset().mockResolvedValue({
      items: [ROW, ROW2],
      total: 2,
      page: 1,
      pageSize: 20,
    } satisfies Paged<AdminProduct>);
    listCategories.mockReset().mockResolvedValue([]);
    productCounts.mockReset().mockResolvedValue({
      status: { all: 2, active: 0, draft: 2, disabled: 0 },
      attention: {
        missing_media: 0,
        no_priced_sku: 0,
        incomplete_shipping: 0,
        stale_draft: 0,
      },
    });
    deleteProduct.mockReset().mockResolvedValue({ ok: true });
  });

  afterEach(cleanup);

  it("selects individual rows and shows the bulk bar with the count", async () => {
    const user = userEvent.setup();
    renderListPage();
    await screen.findAllByText("Chair");

    await user.click(screen.getByRole("checkbox", { name: "选择 Chair" }));

    expect(screen.getByRole("checkbox", { name: "选择 Chair" })).toBeChecked();
    expect(screen.getByText("已选 1 项")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "批量删除" })).toBeInTheDocument();
  });

  it("selects every row on the page and shows the indeterminate state", async () => {
    const user = userEvent.setup();
    renderListPage();
    await screen.findAllByText("Chair");

    const selectAll = screen.getByRole("checkbox", { name: "全选本页" });
    await user.click(selectAll);

    expect(screen.getByRole("checkbox", { name: "选择 Chair" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "选择 Shelf" })).toBeChecked();
    expect(screen.getByText("已选 2 项")).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "选择 Chair" }));
    expect(selectAll).not.toBeChecked();
    expect((selectAll as HTMLInputElement).indeterminate).toBe(true);
  });

  it("bulk deletes the selected products after confirmation and reports success", async () => {
    const user = userEvent.setup();
    renderListPage();
    await screen.findAllByText("Chair");

    await user.click(screen.getByRole("checkbox", { name: "全选本页" }));
    await user.click(screen.getByRole("button", { name: "批量删除" }));

    const dialog = screen.getByRole("dialog", { name: "批量删除商品" });
    expect(
      within(dialog).getByText(/将永久删除选中的 2 个商品/),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "删除" }));

    await waitFor(() => expect(deleteProduct).toHaveBeenCalledTimes(2));
    expect(deleteProduct).toHaveBeenCalledWith("p1");
    expect(deleteProduct).toHaveBeenCalledWith("p2");
    expect(await screen.findByText("已删除 2 个商品。")).toBeInTheDocument();
    // The list refetches for server truth after the batch.
    await waitFor(() =>
      expect(listProducts.mock.calls.length).toBeGreaterThan(1),
    );
  });

  it("keeps failed rows and reports them by name when part of the batch fails", async () => {
    const user = userEvent.setup();
    deleteProduct.mockImplementation((id: string) =>
      id === "p1"
        ? Promise.resolve({ ok: true })
        : Promise.reject(new Error("Foreign key constraint failed")),
    );
    renderListPage();
    await screen.findAllByText("Chair");

    await user.click(screen.getByRole("checkbox", { name: "全选本页" }));
    await user.click(screen.getByRole("button", { name: "批量删除" }));
    const dialog = screen.getByRole("dialog", { name: "批量删除商品" });
    await user.click(within(dialog).getByRole("button", { name: "删除" }));

    expect(
      await screen.findByText(/已删除 1 个；1 个未删除：/),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Shelf：Foreign key constraint failed"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(listProducts.mock.calls.length).toBeGreaterThan(1),
    );
  });

  it("clears the selection from the bulk bar", async () => {
    const user = userEvent.setup();
    renderListPage();
    await screen.findAllByText("Chair");

    await user.click(screen.getByRole("checkbox", { name: "全选本页" }));
    expect(screen.getByText("已选 2 项")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "清除选择" }));

    expect(screen.queryByText(/已选 \d+ 项/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "选择 Chair" }),
    ).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "全选本页" })).not.toBeChecked();
  });

  it("hides selection controls without PRODUCT_MANAGE", async () => {
    permState.canManage = false;
    renderListPage();
    await screen.findAllByText("Chair");

    expect(
      screen.queryByRole("checkbox", { name: "全选本页" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: "选择 Chair" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "批量删除" }),
    ).not.toBeInTheDocument();
  });

  it("maps a 409 delete block to a readable reason for a single delete", async () => {
    const user = userEvent.setup();
    deleteProduct.mockRejectedValue(
      new AdminApiError("Conflict", 409, { code: "PRODUCT_HAS_HISTORY" }),
    );
    renderListPage();
    const table = await screen.findByRole("table", { name: "商品" });
    const row = within(table)
      .getByText("Chair", { selector: 'span[title="Chair"]' })
      .closest("tr");
    expect(row).not.toBeNull();

    await user.click(within(row!).getByRole("button", { name: "更多操作" }));
    await user.click(within(row!).getByRole("button", { name: "删除" }));
    const dialog = screen.getByRole("dialog", { name: "删除商品" });
    await user.click(within(dialog).getByRole("button", { name: "删除" }));

    expect(
      await screen.findByText("该商品有库存流水或订单记录，无法删除；请改为下架。"),
    ).toBeInTheDocument();
  });

  it("reports a blocked batch delete with the readable reason per row", async () => {
    const user = userEvent.setup();
    deleteProduct.mockRejectedValue(
      new AdminApiError("Conflict", 409, { code: "PRODUCT_HAS_HISTORY" }),
    );
    renderListPage();
    await screen.findAllByText("Chair");

    await user.click(screen.getByRole("checkbox", { name: "全选本页" }));
    await user.click(screen.getByRole("button", { name: "批量删除" }));
    const dialog = screen.getByRole("dialog", { name: "批量删除商品" });
    await user.click(within(dialog).getByRole("button", { name: "删除" }));

    expect(
      await screen.findByText(/已删除 0 个；2 个未删除：/),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Chair：该商品有库存流水或订单记录，无法删除；请改为下架。"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Shelf：该商品有库存流水或订单记录，无法删除；请改为下架。"),
    ).toBeInTheDocument();
  });

  it("bulk unpublishes the selected products after confirmation", async () => {
    const user = userEvent.setup();
    bulkSetProductStatus.mockResolvedValue({ updated: 2, notFound: 0 });
    renderListPage();
    await screen.findAllByText("Chair");

    await user.click(screen.getByRole("checkbox", { name: "全选本页" }));
    await user.click(screen.getByRole("button", { name: "批量下架" }));

    const dialog = screen.getByRole("dialog", { name: "批量下架商品" });
    expect(
      within(dialog).getByText(/将把选中的 2 个商品设为下架/),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "下架" }));

    await waitFor(() =>
      expect(bulkSetProductStatus).toHaveBeenCalledWith(
        ["p1", "p2"],
        "DISABLED",
      ),
    );
    expect(await screen.findByText("已下架 2 个商品。")).toBeInTheDocument();
  });

  it("bulk publishes the selected products and reports rows that vanished", async () => {
    const user = userEvent.setup();
    bulkSetProductStatus.mockResolvedValue({ updated: 1, notFound: 1 });
    renderListPage();
    await screen.findAllByText("Chair");

    await user.click(screen.getByRole("checkbox", { name: "全选本页" }));
    await user.click(screen.getByRole("button", { name: "批量上架" }));

    const dialog = screen.getByRole("dialog", { name: "批量上架商品" });
    expect(
      within(dialog).getByText(/将把选中的 2 个商品设为上架/),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "上架" }));

    await waitFor(() =>
      expect(bulkSetProductStatus).toHaveBeenCalledWith(["p1", "p2"], "ACTIVE"),
    );
    expect(await screen.findByText("已上架 1 个商品。")).toBeInTheDocument();
    expect(
      screen.getByText("其中 1 个商品已不存在，未处理。"),
    ).toBeInTheDocument();
  });
});
