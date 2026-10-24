import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProductDetailBody, ProductDetailMedia } from "./ProductDetailBody";

const blocks = [
  { type: "IMAGE" as const, url: "/a.jpg", altText: "A" },
  { type: "IMAGE" as const, url: "/b.jpg", altText: "B" },
];

describe("ProductDetailBody", () => {
  it("never renders the Why You’ll Love It highlights on the storefront", () => {
    render(<ProductDetailBody features={"Folds flat\nLocking frame"} blocks={blocks} />);

    expect(screen.queryByRole("heading", { name: "Why You’ll Love It" })).not.toBeInTheDocument();
    expect(screen.queryByText("Folds flat")).not.toBeInTheDocument();
    expect(screen.getByAltText("A")).toBeInTheDocument();
  });

  it("leaves the description card unchanged when highlights are hidden", () => {
    render(<ProductDetailBody description="A compact table." features="Folds flat" />);

    const description = screen.getByRole("heading", { name: "Description" }).parentElement!;
    expect(description).toHaveClass("border", "rounded-lg", "bg-card");
    expect(screen.getByText("A compact table.")).toBeVisible();
  });

  it("renders nothing when the product has no description or detail media", () => {
    const { container } = render(<ProductDetailBody features="Folds flat" />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe("ProductDetailMedia", () => {
  it("stitches detail images with no frame and no gap on phones", () => {
    const { container } = render(
      <ProductDetailMedia blocks={blocks} fullBleed />,
    );

    const stack = container.firstElementChild as HTMLElement;
    expect(stack.className).toContain("flex-col");
    expect(stack.className).not.toContain("gap-");

    const images = container.querySelectorAll("img");
    expect(images).toHaveLength(2);
    for (const image of images) {
      expect(image.className).toContain("-mx-4");
      expect(image.className).toContain("sm:mx-0");
      expect(image.className).not.toContain("border");
      expect(image.className).not.toContain("rounded");
    }
  });

  it("keeps non-bleed media inside the column without a frame", () => {
    const { container } = render(<ProductDetailMedia blocks={blocks} />);

    const image = container.querySelector("img")!;
    expect(image.className).toContain("w-full");
    expect(image.className).not.toContain("-mx-4");
    expect(image.className).not.toContain("border");
    expect(image.className).not.toContain("rounded");
  });
});
