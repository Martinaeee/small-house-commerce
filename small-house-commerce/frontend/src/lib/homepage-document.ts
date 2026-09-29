export const SCHEMA_VERSION = 1 as const;

export type HorizontalAlign = "LEFT" | "CENTER" | "RIGHT";
export type VerticalAlign = "TOP" | "MIDDLE" | "BOTTOM";
export type SectionType =
  | "HERO"
  | "USP"
  | "CATEGORY_TILES"
  | "PRODUCT_GRID"
  | "SOLUTIONS"
  | "PRODUCT_STORY"
  | "ROOM_INSPIRATION"
  | "UGC"
  | "BRAND_STORY"
  | "CONFIDENCE";

export type Schedule = {
  publishAt: string | null;
  unpublishAt: string | null;
};

export type LinkValue =
  | {
      type: "PRODUCT" | "COLLECTION" | "CATEGORY" | "LANDING";
      id: string;
    }
  | {
      type: "EXTERNAL";
      url: string;
    };

export type ElementStyle = {
  fontSize?: number;
  fontWeight?: 400 | 500 | 600 | 700 | 800;
  lineHeight?: number;
  letterSpacing?: number;
  textColor?: string;
  textAlign?: HorizontalAlign;
  maxWidthPct?: number;
};

export type ElementLayout = {
  xPct: number;
  yPct: number;
  widthPct: number;
  align: HorizontalAlign;
  verticalAlign: VerticalAlign;
};

export type ElementOverride = {
  style?: ElementStyle;
  layout?: Partial<ElementLayout>;
};

export type ElementOverrides = {
  tablet?: ElementOverride;
  mobile?: ElementOverride;
};

export type HeroChip = {
  background: string;
  textColor: string;
  borderRadius: number;
  paddingX: number;
  paddingY: number;
};

export type HeroButton = {
  variant: "SOLID" | "OUTLINE" | "LINK";
  background: string | null;
  textColor: string | null;
  borderColor: string | null;
  hoverBackground: string | null;
  hoverTextColor: string | null;
  borderRadius: number;
  paddingX: number;
  paddingY: number;
  size: "SM" | "MD" | "LG";
  /**
   * Trailing arrow after the label (reference design's primary CTA). Optional so
   * legacy stored buttons (without the field) stay readable; the renderer and
   * editor treat absence as false. Newly written buttons store `arrow: false`
   * explicitly via DEFAULT_BUTTON.
   */
  arrow?: boolean;
};

export type HeroImage = {
  url: string;
  alt: string;
};

export type HeroVideo = {
  url: string;
  poster: string | null;
  autoplay: boolean;
  muted: boolean;
  loop: boolean;
  playsInline: boolean;
  showSoundToggle: boolean;
  pauseOffscreen: boolean;
};

export type FocalPoint = {
  x: number;
  y: number;
};

export type MobileOverride = {
  enabled: boolean;
  image: HeroImage | null;
  video: HeroVideo | null;
};

export type ObjectPosition = {
  desktop: FocalPoint;
  tablet: FocalPoint | null;
  mobile: FocalPoint | null;
};

/** A VIDEO always carries a video object; an IMAGE always carries an image. */
export type HeroMedia = {
  type: "IMAGE" | "VIDEO";
  image: HeroImage | null;
  video: HeroVideo | null;
  mobileOverride: MobileOverride;
  fit: "COVER" | "CONTAIN";
  focal: FocalPoint;
  objectPosition: ObjectPosition;
};

export type SlideOverlay = {
  color: string;
  opacity: number;
  gradient: "NONE" | "BOTTOM" | "FULL";
};

export type SliderBehavior = {
  autoplay: boolean;
  durationMs: number;
  transition: "FADE" | "SLIDE";
  pauseOnHover: boolean;
  arrows: boolean;
  pagination: "DOTS" | "COUNTER" | "PROGRESS";
  manualPauseMs: number;
};

type HeroElementBase = {
  text: string;
  link: LinkValue | null;
  style: ElementStyle;
  layout: ElementLayout;
  overrides: ElementOverrides;
  locked: boolean;
};

type HeroOfferElement = HeroElementBase & { chip: HeroChip };
type HeroCtaElement = HeroElementBase & { button: HeroButton };
type HeroCountdownElement = HeroElementBase & { endsAt: string | null };

