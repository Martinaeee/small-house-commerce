import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { adminApi, type AdminProduct } from "@/lib/admin-api";
import { ProductQuickView } from "@/components/admin/ProductQuickView";

/**
 * Quick view is a read-only peek: it shows only real data, fetches the full
 * graph for exactly the opened product (never for list rows), and contains no
 * editing controls at all.
 */

vi.mock("@/lib/admin-api", () => ({
  adminApi: {
    getProduct: vi.fn(),
    listProductLandingPages: vi.fn(),
  },
  formatAmount: (value: unknown) =>
    value === null || value === undefined ? "—" : `₱${value}`,
}));

const ROW: AdminProduct = {
  id: "p1",
  name: "Chair",
  slug: "chair",
  productCode: "P-000001",
  description: null,
  tagline: null,
  categoryId: "c1",
  status: "ACTIVE",
  room: null,
  internalRole: null,
  solutions: [],
  width: 40,
  height: 80,
  depth: 60,
  foldedWidth: null,
  foldedHeight: null,
  foldedDepth: null,
  materials: "Steel",
  features: null,
  images: [
    {
      id: "img-1",
      url: "/uploads/chair.jpg",
      type: "IMAGE",
      altText: null,
      sortOrder: 0,
    },
  ],
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
        compareAtPrice: "1599",
        productWeight: 8,
        packageWidth: 100,
        packageHeight: 20,
        packageDepth: 20,
        packageWeight: 9,
        volumetricWeight: null,
        onHand: 0,
        reserved: 0,
        availableInventory: 0,
      },
    },
  ],
  updatedAt: "2026-09-23T00:00:00.000Z",
} as unknown as AdminProduct;

function renderDrawer(row: AdminProduct | null, onClose = vi.fn()) {
  return render(
    <AdminI18nProvider>
      <ProductQuickView row={row} categoryName="Storage" onClose={onClose} />
    </AdminI18nProvider>,
  );
}

beforeEach(() => {
  setAdminLang("zh");
  vi.mocked(adminApi.getProduct).mockReset().mockResolvedValue(ROW);
  vi.mocked(adminApi.listProductLandingPages)
    .mockReset()
    .mockResolvedValue([]);
});

describe("ProductQuickView", () => {
  it("renders nothing without a row", () => {
    renderDrawer(null);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows real list data and fetches the graph for the opened product only", async () => {
    vi.mocked(adminApi.getProduct).mockResolvedValue(ROW);
    vi.mocked(adminApi.listProductLandingPages).mockResolvedValue([
      { id: "lp-1" },
    ] as never);
    renderDrawer(ROW);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Chair")).toBeInTheDocument();
    expect(screen.getByText("P-000001")).toBeInTheDocument();
    // Price range from the ACTIVE SKU.
    expect(screen.getByText("₱1299")).toBeInTheDocument();
    expect(screen.getByText("Storage")).toBeInTheDocument();
    // The real SKU count comes from the row, not a hard-coded number.
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
    // The open-storefront link exists only for the saved ACTIVE status.
    expect(
      screen.getByRole("link", { name: "打开前台页面" }),
    ).toHaveAttribute("href", "/products/chair");

    // Both fetches target the opened product id — one row, not the list.
    expect(vi.mocked(adminApi.getProduct)).toHaveBeenCalledWith("p1");
    expect(vi.mocked(adminApi.listProductLandingPages)).toHaveBeenCalledWith(
      "p1",
    );
    expect(await screen.findByText("1 个 →")).toBeInTheDocument();
  });

  it("keeps a DRAFT product honest: no storefront link, no live claim", () => {
    renderDrawer({ ...ROW, status: "DRAFT" });

    expect(screen.getByText("当前未上架，前台不可见。")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "打开前台页面" }),
    ).not.toBeInTheDocument();
  });

  it("closes on Escape and never contains editing controls", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderDrawer(ROW, onClose);

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);

    // Read-only by construction: no inputs, selects or price editors.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});
