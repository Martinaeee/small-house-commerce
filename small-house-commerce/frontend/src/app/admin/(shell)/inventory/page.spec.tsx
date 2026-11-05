import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import type { AdminProduct, AdminSku, Paged } from "@/lib/admin-api";
import InventoryPage from "./page";

const state = vi.hoisted(() => ({ canAdjust: true, query: "" }));
const api = vi.hoisted(() => ({ listProducts: vi.fn(), adjustStock: vi.fn() }));
const router = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/admin/inventory",
  useSearchParams: () => new URLSearchParams(state.query),
}));
vi.mock("@/components/admin/AdminAuthProvider", () => ({
  useAdminAuth: () => ({ hasPermission: () => state.canAdjust }),
}));
vi.mock("@/lib/admin-api", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/admin-api")>(),
  adminApi: api,
}));

function sku(id: string, isBundle: boolean): AdminSku {
  return {
    id,
    skuCode: isBundle ? "SET-1" : "CHAIR-1",
    status: "ACTIVE",
    isBundle,
    bundleVersion: isBundle ? 1 : 0,
    supplierId: null,
    price: "2499",
    compareAtPrice: null,
    supplierSku: null,
    supplierCost: null,
    costCurrency: null,
    landedCost: null,
    productWidth: null,
    productHeight: null,
    productDepth: null,
    productWeight: null,
    packageWidth: null,
    packageHeight: null,
    packageDepth: null,
    packageWeight: null,
    volumetricWeight: null,
    onHand: isBundle ? 99 : 8,
    reserved: isBundle ? 77 : 2,
    availableInventory: isBundle ? 3 : 6,
  };
}

const product: AdminProduct = {
  id: "p1",
  name: "Dining furniture",
  slug: "dining-furniture",
  productCode: "P-000001",
  description: null,
  tagline: null,
  categoryId: "c1",
  status: "ACTIVE",
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
  createdAt: "2026-10-16T00:00:00.000Z",
  updatedAt: "2026-10-16T00:00:00.000Z",
  catalogGraphVersion: 0,
  defaultDisplayVariantId: null,
  images: [
    { id: "video", url: "/uploads/chair.mp4", type: "VIDEO", altText: null, sortOrder: 0 },
    { id: "scene", url: "/uploads/dining-scene.jpg", type: "IMAGE", altText: null, sortOrder: 1, isScene: true },
    { id: "photo", url: "/uploads/chair-main.jpg", type: "IMAGE", altText: null, sortOrder: 2 },
  ],
  detailBlocks: [],
  variants: [
    { id: "vb", name: "Dining set", position: 0, sku: sku("bundle-sku", true) },
    { id: "vc", name: "Chair", position: 1, sku: sku("chair-sku", false) },
  ],
};

const singleProduct: AdminProduct = {
  ...product,
  id: "p2",
  name: "Side table",
  slug: "side-table",
  productCode: "P-000002",
  images: [],
  variants: [{
    id: "vt",
    name: "Oak",
    position: 0,
    sku: { ...sku("table-sku", false), skuCode: "TABLE-1" },
  }],
};

function showProducts(items: AdminProduct[]) {
  api.listProducts.mockResolvedValue({
    items, total: items.length, page: 1, pageSize: 20,
  } satisfies Paged<AdminProduct>);
}

function renderPage() {
  return render(<AdminI18nProvider><InventoryPage /></AdminI18nProvider>);
}

async function expandProduct(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", {
    name: "Expand variants for Dining furniture",
  }));
}

