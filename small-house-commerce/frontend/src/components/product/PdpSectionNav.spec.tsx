import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
        hasDelivery
      />
      <main>
        <section id="pdp-purchase" className="scroll-mt-32" />
        <section id="pdp-delivery" className="scroll-mt-32" />
        <section id="details" className="scroll-mt-32" />
        <section id="specifications" className="scroll-mt-32" />
        <section id="reviews" className="scroll-mt-32" />
      </main>
    </>,
  );
}

afterEach(() => vi.restoreAllMocks());

function sectionPositions(tops: Record<string, number>) {
  for (const [id, top] of Object.entries(tops)) {
    vi.spyOn(document.getElementById(id)!, "getBoundingClientRect").mockReturnValue({
      top, bottom: top + 500, left: 0, right: 600, width: 600, height: 500,
      x: 0, y: top, toJSON: () => ({}),
    });
  }
}

describe("PdpSectionNav", () => {
  it("renders native anchors for real content including the existing delivery card", () => {
    renderPage();

    const nav = screen.getByRole("navigation", { name: "Product sections" });
    const expected = [
      ["Details", "#details"],
      ["Specifications", "#specifications"],
      ["Delivery", "#pdp-delivery"],
      ["Reviews & Q&A", "#reviews"],
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
      expect(targets[0]).toHaveClass("scroll-mt-32");
    }
  });

  it("keeps the combined Q&A anchor available when no FAQ has been published", () => {
    renderPage();

    const nav = screen.getByRole("navigation", { name: "Product sections" });
    expect(
      within(nav).getByRole("link", { name: "Reviews & Q&A" }),
    ).toHaveAttribute("href", "#reviews");
    expect(document.querySelector("#shipping-faq")).toBeNull();
  });

  it("omits only unavailable Details and Specifications anchors", () => {
    renderPage({ hasDetails: false, hasSpecifications: false });

    const nav = screen.getByRole("navigation", { name: "Product sections" });
    expect(within(nav).queryByRole("link", { name: "Details" })).toBeNull();
    expect(
      within(nav).queryByRole("link", { name: "Specifications" }),
    ).toBeNull();
    expect(within(nav).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Delivery",
      "Reviews & Q&A",
      "Order Now",
    ]);
  });

  it("immediately marks only the clicked native anchor current", () => {
    renderPage();
    const nav = screen.getByRole("navigation", { name: "Product sections" });
    const specifications = within(nav).getByRole("link", { name: "Specifications" });
    fireEvent.click(specifications);
    expect(specifications).toHaveAttribute("aria-current", "location");
    expect(specifications).toHaveClass("border-cta", "text-cta");
    expect(nav.querySelectorAll('[aria-current="location"]')).toHaveLength(1);
    fireEvent.click(within(nav).getByRole("link", { name: "Delivery" }));
    expect(specifications).not.toHaveAttribute("aria-current");
    expect(within(nav).getByRole("link", { name: "Delivery" })).toHaveAttribute("aria-current", "location");
  });

  it("tracks scrolling down and back up using content positions rather than menu order", async () => {
    renderPage();
    sectionPositions({ "pdp-purchase": -900, "pdp-delivery": -500, details: -200, specifications: 100, reviews: 800 });
    fireEvent.scroll(window);
    const nav = screen.getByRole("navigation", { name: "Product sections" });
    await waitFor(() => expect(within(nav).getByRole("link", { name: "Specifications" })).toHaveAttribute("aria-current", "location"));
    sectionPositions({ "pdp-purchase": 20, "pdp-delivery": 600, details: 900, specifications: 1500, reviews: 2000 });
    fireEvent.scroll(window);
    await waitFor(() => expect(within(nav).getByRole("link", { name: "Order Now" })).toHaveAttribute("aria-current", "location"));
    expect(nav.querySelectorAll('[aria-current="location"]')).toHaveLength(1);
  });

  it("rechecks layout after resizing without requiring another click", async () => {
    renderPage();
    sectionPositions({ "pdp-purchase": -1500, "pdp-delivery": -1000, details: -900, specifications: -500, reviews: 40 });
    fireEvent.resize(window);
    const reviews = screen.getByRole("link", { name: "Reviews & Q&A" });
    await waitFor(() => expect(reviews).toHaveAttribute("aria-current", "location"));
  });

  it("keeps a native anchor current when subpixel layout rounds its landing position", async () => {
    renderPage();
    sectionPositions({ "pdp-purchase": -1500, "pdp-delivery": -1000, details: -900, specifications: -500, reviews: 128.5 });
    fireEvent.scroll(window);
    await waitFor(() => expect(screen.getByRole("link", { name: "Reviews & Q&A" })).toHaveAttribute("aria-current", "location"));
  });

  it("keeps the same current link visible when the rail narrows", async () => {
    renderPage();
    sectionPositions({ "pdp-purchase": -1500, "pdp-delivery": -1000, details: -900, specifications: -500, reviews: 40 });
    const nav = screen.getByRole("navigation", { name: "Product sections" });
    const reviews = within(nav).getByRole("link", { name: "Reviews & Q&A" });
    let width = 600;
    Object.defineProperty(nav, "clientWidth", { configurable: true, get: () => width });
    Object.defineProperty(reviews, "offsetLeft", { configurable: true, value: 350 });
    Object.defineProperty(reviews, "offsetWidth", { configurable: true, value: 120 });
    fireEvent.click(reviews);
    expect(nav.scrollLeft).toBe(0);
    width = 140;
    fireEvent.resize(window);
    await waitFor(() => expect(nav.scrollLeft).toBeGreaterThan(0));
    expect(reviews).toHaveAttribute("aria-current", "location");
  });

  it("reveals the active link horizontally without scrolling the document", () => {
    renderPage();
    const nav = screen.getByRole("navigation", { name: "Product sections" });
    const reviews = within(nav).getByRole("link", { name: "Reviews & Q&A" });
    Object.defineProperty(nav, "clientWidth", { configurable: true, value: 140 });
    Object.defineProperty(reviews, "offsetLeft", { configurable: true, value: 350 });
    Object.defineProperty(reviews, "offsetWidth", { configurable: true, value: 120 });
    const pageScroll = vi.spyOn(window, "scrollTo");
    fireEvent.click(reviews);
    expect(nav.scrollLeft).toBeGreaterThan(0);
    expect(pageScroll).not.toHaveBeenCalled();
  });
});
