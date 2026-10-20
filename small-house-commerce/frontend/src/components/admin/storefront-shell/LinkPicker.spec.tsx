import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { LinkPicker } from "@/components/admin/storefront-shell/LinkPicker";
import type { AdminProduct } from "@/lib/admin-api";

const listProducts = vi.hoisted(() => vi.fn());
const listLandingPages = vi.hoisted(() => vi.fn());

vi.mock("@/lib/admin-api", () => ({
  adminApi: {
    listProducts,
    listLandingPages,
    listCollections: vi.fn(),
    listCategories: vi.fn(),
    getProduct: vi.fn(),
  },
}));

function productRow(id: string, name: string, imageUrl?: string): AdminProduct {
  return {
    id,
    name,
    slug: `slug-${id}`,
    productCode: null,
    description: null,
    tagline: null,
    categoryId: "cat-root",
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
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    catalogGraphVersion: 0,
    defaultDisplayVariantId: null,
    images: imageUrl
      ? [{ id: "image-1", url: imageUrl, type: "IMAGE", altText: null, sortOrder: 0 }]
      : [],
    detailBlocks: [],
    variants: [],
  };
}

describe("storefront shell LinkPicker", () => {
  beforeEach(() => {
    setAdminLang("en");
    vi.clearAllMocks();
    listProducts.mockResolvedValue({
      items: [productRow("p1", "Oak Side Table", "/uploads/oak.jpg")],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    listLandingPages.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
  });

  it("shows a product photo next to the product name in the entity list", async () => {
    render(
      <AdminI18nProvider>
        <LinkPicker value={null} onChange={vi.fn()} allowExternal={false} />
      </AdminI18nProvider>,
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Link type" }), {
      target: { value: "PRODUCT" },
    });

    const option = await screen.findByRole("button", { name: "Oak Side Table" });
    expect(within(option).getByTestId("link-picker-thumb-p1")).toHaveAttribute(
      "src",
      "/uploads/oak.jpg",
    );
  });
});
