import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import type { AdminProduct, AdminSku, Paged } from "@/lib/admin-api";
import InventoryPage from "./page";

const state = vi.hoisted(() => ({ canAdjust: true }));
const api = vi.hoisted(() => ({ listProducts: vi.fn(), adjustStock: vi.fn() }));
const router = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/admin/inventory",
  useSearchParams: () => new URLSearchParams(),
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
  images: [],
  detailBlocks: [],
  variants: [
    { id: "vb", name: "Dining set", position: 0, sku: sku("bundle-sku", true) },
    { id: "vc", name: "Chair", position: 1, sku: sku("chair-sku", false) },
  ],
};

function renderPage() {
  return render(<AdminI18nProvider><InventoryPage /></AdminI18nProvider>);
}

describe("Bundle inventory rows", () => {
  beforeEach(() => {
    setAdminLang("en");
    state.canAdjust = true;
    api.listProducts.mockReset().mockResolvedValue({
      items: [product], total: 1, page: 1, pageSize: 20,
    } satisfies Paged<AdminProduct>);
    api.adjustStock.mockReset().mockResolvedValue({ onHand: 9, reserved: 2, available: 7 });
  });
  afterEach(cleanup);

  it("shows derived availability without physical figures or an adjustment control", async () => {
    renderPage();
    const row = (await screen.findByText("SET-1")).closest("tr")!;

    expect(within(row).getByText("Component-derived stock")).toBeInTheDocument();
    expect(within(row).getByText("Available 3")).toBeInTheDocument();
    expect(within(row).queryByText(/On hand|Reserved|^99$|^77$/)).not.toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "Adjust" })).not.toBeInTheDocument();
  });

  it("keeps physical adjustment working for an ordinary SKU alongside a Bundle", async () => {
    const user = userEvent.setup();
    renderPage();
    const row = (await screen.findByText("CHAIR-1")).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "Adjust" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText(/^Quantity/), "1");
    await user.type(within(dialog).getByLabelText(/^Reason/), "Stock count");
    await user.click(within(dialog).getByRole("button", { name: "Adjust" }));

    expect(await within(dialog).findByRole("status")).toHaveTextContent("on hand 9");
    expect(api.adjustStock).toHaveBeenCalledWith({ skuId: "chair-sku", quantity: 1, reason: "Stock count" });
  });

  it("keeps adjustment controls absent when the role cannot adjust stock", async () => {
    state.canAdjust = false;
    renderPage();
    await screen.findByText("SET-1");
    expect(screen.queryByRole("button", { name: "Adjust" })).not.toBeInTheDocument();
  });
});
