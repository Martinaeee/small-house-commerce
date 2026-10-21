import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BrandAssetImage } from "./BrandAssetImage";

describe("BrandAssetImage", () => {
  it("renders known dimensions and swaps a broken asset for its generated fallback", () => {
    render(
      <BrandAssetImage
        src="/uploads/brand/logo.webp"
        width={600}
        height={120}
        alt="LUWAG"
        className="h-8"
        fallback={<span data-testid="generated-fallback">fallback</span>}
      />,
    );

    const image = screen.getByRole("img", { name: "LUWAG" });
    expect(image).toHaveAttribute("width", "600");
    expect(image).toHaveAttribute("height", "120");
    expect(image).toHaveClass("object-contain", "h-8");

    fireEvent.error(image);

    expect(screen.queryByRole("img", { name: "LUWAG" })).toBeNull();
    expect(screen.getByTestId("generated-fallback")).toBeVisible();
  });

  it("tries a replacement src once even after the previous src failed", () => {
    const { rerender } = render(
      <BrandAssetImage
        src="/uploads/brand/broken.webp"
        width={600}
        height={120}
        alt="LUWAG"
        fallback={<span data-testid="generated-fallback">fallback</span>}
      />,
    );
    fireEvent.error(screen.getByRole("img", { name: "LUWAG" }));
    expect(screen.getByTestId("generated-fallback")).toBeVisible();

    rerender(
      <BrandAssetImage
        src="/uploads/brand/replacement.webp"
        width={700}
        height={140}
        alt="LUWAG"
        fallback={<span data-testid="generated-fallback">fallback</span>}
      />,
    );

    expect(screen.getByRole("img", { name: "LUWAG" })).toHaveAttribute(
      "src",
      "/uploads/brand/replacement.webp",
    );
  });
});
