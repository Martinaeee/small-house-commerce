import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { BundleComponentSpecification } from "@/lib/api";
import { BundleComponentSpecifications } from "./BundleComponentSpecifications";

const chair: BundleComponentSpecification = {
  productName: "Chair", variantName: "Oak", quantity: 4, width: 45, depth: 50, height: 80,
  foldedWidth: null, foldedDepth: null, foldedHeight: null, productWeight: 4, materials: "Wood",
};

describe("BundleComponentSpecifications", () => {
  it("keeps identity, quantity, single-piece axes, materials and weight together", () => {
    render(<BundleComponentSpecifications components={[chair]} />);
    expect(screen.getByRole("heading", { name: "Chair × 4" })).toBeVisible();
    expect(screen.getByText("Oak")).toBeVisible();
    expect(screen.getByText("45 cm")).toBeVisible();
    expect(screen.getByText("4 kg")).toBeVisible();
    expect(screen.getByText("Wood")).toBeVisible();
    expect(screen.queryByText("180 cm")).not.toBeInTheDocument();
    expect(screen.getAllByText(/^(Width|Height|Depth)$/).map(row => row.textContent)).toEqual(["Width", "Height", "Depth"]);
  });
  it("renders only provided axes without inventing zero for partial measurements", () => {
    render(<BundleComponentSpecifications components={[{ ...chair, width: 0, depth: null, height: null }]} />);
    expect(screen.getByText("0 cm")).toBeVisible();
    expect(screen.queryByText("Height")).not.toBeInTheDocument();
    expect(screen.queryByText("Depth")).not.toBeInTheDocument();
  });
  it("retains names and quantity when measurements have not been provided", () => {
    render(<BundleComponentSpecifications components={[{ ...chair, width: null, depth: null, height: null, productWeight: null, materials: null }]} />);
    expect(screen.getByRole("heading", { name: "Chair × 4" })).toBeVisible();
    expect(screen.getByText("Dimensions not provided")).toBeVisible();
    expect(screen.queryByText(/kg|cm/)).not.toBeInTheDocument();
  });
  it("shows a safe empty state for an invalid definition", () => {
    render(<BundleComponentSpecifications components={[]} />);
    expect(screen.getByText("Component specifications not available")).toBeVisible();
  });
});
