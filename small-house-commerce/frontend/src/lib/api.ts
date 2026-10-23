/**
 * Storefront API client.
 *
 * Browser code calls the relative /api/v1 paths (proxied by next.config.ts
 * rewrites, so there is no CORS). Server Components must use an absolute URL
 * because rewrites only apply to browser requests.
 */

import type {
  AnnouncementCountdownConfig,
  AnnouncementRichTextDocument,
  LinkValue,
  Schedule,
} from "./homepage-document";
import type { Attribution } from "./tracking";
import type { LandingContent } from "./marketing-content";
import { STOREFRONT_TAGS } from "./cache-tags";

export const serverApiUrl = (path: string): string => {
  const target = process.env.API_TARGET ?? "http://localhost:3000";
  return `${target}${path}`;
};

// --- types (mirror the backend storefront responses) -------------------------

/**
 * Per-page hero appearance, shared by category and collection landing pages
 * (they render through the same component). Absent/null = the default:
 * a centered name on the page background.
 */
export interface HeroStyle {
  /** Replaces the category/collection name when set. */
  titleOverride: string | null;
  /** #rrggbb, or null for the theme ink colour. */
  titleColor: string | null;
  /** Desktop px (the component clamps it), or null for the default size. */
  titleSize: number | null;
  /** 'brand' | 'sans' | 'serif', or null for the default. */
  titleFont: string | null;
  backgroundType: "SOLID" | "IMAGE";
  /** #rrggbb for SOLID; null = transparent. */
  backgroundColor: string | null;
  backgroundImageUrl: string | null;
  /** 0–24 px blur on the background LAYER (text stays sharp). */
  backgroundBlur: number;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  heroStyle?: HeroStyle | null;
  children: Category[];
}

export type ProductOptionKind = "COLOR" | "SIZE" | "MATERIAL" | "STYLE";
export type ProductOptionPresentation = "IMAGE" | "SWATCH" | "TEXT";

/** Public media fields only; scope foreign keys never leave the backend. */
export interface ProductMedia {
  id: string;
  url: string;
  type: "IMAGE" | "VIDEO";
  altText: string | null;
  sortOrder: number;
}

export type ProductCardImage = ProductMedia & { type: "IMAGE" };

export interface ProductCardMediaPair {
  cover: ProductCardImage | null;
  scene: ProductCardImage | null;
}

export interface ProductCardMedia {
  displayVariantId: string | null;
  unselected: ProductCardMediaPair;
  variants: Array<ProductCardMediaPair & { variantId: string }>;
}

export interface BundleComponentSpecification {
  productName: string;
  variantName: string;
  quantity: number;
  width: number | null;
  depth: number | null;
  height: number | null;
  foldedWidth: number | null;
  foldedDepth: number | null;
  foldedHeight: number | null;
  productWeight: number | null;
  materials: string | null;
}

export interface StorefrontSku {
  specificationSource?: "SKU" | "BUNDLE_COMPONENTS";
  bundleComponents?: BundleComponentSpecification[];
  id: string;
  skuCode: string;
  status: "ACTIVE" | "DISABLED";
  price: number | null;
  compareAtPrice: number | null;
  availableInventory: number;
  productWeight?: number | null;
  productWidth?: number | null;
  productDepth?: number | null;
  productHeight?: number | null;
  packageWidth?: number | null;
  packageHeight?: number | null;
  packageDepth?: number | null;
  packageWeight?: number | null;
}

export type Sku = StorefrontSku;

export interface StorefrontOptionValue {
  id: string;
  label: string;
  position: number;
  swatchHex: string | null;
  thumbnailUrl: string | null;
  thumbnailAlt: string | null;
}

export interface StorefrontProductOption {
  id: string;
  kind: ProductOptionKind;
  name: string;
  position: number;
  presentation: ProductOptionPresentation;
  isMediaDriver: boolean;
  values: StorefrontOptionValue[];
}

export interface StorefrontProductVariant {
  id: string;
  name: string;
  position: number;
  combinationKey: string;
  optionValueIds: string[];
  sku: StorefrontSku | null;
}