describe("Grouped inventory", () => {
  beforeEach(() => {
    setAdminLang("en");
    state.canAdjust = true;
    state.query = "";
    router.replace.mockReset();
    api.listProducts.mockReset();
    showProducts([product]);
    api.adjustStock.mockReset().mockResolvedValue({ onHand: 9, reserved: 2, available: 7 });
  });
  afterEach(cleanup);

  it("starts with one collapsed product instead of flat SKU rows", async () => {
    renderPage();
    const toggle = await screen.findByRole("button", {
      name: "Expand variants for Dining furniture",
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getAllByText("Dining furniture")).toHaveLength(1);
    expect(within(toggle).getByText("2 variants")).toBeInTheDocument();
    expect(screen.queryByRole("cell", { name: "SET-1" })).not.toBeInTheDocument();
    expect(screen.queryByRole("cell", { name: "CHAIR-1" })).not.toBeInTheDocument();
  });

  it("expands and collapses variants with the keyboard without fetching again", async () => {
    const user = userEvent.setup();
    renderPage();
    const toggle = await screen.findByRole("button", {
      name: "Expand variants for Dining furniture",
    });
    toggle.focus();
    await user.keyboard("{Enter}");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("cell", { name: "SET-1" })).toBeVisible();
    expect(screen.getByRole("cell", { name: "CHAIR-1" })).toBeVisible();
    await user.keyboard(" ");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("cell", { name: "CHAIR-1" })).not.toBeInTheDocument();
    expect(api.listProducts).toHaveBeenCalledTimes(1);
  });

  it("shows a single-variant product directly without an expansion step", async () => {
    showProducts([product, singleProduct]);
    renderPage();
    const row = (await screen.findByRole("cell", { name: "TABLE-1" })).closest("tr")!;
    expect(within(row).getByText("Side table")).toBeInTheDocument();
    expect(within(row).getByText("Oak")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Adjust" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /variants for Side table/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("cell", { name: "CHAIR-1" })).not.toBeInTheDocument();
  });

  it("uses a real product photo instead of video or scene media for the thumbnail", async () => {
    renderPage();
    const image = await screen.findByRole("img", { name: "Dining furniture" });
    expect(image).toHaveAttribute("src", "/_next/image?url=%2Fuploads%2Fchair-main.jpg&w=96&q=75");
  });

  it("keeps the product usable when its thumbnail fails to load", async () => {
    renderPage();
    fireEvent.error(await screen.findByRole("img", { name: "Dining furniture" }));
    expect(screen.queryByRole("img", { name: "Dining furniture" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand variants for Dining furniture" })).toBeEnabled();
  });

  it("makes available stock the emphasized quantity, not physical on-hand stock", async () => {
    showProducts([singleProduct]);
    renderPage();
    const row = (await screen.findByRole("cell", { name: "TABLE-1" })).closest("tr")!;
    expect(within(row).getByText("6", { selector: "strong" })).toBeVisible();
    expect(within(row).getByText(/On hand 8/)).toHaveTextContent("Reserved 2");
    expect(within(row).queryByText("8", { selector: "strong" })).not.toBeInTheDocument();
  });

  it("marks zero available stock as out of stock even when on-hand stock is positive", async () => {
    showProducts([{
      ...singleProduct,
      variants: [{
        ...singleProduct.variants[0],
        sku: { ...sku("table-sku", false), skuCode: "TABLE-1", onHand: 2, reserved: 2, availableInventory: 0 },
      }],
    }]);
    renderPage();
    const row = (await screen.findByRole("cell", { name: "TABLE-1" })).closest("tr")!;
    expect(within(row).getByText("0", { selector: "strong" })).toBeVisible();
    expect(within(row).getByText("Out of stock")).toBeVisible();
  });

  it.each(["Dining", "CHAIR-1"])("automatically expands matching variants for search %s", async (search) => {
    state.query = `search=${search}`;
    renderPage();
    expect(await screen.findByRole("cell", { name: "CHAIR-1" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Collapse variants for Dining furniture" })).toHaveAttribute("aria-expanded", "true");
    if (search === "CHAIR-1") {
      expect(screen.queryByRole("cell", { name: "SET-1" })).not.toBeInTheDocument();
    }
  });

  it("shows Bundle availability without physical figures or an adjustment control", async () => {
    const user = userEvent.setup();
    renderPage();
    await expandProduct(user);
    const row = screen.getByRole("cell", { name: "SET-1" }).closest("tr")!;
    expect(within(row).getByText("Component-derived stock")).toBeInTheDocument();
    expect(within(row).getByText("3", { selector: "strong" })).toBeVisible();
    expect(within(row).queryByText(/On hand|Reserved|^99$|^77$/)).not.toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "Adjust" })).not.toBeInTheDocument();
  });

  it("keeps physical adjustment incremental and immediately updates available stock", async () => {
    const user = userEvent.setup();
    renderPage();
    await expandProduct(user);
    const row = screen.getByRole("cell", { name: "CHAIR-1" }).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "Adjust" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByRole("spinbutton", { name: /^Quantity/ }), "1");
    await user.type(within(dialog).getByRole("textbox", { name: /^Reason/ }), "Stock count");
    await user.click(within(dialog).getByRole("button", { name: "Adjust" }));
    expect(await within(dialog).findByRole("status")).toHaveTextContent("on hand 9");
    expect(api.adjustStock).toHaveBeenCalledWith({ skuId: "chair-sku", quantity: 1, reason: "Stock count" });
    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(within(row).getByText("7", { selector: "strong" })).toBeVisible();
    expect(within(row).getByText(/On hand 9/)).toHaveTextContent("Reserved 2");
    expect(screen.getByRole("button", { name: "Collapse variants for Dining furniture" })).toHaveAttribute("aria-expanded", "true");
  });

  it("expands full help below each adjustment field without submitting the form", async () => {
    const user = userEvent.setup();
    showProducts([singleProduct]);
    renderPage();
    const row = (await screen.findByRole("cell", { name: "TABLE-1" })).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "Adjust" }));
    const dialog = screen.getByRole("dialog");
    const quantityHelp = within(dialog).getByRole("button", { name: "Quantity help" });
    expect(quantityHelp).toHaveAttribute("aria-expanded", "false");
    await user.click(quantityHelp);
    expect(quantityHelp).toHaveAttribute("aria-expanded", "true");
    expect(within(dialog).getByText(/不是目标总库存/)).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Reason help" }));
    expect(within(dialog).getByText(/必填，写清调整原因/)).toBeVisible();
    expect(api.adjustStock).not.toHaveBeenCalled();
    await user.click(quantityHelp);
    expect(within(dialog).getByText(/不是目标总库存/)).not.toBeVisible();
  });

  it.each(["0", "1.5", "1000001"])("rejects invalid adjustment quantity %s", async (quantity) => {
    const user = userEvent.setup();
    showProducts([singleProduct]);
    renderPage();
    const row = (await screen.findByRole("cell", { name: "TABLE-1" })).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "Adjust" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByRole("spinbutton", { name: /^Quantity/ }), quantity);
    await user.type(within(dialog).getByRole("textbox", { name: /^Reason/ }), "Stock count");
    await user.click(within(dialog).getByRole("button", { name: "Adjust" }));
    expect(within(dialog).getByRole("alert")).toBeVisible();
    expect(api.adjustStock).not.toHaveBeenCalled();
  });

  it("keeps negative quantities as removals rather than target stock", async () => {
    const user = userEvent.setup();
    api.adjustStock.mockResolvedValue({ onHand: 6, reserved: 2, available: 4 });
    showProducts([singleProduct]);
    renderPage();
    const row = (await screen.findByRole("cell", { name: "TABLE-1" })).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "Adjust" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByRole("spinbutton", { name: /^Quantity/ }), "-2");
    await user.type(within(dialog).getByRole("textbox", { name: /^Reason/ }), "Damaged items");
    await user.click(within(dialog).getByRole("button", { name: "Adjust" }));
    expect(await within(dialog).findByRole("status")).toHaveTextContent("available 4");
    expect(api.adjustStock).toHaveBeenCalledWith({ skuId: "table-sku", quantity: -2, reason: "Damaged items" });
  });

  it("keeps the reason required", async () => {
    const user = userEvent.setup();
    showProducts([singleProduct]);
    renderPage();
    const row = (await screen.findByRole("cell", { name: "TABLE-1" })).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "Adjust" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByRole("spinbutton", { name: /^Quantity/ }), "5");
    await user.click(within(dialog).getByRole("button", { name: "Adjust" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Reason is required.");
    expect(api.adjustStock).not.toHaveBeenCalled();
  });

  it("keeps adjustment controls absent when the role cannot adjust stock", async () => {
    state.canAdjust = false;
    const user = userEvent.setup();
    renderPage();
    await expandProduct(user);
    expect(screen.getByRole("cell", { name: "CHAIR-1" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Adjust" })).not.toBeInTheDocument();
  });
});
