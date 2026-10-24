import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PublicStorefrontShell } from "@/lib/storefront-shell-api";
import { BrandWordmark } from "./BrandWordmark";

vi.mock("@/lib/fonts", () => ({
  poppins: { className: "font-poppins" },
}));

const brand: PublicStorefrontShell["brand"] = {
  brandName: "Roomy Co",
  horizontalLogo: {
    id: "horizontal",
    url: "/uploads/brand/horizontal.webp",
    width: 600,
    height: 120,
  },
  squareMark: {
    id: "square",
    url: "/uploads/brand/square.png",
    width: 512,
    height: 512,
  },
};

describe("BrandWordmark", () => {
  it("selects the uploaded horizontal logo or square mark with accessible brand text", () => {
    const { rerender } = render(
      <BrandWordmark brand={brand} variant="horizontal" />,
    );
    expect(screen.getByRole("img", { name: "Roomy Co" })).toHaveAttribute(
      "src",
      "/uploads/brand/horizontal.webp",
    );

    rerender(<BrandWordmark brand={brand} variant="square" />);
    expect(screen.getByRole("img", { name: "Roomy Co" })).toHaveAttribute(
      "src",
      "/uploads/brand/square.png",
    );
  });

  it.each(["horizontal", "square"] as const)(
    "falls back to the generated %s mark after an uploaded image errors",
    (variant) => {
      render(<BrandWordmark brand={brand} variant={variant} className="brand-size" />);

      fireEvent.error(screen.getByRole("img", { name: "Roomy Co" }));

      const fallback = screen.getByTestId(`brand-fallback-${variant}`);
      expect(fallback).toHaveAttribute("aria-label", "Roomy Co");
      expect(fallback).toHaveClass("brand-size");
      expect(fallback.querySelectorAll("rect")).toHaveLength(3);
      if (variant === "horizontal") {
        expect(screen.getByText("luwag")).toBeVisible();
      } else {
        expect(screen.queryByText("luwag")).toBeNull();
      }
    },
  );

  it("makes uploaded and generated marks decorative when a parent owns the name", () => {
    const { rerender } = render(
      <BrandWordmark brand={brand} variant="horizontal" decorative />,
    );
    const uploaded = document.querySelector("img");
    expect(uploaded).toHaveAttribute("alt", "");

    fireEvent.error(uploaded!);
    expect(screen.getByTestId("brand-fallback-horizontal")).toHaveAttribute(
      "aria-hidden",
      "true",
    );

    rerender(<BrandWordmark variant="square" decorative />);
    expect(screen.getByTestId("brand-fallback-square")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("lets the call site size an uploaded logo independently of the fallback text", () => {
    render(
      <BrandWordmark
        brand={brand}
        variant="horizontal"
        assetClassName="h-11 w-auto max-w-[240px]"
      />,
    );

    const uploaded = screen.getByRole("img", { name: "Roomy Co" });
    expect(uploaded).toHaveClass("h-11", "w-auto", "max-w-[240px]");
    expect(uploaded).not.toHaveClass("h-[1.12em]");
  });

  it("retains the exact readable LUWAG horizontal fallback when no asset exists", () => {
    render(<BrandWordmark />);

    const fallback = screen.getByTestId("brand-fallback-horizontal");
    expect(fallback).toHaveAttribute("aria-label", "LUWAG");
    expect(screen.getByText("luwag")).toHaveClass(
      "font-poppins",
      "font-bold",
      "lowercase",
    );
  });
});
