import type { HomepageSection } from "@/lib/api";

/**
 * Fallback composition mirroring the Task 4 seed. Used only when the homepage
 * API call fails from the RSC. Category tiles and grids come back empty here;
 * empty-state cards render instead of crashing the page.
 */
export const DEFAULT_SECTIONS: HomepageSection[] = [
  {
    id: "default-hero",
    type: "HERO",
    sortOrder: 0,
    title: "Small Space. Big Luwag.",
    subtitle: "Furniture designed for condos, rentals and everyday small-space living.",
    payload: {
      ctaPrimaryText: "Shop Small-Space Picks",
      ctaPrimaryLink: "/collections",
      ctaSecondaryText: "Explore Solutions",
      ctaSecondaryLink: "#solutions",
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
      body: "LUWAG Living makes furniture for small Filipino homes — the condos, apartments and rentals where every square meter counts. Our name comes from maluwag: spacious, easy-going, and maluwag sa budget. Pieces that fit, prices that don’t hurt, cash on delivery. Because a small space should feel maluwag.",
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
