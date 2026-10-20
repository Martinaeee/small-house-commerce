import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { ProductStorySectionEditor } from "@/components/admin/homepage/sections/ProductStorySectionEditor";
import type { SectionOf } from "@/components/admin/homepage/section-editor-registry";
import type { SectionPayloadMap } from "@/lib/homepage-section-payloads";

const listProducts = vi.hoisted(() => vi.fn());
const getProduct = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin-api", () => ({ adminApi: { listProducts, getProduct } }));

type ProductStorySection = SectionOf<"PRODUCT_STORY">;
const PRODUCT_STORY_ID = "00000000-0000-7000-8000-000000000105";

function makeSection(
  payload: Partial<SectionPayloadMap["PRODUCT_STORY"]> = {},
): ProductStorySection {
  return {
    id: PRODUCT_STORY_ID,
    type: "PRODUCT_STORY",
    title: null,
    subtitle: null,
    enabled: true,
    sortOrder: 50,
    schedule: { publishAt: null, unpublishAt: null },
    products: [],
    payload,
  };
}

function Harness({
  initial = {},
}: {
  initial?: Partial<SectionPayloadMap["PRODUCT_STORY"]>;
}): ReactNode {
  const [payload, setPayload] = useState<SectionPayloadMap["PRODUCT_STORY"]>(initial);
  return (
    <>
      <ProductStorySectionEditor
        section={makeSection(payload)}
        onPayloadChange={(patch) =>
          setPayload((current) =>
            typeof patch === "function" ? patch(current) : { ...current, ...patch },
          )
        }
      />
      <pre data-testid="product-story-payload">{JSON.stringify(payload)}</pre>
    </>
  );
}

const product = {
  id: "00000000-0000-7000-8000-000000000401",
  name: "Oak coffee table",
  slug: "oak-coffee-table",
  productCode: null,
  description: null,
  tagline: null,
  categoryId: "category",
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
  createdAt: "",
  updatedAt: "",
  catalogGraphVersion: 1,
  defaultDisplayVariantId: null,
  images: [
    { id: "image-1", url: "/uploads/oak.jpg", type: "IMAGE", altText: null, sortOrder: 0 },
  ],
  detailBlocks: [],
  variants: [],
};

describe("ProductStorySectionEditor", () => {
  beforeEach(() => {
    listProducts.mockReset().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    getProduct.mockReset().mockRejectedValue(new Error("not linked"));
  });

  it("edits fields without dropping omitted optional payload values", async () => {
    setAdminLang("en");
    render(
      <AdminI18nProvider>
        <Harness
          initial={{
            body: "A considered piece.",
            ctaLink: "/products/oak-table",
            productId: product.id,
          }}
        />
      </AdminI18nProvider>,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Product story heading" }), {
      target: { value: "Made for slow mornings" },
    });

    expect(JSON.parse(screen.getByTestId("product-story-payload").textContent ?? "{}")).toMatchObject({
      heading: "Made for slow mornings",
      body: "A considered piece.",
      ctaLink: "/products/oak-table",
      productId: product.id,
    });
    // The linked product cannot be loaded, so the editor keeps its id visible.
    expect(await screen.findByTestId("product-story-product-id")).toHaveTextContent(product.id);
  });

  it("uses safe empty values for malformed fields and picks a real product", async () => {
    setAdminLang("en");
    listProducts.mockResolvedValue({
      items: [product],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    render(
      <AdminI18nProvider>
        <Harness
          initial={{
            heading: 4 as unknown as string,
            body: null as unknown as string,
            ctaText: {} as unknown as string,
          }}
        />
      </AdminI18nProvider>,
    );

    expect(screen.getByRole("textbox", { name: "Product story heading" })).toHaveValue("");
    fireEvent.click(screen.getByTestId("product-story-product-open"));
    const option = await screen.findByTestId("product-picker-option-oak-coffee-table");
    fireEvent.click(option);

    expect(JSON.parse(screen.getByTestId("product-story-payload").textContent ?? "{}")).toEqual({
      productId: product.id,
    });
  });

  it("shows the linked product photo and name instead of a raw id", async () => {
    setAdminLang("en");
    getProduct.mockResolvedValue(product);
    render(
      <AdminI18nProvider>
        <Harness initial={{ productId: product.id }} />
      </AdminI18nProvider>,
    );

    expect(await screen.findByTestId("product-story-product-current")).toHaveTextContent(
      "Oak coffee table",
    );
    expect(screen.getByTestId("product-story-product-thumb")).toHaveAttribute(
      "src",
      "/uploads/oak.jpg",
    );
    expect(screen.queryByText(product.id)).not.toBeInTheDocument();
  });

  it("searches the full product catalogue instead of only the first page", async () => {
    setAdminLang("en");
    listProducts.mockImplementation(({ search }: { search?: string }) =>
      Promise.resolve({
        items: search ? [{ ...product, name: "Beyond page" }] : [],
        total: search ? 1 : 21,
        page: 1,
        pageSize: 20,
      }),
    );
    render(
      <AdminI18nProvider>
        <Harness />
      </AdminI18nProvider>,
    );

    fireEvent.click(screen.getByTestId("product-story-product-open"));
    const search = await screen.findByRole("searchbox", { name: "Search by product name or code" });
    fireEvent.change(search, { target: { value: "Beyond" } });
    await waitFor(() =>
      expect(listProducts).toHaveBeenLastCalledWith({
        search: "Beyond",
        page: 1,
        pageSize: 50,
      }),
    );
    expect(await screen.findByTestId("product-picker-option-oak-coffee-table")).toBeVisible();
  });

  it("keeps an incomplete CTA URL visible while it is being typed", () => {
    setAdminLang("en");
    render(
      <AdminI18nProvider>
        <Harness />
      </AdminI18nProvider>,
    );

    const input = screen.getByRole("textbox", { name: "Product story CTA link" });
    fireEvent.change(input, { target: { value: "h" } });

    expect(input).toHaveValue("h");
  });

  it("drops a malformed stored CTA link from the editor value", () => {
    setAdminLang("en");
    render(
      <AdminI18nProvider>
        <Harness initial={{ ctaLink: "/products\\escape" }} />
      </AdminI18nProvider>,
    );

    expect(
      screen.getByRole("textbox", { name: "Product story CTA link" }),
    ).toHaveValue("");
  });

  it("keeps an incomplete image URL visible while it is being typed", () => {
    setAdminLang("en");
    render(
      <AdminI18nProvider>
        <Harness />
      </AdminI18nProvider>,
    );

    const input = screen.getByRole("textbox", { name: "Product story image URL" });
    fireEvent.change(input, { target: { value: "/" } });

    expect(input).toHaveValue("/");
  });

  it("keeps the clear action available when product results are empty", async () => {
    setAdminLang("en");
    getProduct.mockResolvedValue(product);
    render(
      <AdminI18nProvider>
        <Harness initial={{ productId: product.id }} />
      </AdminI18nProvider>,
    );

    const clear = await screen.findByTestId("product-story-product-clear");
    fireEvent.click(clear);
    expect(JSON.parse(screen.getByTestId("product-story-payload").textContent ?? "{}")).toEqual({});
  });

  it("uses the existing product story clear behavior", () => {
    setAdminLang("en");
    render(
      <AdminI18nProvider>
        <Harness initial={{ ctaText: "Shop now", ctaLink: "/shop" }} />
      </AdminI18nProvider>,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Product story CTA text" }), {
      target: { value: "" },
    });
    expect(JSON.parse(screen.getByTestId("product-story-payload").textContent ?? "{}")).toEqual({
      ctaLink: "/shop",
    });
  });
});
