import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { HomepageSection } from "@/lib/api";
import { CategoryTilesSection } from "./CategoryTilesSection";

const entries = ["Living areas", "Work spaces", "Dining corners", "Quiet rooms", "Shared spaces", "Storage ideas"]
  .map((name, index) => ({
    id: `entry-${index}`,
    name,
    imageUrl: `/uploads/e2e/category-${index}.jpg`,
    href: `/categories/category-${index}`,
    link: { type: "CATEGORY" as const, id: `category-${index}` },
  }));

const section: HomepageSection = {
  id: "category-rail", type: "CATEGORY_TILES", title: "Shop your space", subtitle: null, sortOrder: 10,
  payload: { entries: [], presentation: "CIRCLES" },
  navigationEntries: entries,
};

function overflowingRail(container: HTMLElement): HTMLElement {
  const node = container.querySelector<HTMLElement>("[data-homepage-category-rail]")!;
  Object.defineProperty(node, "scrollWidth", { value: 541, configurable: true });
  Object.defineProperty(node, "clientWidth", { value: 350, configurable: true });
  Object.defineProperty(node, "scrollLeft", { value: 0, writable: true, configurable: true });
  // The rail only learns it overflows from a scroll/resize tick, so make it tick.
  fireEvent.scroll(node);
  return node;
}

describe("category rail swiping", () => {
  it("stays a plain swipe surface: no pan controls even when the rail overflows", () => {
    const { container } = render(<CategoryTilesSection section={section} previewDevice="mobile" />);
    overflowingRail(container);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText(/Swipe to explore/)).not.toBeInTheDocument();
  });

  it("keeps the rail named and focusable so a keyboard can scroll it", () => {
    const { container } = render(<CategoryTilesSection section={section} previewDevice="mobile" />);
    const rail = container.querySelector<HTMLElement>("[data-homepage-category-rail]")!;
    expect(rail).toHaveAttribute("role", "group");
    expect(rail).toHaveAttribute("aria-label", "Shop by category");
    expect(rail).toHaveAttribute("tabindex", "0");
  });

  it("still renders every category with its full accessible name", () => {
    render(<CategoryTilesSection section={section} previewDevice="mobile" />);
    for (const entry of entries) {
      expect(screen.getByRole("link", { name: entry.name })).toBeVisible();
    }
  });
});
