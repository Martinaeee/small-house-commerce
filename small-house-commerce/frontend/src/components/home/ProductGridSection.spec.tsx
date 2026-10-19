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
  it("applies mobile grid settings without changing the hydrated ProductCard", () => {
    const { container, rerender } = render(<ProductGridSection section={section} previewDevice="mobile" interactionMode="preview" />);
    const card = container.querySelector("article")!.outerHTML;
    rerender(<ProductGridSection section={{ ...section, payload: { layout: { overrides: { mobile: { columns: 1, gap: 6 } } } } }} previewDevice="mobile" interactionMode="preview" />);
    const grid = container.querySelector<HTMLElement>(".grid")!;
    expect(grid.style.gridTemplateColumns).toBe("repeat(1, minmax(0, 1fr))");
    expect(grid.style.gap).toBe("6px");
    expect(container.querySelector("article")!.outerHTML).toBe(card);
  });

  it.each(["desktop", "tablet", "mobile"] as const)("retains legacy two columns on %s when only a gap field is added", previewDevice => {
    const { container } = render(<ProductGridSection section={{ ...section, payload: { columns: 2, layout: { gap: 8 } } }} previewDevice={previewDevice} interactionMode="preview" />);
    expect(container.querySelector<HTMLElement>(".grid")!.style.gridTemplateColumns).toBe("repeat(2, minmax(0, 1fr))");
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
