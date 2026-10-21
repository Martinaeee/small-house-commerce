import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminI18nProvider } from "@/lib/admin-i18n";
import { adminApi, type AdminProduct } from "@/lib/admin-api";
import AdminInventoryPage from "./page";

const navigation = vi.hoisted(() => ({ params: new URLSearchParams(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/inventory",
  useSearchParams: () => navigation.params,
  useRouter: () => navigation,
}));
vi.mock("@/components/admin/AdminAuthProvider", () => ({
  useAdminAuth: () => ({ hasPermission: () => true }),
}));

afterEach(() => { vi.restoreAllMocks(); });

describe("Bundle inventory workbench", () => {
  it("shows derived Bundle availability without offering an independent stock adjustment", async () => {
    const product = {
      id: "product", name: "Chair set", status: "ACTIVE",
      variants: [
        { id: "ordinary", name: "Chair", sku: { id: "chair", skuCode: "CHAIR", status: "ACTIVE", price: "100", onHand: 10, reserved: 2, availableInventory: 8, isBundle: false } },
        { id: "bundle", name: "Set", sku: { id: "set", skuCode: "BUNDLE", status: "ACTIVE", price: "200", onHand: 0, reserved: 0, availableInventory: 4, isBundle: true } },
      ],
    } as unknown as AdminProduct;
    vi.spyOn(adminApi, "listProducts").mockResolvedValue({ items: [product], page: 1, pageSize: 20, total: 1 });
    render(<AdminI18nProvider><AdminInventoryPage /></AdminI18nProvider>);
    const bundleRow = (await screen.findByText("BUNDLE")).closest("tr")!;
    expect(within(bundleRow).queryByRole("button", { name: "Adjust" })).not.toBeInTheDocument();
    expect(within(bundleRow).queryByText(/On hand/)).not.toBeInTheDocument();
    expect(within(bundleRow).getByText(/Available 4/)).toBeVisible();
    expect(within(bundleRow).getByText("虚拟 Bundle")).toBeVisible();
    const chairRow = screen.getByText("CHAIR").closest("tr")!;
    await userEvent.setup().click(within(chairRow).getByRole("button", { name: "Adjust" }));
    expect(screen.getByRole("dialog")).toBeVisible();
  });
});