export type ProductVariant = StorefrontProductVariant;
export type ProductImage = ProductMedia;

export interface ProductMediaSet {
  resolvedScope: "SHARED" | "OPTION_VALUE" | "VARIANT";
  /** Omitted, rather than null, for shared media. */
  scopeId?: string;
  media: ProductMedia[];
  catalogGraphVersion: number;
}

export interface AvailableMediaScopes {
  optionValueIds: string[];
  variantIds: string[];
}

/**
 * One block of the PDP description body, rendered below the gallery: the
 * supplier detail decks are image/video led, so blocks are media-only.
 */
export interface ProductDetailBlock {
  id: string;
  type: "IMAGE" | "VIDEO";
  url: string;
  altText: string | null;
  sortOrder: number;
  optionValueId?: string | null;
  variantId?: string | null;
}

export type ProductFaqAnswerBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "bullets"; items: string[] };

export interface ProductFaqItem {
  id: string;
  title: string;
  answer: ProductFaqAnswerBlock[];
  enabled: boolean;
  position: number;
  defaultOpen: boolean;
}

export type Room = "BEDROOM" | "STORAGE" | "DINING_LIVING" | "HOME_OFFICE";
export type Solution =
  | "FOLDABLE"
  | "NARROW_SPACE"
  | "MOBILE"
  | "MULTIFUNCTIONAL"
  | "HIDDEN_STORAGE"
  | "RENTAL_FRIENDLY";

export interface Review {
  id: string;
  authorName: string;
  location: string | null;
  rating: number;
  title: string | null;
  comment: string;
  photos: string[];
  createdAt: string;
  /** Merchant-entered option descriptor ("Color: … | Size: …"), or null. */
  variant: string | null;
  helpfulCount: number;
  /** True only for reviews backed by a real order — never admin-entered. */
  verifiedPurchase: boolean;
}

export interface Product {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  /** First-screen one-line selling point under the H1; null/empty hides it. */
  tagline: string | null;
  seoTitle?: string | null;
  metaDescription?: string | null;
  categoryId: string;
  ratingAverage: number | null;
  reviewCount: number;
  /** Present only on the single-product detail response. */
  reviews?: Review[];
  room: Room | null;
  internalRole: string | null;
  solutions: Solution[];
  width: number | null;
  height: number | null;
  depth: number | null;
  foldedWidth: number | null;
  foldedHeight: number | null;
  foldedDepth: number | null;
  /**
   * Structured specifications; only the PDP endpoint selects them.
   * `features` is one entry per line.
   */
  materials?: string | null;
  features?: string | null;
  catalogGraphVersion: number;
  options: StorefrontProductOption[];
  defaultDisplayVariantId: string | null;
  effectiveCoverMedia: ProductMedia | null;
  cardMedia?: ProductCardMedia;
  images: ProductImage[];
  /** Present only on the single-product detail response. */
  initialMediaSet?: ProductMediaSet;
  /** Present only on the single-product detail response. */
  availableMediaScopes?: AvailableMediaScopes;
  /**
   * Description-body blocks. Only the PDP endpoint selects them (list routes
   * skip the media deck), so they are absent everywhere else.
   */
  detailBlocks?: ProductDetailBlock[];
  /** Effective FAQ entries are present only on the PDP response. */
  effectiveFaq?: ProductFaqItem[];
  variants: StorefrontProductVariant[];
}

// --- homepage CMS (storefront composition) ----------------------------------

export type HomepageSectionType =
  | "HERO"
  | "USP"
  | "CATEGORY_TILES"
  | "PRODUCT_GRID"
  | "SOLUTIONS"
  | "PRODUCT_STORY"
  | "ROOM_INSPIRATION"
  | "UGC"
  | "BRAND_STORY"
  | "CONFIDENCE"
  | "PROMO_BANNER"
  | "COUNTDOWN_BANNER";

export interface HomepageCategoryTile {
  id: string;
  name: string;
  slug: string;
  imageUrl: string;
}

/** A full storefront Product plus its per-section badge. */
export type HomepageSectionProduct = Product & { badge: string | null };

// --- room scene hotspots (ROOM_INSPIRATION payload) --------------------------

