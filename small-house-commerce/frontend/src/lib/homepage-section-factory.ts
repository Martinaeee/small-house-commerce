import type {
  HomepageDocument,
  HomepageSection,
  NonHeroHomepageSection,
} from "./homepage-document";
import type {
  NonHeroSectionType,
  SectionPayloadMap,
} from "./homepage-section-payloads";

/** The order used by the Add Section picker. HERO is created by emptyDocument. */
export const SECTION_TYPES = [
  "USP",
  "CATEGORY_TILES",
  "PRODUCT_GRID",
  "SOLUTIONS",
  "PRODUCT_STORY",
  "ROOM_INSPIRATION",
  "UGC",
  "BRAND_STORY",
  "CONFIDENCE",
] as const satisfies readonly NonHeroSectionType[];

export type AddableSectionType = (typeof SECTION_TYPES)[number];

const EMPTY_SCHEDULE = {
  publishAt: null,
  unpublishAt: null,
} as const;

function defaultPayload<T extends NonHeroSectionType>(
  type: T,
): SectionPayloadMap[T] {
  switch (type) {
    case "USP":
      return { items: [] } as SectionPayloadMap[T];
    case "CATEGORY_TILES":
      return { categoryIds: [] } as SectionPayloadMap[T];
    case "PRODUCT_GRID":
      return {} as SectionPayloadMap[T];
    case "SOLUTIONS":
      return { items: [] } as SectionPayloadMap[T];
    case "PRODUCT_STORY":
      return {} as SectionPayloadMap[T];
    case "ROOM_INSPIRATION":
      return { scenes: [] } as SectionPayloadMap[T];
    case "UGC":
      return { entries: [] } as SectionPayloadMap[T];
    case "BRAND_STORY":
    case "CONFIDENCE":
      return { bullets: [] } as SectionPayloadMap[T];
  }
}

type SectionOf<T extends NonHeroSectionType> = Extract<
  NonHeroHomepageSection,
  { type: T }
>;

/**
 * Creates the smallest valid non-HERO section for the existing backend DTO.
 * The title stays null: the admin UI owns its localized display label.
 */
export function defaultSection<T extends NonHeroSectionType>(
  type: T,
  id: string,
  sortOrder: number,
): SectionOf<T> {
  return {
    id,
    type,
    title: null,
    subtitle: null,
    enabled: true,
    sortOrder,
    schedule: { ...EMPTY_SCHEDULE },
    payload: defaultPayload(type),
    products: [],
  } as unknown as SectionOf<T>;
}

function renumberSections(sections: HomepageSection[]): void {
  sections.forEach((section, index) => {
    section.sortOrder = index * 10;
  });
}

/** Inserts a deeply-cloned section after `afterId`, or appends it when omitted. */
export function insertSection(
  document: HomepageDocument,
  section: HomepageSection,
  afterId?: string | null,
): HomepageDocument {
  const next = structuredClone(document);
  const copy = structuredClone(section);
  const afterIndex = afterId
    ? next.sections.findIndex(({ id }) => id === afterId)
    : -1;
  const insertAt = afterIndex >= 0 ? afterIndex + 1 : next.sections.length;

  next.sections.splice(insertAt, 0, copy);
  renumberSections(next.sections);
  return next;
}

export type SectionPayloadUpdater = (
  payload: Record<string, unknown>,
) => Record<string, unknown>;

/**
 * Updates one non-HERO payload while preserving its product rows and sibling
 * sections. Unknown ids and HERO sections are intentionally no-ops.
 */
export function updateSectionPayload(
  document: HomepageDocument,
  sectionId: string,
  updater: SectionPayloadUpdater,
): HomepageDocument {
  const section = document.sections.find(({ id }) => id === sectionId);
  if (!section || section.type === "HERO") {
    return document;
  }

  const payload = structuredClone(section.payload) as Record<string, unknown>;
  const updatedPayload = updater(payload);
  const updatedSection = {
    ...section,
    payload: structuredClone(updatedPayload),
  } as unknown as NonHeroHomepageSection;

  return {
    ...document,
    sections: document.sections.map((current) =>
      current.id === sectionId ? updatedSection : current,
    ),
  };
}
