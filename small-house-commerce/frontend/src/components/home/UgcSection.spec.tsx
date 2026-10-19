import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { HomepageSection } from "@/lib/api";
import { UgcSection } from "./UgcSection";

const originalMatchMedia = window.matchMedia;

const product = (name: string, slug: string) => ({ name, slug });

const entries = [
  { id: "first", name: "Layout sample A", comment: "Sample text A", imageUrl: "/uploads/a.jpg" },
  { id: "second", name: "Layout sample B", location: "Sample location", comment: "Sample text B", imageUrl: "/uploads/b.jpg", product: product("Sample furniture", "sample-furniture") },
  { id: "third", name: "", comment: "", imageUrl: "/uploads/c.jpg" },
];
const section: HomepageSection = {
  id: "ugc", type: "UGC", title: "Real Homes", subtitle: null, sortOrder: 0,
  payload: { entries, presentation: { layout: "COLLAGE", featuredEntryId: "second", overlay: "SOFT" } },
};

type Row = Record<string, unknown>;

function collage(rows: Row[], featuredEntryId: string, showQuote?: boolean): HomepageSection {
  return {
    ...section,
    payload: { entries: rows, presentation: { layout: "COLLAGE", featuredEntryId, ...(showQuote === undefined ? {} : { showQuote }) } },
  };
}

function photos(count: number): Row[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `photo-${index}`, name: `Visitor ${index}`, comment: `Comment ${index}`, imageUrl: `/uploads/${index}.jpg`,
  }));
}

function stubOverflow(value = 96) {
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get(this: HTMLElement) { return this.hasAttribute("data-ugc-measure") ? value : 0; },
  });
}

