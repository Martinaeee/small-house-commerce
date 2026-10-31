import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { ProductGridSectionEditor } from "@/components/admin/homepage/sections/ProductGridSectionEditor";
import type { SectionOf } from "@/components/admin/homepage/section-editor-registry";
import type { SectionPayloadMap } from "@/lib/homepage-section-payloads";
import type { SectionProduct } from "@/lib/homepage-document";

const listProducts = vi.hoisted(() => vi.fn());
const getProduct = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin-api", () => ({
  adminApi: { listProducts, getProduct },
}));

const PRODUCT_GRID_ID = "00000000-0000-7000-8000-000000000103";
type ProductGridSection = SectionOf<"PRODUCT_GRID">;

function makeSection(
  payload: Partial<SectionPayloadMap["PRODUCT_GRID"]> = {},
  products: SectionProduct[] = [],
): ProductGridSection {
  return {
    id: PRODUCT_GRID_ID,
    type: "PRODUCT_GRID",
    title: null,
    subtitle: null,
    enabled: true,
    sortOrder: 30,
    schedule: { publishAt: null, unpublishAt: null },
    products,
    payload,
  };
}

function Harness({
  initial = {},
  products = [],
}: {
  initial?: Partial<SectionPayloadMap["PRODUCT_GRID"]>;
  products?: SectionProduct[];
}): ReactNode {
  const [payload, setPayload] = useState<
    SectionPayloadMap["PRODUCT_GRID"]
  >(initial);
  const [sectionProducts, setSectionProducts] = useState(products);
  return (
    <ProductGridSectionEditor
      section={makeSection(payload, sectionProducts)}
      onPayloadChange={(patch) =>
        setPayload((current) =>
          typeof patch === "function" ? patch(current) : { ...current, ...patch },
        )
      }
      onProductsChange={(patch) =>
        setSectionProducts((current) =>
          typeof patch === "function" ? patch(current) : patch,
        )
      }
    />
  );
}

const productRows = [
  {
    id: "00000000-0000-7000-8000-000000000301",
    name: "Oak table",
    slug: "oak-table",
    productCode: "P-000301",
    images: [
      { id: "image-1", url: "/uploads/oak.jpg", type: "IMAGE" as const, altText: null, sortOrder: 0 },
    ],
    variants: [],
  },
  {
    id: "00000000-0000-7000-8000-000000000302",
    name: "Linen chair",
    slug: "linen-chair",
    productCode: "P-000302",
    images: [
      { id: "image-2", url: "/uploads/linen.jpg", type: "IMAGE" as const, altText: null, sortOrder: 0 },
    ],
    variants: [],
  },
];

describe("ProductGridSectionEditor", () => {
  beforeEach(() => {
    listProducts.mockReset().mockResolvedValue({
      items: productRows,
      total: productRows.length,
      page: 1,
      pageSize: 20,
    });
    getProduct.mockReset().mockRejectedValue(new Error("not linked"));
  });

  it("leaves layout to the single responsive panel and edits product badges through product-id rows", async () => {
    setAdminLang("en");
    render(
      <AdminI18nProvider>
        <Harness
          initial={{}}
          products={[{ productId: productRows[0].id, sortOrder: 0, badge: null }]}
        />
      </AdminI18nProvider>,
    );

    expect(await screen.findByText("Oak table")).toBeVisible();
    expect(screen.queryByRole("combobox", { name: "Grid columns" })).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "Badge for Oak table" }), {
      target: { value: "New" },
    });

    expect(screen.getByRole("textbox", { name: "Badge for Oak table" })).toHaveValue(
      "New",
    );
    expect(screen.getByTestId(`product-grid-row-${productRows[0].id}`)).toBeVisible();
  });

  it("edits the optional heading link and the product ordering mode", async () => {
    setAdminLang("en");
    render(
      <AdminI18nProvider>
        <Harness initial={{ linkLabel: "See more", linkUrl: "/collections/best-sellers" }} />
      </AdminI18nProvider>,
    );

    expect(screen.getByRole("textbox", { name: "Link text" })).toHaveValue("See more");
    expect(screen.getByRole("textbox", { name: "Link URL" })).toHaveValue(
      "/collections/best-sellers",
    );
    const order = screen.getByRole("combobox", { name: "Product order" });
    expect(order).toHaveValue("MANUAL");

    fireEvent.change(order, { target: { value: "SALES" } });
    expect(order).toHaveValue("SALES");
    expect(screen.getByText(/Best selling first/)).toBeVisible();
  });

  it("shows the linked product photo and name on the selected row", async () => {
    setAdminLang("en");
    getProduct.mockResolvedValue(productRows[0]);
    render(
      <AdminI18nProvider>
        <Harness products={[{ productId: productRows[0].id, sortOrder: 0, badge: null }]} />
      </AdminI18nProvider>,
    );

    const row = await screen.findByTestId(`product-grid-row-${productRows[0].id}`);
    expect(row).toHaveTextContent("Oak table");
    expect(within(row).getByTestId("product-grid-thumb")).toHaveAttribute(
      "src",
      "/uploads/oak.jpg",
    );
    expect(row).not.toHaveTextContent(productRows[0].id);
  });

  it("adds, reorders, and removes products by productId while preserving badge rows", async () => {
    setAdminLang("en");
    render(
      <AdminI18nProvider>
        <Harness
          products={[
            { productId: productRows[0].id, sortOrder: 0, badge: "First" },
            { productId: productRows[1].id, sortOrder: 1, badge: "Second" },
          ]}
        />
      </AdminI18nProvider>,
    );

    await waitFor(() => expect(screen.getByText("Linen chair")).toBeVisible());
    fireEvent.click(screen.getByRole("button", { name: "Move product 1 down" }));
    const rows = screen.getAllByTestId(/product-grid-row-/);
    expect(rows[0]).toHaveTextContent("Linen chair");
    expect(rows[1]).toHaveTextContent("Oak table");
    expect(
      screen.getByRole("button", {
        name: "Remove product Oak table",
      }),
    ).toBeEnabled();
  });

  it("picks a product from the large picker with its photo and name", async () => {
    setAdminLang("en");
    render(
      <AdminI18nProvider>
        <Harness />
      </AdminI18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add product" }));
    const option = await screen.findByTestId("product-picker-option-oak-table");
    expect(within(option).getByTestId("product-picker-thumb-oak-table")).toHaveAttribute(
      "src",
      "/uploads/oak.jpg",
    );
    fireEvent.click(option);

    expect(
      screen.getByTestId(`product-grid-row-${productRows[0].id}`),
    ).toBeVisible();
  });

  it("renders an explicit empty state for a safe legacy payload", async () => {
    setAdminLang("en");
    listProducts.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    render(
      <AdminI18nProvider>
        <Harness />
      </AdminI18nProvider>,
    );

    expect(await screen.findByText("No products selected yet.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Add product" })).toBeEnabled();
  });
});
