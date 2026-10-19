import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { HomepageSection } from "@/lib/api";
import { UspSection } from "./UspSection";

const section: HomepageSection = {
  id: "usp", type: "USP", title: "Why luwag", subtitle: null, sortOrder: 20,
  payload: { items: [
    { icon: "home", label: "Small rooms", sub: "Layout illustration only" },
    { icon: "truck", label: "Everyday spaces", sub: "Layout illustration only" },
    { icon: "shield", label: "Room to move", sub: "Layout illustration only" },
  ] },
};

describe("UspSection service benefits", () => {
  it("renders every benefit and exposes the real item count the phone layout keys on", () => {
    const { container } = render(<UspSection section={section} previewDevice="mobile" />);
    const grid = container.querySelector<HTMLElement>("[data-usp-count]")!;
    expect(grid.dataset.uspCount).toBe("3");
    expect(grid.children).toHaveLength(3);
    for (const item of section.payload.items as Array<{ label: string }>) {
      expect(screen.getByText(item.label)).toBeVisible();
    }
  });

  it("counts four benefits separately so the phone row knows how many it holds", () => {
    const four = { ...section, payload: { items: [...(section.payload.items as unknown[]), { icon: "lock", label: "Simple routines" }] } };
    const { container } = render(<UspSection section={four} previewDevice="mobile" />);
    const grid = container.querySelector<HTMLElement>("[data-usp-count]")!;
    expect(grid.dataset.uspCount).toBe("4");
    expect(grid.children).toHaveLength(4);
  });

  it("keeps the shared trust bar when no benefit is configured", () => {
    render(<UspSection section={{ ...section, payload: { items: [] } }} previewDevice="mobile" />);
    expect(screen.queryByText("Small rooms")).not.toBeInTheDocument();
    expect(document.querySelector("[data-usp-count]")).toBeNull();
  });
});
