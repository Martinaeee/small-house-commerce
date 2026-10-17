import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProductInformation } from "./ProductInformation";
import type { ResolvedPdpSpecifications } from "./pdp-facts";

const skuSpecifications: ResolvedPdpSpecifications = {
  kind: "SKU",
  product: {
    width: 120,
    height: 75,
    depth: 60,
    foldedWidth: null,
    foldedDepth: null,
    foldedHeight: null,
    materials: "Powder-coated steel",
    features: null,
  },
  productWeight: 8.5,
};

describe("ProductInformation", () => {
  it("merges dimensions, materials and weight into one section without repeating materials", () => {
    render(<ProductInformation specifications={skuSpecifications} />);

    const section = screen.getByRole("region", { name: "Product information" });
    expect(section).toHaveAttribute("id", "specifications");
    expect(section).toHaveClass("scroll-mt-28");
    expect(screen.getAllByText("Powder-coated steel")).toHaveLength(1);
    expect(within(section).getByText("120 cm")).toBeInTheDocument();
    expect(within(section).getByText("8.5 kg")).toBeInTheDocument();
    for (const title of ["Measurements", "Materials", "Product weight"]) {
      expect(within(section).getByText(title)).toBeInTheDocument();
    }
  });

  it("starts every row collapsed and expands only the row that is clicked", async () => {
    const user = userEvent.setup();
    render(<ProductInformation specifications={skuSpecifications} />);

    const rows = screen
      .getByRole("region", { name: "Product information" })
      .querySelectorAll("details");
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row.open).toBe(false);

    await user.click(screen.getByText("Measurements"));
    expect(rows[0]!.open).toBe(true);
    expect(rows[1]!.open).toBe(false);
    expect(rows[2]!.open).toBe(false);
  });

  it("renders only the rows that actually have data", () => {
    render(
      <ProductInformation
        specifications={{
          kind: "SKU",
          product: { ...skuSpecifications.product, materials: null },
          productWeight: null,
        }}
      />,
    );

    const section = screen.getByRole("region", { name: "Product information" });
    expect(within(section).getByText("Measurements")).toBeInTheDocument();
    expect(within(section).queryByText("Materials")).not.toBeInTheDocument();
    expect(within(section).queryByText("Product weight")).not.toBeInTheDocument();
  });

  it("renders nothing when the product has no public specification fields", () => {
    const { container } = render(
      <ProductInformation
        specifications={{
          kind: "SKU",
          product: {
            width: null,
            height: null,
            depth: null,
            foldedWidth: null,
            foldedDepth: null,
            foldedHeight: null,
            materials: "   ",
            features: null,
          },
          productWeight: null,
        }}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("shows the component breakdown instead of parent measurements for a Bundle", () => {
    render(
      <ProductInformation
        specifications={{
          kind: "BUNDLE_COMPONENTS",
          features: null,
          components: [
            {
              productName: "Chair",
              variantName: "Oak",
              quantity: 4,
              width: 45,
              depth: 50,
              height: 80,
              foldedWidth: null,
              foldedDepth: null,
              foldedHeight: null,
              productWeight: 4,
              materials: "Solid oak",
            },
          ],
        }}
      />,
    );

    const section = screen.getByRole("region", { name: "Product information" });
    expect(within(section).getByText("Component specifications")).toBeInTheDocument();
    expect(within(section).getByRole("heading", { name: "Chair × 4" })).toBeInTheDocument();
    expect(within(section).queryByText("Measurements")).not.toBeInTheDocument();
    // Component materials belong to the component card, not to a parent row.
    expect(
      [...section.querySelectorAll("details > summary")].map((node) =>
        node.textContent?.trim(),
      ),
    ).toEqual(["Component specifications"]);
  });

  it("renders nothing for an empty Bundle definition", () => {
    const { container } = render(
      <ProductInformation
        specifications={{
          kind: "BUNDLE_COMPONENTS",
          features: null,
          components: [],
        }}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
