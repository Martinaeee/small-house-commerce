import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HomepageAppearance } from "./HomepageAppearance";
import type { HomepageSection } from "@/lib/api";
import { SECTION_REGISTRY } from "./sectionRegistry";

const base: HomepageSection = {
  id: "00000000-0000-7000-8000-000000000801", type: "BRAND_STORY", title: "Layout sample", subtitle: null, sortOrder: 20,
  payload: {},
};

describe("HomepageAppearance", () => {
  it.each([
    { type: "USP", payload: { items: [{ label: "Layout sample", sub: "Sample body" }] }, roles: ["label", "body"] },
    { type: "SOLUTIONS", payload: { items: [{ title: "Layout sample", blurb: "Sample body", link: "/collections" }] }, roles: ["card", "label", "body"] },
    { type: "PRODUCT_STORY", payload: { imageUrl: "/uploads/e2e/layout.jpg", body: "Sample body", ctaText: "See collections", ctaLink: "/collections" }, roles: ["story-heading", "body", "media", "action"] },
    { type: "ROOM_INSPIRATION", payload: { imageUrl: "/uploads/e2e/layout.jpg", body: "Sample body" }, roles: ["heading", "body", "media"] },
    { type: "BRAND_STORY", payload: { body: "Sample body", bullets: ["Layout sample"] }, roles: ["brand-story-heading", "brand-story-body", "brand-story-list"] },
    { type: "CONFIDENCE", payload: { body: "Sample body", bullets: ["Layout sample"] }, roles: ["heading", "body", "list"] },
    { type: "PROMO_BANNER", payload: { ctaText: "See collections", ctaLink: "/collections" }, roles: ["heading", "body", "action"] },
    { type: "COUNTDOWN_BANNER", payload: { ctaText: "See collections", ctaLink: "/collections", endsAt: new Date(Date.now() + 86_400_000).toISOString() }, roles: ["heading", "body", "action"] },
    { type: "UGC", payload: { entries: [{ name: "Layout sample", comment: "Illustrative copy", imageUrl: "/uploads/e2e/layout.jpg" }] }, roles: ["quote", "name", "media"] },
  ] as const)("exposes existing $type content roles without adding a parallel renderer", ({ type, payload, roles }) => {
    const Renderer = SECTION_REGISTRY[type];
    const { container } = render(<HomepageAppearance appearance="STUDIO_V3"><Renderer section={{ ...base, type, subtitle: "Sample subtitle", payload }} previewDevice="mobile" appearance="STUDIO_V3" interactionMode="preview" /></HomepageAppearance>);
    for (const role of roles) expect(container.querySelector(`[data-homepage-role="${role}"]`), `${type}/${role}`).not.toBeNull();
  });

  it("keeps legacy content free of a new appearance boundary", () => {
    render(<HomepageAppearance><p>Existing content</p></HomepageAppearance>);
    expect(screen.getByText("Existing content").closest("[data-homepage-appearance]")).toBeNull();
  });

  it("scopes the selected appearance to content rather than outside chrome", () => {
    render(<><header>Chrome</header><HomepageAppearance appearance="STUDIO_V3" previewDevice="mobile"><p>Content</p></HomepageAppearance></>);
    const root = screen.getByText("Content").closest("[data-homepage-appearance]");
    expect(root).toHaveAttribute("data-homepage-appearance", "STUDIO_V3");
    expect(root).toHaveAttribute("data-homepage-device", "mobile");
    expect(screen.getByText("Chrome").closest("[data-homepage-appearance]")).toBeNull();
  });
});
