import { emptySlide } from "@/lib/homepage-document";
import type { HomepageSection } from "@/lib/api";

/**
 * Fixed UUIDs for the fallback HERO (Fix round 2). `heroCss` enforces a strict
 * UUID selector whitelist (Task 10), so the fallback hero must use UUID-shaped
 * ids or it renders with zero layout CSS (all elements pile up top-left). These
 * follow the migration file's `00000000-0000-7000-8000-…` style and stay stable
 * across builds.
 */
export const DEFAULT_HERO_SECTION_ID = "00000000-0000-7000-8000-00000000d001";
export const DEFAULT_HERO_SLIDE_ID = "00000000-0000-7000-8000-00000000d002";

/**
 * Fallback composition mirroring the Task 4 seed. Used only when the homepage
 * API call fails from the RSC. Category tiles and grids come back empty here;
 * empty-state cards render instead of crashing the page.
 */

/**
 * The fallback hero loads through the real storefront `HeroSlider`, which reads
 * the v2 `slides` shape from the document schema. The slide is built from the
 * editor's own `emptySlide(0)` so it reuses the real default element layouts
 * (no third shape). CTAs carry the resolved `linkHref` directly — this fallback
 * bypasses the backend, so it mirrors exactly what the backend's `presentHero`
 * would have emitted for the storefront payload.
 */
const FALLBACK_HERO_SLIDE = (() => {
  const slide = emptySlide(0);
  slide.id = DEFAULT_HERO_SLIDE_ID;
  slide.name = "Fallback hero";
  slide.elements.heading.text = "Small Space. Big Luwag.";
  slide.elements.subheading.text =
    "Furniture designed for condos, rentals and everyday small-space living.";
  slide.elements.ctaPrimary.text = "Shop Small-Space Picks";
  slide.elements.ctaPrimary.link = { type: "EXTERNAL", url: "/collections" };
  (slide.elements.ctaPrimary as { linkHref?: string | null }).linkHref =
    "/collections";
  slide.elements.ctaSecondary.text = "Explore Solutions";
  slide.elements.ctaSecondary.link = { type: "EXTERNAL", url: "#solutions" };
  (slide.elements.ctaSecondary as { linkHref?: string | null }).linkHref =
    "#solutions";
  return slide;
})();

// Behaviour mirrors the editor document's DEFAULT_BEHAVIOR (homepage-document.ts).
const FALLBACK_HERO_BEHAVIOR = {
  autoplay: true,
  durationMs: 6000,
  transition: "FADE",
  pauseOnHover: true,
  arrows: true,
  pagination: "DOTS",
  manualPauseMs: 12000,
};

export const DEFAULT_SECTIONS: HomepageSection[] = [
  {
    id: DEFAULT_HERO_SECTION_ID,
    type: "HERO",
    sortOrder: 0,
    title: "Small Space. Big Luwag.",
    subtitle: "Furniture designed for condos, rentals and everyday small-space living.",
    payload: {
      behavior: FALLBACK_HERO_BEHAVIOR,
      slides: [FALLBACK_HERO_SLIDE],
    },
  },
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