/** Admin/input shape: a dot positioned by percentage over its scene image. */
export interface RoomSceneHotspotInput {
  productId: string;
  xPct: number;
  yPct: number;
}

/** Admin-persisted scene (payload.scenes[n] before storefront hydration). */
export interface RoomScene {
  id: string;
  imageUrl: string;
  alt?: string;
  hotspots: RoomSceneHotspotInput[];
}

/** Storefront shape: backend replaces productId with the hydrated product. */
export interface RoomSceneHotspot extends RoomSceneHotspotInput {
  product: Product;
}

export interface HydratedRoomScene extends Omit<RoomScene, "hotspots"> {
  hotspots: RoomSceneHotspot[];
}

export type HomepageSectionStyle = {
  backgroundColor?: string;
  textColor?: string;
  contentWidth?: "FULL" | "STANDARD" | "NARROW";
  paddingTop?: number;
  paddingBottom?: number;
  overrides?: {
    tablet?: {
      backgroundColor?: string; textColor?: string;
      contentWidth?: "FULL" | "STANDARD" | "NARROW";
      paddingTop?: number; paddingBottom?: number;
    };
    mobile?: {
      backgroundColor?: string; textColor?: string;
      contentWidth?: "FULL" | "STANDARD" | "NARROW";
      paddingTop?: number; paddingBottom?: number;
    };
  };
};

export interface HomepageSection {
  id: string;
  type: HomepageSectionType;
  title: string | null;
  subtitle: string | null;
  sortOrder: number;
  style?: HomepageSectionStyle;
  /**
   * Present only on the V2 banner sections; lets a cached page still honor an
   * earlier `unpublishAt` at runtime.
   */
  schedule?: { publishAt: string | null; unpublishAt: string | null };
  payload: Record<string, unknown>;
  // Present only on the types hydrated by the backend.
  products?: HomepageSectionProduct[];
  categories?: HomepageCategoryTile[];
  navigationEntries?: HomepageNavigationEntryView[];
}

export interface HomepageNavigationEntryView {
  id: string;
  name: string;
  imageUrl: string;
  href: string;
  link: { type: "CATEGORY" | "COLLECTION"; id: string };
}

export interface HomepageResponse {
  sections: HomepageSection[];
  appearance?: import("@/lib/homepage-document").HomepageAppearance;
}

// --- HERO payload v2 (homepage document → storefront) -----------------------
//
// The backend resolves each element's `link` value into a final `linkHref`
// string and passes the slide array through unchanged, so the storefront side
// of a HERO section is a looser superset of the editor's HeroPayload: the same
// data plus `linkHref`. These are intentionally loose (everything optional
// except the slide id) because the payload crosses the network as JSON; the
// storefront HeroSlider reads only what it renders and safeCss-shaped fields
// are re-validated by `heroCss`/`safeHex` before ever becoming CSS.

export type HomepageHeroElementKey =
  | "eyebrow"
  | "heading"
  | "subheading"
  | "offer"
  | "ctaPrimary"
  | "ctaSecondary"
  | "countdown";

export interface HomepageHeroImage {
  url?: string;
  alt?: string;
}

export interface HomepageHeroVideo {
  url?: string;
  poster?: string | null;
  autoplay?: boolean;
  muted?: boolean;
  loop?: boolean;
  playsInline?: boolean;
  showSoundToggle?: boolean;
  pauseOffscreen?: boolean;
}

export interface HomepageHeroMobileOverride {
  enabled?: boolean;
  image?: HomepageHeroImage | null;
  video?: HomepageHeroVideo | null;
}

export interface HomepageHeroMedia {
  type?: "IMAGE" | "VIDEO";
  image?: HomepageHeroImage | null;
  video?: HomepageHeroVideo | null;
  mobileOverride?: HomepageHeroMobileOverride;
  fit?: "COVER" | "CONTAIN";
  fitOverrides?: { tablet?: "COVER" | "CONTAIN"; mobile?: "COVER" | "CONTAIN" };
  focal?: { x?: number; y?: number };
  objectPosition?: {
    desktop?: { x?: number; y?: number };
    tablet?: { x?: number; y?: number } | null;
    mobile?: { x?: number; y?: number } | null;
  };
}

