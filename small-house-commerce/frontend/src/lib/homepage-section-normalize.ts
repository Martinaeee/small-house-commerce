import type {
  HomepageSection,
  NonHeroHomepageSection,
} from "./homepage-document";
import type {
  CategoryTilesPayload,
  CountdownBannerPayload,
  NonHeroSectionType,
  ProductGridPayload,
  ProductStoryPayload,
  PromoBannerPayload,
  RoomInspirationPayload,
  SectionPayloadMap,
  SolutionItem,
  SolutionsPayload,
  TextBlockPayload,
  UgcEntry,
  UgcPayload,
  UspItem,
} from "./homepage-section-payloads";

const DEFAULT_SCHEDULE = {
  publishAt: null,
  unpublishAt: null,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function safeRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? clone(value) : {};
}

function safeSchedule(value: unknown) {
  if (!isRecord(value)) return { ...DEFAULT_SCHEDULE };
  return {
    publishAt: typeof value.publishAt === "string" ? value.publishAt : null,
    unpublishAt:
      typeof value.unpublishAt === "string" ? value.unpublishAt : null,
  };
}

function safeUspItems(value: unknown): UspItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => ({
    ...(item.icon === "shield" ||
    item.icon === "home" ||
    item.icon === "lock" ||
    item.icon === "truck"
      ? { icon: item.icon }
      : {}),
    label: typeof item.label === "string" ? item.label : "",
    ...(typeof item.sub === "string" ? { sub: item.sub } : {}),
  }));
}

function safeSolutionItems(value: unknown): SolutionItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => ({
    title: typeof item.title === "string" ? item.title : "",
    ...(typeof item.blurb === "string" ? { blurb: item.blurb } : {}),
    link: typeof item.link === "string" ? item.link : "",
  }));
}

function safeRoomPayload(payload: Record<string, unknown>): RoomInspirationPayload {
  const scenes = Array.isArray(payload.scenes)
    ? payload.scenes.filter(isRecord).map((scene) => ({
        id: typeof scene.id === "string" ? scene.id : "",
        imageUrl: typeof scene.imageUrl === "string" ? scene.imageUrl : "",
        ...(typeof scene.alt === "string" ? { alt: scene.alt } : {}),
        hotspots: Array.isArray(scene.hotspots)
          ? scene.hotspots.filter(isRecord).map((hotspot) => ({
              productId:
                typeof hotspot.productId === "string" ? hotspot.productId : "",
              xPct: typeof hotspot.xPct === "number" ? hotspot.xPct : 0,
              yPct: typeof hotspot.yPct === "number" ? hotspot.yPct : 0,
            }))
          : [],
      }))
    : [];
  return {
    ...(typeof payload.imageUrl === "string"
      ? { imageUrl: payload.imageUrl }
      : {}),
    ...(typeof payload.heading === "string" ? { heading: payload.heading } : {}),
    ...(typeof payload.body === "string" ? { body: payload.body } : {}),
    scenes,
  };
}

function safeProductStoryPayload(
  payload: Record<string, unknown>,
): ProductStoryPayload {
  return {
    ...(typeof payload.imageUrl === "string"
      ? { imageUrl: payload.imageUrl }
      : {}),
    ...(typeof payload.heading === "string" ? { heading: payload.heading } : {}),
    ...(typeof payload.body === "string" ? { body: payload.body } : {}),
    ...(typeof payload.ctaText === "string"
      ? { ctaText: payload.ctaText }
      : {}),
    ...(typeof payload.ctaLink === "string"
      ? { ctaLink: payload.ctaLink }
      : {}),
    ...(typeof payload.productId === "string"
      ? { productId: payload.productId }
      : {}),
  };
}

function safeUgcPayload(payload: Record<string, unknown>): UgcPayload {
  const entries: UgcEntry[] = Array.isArray(payload.entries)
    ? payload.entries.filter(isRecord).map((entry) => ({
        ...(typeof entry.imageUrl === "string"
          ? { imageUrl: entry.imageUrl }
          : {}),
        name: typeof entry.name === "string" ? entry.name : "",
        ...(typeof entry.location === "string"
          ? { location: entry.location }
          : {}),
        comment: typeof entry.comment === "string" ? entry.comment : "",
        ...(typeof entry.productId === "string"
          ? { productId: entry.productId }
          : {}),
      }))
    : [];
  return { entries };
}

