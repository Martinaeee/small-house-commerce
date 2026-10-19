import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SECTION_REGISTRY } from "./sectionRegistry";
import type { HomepageSection } from "@/lib/api";
import { SectionHeading, SectionShell } from "./sectionShell";

const section: HomepageSection = {
  id: "00000000-0000-7000-8000-000000000201",
  type: "USP",
  title: null,
  subtitle: null,
  sortOrder: 10,
  style: {
    backgroundColor: "#112233",
    textColor: "#fefefe",
    contentWidth: "NARROW",
    paddingTop: 18,
    paddingBottom: 26,
  },
  payload: { items: [{ icon: "shield", label: "Nationwide delivery" }] },
};

describe("homepage section style rendering", () => {
  it("exposes existing shell, bleed and heading elements to the shared appearance boundary", () => {
    const { container } = render(<SectionShell bleed><SectionHeading title="Section title" subtitle="Section copy" /></SectionShell>);
    const shell = container.querySelector("section");
    expect(shell).toHaveAttribute("data-homepage-section-shell");
    expect(shell).toHaveAttribute("data-homepage-bleed", "true");
    expect(container.querySelector("h2")).toHaveAttribute("data-homepage-role", "heading");
    expect(container.querySelector("p")).toHaveAttribute("data-homepage-role", "body");
    expect(container.querySelector("h2")?.closest('[data-homepage-role="heading-row"]')).not.toBeNull();
  });

  it.each(["USP", "SOLUTIONS", "BRAND_STORY", "CONFIDENCE", "ROOM_INSPIRATION", "PROMO_BANNER", "COUNTDOWN_BANNER", "UGC"] as const)("uses mobile style including explicit zero for %s in a fixed canvas", (type) => {
    const fixture: HomepageSection = {
      ...section, type, title: "Layout sample", payload: { body: "Layout illustration.", endsAt: new Date(Date.now() + 86_400_000).toISOString() }, products: [],
      style: { paddingTop: 31, overrides: { mobile: { paddingTop: 0 } } },
    };
    const Renderer = SECTION_REGISTRY[type];
    const { container } = render(<Renderer section={fixture} previewDevice="mobile" interactionMode="preview" />);
    expect(container.querySelector("section")).toHaveStyle({ paddingTop: "0px" });
  });

  it("routes public Confidence device width to its inner box and spacing to its full-width background", () => {
    const Renderer = SECTION_REGISTRY.CONFIDENCE;
    const { container } = render(<Renderer section={{ ...section, type: "CONFIDENCE", style: { overrides: { mobile: { paddingTop: 0, contentWidth: "NARROW", backgroundColor: "#112233" } } } }} />);
    const outer = container.querySelector("section")!;
    const inner = outer.firstElementChild!;
    expect(outer).toHaveClass("hp-style-mobile-padding-top", "hp-style-mobile-background-color");
    expect(outer).not.toHaveClass("hp-style-mobile-content-width");
    expect(inner).toHaveClass("hp-style-mobile-content-width");
  });

  it("does not reintroduce Confidence inner spacing after an explicit mobile zero", () => {
    const Renderer = SECTION_REGISTRY.CONFIDENCE;
    const { container } = render(<Renderer section={{ ...section, type: "CONFIDENCE", style: { overrides: { mobile: { paddingTop: 0, paddingBottom: 0 } } } }} previewDevice="mobile" />);
    const shell = container.querySelector("section")!;
    expect(shell.firstElementChild).toHaveStyle({ paddingTop: "0px", paddingBottom: "0px" });
  });

  it.each([
    ["FULL", "none"], ["STANDARD", "1200px"], ["NARROW", "840px"],
  ] as const)("exposes the configured %s width to the appearance boundary", (contentWidth, expected) => {
    const { container } = render(<SectionShell style={{ contentWidth }}>Content</SectionShell>);
    expect(container.querySelector("section")?.style.getPropertyValue("--hp-config-content-width")).toBe(expected);
  });

  it("resolves mobile zero padding and restores common style after reset", () => {
    const { container, rerender } = render(<SectionShell style={{ ...section.style!, overrides: { mobile: { paddingTop: 0, contentWidth: "FULL" } } }} previewDevice="mobile">Content</SectionShell>);
    expect(container.querySelector("section")).toHaveStyle({ paddingTop: "0px", paddingBottom: "26px", backgroundColor: "#112233" });
    expect(container.querySelector("section")).toHaveClass("max-w-none");
    rerender(<SectionShell style={section.style} previewDevice="mobile">Content</SectionShell>);
    expect(container.querySelector("section")).toHaveStyle({ paddingTop: "18px" });
    expect(container.querySelector("section")).toHaveClass("max-w-[840px]");
  });

  it("publishes bounded mobile style variables while leaving desktop inline values unchanged", () => {
    const { container } = render(<SectionShell style={{ ...section.style!, overrides: { mobile: { paddingTop: 0, textColor: "#123456" } } }}>Content</SectionShell>);
    const shell = container.querySelector<HTMLElement>("section")!;
    expect(shell.style.paddingTop).toBe("18px");
    expect(shell.style.getPropertyValue("--hp-style-mobile-padding-top")).toBe("0px");
    expect(shell.style.getPropertyValue("--hp-style-mobile-text-color")).toBe("#123456");
  });
  it("applies persisted section presentation styles to the storefront shell", () => {
    const Section = SECTION_REGISTRY.USP;
    const { container } = render(<Section section={section} />);
    const shell = container.querySelector("section");

    expect(shell).toHaveStyle({
      backgroundColor: "#112233",
      color: "#fefefe",
      paddingTop: "18px",
      paddingBottom: "26px",
    });
    expect(shell).toHaveClass("max-w-[840px]");
  });
});