export interface HomepageHeroElement {
  text?: string;
  link?: Record<string, unknown> | null;
  /** Resolved by the backend storefront mapping; null = unresolvable/deleted. */
  linkHref?: string | null;
  style?: Record<string, unknown>;
  layout?: Record<string, unknown>;
  overrides?: Record<string, unknown>;
  locked?: boolean;
  // offer / cta / countdown extras (mirror the editor types)
  chip?: HomepageHeroChip;
  button?: HomepageHeroButton;
  endsAt?: string | null;
}

export interface HomepageHeroChip {
  background?: string;
  textColor?: string;
  borderRadius?: number;
  paddingX?: number;
  paddingY?: number;
}

export interface HomepageHeroButton {
  variant?: "SOLID" | "OUTLINE" | "LINK";
  background?: string | null;
  textColor?: string | null;
  borderColor?: string | null;
  hoverBackground?: string | null;
  hoverTextColor?: string | null;
  borderRadius?: number;
  paddingX?: number;
  paddingY?: number;
  /** Direct canvas resize (CSS px); absent = intrinsic auto size. */
  widthPx?: number;
  heightPx?: number;
  size?: "SM" | "MD" | "LG";
  /** Optional trailing arrow after the label (mirrors the editor HeroButton). */
  arrow?: boolean;
}

export interface HomepageHeroLinkZone {
  id: string;
  layout?: {
    xPct?: number;
    yPct?: number;
    widthPct?: number;
    heightPct?: number;
  };
  link?: Record<string, unknown> | null;
  /** Resolved by the backend storefront mapping; null = unresolvable. */
  linkHref?: string | null;
  background?: { visible?: boolean; color?: string };
}

export interface HomepageHeroSlide {
  id: string;
  name?: string;
  enabled?: boolean;
  sortOrder?: number;
  schedule?: { publishAt?: string | null; unpublishAt?: string | null };
  media?: HomepageHeroMedia | null;
  overlay?: {
    color?: string; opacity?: number; gradient?: string;
    overrides?: {
      tablet?: { color?: string; opacity?: number; gradient?: string };
      mobile?: { color?: string; opacity?: number; gradient?: string };
    };
  };
  elements?: Partial<Record<HomepageHeroElementKey, HomepageHeroElement>>;
  /** BUTTON = only the CTA buttons navigate; SLIDE = the whole banner does. */
  linkMode?: "BUTTON" | "SLIDE";
  slideLink?: Record<string, unknown> | null;
  /** Resolved by the backend storefront mapping. */
  slideLinkHref?: string | null;
  /** Clickable rectangles painted over the picture. */
  zones?: HomepageHeroLinkZone[];
}

export interface HomepageHeroBehavior {
  autoplay?: boolean;
  durationMs?: number;
  transition?: string;
  pauseOnHover?: boolean;
  arrows?: boolean;
  pagination?: string;
  manualPauseMs?: number;
}

export interface HomepageHeroPayload {
  behavior?: HomepageHeroBehavior;
  display?: import("./homepage-document").HeroDisplay;
  slides?: HomepageHeroSlide[];
  // Loose storefront view: unknown/extra payload fields must not break the
  // type; the index signature also makes payloads narrow cleanly from a
  // `Record<string, unknown>` through `isHeroPayloadView`.
  [key: string]: unknown;
}

/** Loose storefront view of a HERO section payload (see block comment above). */
export type HeroPayloadView = HomepageHeroPayload;

/** Narrow a `Record<string, unknown>` HERO payload to the loose v2 storefront shape. */
export function isHeroPayloadView(payload: unknown): payload is HeroPayloadView {
  if (!payload || typeof payload !== "object") return false;
  const slides = (payload as { slides?: unknown }).slides;
  return (
    Array.isArray(slides) &&
    slides.some(
      (slide) =>
        slide !== null &&
        typeof slide === "object" &&
        typeof (slide as { id?: unknown }).id === "string",
    )
  );
}

