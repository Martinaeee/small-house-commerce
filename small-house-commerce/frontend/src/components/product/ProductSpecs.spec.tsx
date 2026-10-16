import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MaterialDimensions, ProductSpecs, type ProductSpecSource } from "./ProductSpecs";

const product: ProductSpecSource = {
  width: 100, depth: 50, height: 70,
  foldedWidth: 90, foldedDepth: 40, foldedHeight: 10,
  materials: "Oak", features: null,
};
const empty: ProductSpecSource = {
  width: null, depth: null, height: null,
  foldedWidth: null, foldedDepth: null, foldedHeight: null,
  materials: null, features: null,
};

function expectDimension(label: string, value: string) {
  expect(screen.getAllByText(label)[0].nextElementSibling?.textContent).toBe(value);
}

for (const Component of [ProductSpecs, MaterialDimensions]) {
  describe(`${Component.name} selected SKU dimensions`, () => {
    it("uses resolved component specifications rather than parent dimensions and material", () => {
      render(<Component product={product} specifications={{ kind: "BUNDLE_COMPONENTS", features: null, components: [{
        productName: "Chair", variantName: "Walnut", quantity: 4, width: 45, depth: null, height: 0,
        foldedWidth: null, foldedDepth: null, foldedHeight: null, productWeight: 4, materials: "Walnut",
      }] }} />);
      expect(screen.getByRole("heading", { name: "Chair × 4" })).toBeVisible();
      expect(screen.getByText("45 cm")).toBeVisible();
      expect(screen.getByText("0 cm")).toBeVisible();
      expect(screen.queryByText("100 cm")).not.toBeInTheDocument();
      expect(screen.queryByText("Oak")).not.toBeInTheDocument();
    });

    it("keeps a materials-only component visible with a missing-dimensions explanation", () => {
      render(<Component product={product} specifications={{ kind: "BUNDLE_COMPONENTS", features: null, components: [{
        productName: "Chair", variantName: "Walnut", quantity: 4, width: null, depth: null, height: null,
        foldedWidth: null, foldedDepth: null, foldedHeight: null, productWeight: null, materials: "Walnut",
      }] }} />);
      expect(screen.getByText("Dimensions not provided")).toBeVisible();
      expect(screen.getAllByText("Walnut")).toHaveLength(2);
      expect(screen.queryByText("100 cm")).not.toBeInTheDocument();
    });

    it("renders no parent specifications for an invalid empty Bundle", () => {
      const { container } = render(<Component product={product} specifications={{ kind: "BUNDLE_COMPONENTS", features: null, components: [] }} />);
      expect(container).toBeEmptyDOMElement();
    });

    it("renders selected SKU overrides without changing storefront axes or folded dimensions", () => {
      render(<Component product={product} variantDimensions={{ productWidth: 120, productDepth: 60, productHeight: 75 }} />);
      expectDimension("Width", "120 cm");
      expectDimension("Depth", "60 cm");
      expectDimension("Height", "75 cm");
      expect(screen.getAllByText("Width")[1].nextElementSibling).toHaveTextContent("90 cm");
      expectDimension("Folded depth", "40 cm");
      expectDimension("Folded height", "10 cm");
      expect(screen.getAllByText(/^(Width|Height|Depth)$/).slice(0, 3).map(row => row.textContent)).toEqual(["Width", "Height", "Depth"]);
    });

    it("resolves each null or omitted axis independently and preserves explicit zero", () => {
      render(<Component product={product} variantDimensions={{ productWidth: 0, productDepth: null }} />);
      expectDimension("Width", "0 cm");
      expectDimension("Depth", "50 cm");
      expectDimension("Height", "70 cm");
    });

    it("restores live parent inheritance after overrides are cleared", () => {
      const view = render(<Component product={product} variantDimensions={{ productWidth: 120, productDepth: 60, productHeight: 75 }} />);
      view.rerender(<Component product={{ ...product, width: 140, depth: 80, height: 95 }} variantDimensions={{ productWidth: null, productDepth: null, productHeight: null }} />);
      expectDimension("Width", "140 cm");
      expectDimension("Depth", "80 cm");
      expectDimension("Height", "95 cm");
      expect(screen.queryByText("120 cm")).not.toBeInTheDocument();
    });

    it("renders SKU-only zero dimensions when all product-level specifications are empty", () => {
      render(<Component product={empty} variantDimensions={{ productWidth: 0 }} />);
      expectDimension("Width", "0 cm");
    });

    it("keeps product-only previews unchanged when there is no selected SKU", () => {
      render(<Component product={product} />);
      expectDimension("Width", "100 cm");
      expectDimension("Depth", "50 cm");
      expectDimension("Height", "70 cm");
    });

    it("hides fully empty specifications after clearing SKU-only overrides", () => {
      const view = render(<Component product={empty} variantDimensions={{ productWidth: 120 }} />);
      view.rerender(<Component product={empty} variantDimensions={null} />);
      expect(view.container).toBeEmptyDOMElement();
    });
  });
}
