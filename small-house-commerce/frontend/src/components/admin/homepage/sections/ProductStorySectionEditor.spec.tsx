import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { ProductStorySectionEditor } from "@/components/admin/homepage/sections/ProductStorySectionEditor";
import type { SectionOf } from "@/components/admin/homepage/section-editor-registry";
import type { SectionPayloadMap } from "@/lib/homepage-section-payloads";

const listProducts = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin-api", () => ({ adminApi: { listProducts } }));

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
};

describe("ProductStorySectionEditor", () => {
  it("edits fields without dropping omitted optional payload values", () => {
    setAdminLang("en");
    listProducts.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
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
  });

  it("uses safe empty values for malformed fields and picks a real product", async () => {
    setAdminLang("en");
    listProducts.mockResolvedValue({
      items: [
        {
          ...product,
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
          images: [],
          detailBlocks: [],
          variants: [],
        },
      ],
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
    await waitFor(() => expect(screen.getByRole("button", { name: product.name })).toBeVisible());
    fireEvent.click(screen.getByRole("button", { name: product.name }));

    expect(JSON.parse(screen.getByTestId("product-story-payload").textContent ?? "{}")).toMatchObject({
      productId: product.id,
    });
  });

  it("keeps the call to action optional and clears only the edited field", () => {
    setAdminLang("en");
    listProducts.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
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
