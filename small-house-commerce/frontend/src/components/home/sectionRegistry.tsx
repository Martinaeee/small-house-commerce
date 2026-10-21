import type { ComponentType } from "react";
import type { ProductCardInteractionMode } from "@/components/product/ProductCard";
import type { HomepageSection, HomepageSectionType } from "@/lib/api";
import { BrandStorySection } from "./BrandStorySection";
import { CategoryTilesSection } from "./CategoryTilesSection";
import { ConfidenceSection } from "./ConfidenceSection";
import { CountdownBannerSection } from "./CountdownBannerSection";
import { HeroSlider } from "./HeroSlider";
import { ProductGridSection } from "./ProductGridSection";
import { ProductStorySection } from "./ProductStorySection";
import { PromoBannerSection } from "./PromoBannerSection";
import { RoomInspirationSection } from "./RoomInspirationSection";
import { SolutionsSection } from "./SolutionsSection";
import { UgcSection } from "./UgcSection";
import { UspSection } from "./UspSection";

export type SectionPreviewDevice = "desktop" | "tablet" | "mobile";

export interface SectionProps {
  section: HomepageSection;
  previewDevice?: SectionPreviewDevice;
  interactionMode?: ProductCardInteractionMode;
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
  PROMO_BANNER: PromoBannerSection,
  COUNTDOWN_BANNER: CountdownBannerSection,
};