export type HeroElement =
  HeroElementBase | HeroOfferElement | HeroCtaElement | HeroCountdownElement;

export type HeroElementKey =
  | "eyebrow"
  | "heading"
  | "subheading"
  | "offer"
  | "ctaPrimary"
  | "ctaSecondary"
  | "countdown";

export type HeroElements = {
  eyebrow: HeroElementBase;
  heading: HeroElementBase;
  subheading: HeroElementBase;
  offer: HeroOfferElement;
  ctaPrimary: HeroCtaElement;
  ctaSecondary: HeroCtaElement;
  countdown: HeroCountdownElement;
};

export type HeroSlide = {
  id: string;
  name: string;
  enabled: boolean;
  sortOrder: number;
  schedule: Schedule;
  media: HeroMedia | null;
  overlay: SlideOverlay;
  elements: HeroElements;
};

export type HeroPayload = {
  behavior: SliderBehavior;
  slides: HeroSlide[];
};

export type AnnouncementItem = {
  id: string;
  text: string;
  link: LinkValue | null;
  linkLabel: string | null;
  textColor: string;
  backgroundColor: string;
  schedule: Schedule;
  enabled: boolean;
  sortOrder: number;
};

export type AnnouncementBlock = {
  enabled: boolean;
  rotationMs: number;
  items: AnnouncementItem[];
};

type SectionProduct = {
  productId: string;
  sortOrder: number;
  badge: string | null;
};

type HomepageSectionBase = {
  id: string;
  title: string | null;
  subtitle: string | null;
  enabled: boolean;
  sortOrder: number;
  schedule: Schedule;
  products: SectionProduct[];
  style?: Record<string, unknown>;
};

type HeroSection = HomepageSectionBase & {
  type: "HERO";
  payload: HeroPayload;
};

type OpaqueHomepageSection = HomepageSectionBase & {
  type: Exclude<SectionType, "HERO">;
  payload: Record<string, unknown>;
};

export type HomepageSection = HeroSection | OpaqueHomepageSection;

export type HomepageDocument = {
  schemaVersion: typeof SCHEMA_VERSION;
  sections: HomepageSection[];
  announcement: AnnouncementBlock;
};

export type HeroElementPatch = {
  text?: string;
  link?: LinkValue | null;
  style?: Partial<ElementStyle>;
  layout?: Partial<ElementLayout>;
  locked?: boolean;
  chip?: Partial<HeroChip>;
  button?: Partial<HeroButton>;
  endsAt?: string | null;
};

/** Nested media patches are accepted by the editor while the stored object stays complete. */
export type HeroMediaPatch = {
  type?: HeroMedia["type"];
  image?: HeroImage | Partial<HeroImage> | null;
  video?: HeroVideo | Partial<HeroVideo> | null;
  mobileOverride?: {
    enabled?: boolean;
    image?: HeroImage | Partial<HeroImage> | null;
    video?: HeroVideo | Partial<HeroVideo> | null;
  };
  fit?: HeroMedia["fit"];
  focal?: Partial<FocalPoint>;
  objectPosition?: {
    desktop?: Partial<FocalPoint>;
    tablet?: Partial<FocalPoint> | null;
    mobile?: Partial<FocalPoint> | null;
  };
};

export type AnnouncementItemPatch = Partial<
  Omit<AnnouncementItem, "id" | "sortOrder">
>;

const EMPTY_SECTION_ID = "00000000-0000-7000-8000-000000000001";
const EMPTY_SLIDE_ID = "00000000-0000-7000-8000-000000000010";

const DEFAULT_ELEMENT_LAYOUTS: Record<HeroElementKey, ElementLayout> = {
  eyebrow: {
    xPct: 7.4,
    yPct: 14,
    widthPct: 40,
    align: "LEFT",
    verticalAlign: "TOP",
  },
  heading: {
    xPct: 7.4,
    yPct: 22.8,
    widthPct: 40,
    align: "LEFT",
    verticalAlign: "TOP",
  },
  subheading: {
    xPct: 7.4,
    yPct: 38,
    widthPct: 40,
    align: "LEFT",
    verticalAlign: "TOP",
  },
  offer: {
    xPct: 7.4,
    yPct: 50,
    widthPct: 30,
    align: "LEFT",
    verticalAlign: "TOP",
  },
  ctaPrimary: {
    xPct: 7.4,
    yPct: 58,
    widthPct: 22,
    align: "LEFT",
    verticalAlign: "TOP",
  },
  ctaSecondary: {
    xPct: 31,
    yPct: 58,
    widthPct: 22,
    align: "LEFT",
    verticalAlign: "TOP",
  },
  countdown: {
    xPct: 7.4,
    yPct: 70,
    widthPct: 30,
    align: "LEFT",
    verticalAlign: "TOP",
  },
};

