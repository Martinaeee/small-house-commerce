import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AdminI18nProvider } from "@/lib/admin-i18n";
import { LandingPageForm, emptyLandingForm } from "./landing-page-form";

const listProducts = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin-api", () => ({
  adminApi: { listProducts, getProduct: vi.fn() },
}));

const OAK = {
  id: "00000000-0000-7000-8000-000000000601",
  name: "Classic Oak Shelf",
  slug: "classic-oak-shelf",
  productCode: "P-000001",
  images: [
    { id: "img-1", url: "/uploads/oak.jpg", type: "IMAGE" as const, altText: null, sortOrder: 0 },
  ],
  variants: [],
};

const mount = () =>
  render(
    <AdminI18nProvider>
      <LandingPageForm
        mode="create"
        initial={emptyLandingForm}
        pending={false}
        onSubmit={() => {}}
        onCancel={() => {}}
      />
    </AdminI18nProvider>,
  );

describe("landing page form product picker", () => {
  it("shows the chosen product's photo and name instead of a bare name", async () => {
    listProducts.mockResolvedValue({ items: [OAK], total: 1, page: 1, pageSize: 50 });
    mount();
    await userEvent.click(screen.getByTestId("landing-page-product-open"));
    const option = await screen.findByTestId("product-picker-option-classic-oak-shelf");
    await userEvent.click(option);
    expect(await screen.findByTestId("landing-page-product-current")).toHaveTextContent(
      "Classic Oak Shelf",
    );
    expect(screen.getByTestId("landing-page-product-thumb")).toHaveAttribute(
      "src",
      "/uploads/oak.jpg",
    );
  });
});
