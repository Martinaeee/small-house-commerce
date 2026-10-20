import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminI18nProvider } from "@/lib/admin-i18n";
import {
  ProductOptionGrid,
  ProductPickerDialog,
  ProductPickerField,
  ProductPickerInline,
} from "@/components/admin/ProductPicker";

const listProducts = vi.hoisted(() => vi.fn());
const getProduct = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin-api", () => ({ adminApi: { listProducts, getProduct } }));

const OAK = {
  id: "00000000-0000-7000-8000-000000000601",
  name: "Classic Oak Shelf",
  slug: "classic-oak-shelf",
  productCode: "P-000001",
  images: [
    { id: "img-1", url: "/uploads/oak.jpg", type: "IMAGE" as const, altText: null, sortOrder: 0 },
  ],
  variants: [
    {
      id: "variant-1",
      name: "Default",
      position: 0,
      sku: { id: "sku-1", skuCode: "SKU-1", status: "ACTIVE" as const, price: "1499" },
    },
  ],
};
const BAMBOO = {
  ...OAK,
  id: "00000000-0000-7000-8000-000000000602",
  name: "Bamboo Side Table",
  slug: "bamboo-side-table",
  productCode: "P-000002",
  images: [
    { id: "img-2", url: "/uploads/bamboo.jpg", type: "IMAGE" as const, altText: null, sortOrder: 0 },
  ],
};

