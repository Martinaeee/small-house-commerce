export type UspIcon = "shield" | "home" | "lock" | "truck";

export type UspItem = {
  icon?: UspIcon;
  label: string;
  sub?: string;
};

export type UspPayload = {
  items?: UspItem[];
};

export type CategoryTilesPayload = {
  categoryIds?: string[];
};

export type ProductGridPayload = {
  columns?: 2 | 4;
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
  imageUrl?: string;
  name: string;
  location?: string;
  comment: string;
  productId?: string;
};

export type UgcPayload = {
  entries?: UgcEntry[];
};

export type TextBlockPayload = {
  heading?: string;
  body?: string;
  bullets?: string[];
};

/** BRAND_STORY and CONFIDENCE intentionally share the backend text schema. */
export type BrandStoryPayload = TextBlockPayload;
export type ConfidencePayload = TextBlockPayload;

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
};

export type NonHeroSectionType = keyof SectionPayloadMap;
export type NonHeroSectionPayload = SectionPayloadMap[NonHeroSectionType];
