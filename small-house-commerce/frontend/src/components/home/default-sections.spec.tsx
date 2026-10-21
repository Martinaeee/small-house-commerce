import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SECTION_REGISTRY } from "./sectionRegistry";
import {
  DEFAULT_HERO_SECTION_ID,
  DEFAULT_HERO_SLIDE_ID,
  DEFAULT_SECTIONS,
} from "./default-sections";
import type { HomepageSection } from "@/lib/api";

// The registry pulls in every section component, and the brand story sets
// its display type in its own faces — next/font/local is unavailable under
// vitest.
vi.mock("@/lib/fonts", () => ({
  poppins: { className: "font-poppins" },
  poppinsMedium: { className: "font-poppins-medium" },
  storySerif: { className: "font-story-serif" },
}));

/**
 * Fallback-hero regression (Task 19, confirmed finding): `DEFAULT_SECTIONS`
 * is the RSC resilience path whenever the homepage API returns zero sections
 * or throws (page.tsx:32-34). With HERO → HeroSlider in the registry, the old
 * v1 fallback payload (ctaPrimaryText/…) had no slides and rendered a blank
 * hero to real users. The fallback HERO must now carry a v2 HeroPayloadView
 * with one slide whose elements reuse the editor's real default layouts.
 */

const heroSection = (): HomepageSection => {
  const hero = DEFAULT_SECTIONS.find(({ type }) => type === "HERO");
  if (!hero) throw new Error("fallback DEFAULT_SECTIONS has no HERO");
  return hero;
};

// Fix-round-2 expectation: the fallback hero must use UUID-scoped ids so
// heroCss (Task 10 strict-UUID whitelist) actually emits layout rules for it.
const EXPECTED_SECTION_ID = DEFAULT_HERO_SECTION_ID;
const EXPECTED_SLIDE_ID = DEFAULT_HERO_SLIDE_ID;

describe("DEFAULT_SECTIONS fallback hero", () => {
  it("renders the fallback hero's heading and both CTAs through the real storefront path", () => {
    const Hero = SECTION_REGISTRY.HERO;
    render(<Hero section={heroSection()} />);

    // The real HeroSlider mount, not a blank section.
    expect(document.querySelector("[data-hero-slider]")).not.toBeNull();
    expect(
      document.querySelector(`#hp-hero-${EXPECTED_SECTION_ID}`),
    ).not.toBeNull();
    expect(
      document.querySelector(`[data-slide="${EXPECTED_SLIDE_ID}"]`),
    ).not.toBeNull();

    const heading = document.querySelector('[data-hero-element="heading"]');
    expect(heading?.textContent).toContain("Small Space. Big Luwag.");

    const primary = document.querySelector(
      '[data-hero-element="ctaPrimary"] a',
    );
    expect(primary?.getAttribute("href")).toBe("/collections");
    expect(primary?.getAttribute("data-track-event")).toBe("HeroClick");

    const secondary = document.querySelector(
      '[data-hero-element="ctaSecondary"] a',
    );
    expect(secondary?.getAttribute("href")).toBe("#solutions");
  });

  it("emits scoped heroCss layout rules for the fallback hero (UUID scope)", () => {
    const Hero = SECTION_REGISTRY.HERO;
    render(<Hero section={heroSection()} />);

    const cssText = Array.from(
      document.querySelectorAll("[data-hero-slider] style"),
    )
      .map((node) => node.textContent ?? "")
      .join("");

    expect(cssText).toContain(`#hp-hero-${EXPECTED_SECTION_ID}`);
    expect(cssText).toContain(`[data-slide="${EXPECTED_SLIDE_ID}"]`);
    // position/layout vars are always emitted for default elements (Ruling 26:
    // `[data-hero-element]` typography rules are optional, position vars are not)
    expect(cssText).toContain(`--el-heading-x:`);
    expect(cssText).toContain(`--el-ctaPrimary-x:`);
    expect(cssText).toContain("--hp-hero-height: calc(100vw * 1.25);");
  });

  it("keeps the other nine default sections byte-identical", () => {
    const others = DEFAULT_SECTIONS.filter(({ type }) => type !== "HERO");
    expect(others).toEqual(NON_HERO_DEFAULTS);
  });
});

const NON_HERO_DEFAULTS: HomepageSection[] = [
  { id: "default-usp", type: "USP", sortOrder: 10, title: null, subtitle: null, payload: {} },
  {
    id: "default-categories",
    type: "CATEGORY_TILES",
    sortOrder: 20,
    title: "Shop by Category",
    subtitle: null,
    payload: { categoryIds: [] },
    categories: [],
  },
  {
    id: "default-grid-1",
    type: "PRODUCT_GRID",
    sortOrder: 30,
    title: "Small-Space Favorites",
    subtitle: null,
    payload: {},
    products: [],
  },
  {
    id: "default-story-1",
    type: "PRODUCT_STORY",
    sortOrder: 40,
    title: "Made For Real Small Spaces",
    subtitle: null,
    payload: {},
  },
  {
    id: "default-solutions",
    type: "SOLUTIONS",
    sortOrder: 50,
    title: "Shop by Solution",
    subtitle: "Whatever your space problem, there is furniture built for it.",
    payload: {
      items: [
        { title: "Small Bedroom", blurb: "Compact beds, wardrobes and storage", link: "/collections/bedroom-essentials" },
        { title: "Home Office", blurb: "Foldable desks that disappear", link: "/collections/small-space-solutions" },
        { title: "Rental Friendly", blurb: "Portable, non-permanent furniture", link: "/collections/small-space-solutions" },
        { title: "Foldable Furniture", blurb: "Set up and stow in seconds", link: "/collections/small-space-solutions" },
        { title: "Narrow Space", blurb: "Slim profiles for tight corners", link: "/collections/small-space-solutions" },
        { title: "Storage Solution", blurb: "Make every corner useful", link: "/collections/storage-organization" },
      ],
    },
  },
  { id: "default-story-2", type: "PRODUCT_STORY", sortOrder: 60, title: null, subtitle: null, payload: {} },
  {
    id: "default-grid-2",
    type: "PRODUCT_GRID",
    sortOrder: 70,
    title: "Small Upgrades",
    subtitle: null,
    payload: {},
    products: [],
  },
  {
    id: "default-room",
    type: "ROOM_INSPIRATION",
    sortOrder: 80,
    title: "Room Inspiration",
    subtitle: null,
    payload: {},
    products: [],
  },
  { id: "default-ugc", type: "UGC", sortOrder: 90, title: "Real Homes", subtitle: null, payload: {} },
  {
    id: "default-brand",
    type: "BRAND_STORY",
    sortOrder: 100,
    title: null,
    subtitle: null,
    payload: {
      eyebrow: "SMALL SPACE. BIG POSSIBILITIES.",
      heading: "Room to breathe.\nRoom to live.",
      body: "Thoughtful furniture for everyday spaces.\nDesigned around the way real homes work,\nmove, and grow.",
      ctaText: "A little more about luwag",
      ctaLink: "/about",
    },
  },
  {
    id: "default-confidence",
    type: "CONFIDENCE",
    sortOrder: 110,
    title: null,
    subtitle: null,
    payload: {
      bullets: [
        "Cash on Delivery — pay at your door",
        "Nationwide delivery",
        "Real-time order updates by phone",
      ],
    },
  },
];