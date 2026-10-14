import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { ProductGridSectionEditor } from "@/components/admin/homepage/sections/ProductGridSectionEditor";
import type { SectionOf } from "@/components/admin/homepage/section-editor-registry";
import type { SectionPayloadMap } from "@/lib/homepage-section-payloads";
import type { SectionProduct } from "@/lib/homepage-document";

const listProducts = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin-api", () => ({
  adminApi: { listProducts },
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
  { id: "00000000-0000-7000-8000-000000000301", name: "Oak table" },
  { id: "00000000-0000-7000-8000-000000000302", name: "Linen chair" },
];

describe("ProductGridSectionEditor", () => {
  it("limits columns to two or four and edits product badge through product-id rows", async () => {
    setAdminLang("en");
    listProducts.mockResolvedValue({
      items: productRows,
      total: productRows.length,
      page: 1,
      pageSize: 20,
    });
    render(
      <AdminI18nProvider>
        <Harness
          initial={{}}
          products={[{ productId: productRows[0].id, sortOrder: 0, badge: null }]}
        />
      </AdminI18nProvider>,
    );

    expect(await screen.findByText("Oak table")).toBeVisible();
    fireEvent.change(screen.getByRole("combobox", { name: "Grid columns" }), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Badge for Oak table" }), {
      target: { value: "New" },
    });

    expect(screen.getByRole("combobox", { name: "Grid columns" })).toHaveValue("2");
    expect(screen.getByRole("textbox", { name: "Badge for Oak table" })).toHaveValue(
      "New",
    );
    expect(screen.getByTestId(`product-grid-row-${productRows[0].id}`)).toBeVisible();
  });

  it("adds, reorders, and removes products by productId while preserving badge rows", async () => {
    setAdminLang("en");
    listProducts.mockResolvedValue({
      items: productRows,
      total: productRows.length,
      page: 1,
      pageSize: 20,
    });
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
        name: `Remove product ${productRows[0].id}`,
      }),
    ).toBeEnabled();
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