function stubMobileViewport() {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: ((query: string) => ({
    matches: /max-width:\s*767/.test(query),
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia });
}

afterEach(() => {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollHeight;
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollWidth;
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
});

describe("UgcSection collage", () => {
  it("binds the featured quote and its own product link to the featured photo", () => {
    const { container } = render(<UgcSection section={section} previewDevice="mobile" />);
    const featured = container.querySelector<HTMLElement>("[data-ugc-featured]")!;
    expect(featured).not.toBeNull();
    expect(featured).toHaveAttribute("data-ugc-entry-id", "second");
    expect(featured.querySelector("img")).toHaveAttribute("src", "/uploads/b.jpg");
    expect(featured.querySelector("[data-ugc-summary]")).toHaveTextContent("Sample text B");
    expect(within(featured).queryByText(/Sample text A/)).toBeNull();
    expect(within(featured).getByRole("link", { name: /View Sample furniture/i }))
      .toHaveAttribute("href", "/products/sample-furniture");
    expect(container.querySelector('[data-ugc-entry-id="first"] blockquote')).toBeNull();
    expect(container.querySelector('[data-ugc-layout="collage"]')).toHaveAttribute("data-device", "mobile");
  });

  it("keeps the left/right collage on every device instead of stacking on phones", () => {
    for (const device of ["mobile", "tablet", "desktop"] as const) {
      const { container, unmount } = render(<UgcSection section={section} previewDevice={device} />);
      const canvas = container.querySelector("[data-ugc-canvas]")!;
      expect(canvas, device).not.toBeNull();
      expect(canvas.querySelector("[data-ugc-featured]"), device).not.toBeNull();
      expect(canvas.querySelector("[data-ugc-supporting]"), device).not.toBeNull();
      unmount();
    }
  });

  it.each([1, 2, 3, 4, 5, 6])("keeps all %i supplied photos and invents none", (count) => {
    const rows = photos(count);
    const { container } = render(<UgcSection section={collage(rows, "photo-0")} />);
    expect(container.querySelectorAll("[data-ugc-entry-id]")).toHaveLength(count);
    expect(container.querySelectorAll("[data-ugc-supporting] > figure")).toHaveLength(count - 1);
    if (count === 1) {
      expect(container.querySelector("[data-ugc-supporting]")).toBeNull();
    } else {
      expect(container.querySelector("[data-ugc-supporting]")).toHaveAttribute("data-count", String(count - 1));
    }
  });

  it("updates panning controls when photos change without a quote or viewport resize", () => {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 350 });
    Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
      configurable: true,
      get(this: HTMLElement) { return this.querySelectorAll("[data-ugc-entry-id]").length > 1 ? 500 : 350; },
    });
    const rows = photos(2);
    const { rerender } = render(<UgcSection section={collage(rows.slice(0, 1), "photo-0", false)} previewDevice="mobile" />);
    expect(screen.queryByRole("button", { name: "Next photos" })).toBeNull();
    rerender(<UgcSection section={collage(rows, "photo-0", false)} previewDevice="mobile" />);
    expect(screen.getByRole("button", { name: "Next photos" })).toBeEnabled();
    rerender(<UgcSection section={collage(rows.slice(0, 1), "photo-0", false)} previewDevice="mobile" />);
    expect(screen.queryByRole("button", { name: "Next photos" })).toBeNull();
  });

  it("points each photo at its own product and leaves unlinked photos inert", () => {
    const rows: Row[] = [
      { id: "a", name: "A", comment: "qa", imageUrl: "/uploads/a.jpg", product: product("Chair", "chair") },
      { id: "b", name: "B", comment: "qb", imageUrl: "/uploads/b.jpg", product: product("Table", "table") },
      { id: "c", name: "C", comment: "qc", imageUrl: "/uploads/c.jpg" },
    ];
    const { container } = render(<UgcSection section={collage(rows, "a")} />);
    expect(container.querySelector('[data-ugc-entry-id="a"] a[data-ugc-photo-link]'))
      .toHaveAttribute("href", "/products/chair");
    expect(container.querySelector('[data-ugc-entry-id="b"] a[data-ugc-photo-link]'))
      .toHaveAttribute("href", "/products/table");
    expect(container.querySelector('[data-ugc-entry-id="c"] a')).toBeNull();
    expect(container.querySelector('[data-ugc-entry-id="c"] button')).toBeNull();
  });

  it("never nests an interactive control inside a photo link", () => {
    const { container } = render(<UgcSection section={section} />);
    const link = container.querySelector("[data-ugc-photo-link]")!;
    expect(link.querySelector("a, button, input, select, textarea")).toBeNull();
  });

  it("hides the quote and attribution without removing the photo links when showQuote is off", () => {
    const source = structuredClone(section);
    source.payload.presentation = { layout: "COLLAGE", featuredEntryId: "second", showQuote: false };
    const { container } = render(<UgcSection section={source} />);
    expect(container.querySelector("[data-ugc-summary]")).toBeNull();
    expect(screen.queryByText(/Layout sample B/)).toBeNull();
    expect(container.querySelector("[data-ugc-entry-id='second'] a[data-ugc-photo-link]"))
      .toHaveAttribute("href", "/products/sample-furniture");
    expect(container.querySelectorAll("img")).toHaveLength(3);
    expect(source.payload.entries).toEqual(entries);
  });

  it("supports anonymous long quotes and broken photo placeholders without inventing social proof", () => {
    const quote = "x".repeat(1000);
    const source = collage(
      [{ id: "solo", name: "", comment: quote, imageUrl: "/uploads/404.jpg", stars: 5, verified: true }],
      "solo",
    );
    const { container } = render(<UgcSection section={source} />);
    expect(container.querySelector("[data-ugc-summary]")).toHaveTextContent(quote);
    expect(container.querySelector("[data-ugc-supporting]")).toBeNull();
    expect(screen.queryByText(/verified|purchase|customer|★/i)).toBeNull();
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
  });

  it("does not silently choose a different featured row", () => {
    const { container } = render(<UgcSection section={collage(entries as unknown as Row[], "removed")} />);
    expect(container.querySelector("figure")).toBeNull();
  });

  it("keeps preview product links inert for tracking", () => {
    const { container } = render(<UgcSection section={section} interactionMode="preview" />);
    expect(container.querySelector("[data-track-event]")).toBeNull();
  });

  it("tracks photo product clicks outside preview mode", () => {
    const { container } = render(<UgcSection section={section} />);
    expect(container.querySelector("[data-ugc-photo-link]")).toHaveAttribute("data-track-event", "ProductClick");
  });

  it("retains legacy cards and captions when no presentation is supplied", () => {
    const { container } = render(<UgcSection section={{ ...section, payload: { entries: entries.slice(0, 2) } }} />);
    expect(container.querySelectorAll("figcaption")).toHaveLength(2);
    expect(container.querySelectorAll("blockquote")).toHaveLength(2);
    expect(screen.getByText(/Sample text A/)).toBeVisible();
    expect(container.querySelector("[data-ugc-layout]")).toBeNull();
  });
});

