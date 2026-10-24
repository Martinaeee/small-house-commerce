import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HIDDEN_FEATURE_PREFIX } from "@/lib/feature-lines";
import { ProductDetailBody, ProductDetailMedia } from "./ProductDetailBody";

const blocks = [
  { type: "IMAGE" as const, url: "/a.jpg", altText: "A" },
  { type: "IMAGE" as const, url: "/b.jpg", altText: "B" },
];

describe("ProductDetailBody", () => {
  it("renders the Why You’ll Love It highlights by default", () => {
    render(<ProductDetailBody features={"Folds flat\nLocking frame"} blocks={blocks} />);

    expect(
      screen.getByRole("heading", { name: "Why You’ll Love It" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Folds flat")).toBeInTheDocument();
    expect(screen.getByText("Locking frame")).toBeInTheDocument();
    expect(screen.getByAltText("A")).toBeInTheDocument();
  });

  it("hides the whole block when the module switch is off", () => {
    render(
      <ProductDetailBody
        features={"Folds flat\nLocking frame"}
        highlightsVisible={false}
        blocks={blocks}
      />,
    );

    expect(
      screen.queryByRole("heading", { name: "Why You’ll Love It" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Folds flat")).not.toBeInTheDocument();
    expect(screen.getByAltText("A")).toBeInTheDocument();
  });

  it("renders only the bullets that are not hidden", () => {
    render(
      <ProductDetailBody
        features={`Folds flat\n${HIDDEN_FEATURE_PREFIX}Internal note\nLocking frame`}
        blocks={blocks}
      />,
    );

    expect(screen.getByText("Folds flat")).toBeInTheDocument();
    expect(screen.getByText("Locking frame")).toBeInTheDocument();
    expect(screen.queryByText("Internal note")).not.toBeInTheDocument();
    expect(screen.queryByText(/\[hidden\]/)).not.toBeInTheDocument();
  });

  it("drops the block when every bullet is hidden", () => {
    render(
      <ProductDetailBody
        features={`${HIDDEN_FEATURE_PREFIX}Folds flat`}
        blocks={blocks}
      />,
    );

    expect(
      screen.queryByRole("heading", { name: "Why You’ll Love It" }),
    ).not.toBeInTheDocument();
    expect(screen.getByAltText("A")).toBeInTheDocument();
  });

  it("leaves the description card unchanged", () => {
    render(<ProductDetailBody description="A compact table." features="Folds flat" />);

    const description = screen.getByRole("heading", { name: "Description" }).parentElement!;
    expect(description).toHaveClass("border", "rounded-lg", "bg-card");
    expect(screen.getByText("A compact table.")).toBeVisible();
  });

  it("renders the highlights frameless and directly above the detail media", () => {
    const { container } = render(
      <ProductDetailBody description="A compact table." features="Folds flat" blocks={blocks} />,
    );

    const heading = screen.getByRole("heading", { name: "Why You’ll Love It" });
    const highlightBlock = heading.parentElement!;
    expect(highlightBlock.className).not.toContain("border");
    expect(highlightBlock.className).not.toContain("bg-card");
    expect(highlightBlock.className).not.toContain("rounded");

    const media = container.querySelector("img[data-detail-index]")!;
    expect(highlightBlock.parentElement!.contains(media)).toBe(true);
    expect(highlightBlock.parentElement!.className).not.toContain("gap-");
  });

  it("renders nothing when the product has no description, visible feature or detail media", () => {
    const { container } = render(
      <ProductDetailBody
        features={`${HIDDEN_FEATURE_PREFIX}Folds flat`}
        highlightsVisible={false}
      />,
    );

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
