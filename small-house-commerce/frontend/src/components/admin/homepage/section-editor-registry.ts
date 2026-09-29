import { createElement, type ComponentType, type ReactNode } from "react";
import type { TKey } from "@/lib/admin-i18n";
import {
  defaultSection,
  type AddableSectionType,
} from "@/lib/homepage-section-factory";
import type { NonHeroHomepageSection, SectionProduct } from "@/lib/homepage-document";
import type {
  NonHeroSectionType,
  SectionPayloadMap,
} from "@/lib/homepage-section-payloads";
import { UspSectionEditor } from "@/components/admin/homepage/sections/UspSectionEditor";
import { CategoryTilesSectionEditor } from "@/components/admin/homepage/sections/CategoryTilesSectionEditor";
import { ProductGridSectionEditor } from "@/components/admin/homepage/sections/ProductGridSectionEditor";

export type SectionOf<T extends NonHeroSectionType> = Extract<
  NonHeroHomepageSection,
  { type: T }
>;

export type SectionPayloadEditorProps<T extends NonHeroSectionType> = {
  section: SectionOf<T>;
  onPayloadChange: (
    patch:
      | Partial<SectionPayloadMap[T]>
      | ((payload: SectionPayloadMap[T]) => SectionPayloadMap[T]),
  ) => void;
  onProductsChange?: (
    patch: SectionProduct[] | ((products: SectionProduct[]) => SectionProduct[]),
  ) => void;
};

export type SectionEditorComponent<T extends NonHeroSectionType> = ComponentType<
  SectionPayloadEditorProps<T>
>;

export type SectionEditorDefinition<T extends NonHeroSectionType> = {
  type: T;
  labelKey: Extract<TKey, `homepage_builder_section_type_${T}`>;
  descriptionKey: Extract<TKey, `homepage_builder_section_description_${T}`>;
  createDefault: (id: string, sortOrder: number) => SectionOf<T>;
  editor: SectionEditorComponent<T>;
};

export type SectionEditorRegistry = {
  [T in NonHeroSectionType]: SectionEditorDefinition<T>;
};

function PayloadEditorNotice<T extends NonHeroSectionType>({
  type,
}: {
  type: T;
}): ReactNode {
  return createElement("div", {
    "data-section-payload-editor": type,
    className: "hidden",
  });
}

function makeEditor<T extends NonHeroSectionType>(
  type: T,
): SectionEditorComponent<T> {
  return function TypedSectionPayloadEditor() {
    return createElement(PayloadEditorNotice, { type });
  };
}

function createDefault<T extends AddableSectionType>(
  type: T,
): SectionEditorDefinition<T>["createDefault"] {
  return (id, sortOrder) => defaultSection(type, id, sortOrder) as SectionOf<T>;
}

const uspEditor = UspSectionEditor;
const categoryTilesEditor = CategoryTilesSectionEditor;
const productGridEditor = ProductGridSectionEditor;
const solutionsEditor = makeEditor("SOLUTIONS");
const productStoryEditor = makeEditor("PRODUCT_STORY");
const roomInspirationEditor = makeEditor("ROOM_INSPIRATION");
const ugcEditor = makeEditor("UGC");
const brandStoryEditor = makeEditor("BRAND_STORY");
const confidenceEditor = makeEditor("CONFIDENCE");

const createUspDefault = createDefault("USP");
const createCategoryTilesDefault = createDefault("CATEGORY_TILES");
const createProductGridDefault = createDefault("PRODUCT_GRID");
const createSolutionsDefault = createDefault("SOLUTIONS");
const createProductStoryDefault = createDefault("PRODUCT_STORY");
const createRoomInspirationDefault = createDefault("ROOM_INSPIRATION");
const createUgcDefault = createDefault("UGC");
const createBrandStoryDefault = createDefault("BRAND_STORY");
const createConfidenceDefault = createDefault("CONFIDENCE");

export const SECTION_EDITOR_REGISTRY: SectionEditorRegistry = {
  USP: {
    type: "USP",
    labelKey: "homepage_builder_section_type_USP",
    descriptionKey: "homepage_builder_section_description_USP",
    createDefault: createUspDefault,
    editor: uspEditor,
  },
  CATEGORY_TILES: {
    type: "CATEGORY_TILES",
    labelKey: "homepage_builder_section_type_CATEGORY_TILES",
    descriptionKey: "homepage_builder_section_description_CATEGORY_TILES",
    createDefault: createCategoryTilesDefault,
    editor: categoryTilesEditor,
  },
  PRODUCT_GRID: {
    type: "PRODUCT_GRID",
    labelKey: "homepage_builder_section_type_PRODUCT_GRID",
    descriptionKey: "homepage_builder_section_description_PRODUCT_GRID",
    createDefault: createProductGridDefault,
    editor: productGridEditor,
  },
  SOLUTIONS: {
    type: "SOLUTIONS",
    labelKey: "homepage_builder_section_type_SOLUTIONS",
    descriptionKey: "homepage_builder_section_description_SOLUTIONS",
    createDefault: createSolutionsDefault,
    editor: solutionsEditor,
  },
  PRODUCT_STORY: {
    type: "PRODUCT_STORY",
    labelKey: "homepage_builder_section_type_PRODUCT_STORY",
    descriptionKey: "homepage_builder_section_description_PRODUCT_STORY",
    createDefault: createProductStoryDefault,
    editor: productStoryEditor,
  },
  ROOM_INSPIRATION: {
    type: "ROOM_INSPIRATION",
    labelKey: "homepage_builder_section_type_ROOM_INSPIRATION",
    descriptionKey: "homepage_builder_section_description_ROOM_INSPIRATION",
    createDefault: createRoomInspirationDefault,
    editor: roomInspirationEditor,
  },
  UGC: {
    type: "UGC",
    labelKey: "homepage_builder_section_type_UGC",
    descriptionKey: "homepage_builder_section_description_UGC",
    createDefault: createUgcDefault,
    editor: ugcEditor,
  },
  BRAND_STORY: {
    type: "BRAND_STORY",
    labelKey: "homepage_builder_section_type_BRAND_STORY",
    descriptionKey: "homepage_builder_section_description_BRAND_STORY",
    createDefault: createBrandStoryDefault,
    editor: brandStoryEditor,
  },
  CONFIDENCE: {
    type: "CONFIDENCE",
    labelKey: "homepage_builder_section_type_CONFIDENCE",
    descriptionKey: "homepage_builder_section_description_CONFIDENCE",
    createDefault: createConfidenceDefault,
    editor: confidenceEditor,
  },
};

export const sectionEditorRegistry = SECTION_EDITOR_REGISTRY;

export function getSectionEditorDefinition<T extends NonHeroSectionType>(
  type: T,
): SectionEditorDefinition<T> {
  return SECTION_EDITOR_REGISTRY[type] as SectionEditorDefinition<T>;
}
