import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { PdpSectionNav } from "./PdpSectionNav";

function renderPage({
  hasDetails = true,
  hasSpecifications = true,
}: {
  hasDetails?: boolean;
  hasSpecifications?: boolean;
} = {}) {
  render(
    <>
      <PdpSectionNav
        hasDetails={hasDetails}
        hasSpecifications={hasSpecifications}
      />
      <main>
        <section id="details" className="scroll-mt-28" />
        <section id="specifications" className="scroll-mt-28" />
        <section id="shipping-faq" className="scroll-mt-28" />
        <section id="reviews" className="scroll-mt-28" />
        <section id="pdp-purchase" className="scroll-mt-28" />
      </main>
    </>,
  );
}

describe("PdpSectionNav", () => {
  it("renders five native anchors with unique scroll-safe targets on every viewport", () => {
    renderPage();

    const nav = screen.getByRole("navigation", { name: "Product sections" });
    const expected = [
      ["Details", "#details"],
      ["Specifications", "#specifications"],
      ["Delivery & FAQs", "#shipping-faq"],
      ["Reviews", "#reviews"],
      ["Order Now", "#pdp-purchase"],
    ] as const;

    expect(nav).toHaveClass("flex");
    expect(nav).toHaveClass("overflow-x-auto");
    expect(nav).not.toHaveClass("hidden");

    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(
      expected.map(([label]) => label),
    );

    for (const [label, href] of expected) {
      const link = within(nav).getByRole("link", { name: label });
      expect(link).toHaveAttribute("href", href);
      expect(link.className).toContain("focus-visible:");
      const targets = document.querySelectorAll(href);
      expect(targets).toHaveLength(1);
      expect(targets[0]).toHaveClass("scroll-mt-28");
    }
  });

  it("omits only unavailable Details and Specifications anchors", () => {
    renderPage({ hasDetails: false, hasSpecifications: false });

    const nav = screen.getByRole("navigation", { name: "Product sections" });
    expect(within(nav).queryByRole("link", { name: "Details" })).toBeNull();
    expect(
      within(nav).queryByRole("link", { name: "Specifications" }),
    ).toBeNull();
    expect(within(nav).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Delivery & FAQs",
      "Reviews",
      "Order Now",
    ]);
  });
});
