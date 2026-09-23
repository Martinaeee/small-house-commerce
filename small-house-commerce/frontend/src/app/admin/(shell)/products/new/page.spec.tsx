import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * Review-fix cover for the two-phase save on the new-product page: the
 * created product row exists the moment createProduct resolves, so EVERY
 * later failure (Phase A graph PATCH, Phase B stock batch) must leave the
 * operator a "continue on the edit page" pointer instead of stranding them
 * on a form whose re-submit would 409 into "slug already exists".
 */

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

const listCategories = vi.fn();
const createProduct = vi.fn();
const updateProduct = vi.fn();
const setStockBatch = vi.fn();

vi.mock("@/lib/admin-api", () => ({
  adminApi: {
    listCategories: (...args: unknown[]) => listCategories(...args),
    createProduct: (...args: unknown[]) => createProduct(...args),
    updateProduct: (...args: unknown[]) => updateProduct(...args),
    setStockBatch: (...args: unknown[]) => setStockBatch(...args),
  },
}));

import { AdminApiError } from "@/lib/admin-auth";
import type { AdminCategoryNode, AdminProduct } from "@/lib/admin-api";
import NewProductPage from "./page";

const CATEGORY = {
  id: "018f0000-0000-7000-8000-0000000000c1",
  parentId: null,
  name: "Living",
  slug: "living",
  sortOrder: 0,
  imageUrl: null,
  status: "ACTIVE",
  heroStyle: null,
  children: [],
} as AdminCategoryNode;

const CREATED = {
  id: "created-1",
  catalogGraphVersion: 0,
  variants: [],
} as unknown as AdminProduct;

const SAVED_WITH_SKU = {
  id: "created-1",
  catalogGraphVersion: 1,
  variants: [
    {
      id: "variant-1",
      name: "Default",
      position: 0,
      sku: {
        id: "sku-1",
        skuCode: "SH-1",
        status: "ACTIVE",
        price: "1299",
        compareAtPrice: null,
        supplierSku: null,
        supplierCost: null,
        costCurrency: null,
        landedCost: null,
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
} as unknown as AdminProduct;

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  // The typed editors are the default variant editor on this page; pricing
  // the Default candidate is what turns the draft into typed rows (Phase A).
  await user.click(await screen.findByRole("tab", { name: /Options & Variants/ }));
  await user.type(await screen.findByLabelText("SKU code for Default"), "SH-1");
  await user.type(screen.getByLabelText("Price for Default"), "1299");

  await user.click(screen.getByRole("tab", { name: "Basic Info" }));
  // Field wraps its operator hint inside the <label>, so label queries use
  // substring regexes rather than exact text.
  await user.type(screen.getByLabelText(/Name \*/), "Chair");
  await user.selectOptions(screen.getByLabelText(/Category \*/), CATEGORY.id);

  await user.click(screen.getByRole("tab", { name: "SEO" }));
  await user.type(screen.getByLabelText(/Slug \*/), "chair");

  await user.click(screen.getByRole("button", { name: "Create product" }));
}

describe("NewProductPage two-phase save", () => {
  beforeEach(() => {
    pushMock.mockReset();
    listCategories.mockReset().mockResolvedValue([CATEGORY]);
    createProduct.mockReset();
    updateProduct.mockReset();
    setStockBatch.mockReset();
  });

  afterEach(cleanup);

  it("keeps a continue-on-edit link when the Phase A graph PATCH fails after create", async () => {
    const user = userEvent.setup();
    createProduct.mockResolvedValue(CREATED);
    updateProduct.mockRejectedValue(new Error("graph boom"));

    render(<NewProductPage />);
    await fillAndSubmit(user);

    const link = await screen.findByRole("link", { name: /edit page/i });
    expect(link).toHaveAttribute("href", "/admin/products/created-1/edit");
    expect(pushMock).not.toHaveBeenCalled();
    // The failure message is the backend's own, not the slug-conflict copy.
    expect(await screen.findAllByText(/graph boom/)).not.toHaveLength(0);
  });

  it("navigates to the edit page when both phases succeed", async () => {
    const user = userEvent.setup();
    createProduct.mockResolvedValue(CREATED);
    updateProduct.mockResolvedValue(SAVED_WITH_SKU);
    setStockBatch.mockResolvedValue([
      { skuId: "sku-1", ok: true, onHand: 0, reserved: 0, available: 0 },
    ]);

    render(<NewProductPage />);
    await fillAndSubmit(user);

    await vi.waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/admin/products/created-1/edit");
    });
    expect(setStockBatch).toHaveBeenCalledWith([
      { skuId: "sku-1", onHand: 0, reason: "New product" },
    ]);
  });

  it("maps a create-time slug conflict to the slug copy with no continue link", async () => {
    const user = userEvent.setup();
    createProduct.mockRejectedValue(
      new AdminApiError("Products_service: slug conflict", 409),
    );

    render(<NewProductPage />);
    await fillAndSubmit(user);

    expect(await screen.findByText(/slug already exists/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /edit page/i })).not.toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });
});