// --- announcement bar (homepage document → storefront layout) ---------------
//
// The backend returns the document's `announcement` block with the item list
// already filtered by enablement + schedule and each item's `link` resolved
// into a final `linkHref` (same resolution as HERO element links). Colors are
// whitelisted server-side; the bar re-clamps them through `safeHex` anyway.

export interface AnnouncementItemView {
  id: string;
  text: string;
  content?: AnnouncementRichTextDocument;
  link: LinkValue | null;
  /** Resolved by the backend; null = plain-text item (no anchor). */
  linkHref: string | null;
  /** CTA suffix rendered after the text when the item is a link. */
  linkLabel: string | null;
  /** #rrggbb. */
  textColor: string;
  backgroundColor: string;
  schedule: Schedule;
  countdown?: AnnouncementCountdownConfig | null;
  enabled: boolean;
  sortOrder: number;
}

export interface AnnouncementBlockView {
  enabled: boolean;
  /** Rotation interval in ms for multi-item bars. */
  rotationMs: number;
  items: AnnouncementItemView[];
}

export interface Collection {
  id: string;
  name: string;
  slug: string;
  type: "NAVIGATION" | "MARKETING" | "SCENARIO" | "SYSTEM";
  description: string | null;
  heroImage: string | null;
  heroStyle?: HeroStyle | null;
  sortOrder: number;
  seoTitle?: string | null;
  seoDescription?: string | null;
  /** Admin-set promo chip text (e.g. "9.9 Sale"); absent until backend phase 2. */
  badgeLabel?: string | null;
}

export interface CollectionSection {
  sectionType: string;
  contentJson: unknown;
  sortOrder: number;
}

/**
 * One typed option assignment on a cart line, ordered by option position
 * (the backend's canonical order). Empty for legacy variant rows created
 * before typed options — clients fall back to `variantName`.
 */
export interface CartItemOptionValue {
  optionId: string;
  optionName: string;
  optionValueId: string;
  label: string;
}

/**
 * The line's effective thumbnail, resolved by the backend with the same
 * precedence as the PDP gallery (exact variant → active media-driver value →
 * shared). May be a VIDEO url; render accordingly.
 */
export interface CartItemThumbnail {
  url: string;
  type: "IMAGE" | "VIDEO";
  altText: string | null;
  resolvedScope: "VARIANT" | "OPTION_VALUE" | "SHARED";
}

export interface CartItem {
  itemId: string;
  skuId: string;
  skuCode: string;
  productName: string;
  productSlug: string;
  variantName: string;
  quantity: number;
  unitPrice: number | null;
  compareAtPrice: number | null;
  lineTotal: number;
  availableInventory: number;
  unavailable: boolean;
  optionValues: CartItemOptionValue[];
  thumbnail: CartItemThumbnail | null;
}

export interface CartSummary {
  cartId: string;
  expiresAt: string;
  items: CartItem[];
  subtotal: number;
  discount: number;
  shipping: number;
  total: number;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface LandingImageOverride {
  url: string;
  altText?: string | null;
}

export interface LandingPageInfo {
  id: string;
  slug: string;
  content: LandingContent;
  publishedRevision: number;
}

export interface LandingPageComposite {
  landingPage: LandingPageInfo;
  product: Product;
}

// --- browser client (relative paths, proxied) --------------------------------

async function assertOk(res: Response): Promise<void> {
  if (res.ok) return;
  let message = `Request failed: ${res.status}`;
  try {
    const body = (await res.json()) as { message?: string };
    if (body.message) message = body.message;
  } catch {
    /* keep default message */
  }
  throw new Error(message);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  await assertOk(res);
  return res.json() as Promise<T>;
}

// View beacons return 204 No Content.
async function requestVoid(path: string, init?: RequestInit): Promise<void> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  await assertOk(res);
}

// Homepage composition. Server Components only (absolute URL + ISR tags);
// the browser reads sections through server-rendered markup.
export async function getHomepage(): Promise<HomepageResponse> {
  const res = await fetch(serverApiUrl("/api/v1/storefront/homepage"), {
    next: { revalidate: 120, tags: STOREFRONT_TAGS },
  });
  await assertOk(res);
  return res.json() as Promise<HomepageResponse>;
}

