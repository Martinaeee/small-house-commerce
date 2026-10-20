import type { CategoryTilesPayload, UgcPayload } from "./homepage-section-payloads";
import type { ElementStyle, HomepageDocument, ResponsiveFields, SectionStyle } from "./homepage-document";
import { readCategoryTilesPayload, readUgcPayload } from "./homepage-section-normalize";

const DEVICES = ["tablet", "mobile"] as const;
const SPACING_FIELDS = ["paddingTop", "paddingBottom"] as const;
const TYPOGRAPHY_FIELDS = ["fontSize", "fontWeight", "lineHeight", "letterSpacing"] as const;

export type StudioVisualScope =
  | { kind: "DEFAULTS" }
  | { kind: "SECTION"; sectionId: string }
  | { kind: "HERO_TYPOGRAPHY"; sectionId: string };

function hasFields<T extends object>(value: Partial<T> | undefined, keys: readonly (keyof T)[]): boolean {
  return keys.some((key) => value?.[key] !== undefined);
}

function hasResponsiveFields<T extends object>(value: ResponsiveFields<T> | undefined, keys: readonly (keyof T)[]): boolean {
  return hasFields(value, keys) || DEVICES.some((device) => hasFields(value?.overrides?.[device], keys));
}

function clearFields<T extends object>(value: Partial<T>, keys: readonly (keyof T)[]): boolean {
  let changed = false;
  for (const key of keys) {
    if (value[key] === undefined) continue;
    delete value[key];
    changed = true;
  }
  return changed;
}

function clearResponsiveFields<T extends object>(value: ResponsiveFields<T>, keys: readonly (keyof T)[]): void {
  clearFields(value, keys);
  for (const device of DEVICES) {
    const fields = value.overrides?.[device];
    if (fields && clearFields(fields, keys) && Object.keys(fields).length === 0) delete value.overrides?.[device];
  }
  if (value.overrides && Object.keys(value.overrides).length === 0) delete value.overrides;
}

export function studioVisualOverrides(document: HomepageDocument): {
  defaults: boolean;
  sectionIds: string[];
  heroSectionIds: string[];
} {
  const sectionIds: string[] = [];
  const heroSectionIds: string[] = [];
  for (const section of document.sections) {
    const layout = section.type === "CATEGORY_TILES" || section.type === "PRODUCT_GRID" || section.type === "PRODUCT_STORY"
      ? section.payload.layout : undefined;
    if (hasResponsiveFields(section.style as SectionStyle | undefined, SPACING_FIELDS) || hasResponsiveFields<{ gap: number }>(layout, ["gap"])) sectionIds.push(section.id);
    if (section.type === "HERO" && section.payload.slides.some((slide) => Object.values(slide.elements).some((element) =>
      hasFields<ElementStyle>(element.style, TYPOGRAPHY_FIELDS) || DEVICES.some((device) => hasFields<ElementStyle>(element.overrides[device]?.style, TYPOGRAPHY_FIELDS)),
    ))) heroSectionIds.push(section.id);
  }
  return { defaults: hasResponsiveFields(document.defaults, SPACING_FIELDS), sectionIds, heroSectionIds };
}

export function resetStudioVisualFields(document: HomepageDocument, scope: StudioVisualScope): HomepageDocument {
  const fields = studioVisualOverrides(document);
  const needed = scope.kind === "DEFAULTS" ? fields.defaults
    : (scope.kind === "SECTION" ? fields.sectionIds : fields.heroSectionIds).includes(scope.sectionId);
  if (!needed) return document;
  const next = structuredClone(document);
  if (scope.kind === "DEFAULTS") {
    clearResponsiveFields(next.defaults!, SPACING_FIELDS);
    if (Object.keys(next.defaults!).length === 0) delete next.defaults;
    return next;
  }
  const section = next.sections.find(({ id }) => id === scope.sectionId)!;
  if (scope.kind === "SECTION") {
    if (section.style) {
      clearResponsiveFields(section.style as SectionStyle, SPACING_FIELDS);
      if (Object.keys(section.style).length === 0) delete section.style;
    }
    if (section.type === "CATEGORY_TILES" || section.type === "PRODUCT_GRID" || section.type === "PRODUCT_STORY") {
      const layout = section.payload.layout;
      if (layout) {
        clearResponsiveFields<{ gap: number }>(layout, ["gap"]);
        if (Object.keys(layout).length === 0) delete section.payload.layout;
      }
    }
  } else if (section.type === "HERO") {
    for (const slide of section.payload.slides) {
      for (const element of Object.values(slide.elements)) {
        clearFields<ElementStyle>(element.style, TYPOGRAPHY_FIELDS);
        for (const device of DEVICES) {
          const override = element.overrides[device];
          if (!override?.style || !clearFields<ElementStyle>(override.style, TYPOGRAPHY_FIELDS)) continue;
          if (Object.keys(override.style).length === 0) delete override.style;
          if (Object.keys(override).length === 0) delete element.overrides[device];
        }
      }
    }
  }
  return next;
}

/** How the operator arranges the photos: a card grid, or a large photo plus the rest. */
export type UgcLayoutChoice = "CARDS" | "GRID" | "STRIP" | "PORTRAIT";

export function makeUgcPresentation(payload: UgcPayload, choice: UgcLayoutChoice, idFactory: () => string): UgcPayload {
  const current = readUgcPayload(payload);
  if (choice === "CARDS") {
    const presentation = { ...(current.presentation ?? { layout: "CARDS" as const }) };
    delete presentation.collageVariant;
    presentation.layout = "CARDS";
    return { ...current, presentation };
  }
  const entries = (current.entries ?? []).map((entry) => ({ ...entry, id: entry.id ?? idFactory() }));
  const selected = current.presentation?.featuredEntryId;
  const featuredEntryId = entries.some((entry) => entry.id === selected) ? selected : entries[0]?.id;
  return { ...current, entries, presentation: {
    layout: "COLLAGE", collageVariant: choice,
    showQuote: current.presentation?.showQuote ?? true, overlay: current.presentation?.overlay ?? "SOFT",
    ...(featuredEntryId ? { featuredEntryId } : {}),
  } };
}

export function makeCircularNavigation(
  payload: CategoryTilesPayload,
  idFactory: () => string,
): CategoryTilesPayload {
  const current = readCategoryTilesPayload(payload);
  const { categoryIds, ...rest } = current;
  return {
    ...rest,
    entries: current.entries ?? (categoryIds ?? []).map((id) => ({
      id: idFactory(), link: { type: "CATEGORY" as const, id },
    })),
    presentation: "CIRCLES",
  };
}