const DEFAULT_BEHAVIOR: SliderBehavior = {
  autoplay: true,
  durationMs: 6000,
  transition: "FADE",
  pauseOnHover: true,
  arrows: true,
  pagination: "DOTS",
  manualPauseMs: 12000,
};

const DEFAULT_OVERLAY: SlideOverlay = {
  color: "#000000",
  opacity: 0.3,
  gradient: "BOTTOM",
};

const DEFAULT_CHIP: HeroChip = {
  background: "#C4552D",
  textColor: "#FFFFFF",
  borderRadius: 4,
  paddingX: 12,
  paddingY: 6,
};

const DEFAULT_BUTTON: HeroButton = {
  variant: "SOLID",
  background: null,
  textColor: null,
  borderColor: null,
  hoverBackground: null,
  hoverTextColor: null,
  borderRadius: 0,
  paddingX: 28,
  paddingY: 14,
  size: "MD",
  arrow: false,
};

const DEFAULT_ANNOUNCEMENT_TEXT =
  "Free Metro Manila delivery on orders ₱3,000+ · Cash on Delivery nationwide";

function newUuid(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function")
    return cryptoApi.randomUUID();
  if (typeof cryptoApi?.getRandomValues === "function") {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  throw new Error("A platform cryptographic UUID source is required");
}

function cloneDocument(doc: HomepageDocument): HomepageDocument {
  return structuredClone(doc);
}

function defaultElementBase(key: HeroElementKey): HeroElementBase {
  return {
    text: "",
    link: null,
    style: {},
    layout: structuredClone(DEFAULT_ELEMENT_LAYOUTS[key]),
    overrides: {},
    locked: false,
  };
}

export function emptyElement(key: HeroElementKey): HeroElement {
  switch (key) {
    case "offer":
      return {
        ...defaultElementBase(key),
        chip: structuredClone(DEFAULT_CHIP),
      };
    case "ctaPrimary":
    case "ctaSecondary":
      return {
        ...defaultElementBase(key),
        button: structuredClone(DEFAULT_BUTTON),
      };
    case "countdown":
      return { ...defaultElementBase(key), endsAt: null };
    default:
      return defaultElementBase(key);
  }
}

function createEmptySlide(
  sortOrder: number,
  id: string,
  name: string,
): HeroSlide {
  return {
    id,
    name,
    enabled: true,
    sortOrder,
    schedule: { publishAt: null, unpublishAt: null },
    media: null,
    overlay: structuredClone(DEFAULT_OVERLAY),
    elements: {
      eyebrow: emptyElement("eyebrow") as HeroElementBase,
      heading: emptyElement("heading") as HeroElementBase,
      subheading: emptyElement("subheading") as HeroElementBase,
      offer: emptyElement("offer") as HeroOfferElement,
      ctaPrimary: emptyElement("ctaPrimary") as HeroCtaElement,
      ctaSecondary: emptyElement("ctaSecondary") as HeroCtaElement,
      countdown: emptyElement("countdown") as HeroCountdownElement,
    },
  };
}

export function emptySlide(sortOrder: number): HeroSlide {
  const position = Math.max(0, Math.floor(sortOrder / 10));
  return createEmptySlide(sortOrder, newUuid(), `Hero ${position + 1}`);
}

export function emptyDocument(): HomepageDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    sections: [
      {
        id: EMPTY_SECTION_ID,
        type: "HERO",
        title: null,
        subtitle: null,
        enabled: true,
        sortOrder: 0,
        schedule: { publishAt: null, unpublishAt: null },
        payload: {
          behavior: structuredClone(DEFAULT_BEHAVIOR),
          slides: [createEmptySlide(0, EMPTY_SLIDE_ID, "Hero 1")],
        },
        products: [],
      },
    ],
    announcement: { enabled: false, rotationMs: 5000, items: [] },
  };
}