/**
 * Announcement bar data for the storefront layout (global, same ISR contract
 * as getHomepage). The backend answers 200 with an empty body when no version
 * is effective or nothing is active, so "no announcement" is a normal null;
 * non-OK responses throw like every other helper here — the layout catches
 * and hides the bar.
 */
export async function getAnnouncement(): Promise<AnnouncementBlockView | null> {
  const res = await fetch(serverApiUrl("/api/v1/storefront/announcement"), {
    next: { revalidate: 120, tags: STOREFRONT_TAGS },
  });
  await assertOk(res);
  const body = await res.text();
  if (body.trim() === "") return null;
  const parsed = JSON.parse(body) as AnnouncementBlockView | null;
  return parsed ?? null;
}

export const api = {
  // Recently Viewed batch lookup; backend preserves the requested id order.
  getProductsByIds: (ids: string[]) =>
    request<Paged<Product>>(
      `/api/v1/storefront/products?ids=${ids.map((id) => encodeURIComponent(id)).join(",")}`,
    ),
  getCategories: () => request<Category[]>("/api/v1/storefront/categories"),
  getProducts: (params?: {
    categoryId?: string;
    search?: string;
    room?: Room;
    solution?: Solution;
    minPrice?: number;
    maxPrice?: number;
    page?: number;
    pageSize?: number;
  }) => {
    const q = new URLSearchParams();
    if (params?.categoryId) q.set("categoryId", params.categoryId);
    if (params?.search) q.set("search", params.search);
    if (params?.room) q.set("room", params.room);
    if (params?.solution) q.set("solution", params.solution);
    if (params?.minPrice !== undefined) q.set("minPrice", String(params.minPrice));
    if (params?.maxPrice !== undefined) q.set("maxPrice", String(params.maxPrice));
    if (params?.page) q.set("page", String(params.page));
    if (params?.pageSize) q.set("pageSize", String(params.pageSize));
    return request<Paged<Product>>(`/api/v1/storefront/products?${q.toString()}`);
  },
  getProductBySlug: (slug: string) => request<Product>(`/api/v1/storefront/products/${slug}`),
  markReviewHelpful: (reviewId: string) =>
    request<{ helpfulCount: number; voted: boolean }>(
      `/api/v1/storefront/reviews/${reviewId}/helpful`,
      { method: "POST", body: "{}" },
    ),
  reportReview: (reviewId: string, reason?: string) =>
    request<{ ok: boolean }>(`/api/v1/storefront/reviews/${reviewId}/report`, {
      method: "POST",
      body: JSON.stringify(reason ? { reason } : {}),
    }),
  /**
   * "Ask a question" from the PDP. The submission lands in the operator inbox
   * and is not published until it is answered and converted into a product FAQ
   * entry, so the response deliberately says nothing about moderation state.
   */
  askProductQuestion: (
    slug: string,
    input: { question: string; name?: string; email?: string },
  ) =>
    request<{ ok: boolean }>(
      `/api/v1/storefront/products/${encodeURIComponent(slug)}/questions`,
      { method: "POST", body: JSON.stringify(input) },
    ),
  getLandingPage: (slug: string) =>
    request<LandingPageComposite>(
      `/api/v1/storefront/lp/${encodeURIComponent(slug)}`,
    ),
  recordLandingPageView: (slug: string, visitKey: string) =>
    requestVoid(`/api/v1/storefront/lp/${encodeURIComponent(slug)}/view`, {
      method: "POST",
      body: JSON.stringify({ visitKey }),
    }),
  marketingTouch: (input: {
    code?: string;
    path: string;
    visitKey: string;
    landingPageId?: string;
    aid?: string;
    sourceType?: string;
    adId?: string | null;
    campaignId?: string | null;
    adsetId?: string | null;
    utmSource?: string | null;
    utmMedium?: string | null;
    utmCampaign?: string | null;
    utmContent?: string | null;
    utmTerm?: string | null;
  }) =>
    request<{ credential: string | null; expiresAt: string | null }>(
      "/api/v1/storefront/marketing-touch",
      {
        method: "POST",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        body: JSON.stringify(input),
      },
    ),
  getCollections: (type?: string) =>
    request<{ items: Collection[]; total: number }>(
      `/api/v1/storefront/collections${type ? `?type=${type}` : ""}`,
    ),
  getCollectionBySlug: (slug: string) =>
    request<Collection & { sections: CollectionSection[] }>(`/api/v1/storefront/collections/${slug}`),
  getCollectionProducts: (slug: string, page = 1) =>
    request<Paged<Product>>(`/api/v1/storefront/collections/${slug}/products?page=${page}`),
  getCart: (cartId: string) => request<CartSummary>(`/api/v1/storefront/cart/${cartId}/summary`),
  updateCartItem: (cartId: string, itemId: string, quantity: number) =>
    request<CartSummary>(`/api/v1/storefront/cart/${cartId}/items/${itemId}`, {
      method: "PUT",
      body: JSON.stringify({ quantity }),
    }),
  /**
   * Atomically replaces a line's SKU (the Change Options flow). If the target
   * SKU already sits on another row of the same cart the backend merges the
   * quantities and deletes the source row; otherwise the row is updated in
   * place. The returned summary is the merged state to adopt as-is.
   */
  replaceCartItem: (cartId: string, itemId: string, input: { skuId: string; quantity: number }) =>
    request<CartSummary>(`/api/v1/storefront/cart/${cartId}/items/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  removeCartItem: (cartId: string, itemId: string) =>
    request<CartSummary>(`/api/v1/storefront/cart/${cartId}/items/${itemId}`, {
      method: "DELETE",
    }),
  /**
   * Adds a SKU to the cart. Omit cartId for a fresh cart (the response
   * carries the cartId to persist in localStorage). The backend allows
   * out-of-stock SKUs in carts; checkout is where stock is enforced.
   */
  addToCart: (input: { cartId?: string; skuId: string; quantity: number }) =>
    request<CartSummary & { created: boolean }>("/api/v1/storefront/cart/items", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  createOrder: (input: {
    customer: {
      name: string;
      phone: string;
      province: string;
      city: string;
      barangay?: string | null;
      postalCode?: string | null;
      streetAddress: string;
      landmark?: string | null;
    };
    items: { skuId: string; quantity: number }[];
    attribution?: Attribution;
    marketingCredential?: string | null;
    preferredDeliveryDate?: string | null;
    customerNote?: string | null;
    promoCode?: string | null;
    /**
     * The browser tab that placed the order. Analytics-only: it links the
     * order to the visit that produced it so the dashboard can divide
     * ordering sessions by all sessions. Never a customer identity.
     */
    trackingSessionId?: string | null;
  }) =>
    request<{ orderNumber: string; orderStatus: string; confirmationStatus: string }>(
      "/api/v1/storefront/orders",
      {
        method: "POST",
        body: JSON.stringify({
          attribution: input.attribution ?? { sourceType: "ORGANIC" },
          marketingCredential: input.marketingCredential,
          customer: input.customer,
          items: input.items,
          preferredDeliveryDate: input.preferredDeliveryDate ?? null,
          customerNote: input.customerNote ?? null,
          promoCode: input.promoCode ?? null,
          trackingSessionId: input.trackingSessionId ?? null,
        }),
      },
    ),

  /** Display-only; checkout recomputes the authoritative discount. */
  previewPromoCode: (
    code: string,
    subtotal: number,
  ): Promise<{ valid: boolean; discountAmount: number; message: string }> =>
    request<{ valid: boolean; discountAmount: number; message: string }>(
      "/api/v1/storefront/checkout/promo-code/preview",
      {
        method: "POST",
        body: JSON.stringify({ code, subtotal }),
      },
    ),
};

/** Cart id lives in localStorage on the client. */
export const cartStorage = {
  get: (): string | undefined => {
    if (typeof window === "undefined") return undefined;
    const value = window.localStorage.getItem("cartId");
    // An empty string means "no cart" (cleared after placing an order).
    return value && value !== "" ? value : undefined;
  },
  set: (cartId: string) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("cartId", cartId);
    }
  },
};
