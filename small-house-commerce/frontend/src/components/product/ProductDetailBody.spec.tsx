import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProductDetailMedia } from "./ProductDetailBody";

const blocks = [
  { type: "IMAGE" as const, url: "/a.jpg", altText: "A" },
  { type: "IMAGE" as const, url: "/b.jpg", altText: "B" },
];

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
