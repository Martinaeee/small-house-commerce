import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { HomepageSection } from "@/lib/api";
import { CategoryTilesSection } from "./CategoryTilesSection";

const section: HomepageSection = {
  id: "category-responsive", type: "CATEGORY_TILES", title: "Shop your space", subtitle: null, sortOrder: 10,
  payload: { categoryIds: ["living"], layout: { columns: 5, gap: 12, overrides: {
    tablet: { columns: 3 }, mobile: { columns: 1, gap: 8, imageRatio: "PORTRAIT" },
  } } },
  categories: [{ id: "living", name: "Living room", slug: "living-room", imageUrl: "/uploads/living.jpg" }],
};

describe("custom homepage navigation", () => {
  const entry = { id: "entry", name: "Local collection", imageUrl: "/uploads/e2e/custom.jpg", href: "/collections/local", link: { type: "COLLECTION" as const, id: "collection" } };
  it("renders one accessible image link with its name outside and the real collection href", () => {
    const { container } = render(<CategoryTilesSection section={{ ...section, payload: { entries: [], presentation: "CIRCLES" }, navigationEntries: [entry] }} previewDevice="mobile" />);
    const link = screen.getByRole("link", { name: entry.name });
    expect(link).toHaveAttribute("href", entry.href);
    expect(link).toHaveAttribute("aria-label", entry.name);
    expect(link).toHaveAttribute("data-track-event", "CategoryClick");
    expect(link).not.toHaveTextContent(entry.name);
    expect(screen.getByText(entry.name)).toBeVisible();
    expect(container.querySelector("img")).toHaveAttribute("src", entry.imageUrl);
    expect(container.querySelector("img")).toHaveAttribute("alt", "");
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("does not revive legacy categories when new navigation is empty", () => {
    render(<CategoryTilesSection section={{ ...section, navigationEntries: [] }} />);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.queryByText("Living room")).not.toBeInTheDocument();
    expect(screen.queryByText(/being prepared/)).not.toBeInTheDocument();
  });

  it("keeps explicit grid settings but makes circular image geometry independent of image ratio", () => {
    const { container } = render(<CategoryTilesSection section={{ ...section, payload: { ...section.payload, presentation: "CIRCLES" }, navigationEntries: [entry] }} previewDevice="mobile" />);
    const grid = container.querySelector<HTMLElement>(".grid")!;
    expect(grid.style.gridTemplateColumns).toBe("repeat(1, minmax(0, 1fr))");
    expect(grid.style.gap).toBe("8px");
    expect(screen.getByRole("link", { name: entry.name }).style.aspectRatio).not.toBe("3 / 4");
  });

  it("uses a neutral placeholder after a configured image fails without substituting a product image", () => {
    const { container } = render(<CategoryTilesSection section={{ ...section, navigationEntries: [entry] }} />);
    const image = container.querySelector("img")!;
    fireEvent.error(image);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("link", { name: entry.name })).toHaveAttribute("href", entry.href);
  });

  it("has no tracking attributes in preview mode", () => {
    const { container } = render(<CategoryTilesSection section={{ ...section, navigationEntries: [entry] }} interactionMode="preview" />);
    expect(container.querySelector("[data-track-event]")).toBeNull();
  });
});

describe("CategoryTilesSection responsive display", () => {
  it.each([
    ["desktop", 5, 12, "1 / 1"], ["tablet", 3, 12, "1 / 1"], ["mobile", 1, 8, "3 / 4"],
  ] as const)("consumes the %s layout without changing category content", (device, columns, gap, ratio) => {
    const original = structuredClone(section);
    const { container } = render(<CategoryTilesSection section={section} previewDevice={device} />);
    const grid = container.querySelector<HTMLElement>(".grid")!;
    expect(grid.style.gridTemplateColumns).toBe(`repeat(${columns}, minmax(0, 1fr))`);
    expect(grid.style.gap).toBe(`${gap}px`);
    const tile = screen.getByRole("link", { name: /Living room/ });
    expect(tile).toHaveAttribute("href", "/categories/living-room");
    expect(tile.style.aspectRatio).toBe(ratio);
    expect(screen.getByRole("img")).toHaveAttribute("src", "/uploads/living.jpg");
    expect(section).toEqual(original);
  });

  it("retains device column defaults when only mobile gap is configured", () => {
    const { container } = render(<CategoryTilesSection section={{ ...section, payload: { layout: { overrides: { mobile: { gap: 0 } } } } }} previewDevice="mobile" />);
    expect(container.querySelector<HTMLElement>(".grid")!.style.gridTemplateColumns).toBe("repeat(2, minmax(0, 1fr))");
    expect(container.querySelector<HTMLElement>(".grid")!.style.gap).toBe("0px");
  });

  it("keeps the original empty-module placeholder", () => {
    render(<CategoryTilesSection section={{ ...section, categories: [] }} previewDevice="mobile" />);
    expect(screen.getByText("Categories are being prepared — check back soon.")).toBeVisible();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});