function mergeDefined<T extends Record<string, unknown>>(
  base: T,
  patch: Partial<T>,
): T {
  const next = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) next[key as keyof T] = value as T[keyof T];
  }
  return next;
}

export function clampPct(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function clampWidthPct(value: number): number {
  if (Number.isNaN(value)) return 5;
  return Math.min(100, Math.max(5, value));
}

function clampLayoutPatch(
  patch: Partial<ElementLayout>,
): Partial<ElementLayout> {
  const next = { ...patch };
  if (typeof next.xPct === "number") next.xPct = clampPct(next.xPct);
  if (typeof next.yPct === "number") next.yPct = clampPct(next.yPct);
  if (typeof next.widthPct === "number")
    next.widthPct = clampWidthPct(next.widthPct);
  return next;
}

function renumberSections(sections: HomepageSection[]): void {
  sections.forEach((section, index) => {
    section.sortOrder = index * 10;
  });
}

function renumberSlides(slides: HeroSlide[]): void {
  slides.forEach((currentSlide, index) => {
    currentSlide.sortOrder = index * 10;
  });
}

function renumberAnnouncementItems(items: AnnouncementItem[]): void {
  items.forEach((item, index) => {
    item.sortOrder = index * 10;
  });
}

function heroSectionOf(doc: HomepageDocument): HeroSection | undefined {
  const section = doc.sections.find(({ type }) => type === "HERO");
  return section?.type === "HERO" ? section : undefined;
}

/**
 * Index-only slide APIs intentionally use the first HERO. Every API that
 * receives a slide id must instead use this document-wide lookup so copied
 * HERO sections remain independently editable.
 */
type HeroSlideTarget = {
  section: HeroSection;
  index: number;
  slide: HeroSlide;
};

function heroSlideTarget(
  doc: HomepageDocument,
  slideId: string,
): HeroSlideTarget | undefined {
  for (const section of doc.sections) {
    if (section.type !== "HERO") continue;
    const index = section.payload.slides.findIndex(({ id }) => id === slideId);
    if (index >= 0) {
      return { section, index, slide: section.payload.slides[index] };
    }
  }
  return undefined;
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCompleteImage(value: unknown): value is HeroImage {
  return (
    isRecord(value) &&
    typeof value.url === "string" &&
    typeof value.alt === "string"
  );
}

function isCompleteVideo(value: unknown): value is HeroVideo {
  return (
    isRecord(value) &&
    typeof value.url === "string" &&
    hasOwn(value, "poster") &&
    (value.poster === null || typeof value.poster === "string") &&
    typeof value.autoplay === "boolean" &&
    typeof value.muted === "boolean" &&
    typeof value.loop === "boolean" &&
    typeof value.playsInline === "boolean" &&
    typeof value.showSoundToggle === "boolean" &&
    typeof value.pauseOffscreen === "boolean"
  );
}

function mergeFocal(
  current: FocalPoint | null,
  patch: unknown,
): FocalPoint | null {
  if (patch === null) return null;
  if (!isRecord(patch)) return current;
  const merged = { ...(current ?? {}), ...patch };
  return typeof merged.x === "number" && typeof merged.y === "number"
    ? { x: clampPct(merged.x), y: clampPct(merged.y) }
    : current;
}

function mergeImage(
  current: HeroImage | null,
  patch: unknown,
): HeroImage | null {
  if (patch === null) return current;
  if (!isRecord(patch)) return current;
  const merged = current ? { ...current, ...patch } : patch;
  return isCompleteImage(merged) ? structuredClone(merged) : current;
}

function mergeVideo(
  current: HeroVideo | null,
  patch: unknown,
): HeroVideo | null {
  if (patch === null) return current;
  if (!isRecord(patch)) return current;
  const merged = current ? { ...current, ...patch } : patch;
  return isCompleteVideo(merged) ? structuredClone(merged) : current;
}

function mergeMobileImage(
  current: HeroImage | null,
  patch: unknown,
): HeroImage | null {
  if (patch === null) return null;
  return mergeImage(current, patch);
}

function mergeMobileVideo(
  current: HeroVideo | null,
  patch: unknown,
): HeroVideo | null {
  if (patch === null) return null;
  return mergeVideo(current, patch);
}

function defaultMedia(
  type: HeroMedia["type"],
  source: HeroImage | HeroVideo,
): HeroMedia {
  return {
    type,
    image: type === "IMAGE" ? structuredClone(source as HeroImage) : null,
    video: type === "VIDEO" ? structuredClone(source as HeroVideo) : null,
    mobileOverride: { enabled: false, image: null, video: null },
    fit: "COVER",
    focal: { x: 50, y: 50 },
    objectPosition: { desktop: { x: 50, y: 50 }, tablet: null, mobile: null },
  };
}

function mergeMediaPatch(current: HeroMedia, patch: HeroMediaPatch): HeroMedia {
  const next = structuredClone(current);
  const requestedType = patch.type ?? current.type;

  if (requestedType !== current.type) {
    const source = requestedType === "IMAGE" ? patch.image : patch.video;
    const complete =
      requestedType === "IMAGE"
        ? isCompleteImage(source)
        : isCompleteVideo(source);
    if (!complete) return next;
    next.type = requestedType;
    if (requestedType === "IMAGE") {
      next.image = structuredClone(source as HeroImage);
    } else {
      next.video = structuredClone(source as HeroVideo);
    }
  } else if (requestedType === "IMAGE") {
    const image = mergeImage(next.image, patch.image);
    if (image) next.image = image;
  } else {
    const video = mergeVideo(next.video, patch.video);
    if (video) next.video = video;
  }

  if (patch.fit !== undefined) next.fit = patch.fit;
  if (patch.focal && isRecord(patch.focal)) {
    next.focal = mergeFocal(next.focal, patch.focal) ?? next.focal;
  }
  if (patch.objectPosition && isRecord(patch.objectPosition)) {
    const position = patch.objectPosition;
    next.objectPosition = {
      desktop:
        position.desktop !== undefined
          ? (mergeFocal(next.objectPosition.desktop, position.desktop) ??
            next.objectPosition.desktop)
          : next.objectPosition.desktop,
      tablet:
        position.tablet !== undefined
          ? mergeFocal(next.objectPosition.tablet, position.tablet)
          : next.objectPosition.tablet,
      mobile:
        position.mobile !== undefined
          ? mergeFocal(next.objectPosition.mobile, position.mobile)
          : next.objectPosition.mobile,
    };
  }
  if (patch.mobileOverride && isRecord(patch.mobileOverride)) {
    const mobilePatch = patch.mobileOverride;
    const mobile = {
      ...next.mobileOverride,
      ...(typeof mobilePatch.enabled === "boolean"
        ? { enabled: mobilePatch.enabled }
        : {}),
    };
    if (hasOwn(mobilePatch, "image")) {
      mobile.image = mergeMobileImage(
        next.mobileOverride.image,
        mobilePatch.image,
      );
    }
    if (hasOwn(mobilePatch, "video")) {
      mobile.video = mergeMobileVideo(
        next.mobileOverride.video,
        mobilePatch.video,
      );
    }
    if (mobile.enabled === false) {
      mobile.image = null;
      mobile.video = null;
    } else if (
      mobilePatch.enabled === undefined &&
      (mobile.image !== null || mobile.video !== null)
    ) {
      mobile.enabled = true;
    }
    next.mobileOverride = mobile;
  }

  // Both source slots are intentionally retained. The active `type` chooses
  // which one renders, while keeping the inactive slot lets the builder switch
  // media type without losing a previously uploaded source.
  return next;
}

export function updateSection(
  doc: HomepageDocument,
  sectionId: string,
  patch: Partial<
    Pick<HomepageSection, "title" | "subtitle" | "enabled" | "schedule">
  >,
): HomepageDocument {
  const next = cloneDocument(doc);
  const section = next.sections.find(({ id }) => id === sectionId);
  if (!section) return next;
  if (patch.title !== undefined) section.title = patch.title;
  if (patch.subtitle !== undefined) section.subtitle = patch.subtitle;
  if (patch.enabled !== undefined) section.enabled = patch.enabled;
  if (patch.schedule !== undefined)
    section.schedule = structuredClone(patch.schedule);
  return next;
}

export function moveSection(
  doc: HomepageDocument,
  fromIndex: number,
  toIndex: number,
): HomepageDocument {
  const next = cloneDocument(doc);
  if (
    !Number.isInteger(fromIndex) ||
    !Number.isInteger(toIndex) ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= next.sections.length ||
    toIndex >= next.sections.length
  ) {
    return next;
  }
  const [section] = next.sections.splice(fromIndex, 1);
  next.sections.splice(toIndex, 0, section);
  renumberSections(next.sections);
  return next;
}

export function removeSection(
  doc: HomepageDocument,
  sectionId: string,
): HomepageDocument {
  const next = cloneDocument(doc);
  const index = next.sections.findIndex(({ id }) => id === sectionId);
  if (index < 0) return next;
  next.sections.splice(index, 1);
  renumberSections(next.sections);
  return next;
}

export function duplicateSection(
  doc: HomepageDocument,
  sectionId: string,
): HomepageDocument {
  const next = cloneDocument(doc);
  const index = next.sections.findIndex(({ id }) => id === sectionId);
  if (index < 0) return next;
  const source = next.sections[index];
  const copy = structuredClone(source);
  copy.id = newUuid();
  if (copy.type === "HERO") {
    copy.payload.slides = copy.payload.slides.map(
      (currentSlide, slideIndex) => ({
        ...currentSlide,
        id: newUuid(),
        sortOrder: slideIndex * 10,
      }),
    );
  }
  next.sections.splice(index + 1, 0, copy);
  renumberSections(next.sections);
  return next;
}

export function updateHeroBehavior(
  doc: HomepageDocument,
  patch: Partial<SliderBehavior>,
): HomepageDocument {
  const next = cloneDocument(doc);
  const section = heroSectionOf(next);
  if (!section) return next;
  section.payload.behavior = mergeDefined(
    section.payload.behavior as unknown as Record<string, unknown>,
    patch as Record<string, unknown>,
  ) as unknown as SliderBehavior;
  return next;
}

export function addHeroSlide(doc: HomepageDocument): HomepageDocument {
  const next = cloneDocument(doc);
  const section = heroSectionOf(next);
  if (!section || section.payload.slides.length >= 6) return next;
  section.payload.slides.push(emptySlide(section.payload.slides.length * 10));
  renumberSlides(section.payload.slides);
  return next;
}

export function duplicateHeroSlide(
  doc: HomepageDocument,
  slideId: string,
): HomepageDocument {
  const next = cloneDocument(doc);
  const target = heroSlideTarget(next, slideId);
  if (!target || target.section.payload.slides.length >= 6) return next;
  const { section, index } = target;
  const source = target.slide;
  const suffix = "（副本）";
  const copy = structuredClone(source);
  copy.id = newUuid();
  copy.name = `${source.name.slice(0, Math.max(0, 80 - suffix.length))}${suffix}`;
  section.payload.slides.splice(index + 1, 0, copy);
  renumberSlides(section.payload.slides);
  return next;
}

export function removeHeroSlide(
  doc: HomepageDocument,
  slideId: string,
): HomepageDocument {
  const next = cloneDocument(doc);
  const target = heroSlideTarget(next, slideId);
  if (!target || target.section.payload.slides.length <= 1) return next;
  target.section.payload.slides.splice(target.index, 1);
  renumberSlides(target.section.payload.slides);
  return next;
}

export function moveHeroSlide(
  doc: HomepageDocument,
  from: number,
  to: number,
): HomepageDocument {
  const next = cloneDocument(doc);
  const section = heroSectionOf(next);
  if (
    !section ||
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < 0 ||
    from >= section.payload.slides.length ||
    to >= section.payload.slides.length
  ) {
    return next;
  }
  const [currentSlide] = section.payload.slides.splice(from, 1);
  section.payload.slides.splice(to, 0, currentSlide);
  renumberSlides(section.payload.slides);
  return next;
}

export function updateHeroSlide(
  doc: HomepageDocument,
  slideId: string,
  patch: Partial<Pick<HeroSlide, "name" | "enabled" | "schedule" | "overlay">>,
): HomepageDocument {
  const next = cloneDocument(doc);
  const target = heroSlideTarget(next, slideId);
  if (!target) return next;
  const currentSlide = target.slide;
  if (patch.name !== undefined) currentSlide.name = patch.name;
  if (patch.enabled !== undefined) currentSlide.enabled = patch.enabled;
  if (patch.schedule !== undefined)
    currentSlide.schedule = structuredClone(patch.schedule);
  if (patch.overlay !== undefined)
    currentSlide.overlay = structuredClone(patch.overlay);
  return next;
}

export function updateHeroMedia(
  doc: HomepageDocument,
  slideId: string,
  patch: Partial<HeroMedia>,
): HomepageDocument;
export function updateHeroMedia(
  doc: HomepageDocument,
  slideId: string,
  patch: HeroMediaPatch,
): HomepageDocument;
export function updateHeroMedia(
  doc: HomepageDocument,
  slideId: string,
  patch: HeroMediaPatch,
): HomepageDocument {
  const next = cloneDocument(doc);
  const target = heroSlideTarget(next, slideId);
  if (!target) return next;
  const currentSlide = target.slide;

  if (currentSlide.media === null) {
    const type = patch.type;
    const source =
      type === "IMAGE"
        ? patch.image
        : type === "VIDEO"
          ? patch.video
          : undefined;
    const complete =
      type === "IMAGE"
        ? isCompleteImage(source)
        : type === "VIDEO"
          ? isCompleteVideo(source)
          : false;
    if (!complete || !type) return next;
    currentSlide.media = mergeMediaPatch(
      defaultMedia(type, source as HeroImage | HeroVideo),
      patch,
    );
    return next;
  }

  currentSlide.media = mergeMediaPatch(currentSlide.media, patch);
  return next;
}

export function updateHeroElement(
  doc: HomepageDocument,
  slideId: string,
  key: HeroElementKey,
  patch: HeroElementPatch,
): HomepageDocument {
  const next = cloneDocument(doc);
  const target = heroSlideTarget(next, slideId);
  if (!target) return next;
  const currentSlide = target.slide;
  const element = currentSlide.elements[key];
  if (patch.text !== undefined) element.text = patch.text;
  if (patch.link !== undefined) element.link = structuredClone(patch.link);
  if (patch.style !== undefined) {
    element.style = mergeDefined(
      element.style as Record<string, unknown>,
      patch.style as Record<string, unknown>,
    ) as ElementStyle;
  }
  if (patch.layout !== undefined) {
    element.layout = mergeDefined(
      element.layout as unknown as Record<string, unknown>,
      clampLayoutPatch(patch.layout) as Record<string, unknown>,
    ) as unknown as ElementLayout;
  }
  if (patch.locked !== undefined) element.locked = patch.locked;

  if (key === "offer" && patch.chip !== undefined) {
    const offer = currentSlide.elements.offer;
    offer.chip = mergeDefined(
      offer.chip as unknown as Record<string, unknown>,
      patch.chip as Record<string, unknown>,
    ) as unknown as HeroChip;
  }
  if (
    (key === "ctaPrimary" || key === "ctaSecondary") &&
    patch.button !== undefined
  ) {
    const cta = currentSlide.elements[key];
    cta.button = mergeDefined(
      cta.button as unknown as Record<string, unknown>,
      patch.button as Record<string, unknown>,
    ) as unknown as HeroButton;
  }
  if (key === "countdown" && patch.endsAt !== undefined) {
    currentSlide.elements.countdown.endsAt = patch.endsAt;
  }
  return next;
}

export function setElementOverride(
  doc: HomepageDocument,
  slideId: string,
  key: HeroElementKey,
  device: "tablet" | "mobile",
  patch: {
    style?: Partial<ElementStyle>;
    layout?: Partial<ElementLayout>;
  } | null,
): HomepageDocument {
  const next = cloneDocument(doc);
  const target = heroSlideTarget(next, slideId);
  if (!target) return next;
  const element = target.slide.elements[key];
  if (patch === null) {
    delete element.overrides[device];
    return next;
  }

  const existing = element.overrides[device] ?? {};
  const override: { style?: ElementStyle; layout?: Partial<ElementLayout> } = {
    ...existing,
  };
  if (patch.style !== undefined) {
    override.style = mergeDefined(
      (existing.style ?? {}) as Record<string, unknown>,
      patch.style as Record<string, unknown>,
    ) as ElementStyle;
  }
  if (patch.layout !== undefined) {
    override.layout = mergeDefined(
      (existing.layout ?? {}) as Record<string, unknown>,
      clampLayoutPatch(patch.layout) as Record<string, unknown>,
    ) as Partial<ElementLayout>;
  }
  element.overrides[device] = override;
  return next;
}

export function resetElementLayout(
  doc: HomepageDocument,
  slideId: string,
  key: HeroElementKey,
): HomepageDocument {
  const next = cloneDocument(doc);
  const target = heroSlideTarget(next, slideId);
  if (!target) return next;
  target.slide.elements[key].layout = structuredClone(emptyElement(key).layout);
  return next;
}

export function updateAnnouncement(
  doc: HomepageDocument,
  patch: Partial<Pick<AnnouncementBlock, "enabled" | "rotationMs">>,
): HomepageDocument {
  const next = cloneDocument(doc);
  if (patch.enabled !== undefined) next.announcement.enabled = patch.enabled;
  if (patch.rotationMs !== undefined)
    next.announcement.rotationMs = patch.rotationMs;
  return next;
}

export function addAnnouncementItem(doc: HomepageDocument): HomepageDocument {
  const next = cloneDocument(doc);
  const items = next.announcement.items;
  if (items.length >= 6) return next;
  items.push({
    id: newUuid(),
    text: DEFAULT_ANNOUNCEMENT_TEXT,
    link: null,
    linkLabel: null,
    textColor: "#292724",
    backgroundColor: "#F2EFE9",
    schedule: { publishAt: null, unpublishAt: null },
    enabled: true,
    sortOrder: items.length * 10,
  });
  renumberAnnouncementItems(items);
  return next;
}

export function removeAnnouncementItem(
  doc: HomepageDocument,
  itemId: string,
): HomepageDocument {
  const next = cloneDocument(doc);
  const index = next.announcement.items.findIndex(({ id }) => id === itemId);
  if (index < 0) return next;
  next.announcement.items.splice(index, 1);
  renumberAnnouncementItems(next.announcement.items);
  return next;
}

export function moveAnnouncementItem(
  doc: HomepageDocument,
  from: number,
  to: number,
): HomepageDocument {
  const next = cloneDocument(doc);
  const items = next.announcement.items;
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < 0 ||
    from >= items.length ||
    to >= items.length
  ) {
    return next;
  }
  const [item] = items.splice(from, 1);
  items.splice(to, 0, item);
  renumberAnnouncementItems(items);
  return next;
}

export function updateAnnouncementItem(
  doc: HomepageDocument,
  itemId: string,
  patch: AnnouncementItemPatch,
): HomepageDocument {
  const next = cloneDocument(doc);
  const item = next.announcement.items.find(({ id }) => id === itemId);
  if (!item) return next;
  if (patch.text !== undefined) item.text = patch.text;
  if (patch.link !== undefined) item.link = structuredClone(patch.link);
  if (patch.linkLabel !== undefined) item.linkLabel = patch.linkLabel;
  if (patch.textColor !== undefined) item.textColor = patch.textColor;
  if (patch.backgroundColor !== undefined)
    item.backgroundColor = patch.backgroundColor;
  if (patch.schedule !== undefined)
    item.schedule = structuredClone(patch.schedule);
  if (patch.enabled !== undefined) item.enabled = patch.enabled;
  return next;
}

export function isScheduleActive(schedule: Schedule, now: Date): boolean {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return false;
  const publishAt =
    schedule.publishAt === null ? -Infinity : Date.parse(schedule.publishAt);
  const unpublishAt =
    schedule.unpublishAt === null ? Infinity : Date.parse(schedule.unpublishAt);
  return publishAt <= nowMs && unpublishAt > nowMs;
}

export function effectiveElementStyle(
  slide: HeroSlide,
  key: HeroElementKey,
  device: "desktop" | "tablet" | "mobile",
): { style: ElementStyle; layout: ElementLayout } {
  const element = slide.elements[key];
  let style = { ...element.style };
  let layout = { ...element.layout };
  const tablet = element.overrides.tablet;
  const mobile = element.overrides.mobile;

  if (device === "tablet" || device === "mobile") {
    if (tablet?.style) style = { ...style, ...tablet.style };
    if (tablet?.layout) layout = { ...layout, ...tablet.layout };
  }
  if (device === "mobile") {
    if (mobile?.style) style = { ...style, ...mobile.style };
    if (mobile?.layout) layout = { ...layout, ...mobile.layout };
  }
  return { style: structuredClone(style), layout: structuredClone(layout) };
}
