import type {
  CategoryLayoutFields,
  ProductGridLayoutFields,
  ProductStoryLayoutFields,
  ResponsiveFields,
} from "./homepage-document";

export type UspIcon = "shield" | "home" | "lock" | "truck";

export type UspItem = {
  icon?: UspIcon;
  label: string;
  sub?: string;
};

export type UspPayload = {
  items?: UspItem[];
};

export type HomepageNavigationEntry = {
  id: string;
  label?: string;
  imageUrl?: string;
  link: { type: "CATEGORY" | "COLLECTION"; id: string } | null;
};

export type CategoryTilesPayload = {
  categoryIds?: string[];
  entries?: HomepageNavigationEntry[];
  presentation?: "TILES" | "CIRCLES";
  layout?: ResponsiveFields<CategoryLayoutFields>;
};

export type ProductGridPayload = {
  columns?: 2 | 4;
  layout?: ResponsiveFields<ProductGridLayoutFields>;
};

export type SolutionItem = {
  title: string;
  blurb?: string;
  link: string;
};

export type SolutionsPayload = {
  items?: SolutionItem[];
};

export type ProductStoryPayload = {
  layout?: ResponsiveFields<ProductStoryLayoutFields>;
  imageUrl?: string;
  heading?: string;
  body?: string;
  ctaText?: string;
  ctaLink?: string;
  productId?: string;
};

export type RoomHotspot = {
  productId: string;
  xPct: number;
  yPct: number;
};

export type RoomScene = {
  id: string;
  imageUrl: string;
  alt?: string;
  hotspots: RoomHotspot[];
};

export type RoomInspirationPayload = {
  imageUrl?: string;
  heading?: string;
  body?: string;
  scenes?: RoomScene[];
};

/** Alias matching the backend roomPayloadSchema name. */
export type RoomPayload = RoomInspirationPayload;

export type UgcEntry = {
  id?: string;
  imageUrl?: string;
  name: string;
  location?: string;
  comment: string;
  productId?: string;
  /** Focal point of the photo in percent; the storefront crops around it. */
  focalX?: number;
  focalY?: number;
};

/** How the photos are arranged next to the large one. */
export type UgcCollageVariant = "GRID" | "STRIP" | "PORTRAIT";

export type UgcPayload = {
  entries?: UgcEntry[];
  presentation?: {
    layout: "CARDS" | "COLLAGE";
    /** Only meaningful for the collage layout; GRID is the default. */
    collageVariant?: UgcCollageVariant;
    featuredEntryId?: string;
    showQuote?: boolean;
    overlay?: "SOFT" | "STRONG";
  };
};

export type TextBlockPayload = {
  heading?: string;
  body?: string;
  bullets?: string[];
};

/**
 * BRAND_STORY is a split section: one brand image beside the brand copy
 * (eyebrow / heading / body / CTA). It has its own payload — the backend
 * validates BRAND_STORY separately — so the image survives the round trip.
 */
export type BrandStoryPayload = {
  imageUrl?: string;
  imageAlt?: string;
  eyebrow?: string;
  heading?: string;
  body?: string;
  /** Legacy — the old shared text block exposed bullets here. */
  bullets?: string[];
  ctaText?: string;
  ctaLink?: string;
};

/** CONFIDENCE keeps the plain text-block payload. */
export type ConfidencePayload = TextBlockPayload;

/** Non-Hero CTA links are stored strings: /path, #anchor, or https://… . */
export type PromoBannerPayload = {
  ctaText?: string;
  ctaLink?: string;
};

export type CountdownBannerPayload = PromoBannerPayload & {
  /** null = draft-only; publish requires a future ISO datetime. */
  endsAt: string | null;
};

export type SectionPayloadMap = {
  USP: UspPayload;
  CATEGORY_TILES: CategoryTilesPayload;
  PRODUCT_GRID: ProductGridPayload;
  SOLUTIONS: SolutionsPayload;
  PRODUCT_STORY: ProductStoryPayload;
  ROOM_INSPIRATION: RoomInspirationPayload;
  UGC: UgcPayload;
  BRAND_STORY: BrandStoryPayload;
  CONFIDENCE: ConfidencePayload;
  PROMO_BANNER: PromoBannerPayload;
  COUNTDOWN_BANNER: CountdownBannerPayload;
};

export type NonHeroSectionType = keyof SectionPayloadMap;
export type NonHeroSectionPayload = SectionPayloadMap[NonHeroSectionType];
