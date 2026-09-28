import type { ComponentType } from "react";
import type { HomepageSection, HomepageSectionType } from "@/lib/api";
import { BrandStorySection } from "./BrandStorySection";
import { CategoryTilesSection } from "./CategoryTilesSection";
import { ConfidenceSection } from "./ConfidenceSection";
import { HeroSlider } from "./HeroSlider";
import { ProductGridSection } from "./ProductGridSection";
import { ProductStorySection } from "./ProductStorySection";
import { RoomInspirationSection } from "./RoomInspirationSection";
import { SolutionsSection } from "./SolutionsSection";
import { UgcSection } from "./UgcSection";
import { UspSection } from "./UspSection";

export interface SectionProps {
  section: HomepageSection;
}

export const SECTION_REGISTRY: Record<HomepageSectionType, ComponentType<SectionProps>> = {
  HERO: HeroSlider,
  USP: UspSection,
  CATEGORY_TILES: CategoryTilesSection,
  PRODUCT_GRID: ProductGridSection,
  SOLUTIONS: SolutionsSection,
  PRODUCT_STORY: ProductStorySection,
  ROOM_INSPIRATION: RoomInspirationSection,
  UGC: UgcSection,
  BRAND_STORY: BrandStorySection,
  CONFIDENCE: ConfidenceSection,
};