function renderWithI18n(ui: React.ReactNode): ReturnType<typeof render> {
  return render(<AdminI18nProvider>{ui}</AdminI18nProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ProductPickerDialog", () => {
  it("lists every product with its photo and name", async () => {
    listProducts.mockResolvedValue({ items: [OAK, BAMBOO], total: 2, page: 1, pageSize: 50 });
    renderWithI18n(
      <ProductPickerDialog
        open
        onClose={() => {}}
        onSelect={() => {}}
      />,
    );
    expect(await screen.findByTestId("product-picker-option-classic-oak-shelf")).toBeInTheDocument();
    const option = screen.getByTestId("product-picker-option-classic-oak-shelf");
    expect(within(option).getByTestId("product-picker-thumb-classic-oak-shelf")).toHaveAttribute(
      "src",
      "/uploads/oak.jpg",
    );
    expect(option).toHaveTextContent("Classic Oak Shelf");
    expect(screen.getByTestId("product-picker-option-bamboo-side-table")).toHaveTextContent(
      "Bamboo Side Table",
    );
  });

  it("returns the picked product and closes", async () => {
    listProducts.mockResolvedValue({ items: [OAK, BAMBOO], total: 2, page: 1, pageSize: 50 });
    const onSelect = vi.fn();
    const onClose = vi.fn();
    renderWithI18n(
      <ProductPickerDialog open onClose={onClose} onSelect={onSelect} />,
    );
    const option = await screen.findByTestId("product-picker-option-bamboo-side-table");
    await userEvent.click(option);
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        id: BAMBOO.id,
        name: "Bamboo Side Table",
        thumbnailUrl: "/uploads/bamboo.jpg",
      }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("marks products that are already linked", async () => {
    listProducts.mockResolvedValue({ items: [OAK, BAMBOO], total: 2, page: 1, pageSize: 50 });
    renderWithI18n(
      <ProductPickerDialog
        open
        onClose={() => {}}
        onSelect={() => {}}
        selectedIds={[OAK.id]}
      />,
    );
    expect(await screen.findByTestId("product-picker-option-classic-oak-shelf")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("product-picker-option-bamboo-side-table")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});

describe("ProductOptionGrid", () => {
  it("loads scoped products from the server and shows their photo and name", async () => {
    const loadProducts = vi.fn().mockResolvedValue([
      {
        id: "00000000-0000-7000-8000-000000000701",
        name: "Oak Table",
        productCode: "LUW-001",
        thumbnailUrl: "/uploads/oak-table.jpg",
      },
    ]);
    renderWithI18n(
      <ProductOptionGrid loadProducts={loadProducts} onSelect={() => {}} />,
    );
    await waitFor(() => expect(loadProducts).toHaveBeenCalledWith(""));
    const option = await screen.findByTestId(
      "product-picker-option-00000000-0000-7000-8000-000000000701",
    );
    expect(option).toHaveTextContent("Oak Table");
    expect(
      within(option).getByTestId(
        "product-picker-thumb-00000000-0000-7000-8000-000000000701",
      ),
    ).toHaveAttribute("src", "/uploads/oak-table.jpg");
  });

  it("searches the scoped source instead of the catalogue", async () => {
    const loadProducts = vi.fn().mockResolvedValue([]);
    renderWithI18n(
      <ProductOptionGrid loadProducts={loadProducts} onSelect={() => {}} />,
    );
    await waitFor(() => expect(loadProducts).toHaveBeenCalledWith(""));
    await userEvent.type(screen.getByRole("searchbox"), "table");
    await waitFor(() => expect(loadProducts).toHaveBeenCalledWith("table"), {
      timeout: 2000,
    });
    expect(listProducts).not.toHaveBeenCalled();
  });
});

describe("ProductPickerInline", () => {
  it("shows the linked product's photo and name", async () => {
    renderWithI18n(
      <ProductPickerInline
        label="关联商品"
        value={OAK.id}
        scope="inline-product"
        onChange={() => {}}
        products={[
          {
            id: OAK.id,
            name: OAK.name,
            slug: OAK.slug,
            productCode: OAK.productCode,
            thumbnailUrl: "/uploads/oak.jpg",
          },
        ]}
      />,
    );
    expect(await screen.findByTestId("inline-product-current")).toHaveTextContent(
      "Classic Oak Shelf",
    );
    expect(screen.getByTestId("inline-product-thumb")).toHaveAttribute(
      "src",
      "/uploads/oak.jpg",
    );
  });

  it("opens the product grid in place and applies the chosen product", async () => {
    const onChange = vi.fn();
    renderWithI18n(
      <ProductPickerInline
        label="关联商品"
        value={undefined}
        scope="inline-product"
        onChange={onChange}
        products={[
          {
            id: OAK.id,
            name: OAK.name,
            slug: OAK.slug,
            productCode: OAK.productCode,
            thumbnailUrl: "/uploads/oak.jpg",
          },
        ]}
      />,
    );
    await userEvent.click(screen.getByTestId("inline-product-open"));
    const option = await screen.findByTestId(
      "inline-product-grid-option-classic-oak-shelf",
    );
    await userEvent.click(option);
    expect(onChange).toHaveBeenCalledWith(OAK.id);
  });
});

describe("ProductPickerField", () => {
  it("shows the linked product's name and photo instead of its raw id", async () => {
    getProduct.mockResolvedValue(OAK);
    const { container } = renderWithI18n(
      <ProductPickerField
        label="关联商品"
        value={OAK.id}
        onChange={() => {}}
      />,
    );
    const current = await screen.findByTestId("product-picker-current");
    expect(current).toHaveTextContent("Classic Oak Shelf");
    expect(screen.getByTestId("product-picker-current-thumb")).toHaveAttribute(
      "src",
      "/uploads/oak.jpg",
    );
    expect(container.textContent).not.toContain(OAK.id);
  });

  it("keeps the raw id visible when the linked product can no longer be loaded", async () => {
    getProduct.mockRejectedValue(new Error("gone"));
    renderWithI18n(
      <ProductPickerField label="关联商品" value={OAK.id} onChange={() => {}} />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("product-picker-current-id")).toHaveTextContent(OAK.id);
    });
  });

  it("opens the picker and applies the chosen product", async () => {
    listProducts.mockResolvedValue({ items: [OAK, BAMBOO], total: 2, page: 1, pageSize: 50 });
    const onChange = vi.fn();
    renderWithI18n(
      <ProductPickerField label="关联商品" value={undefined} onChange={onChange} />,
    );
    await userEvent.click(screen.getByTestId("product-picker-open"));
    const option = await screen.findByTestId("product-picker-option-classic-oak-shelf");
    await userEvent.click(option);
    expect(onChange).toHaveBeenCalledWith(OAK.id);
  });

  it("clears the current product", async () => {
    getProduct.mockResolvedValue(OAK);
    const onChange = vi.fn();
    renderWithI18n(
      <ProductPickerField label="关联商品" value={OAK.id} onChange={onChange} />,
    );
    const clear = await screen.findByTestId("product-picker-clear");
    await userEvent.click(clear);
    expect(onChange).toHaveBeenCalledWith(undefined);
  });
});
