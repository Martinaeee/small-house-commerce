import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Product, BundleComponentSpecification } from "@/lib/api";
import { ProductDetailsModal } from "./ProductDetailsModal";

const product: Product = {
  id: "modal-product", name: "Set", slug: "set", categoryId: "chairs", description: "Delivery-safe construction", tagline: null,
  ratingAverage: null, reviewCount: 0, room: null, internalRole: null, solutions: [],
  width: 999, depth: 999, height: 999, foldedWidth: null, foldedDepth: null, foldedHeight: null,
  materials: "Parent-only material", features: null, catalogGraphVersion: 1, options: [], variants: [],
  images: [], defaultDisplayVariantId: null, effectiveCoverMedia: null,
};
const chair: BundleComponentSpecification = {
  productName: "Chair", variantName: "Oak", quantity: 4, width: 45, depth: 50, height: 80,
  foldedWidth: null, foldedDepth: null, foldedHeight: null, productWeight: 4, materials: "Solid oak",
};

describe("ProductDetailsModal selected specifications", () => {
  it("updates an already-open modal across ordinary and two Bundle selections without parent fallback", () => {
    const onClose = vi.fn();
    const view = render(<ProductDetailsModal product={product} onClose={onClose} specifications={{ kind: "SKU", product: { ...product, width: 120, depth: 60, height: 75 }, productWeight: 4 }} />);
    expect(screen.getByText("120 cm")).toBeVisible();
    view.rerender(<ProductDetailsModal product={product} onClose={onClose} specifications={{ kind: "BUNDLE_COMPONENTS", components: [chair], features: null }} />);
    expect(screen.getByRole("heading", { name: "Chair × 4" })).toBeVisible();
    expect(screen.getByText("45 cm")).toBeVisible();
    expect(screen.queryByText("120 cm")).not.toBeInTheDocument();
    expect(screen.queryByText("999 cm")).not.toBeInTheDocument();
    expect(screen.queryByText("180 cm")).not.toBeInTheDocument();
    view.rerender(<ProductDetailsModal product={product} onClose={onClose} specifications={{ kind: "BUNDLE_COMPONENTS", components: [{ ...chair, productName: "Bench", quantity: 2 }], features: null }} />);
    expect(screen.getByRole("heading", { name: "Bench × 2" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Chair × 4" })).not.toBeInTheDocument();
  });
  it("does not reuse parent dimensions when a selected Bundle becomes invalid while open", () => {
    render(<ProductDetailsModal product={product} onClose={vi.fn()} specifications={{ kind: "BUNDLE_COMPONENTS", components: [], features: null }} />);
    expect(screen.getByText("Component specifications not available")).toBeVisible();
    expect(screen.queryByText("999 cm")).not.toBeInTheDocument();
  });
  it("preserves close, Escape and body scroll-lock lifecycle", () => {
    document.body.style.overflow = "auto";
    const onClose = vi.fn();
    const view = render(<ProductDetailsModal product={product} onClose={onClose} specifications={{ kind: "BUNDLE_COMPONENTS", components: [chair], features: null }} />);
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.click(screen.getByRole("button", { name: "Close product details" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
    view.unmount();
    expect(document.body.style.overflow).toBe("auto");
    document.body.style.overflow = "";
  });
});
