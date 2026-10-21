import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { PublicStorefrontShell } from "@/lib/storefront-shell-api";
import { Header } from "./Header";

vi.mock("@/lib/fonts", () => ({
  poppins: { className: "font-poppins" },
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("./MainNav", () => ({
  MainNav: ({ mode = "live" }: { mode?: string }) => (
    <div data-testid="main-nav" data-mode={mode} />
  ),
}));

vi.mock("./SiteSearch", () => ({
  SiteSearch: () => <div data-testid="live-search" />,
}));

vi.mock("@/components/auth/AccountEntry", () => ({
  AccountEntry: () => <div data-testid="live-account" />,
}));

vi.mock("@/components/cart/CartBadge", () => ({
  CartBadge: () => <span data-testid="live-cart-badge" />,
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

describe("Header", () => {
  it("puts decorative desktop and mobile brand assets under one named home link", () => {
    render(<Header navItems={[]} brand={brand} mode="live" />);

    expect(screen.getByRole("link", { name: "Roomy Co home" })).toHaveAttribute(
      "href",
      "/",
    );
    const images = document.querySelectorAll("header img");
    expect(images).toHaveLength(2);
    expect([...images].map((image) => image.getAttribute("src"))).toEqual([
      "/uploads/brand/horizontal.webp",
      "/uploads/brand/square.png",
    ]);
    expect([...images].every((image) => image.getAttribute("alt") === "")).toBe(true);
    expect(screen.getByTestId("main-nav")).toHaveAttribute("data-mode", "live");
    expect(screen.getByTestId("live-search")).toBeInTheDocument();
    expect(screen.getByTestId("live-account")).toBeInTheDocument();
    expect(screen.getByTestId("live-cart-badge")).toBeInTheDocument();
  });

  it("renders static non-navigable controls and does not mount live customer islands in preview", () => {
    render(<Header navItems={[]} brand={brand} mode="preview" />);

    expect(document.querySelector("header a")).toBeNull();
    expect(screen.getByLabelText("Roomy Co home")).toBeInTheDocument();
    expect(screen.getByLabelText("Search")).toBeInTheDocument();
    expect(screen.getByLabelText("Account")).toBeInTheDocument();
    expect(screen.getByLabelText("Shopping cart")).toBeInTheDocument();
    expect(screen.queryByTestId("live-search")).toBeNull();
    expect(screen.queryByTestId("live-account")).toBeNull();
    expect(screen.queryByTestId("live-cart-badge")).toBeNull();
    expect(screen.getByTestId("main-nav")).toHaveAttribute("data-mode", "preview");
  });
});