describe("UgcSection collage quote reading", () => {
  it("closes the reader with Escape from its toolbar as well as its body", () => {
    stubOverflow();
    const { container } = render(<UgcSection section={section} />);
    fireEvent.click(container.querySelector("[data-ugc-expand]")!);
    fireEvent.keyDown(container.querySelector("[data-ugc-collapse]")!, { key: "Escape" });
    expect(container.querySelector("[data-ugc-reader]")).toBeNull();
    expect(container.querySelector("[data-ugc-expand]")).toHaveFocus();
  });

  it("restores photo badges when quotes are disabled while the reader is open", () => {
    stubOverflow();
    const { container, rerender } = render(<UgcSection section={section} />);
    fireEvent.click(container.querySelector("[data-ugc-expand]")!);
    rerender(<UgcSection section={collage(entries as unknown as Row[], "second", false)} />);
    expect(container.querySelector("[data-ugc-reader]")).toBeNull();
    expect(container.querySelector("[data-ugc-photo-badge]")).not.toHaveAttribute("hidden");
  });
  it("offers Read more only when the collapsed summary really overflows", () => {
    const { container, unmount } = render(<UgcSection section={section} />);
    expect(container.querySelector("[data-ugc-expand]")).toBeNull();
    expect(container.querySelector("[data-ugc-summary]")).not.toBeNull();
    unmount();

    stubOverflow();
    const { container: overflowing } = render(<UgcSection section={section} />);
    const expand = overflowing.querySelector<HTMLElement>("[data-ugc-expand]")!;
    expect(expand).not.toBeNull();
    expect(expand).toHaveAttribute("aria-expanded", "false");
    expect(overflowing.querySelector("[data-ugc-reader]")).toBeNull();
  });

  it("expands the full quote into its own scroll region and collapses again", () => {
    stubOverflow();
    const { container } = render(<UgcSection section={section} />);
    fireEvent.click(container.querySelector("[data-ugc-expand]")!);

    const reader = container.querySelector<HTMLElement>("[data-ugc-reader]")!;
    expect(reader).not.toBeNull();
    expect(reader).toHaveAttribute("role", "region");
    expect(within(reader).getByText(/Sample text B/)).toBeVisible();
    expect(container.querySelector("[data-ugc-summary]")).toBeNull();
    expect(container.querySelector("[data-ugc-featured] img")).not.toBeNull();

    fireEvent.click(container.querySelector("[data-ugc-collapse]")!);
    expect(container.querySelector("[data-ugc-reader]")).toBeNull();
    expect(container.querySelector("[data-ugc-summary]")).not.toBeNull();
  });

  it("restores focus to the expand control when Escape collapses the reader", () => {
    stubOverflow();
    const { container } = render(<UgcSection section={section} />);
    fireEvent.click(container.querySelector("[data-ugc-expand]")!);
    fireEvent.keyDown(container.querySelector("[data-ugc-reader]")!, { key: "Escape" });
    const expand = container.querySelector<HTMLElement>("[data-ugc-expand]")!;
    expect(container.querySelector("[data-ugc-reader]")).toBeNull();
    expect(document.activeElement).toBe(expand);
  });

  it("keeps the photo link reachable while expanded but hides its badge", () => {
    stubOverflow();
    const { container } = render(<UgcSection section={section} />);
    fireEvent.click(container.querySelector("[data-ugc-expand]")!);
    const link = container.querySelector<HTMLElement>("[data-ugc-featured] [data-ugc-photo-link]")!;
    expect(link).toHaveAttribute("href", "/products/sample-furniture");
    expect(link.querySelector("[data-ugc-photo-badge]")).toHaveAttribute("hidden");
  });

  it("collapses the reader when the featured photo changes", () => {
    stubOverflow();
    const { container, rerender } = render(<UgcSection section={section} />);
    fireEvent.click(container.querySelector("[data-ugc-expand]")!);
    expect(container.querySelector("[data-ugc-reader]")).not.toBeNull();
    rerender(<UgcSection section={collage(entries as unknown as Row[], "first")} />);
    expect(container.querySelector("[data-ugc-reader]")).toBeNull();
    expect(container.querySelector("[data-ugc-featured]")).toHaveAttribute("data-ugc-entry-id", "first");
  });

  it("moves the expanded reader and the attribution out of the panning canvas on phones", () => {
    stubOverflow();
    stubMobileViewport();
    const { container } = render(<UgcSection section={section} />);
    fireEvent.click(container.querySelector("[data-ugc-expand]")!);
    const viewport = container.querySelector("[data-ugc-viewport]")!;
    expect(viewport.querySelector("[data-ugc-reader]")).toBeNull();
    expect(container.querySelector("[data-ugc-meta] [data-homepage-role='name']")).not.toBeNull();
  });

  it("keeps the attribution inside the photo panel on wider viewports", () => {
    const { container } = render(<UgcSection section={section} />);
    expect(container.querySelector("[data-ugc-meta]")).toBeNull();
    expect(container.querySelector("[data-ugc-featured] [data-homepage-role='name']")).not.toBeNull();
  });
});
