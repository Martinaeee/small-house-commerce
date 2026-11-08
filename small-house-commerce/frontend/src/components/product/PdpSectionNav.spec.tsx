import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installDesktopViewport } from "@/test/desktop-viewport";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PdpSectionNav } from "./PdpSectionNav";

let galleryCallback: IntersectionObserverCallback | null = null;

function renderPage({
  hasDetails = true,
  hasSpecifications = true,
}: {
  hasDetails?: boolean;
  hasSpecifications?: boolean;
} = {}) {
  const result = render(
    <div data-storefront-shell-mode="live">
      <div className="sticky top-0 z-40"><div>Announcement</div><header /></div>
      <main>
        <div data-pdp-gallery />
        <PdpSectionNav
          hasDetails={hasDetails}
          hasSpecifications={hasSpecifications}
        />
        <section id="product" className="scroll-mt-32" />
        <section id="pdp-purchase" className="scroll-mt-32" />
        <section id="details" className="scroll-mt-32" />
        <section id="specifications" className="scroll-mt-32" />
        <section id="reviews" className="scroll-mt-32" />
      </main>
    </div>,
  );
  // Mobile tests assume the shopper already scrolled past the hero gallery;
  // that is when the overlay rail is on screen.
  if (galleryCallback) {
    const gallery = document.querySelector("[data-pdp-gallery]")!;
    act(() => galleryCallback!(
      [{ target: gallery, isIntersecting: false, intersectionRatio: 0 } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ));
  }
  return result;
}

beforeEach(() => {
  galleryCallback = null;
  vi.stubGlobal("IntersectionObserver", class {
    root = null;
    rootMargin = "";
    thresholds = [0];
    constructor(callback: IntersectionObserverCallback) { galleryCallback = callback; }
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  });
  installDesktopViewport();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function elementHeight(element: Element, height: number) {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    top: 0, bottom: height, left: 0, right: 600, width: 600, height,
    x: 0, y: 0, toJSON: () => ({}),
  });
}

function sectionPositions(tops: Record<string, number>) {
  for (const [id, top] of Object.entries(tops)) {
    vi.spyOn(document.getElementById(id)!, "getBoundingClientRect").mockReturnValue({
      top, bottom: top + 500, left: 0, right: 600, width: 600, height: 500,
      x: 0, y: top, toJSON: () => ({}),
    });
  }
}

describe("PdpSectionNav", () => {
  it("uses the compact four-tab rail on phones", () => {
    installDesktopViewport(false);
    renderPage();
    const nav = screen.getByRole("navigation", { name: "Product sections" });
    expect(within(nav).queryByRole("link", { name: "Order Now" })).toBeNull();
    expect(within(nav).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Product",
      "Details",
      "Specifications",
      "Reviews & Q&A",
    ]);
    expect(within(nav).getByRole("link", { name: "Product" })).toHaveAttribute("href", "#product");
  });

  it("uses only the visible header height after the announcement scrolls away", async () => {
    installDesktopViewport(false);
    renderPage();
    const nav = screen.getByRole("navigation", { name: "Product sections" });
    const header = screen.getByRole("banner").parentElement!;
    vi.spyOn(header, "getBoundingClientRect").mockReturnValue({ top: -26, height: 78 } as DOMRect);
    elementHeight(nav, 53);
    fireEvent.scroll(window);
    await waitFor(() => expect(nav.style.top).toBe("52px"));
  });

  it("shows the overlay rail only after the main gallery leaves the viewport", async () => {
    installDesktopViewport(false);
    renderPage();
    const nav = screen.getByRole("navigation", { name: "Product sections" });
    const gallery = document.querySelector("[data-pdp-gallery]")!;
    expect(nav).toHaveAttribute("data-pinned", "true");
    expect(nav).not.toHaveAttribute("inert");

    act(() => galleryCallback?.(
      [{ target: gallery, isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ));
    await waitFor(() => expect(nav).toHaveAttribute("data-pinned", "false"));
    expect(nav).toHaveAttribute("inert");

    act(() => galleryCallback?.(
      [{ target: gallery, isIntersecting: false, intersectionRatio: 0 } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ));
    await waitFor(() => expect(nav).toHaveAttribute("data-pinned", "true"));
    expect(nav).not.toHaveAttribute("inert");
    // The rail is an overlay, never an in-flow row above the detail images.
    expect(nav.className).not.toContain("relative");
  });

  it.each([
    { device: "mobile", headerHeight: 113, margin: "174px" },
    { device: "desktop", headerHeight: 125, margin: "186px" },
  ])("sits below the entire sticky header on $device and clears it on anchor jumps", async ({ headerHeight, margin }) => {
    renderPage();
    const nav = screen.getByRole("navigation", { name: "Product sections" });
    const header = screen.getByRole("banner").parentElement!;
    elementHeight(header, headerHeight);
    elementHeight(nav, 53);

    fireEvent.resize(window);

    await waitFor(() => expect(nav.style.top).toBe(`${headerHeight}px`));
    for (const id of ["pdp-purchase", "details", "specifications", "reviews"]) {
      expect(document.getElementById(id)!.style.scrollMarginTop).toBe(margin);
    }
  });

  it("follows announcement or font height changes without waiting for a window resize", async () => {
    const callbacks = new Map<Element, () => void>();
    vi.stubGlobal("ResizeObserver", class {
      constructor(private callback: () => void) {}
      observe(target: Element) { callbacks.set(target, this.callback); }
      unobserve(target: Element) { callbacks.delete(target); }
      disconnect() {}
    });
    renderPage();
    const nav = screen.getByRole("navigation", { name: "Product sections" });
    const header = screen.getByRole("banner").parentElement!;
    elementHeight(header, 125);
    elementHeight(nav, 53);
    fireEvent.resize(window);
    await waitFor(() => expect(nav.style.top).toBe("125px"));

    elementHeight(header, 149);
    callbacks.get(header)?.();

    await waitFor(() => expect(nav.style.top).toBe("149px"));
    expect(document.getElementById("reviews")!.style.scrollMarginTop).toBe("210px");
  });

  it("renders native anchors for the real content sections", () => {
    renderPage();

    const nav = screen.getByRole("navigation", { name: "Product sections" });
    const expected = [
      ["Details", "#details"],
      ["Specifications", "#specifications"],
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
    fireEvent.click(within(nav).getByRole("link", { name: "Order Now" }));
    expect(specifications).not.toHaveAttribute("aria-current");
    expect(within(nav).getByRole("link", { name: "Order Now" })).toHaveAttribute("aria-current", "location");
  });

  it("tracks scrolling down and back up using content positions rather than menu order", async () => {
    renderPage();
    sectionPositions({ "pdp-purchase": -900, details: -200, specifications: 100, reviews: 800 });
    fireEvent.scroll(window);
    const nav = screen.getByRole("navigation", { name: "Product sections" });
    await waitFor(() => expect(within(nav).getByRole("link", { name: "Specifications" })).toHaveAttribute("aria-current", "location"));
    sectionPositions({ "pdp-purchase": 20, details: 900, specifications: 1500, reviews: 2000 });
    fireEvent.scroll(window);
    await waitFor(() => expect(within(nav).getByRole("link", { name: "Order Now" })).toHaveAttribute("aria-current", "location"));
    expect(nav.querySelectorAll('[aria-current="location"]')).toHaveLength(1);
  });

  it("rechecks layout after resizing without requiring another click", async () => {
    renderPage();
    sectionPositions({ "pdp-purchase": -1500, details: -900, specifications: -500, reviews: 40 });
    fireEvent.resize(window);
    const reviews = screen.getByRole("link", { name: "Reviews & Q&A" });
    await waitFor(() => expect(reviews).toHaveAttribute("aria-current", "location"));
  });

  it("keeps a native anchor current when subpixel layout rounds its landing position", async () => {
    renderPage();
    sectionPositions({ "pdp-purchase": -1500, details: -900, specifications: -500, reviews: 128.5 });
    fireEvent.scroll(window);
    await waitFor(() => expect(screen.getByRole("link", { name: "Reviews & Q&A" })).toHaveAttribute("aria-current", "location"));
  });

  it("keeps the same current link visible when the rail narrows", async () => {
    renderPage();
    sectionPositions({ "pdp-purchase": -1500, details: -900, specifications: -500, reviews: 40 });
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
