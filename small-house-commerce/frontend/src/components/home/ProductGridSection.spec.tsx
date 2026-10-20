import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { HomepageSection } from "@/lib/api";
import { cardTestProduct } from "@/test/product-card-fixtures";
import { ProductGridSection } from "./ProductGridSection";

const tracking = vi.hoisted(() => ({ track: vi.fn(), trackCustom: vi.fn() }));
vi.mock("@/lib/tracking", () => tracking);

const section: HomepageSection = {
  id: "grid-preview", type: "PRODUCT_GRID", title: "Selected tables", subtitle: null, sortOrder: 0, payload: {},
  products: [{ ...cardTestProduct({ defaultDisplayVariantId: "blue-variant", cardMedia: {
    displayVariantId: "blue-variant", unselected: { cover: null, scene: null }, variants: [],
  } }), badge: "New" }],
};

beforeEach(() => vi.clearAllMocks());

describe("ProductGridSection preview isolation", () => {
  it("renders a single horizontal swipe rail without changing the hydrated ProductCard", () => {
    const { container, rerender } = render(<ProductGridSection section={section} previewDevice="mobile" interactionMode="preview" />);
    const card = container.querySelector("article")!.outerHTML;
    rerender(<ProductGridSection section={{ ...section, payload: { layout: { overrides: { mobile: { columns: 1, gap: 6 } } } } }} previewDevice="mobile" interactionMode="preview" />);
    const rail = container.querySelector<HTMLElement>("[data-homepage-product-rail]")!;
    expect(rail).not.toBeNull();
    expect(rail.className).toContain("hp-product-rail");
    expect(rail.style.gap).toBe("6px");
    expect(rail.style.getPropertyValue("--hp-layout-mobile-columns")).toBe("1");
    expect(rail.style.getPropertyValue("gridTemplateColumns")).toBe("");
    expect(container.querySelector("article")!.outerHTML).toBe(card);
  });

  it.each(["desktop", "tablet", "mobile"] as const)("retains legacy two columns per screen on %s when only a gap field is added", previewDevice => {
    const { container } = render(<ProductGridSection section={{ ...section, payload: { columns: 2, layout: { gap: 8 } } }} previewDevice={previewDevice} interactionMode="preview" />);
    const rail = container.querySelector<HTMLElement>("[data-homepage-product-rail]")!;
    expect(rail).not.toBeNull();
    expect(rail.style.getPropertyValue(`--hp-layout-${previewDevice}-columns`)).toBe("2");
    expect(rail.style.getPropertyValue("gridTemplateColumns")).toBe("");
  });

  it("wraps each product in its own fixed-width rail cell", () => {
    const second = { ...section.products![0]!, id: "product-2", slug: "/products/two" };
    const { container } = render(<ProductGridSection section={{ ...section, products: [section.products![0]!, second] }} previewDevice="mobile" interactionMode="preview" />);
    const rail = container.querySelector("[data-homepage-product-rail]")!;
    const cells = rail.querySelectorAll(".hp-product-rail-cell");
    expect(cells).toHaveLength(2);
    cells.forEach(cell => expect(cell.querySelector("article")).not.toBeNull());
  });

  it("applies the STUDIO appearance gap to the rail", () => {
    const { container } = render(<ProductGridSection section={section} previewDevice="desktop" interactionMode="preview" appearance="STUDIO_V3" />);
    expect(container.querySelector<HTMLElement>("[data-homepage-product-rail]")!.style.gap).toBe("24px");
  });

  it("renders a plain rail outside preview with no inline grid styles", () => {
    const { container } = render(<ProductGridSection section={section} interactionMode="preview" />);
    const rail = container.querySelector<HTMLElement>("[data-homepage-product-rail]")!;
    expect(rail).not.toBeNull();
    expect(rail.className).toContain("hp-product-rail");
    expect(rail.style.length).toBe(0);
    expect(container.querySelector("article")).not.toBeNull();
  });
  it.each(["desktop", "tablet", "mobile"] as const)("renders inert cards without cart context on the %s canvas", previewDevice => {
    const { container } = render(<ProductGridSection section={section} previewDevice={previewDevice} interactionMode="preview" />);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(container.querySelector("[data-track-event]")).toBeNull();
    for (const button of screen.getAllByRole("button")) {
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(screen.getByRole("button", { name: "Blue" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(tracking.track).not.toHaveBeenCalled();
    expect(tracking.trackCustom).not.toHaveBeenCalled();
  });

  it("preserves the empty selection placeholder without cart context", () => {
    render(<ProductGridSection section={{ ...section, products: [] }} interactionMode="preview" />);
    expect(screen.getByText(/Products coming soon/)).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