function safeTextPayload(payload: Record<string, unknown>): TextBlockPayload {
  return {
    ...(typeof payload.heading === "string" ? { heading: payload.heading } : {}),
    ...(typeof payload.body === "string" ? { body: payload.body } : {}),
    bullets: Array.isArray(payload.bullets)
      ? payload.bullets.filter((bullet): bullet is string => typeof bullet === "string")
      : [],
  };
}

/** Non-Hero CTA links: /path, #anchor, or https://… (backend is the gate). */
function isInAppOrHttps(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 2048 &&
    ((value.startsWith("/") && !value.startsWith("//")) ||
      value.startsWith("#") ||
      /^https:\/\/.+/.test(value))
  );
}

function safePromoBannerPayload(
  payload: Record<string, unknown>,
): PromoBannerPayload {
  return {
    ...(typeof payload.ctaText === "string" ? { ctaText: payload.ctaText } : {}),
    ...(isInAppOrHttps(payload.ctaLink) ? { ctaLink: payload.ctaLink } : {}),
  };
}

function safeCountdownBannerPayload(
  payload: Record<string, unknown>,
): CountdownBannerPayload {
  const endsAt =
    typeof payload.endsAt === "string" &&
    Number.isFinite(Date.parse(payload.endsAt))
      ? payload.endsAt
      : null;
  return { ...safePromoBannerPayload(payload), endsAt };
}

function normalizePayload<T extends NonHeroSectionType>(
  type: T,
  value: unknown,
): SectionPayloadMap[T] {
  const payload = safeRecord(value);
  switch (type) {
    case "USP":
      return { items: safeUspItems(payload.items) } as SectionPayloadMap[T];
    case "CATEGORY_TILES":
      return {
        categoryIds: Array.isArray(payload.categoryIds)
          ? payload.categoryIds.filter((id): id is string => typeof id === "string")
          : [],
      } as CategoryTilesPayload as SectionPayloadMap[T];
    case "PRODUCT_GRID": {
      const columns: ProductGridPayload["columns"] =
        payload.columns === 2 || payload.columns === 4 ? payload.columns : 4;
      return { columns } as SectionPayloadMap[T];
    }
    case "SOLUTIONS":
      return {
        items: safeSolutionItems(payload.items),
      } as SolutionsPayload as SectionPayloadMap[T];
    case "PRODUCT_STORY":
      return safeProductStoryPayload(payload) as SectionPayloadMap[T];
    case "ROOM_INSPIRATION":
      return safeRoomPayload(payload) as SectionPayloadMap[T];
    case "UGC":
      return safeUgcPayload(payload) as SectionPayloadMap[T];
    case "BRAND_STORY":
    case "CONFIDENCE":
      return safeTextPayload(payload) as SectionPayloadMap[T];
    case "PROMO_BANNER":
      return safePromoBannerPayload(payload) as SectionPayloadMap[T];
    case "COUNTDOWN_BANNER":
      return safeCountdownBannerPayload(payload) as SectionPayloadMap[T];
  }
}

/**
 * Returns a cloned, editor-safe view of a section. Legacy rows may have an
 * empty/null payload; defaults are applied only to this read model so a
 * render cannot mutate the reducer's document or silently rewrite the draft.
 */
export function normalizeSectionForEditor(
  section: HomepageSection,
): HomepageSection {
  const next = clone(section);
  next.schedule = safeSchedule(section.schedule);
  next.products = Array.isArray(section.products) ? clone(section.products) : [];

  if (next.type === "HERO") return next;

  next.payload = normalizePayload(next.type, section.payload);
  if (!isRecord(section.style)) {
    delete next.style;
  } else {
    next.style = clone(section.style);
  }
  return next as NonHeroHomepageSection;
}
