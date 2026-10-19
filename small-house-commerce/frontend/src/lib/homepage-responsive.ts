import type { CSSProperties } from "react";
import type {
  CategoryLayoutFields,
  HomepageAppearance,
  HomepageDevice,
  ProductGridLayoutFields,
  ProductStoryLayoutFields,
  ResponsiveFields,
  SectionStyle,
  SectionStyleFields,
} from "./homepage-document";

export function resolveResponsiveFields<T extends object>(
  defaults: Record<HomepageDevice, T>,
  value: ResponsiveFields<T> | undefined,
  device: HomepageDevice,
): T {
  const source: ResponsiveFields<T> = value ?? {};
  const { overrides, ...common } = source;
  return {
    ...defaults[device],
    ...common,
    ...(device === "desktop" ? {} : overrides?.[device]),
  } as T;
}

export function patchResponsiveFields<T extends object>(
  value: ResponsiveFields<T> | undefined,
  device: HomepageDevice,
  patch: Partial<{ [K in keyof T]: T[K] | undefined }>,
): ResponsiveFields<T> | undefined {
  const next: ResponsiveFields<T> = structuredClone(value ?? {});
  const target: Partial<T> = device === "desktop"
    ? next
    : ((next.overrides ??= {})[device] ??= {});
  for (const [key, entry] of Object.entries(patch)) {
    if (entry === undefined) delete target[key as keyof T];
    else target[key as keyof T] = entry as T[keyof T];
  }
  for (const name of ["tablet", "mobile"] as const) {
    if (next.overrides?.[name] && Object.keys(next.overrides[name]).length === 0) {
      delete next.overrides[name];
    }
  }
  if (next.overrides && Object.keys(next.overrides).length === 0) delete next.overrides;
  return Object.keys(next).length > 0 ? next : undefined;
}

export function mergeSectionStyles(
  defaults: SectionStyle | undefined,
  section: SectionStyle | undefined,
): SectionStyle | undefined {
  const { overrides: globalOverrides, ...globalBase } = defaults ?? {};
  const { overrides: sectionOverrides, ...sectionBase } = section ?? {};
  const base: SectionStyleFields = { ...globalBase, ...sectionBase };
  const result: SectionStyle = { ...base };
  for (const device of ["tablet", "mobile"] as const) {
    const effective = {
      ...globalBase,
      ...globalOverrides?.[device],
      ...sectionBase,
      ...sectionOverrides?.[device],
    };
    const difference = Object.fromEntries(Object.entries(effective).filter(
      ([key, value]) => value !== base[key as keyof SectionStyleFields],
    ));
    if (Object.keys(difference).length > 0) {
      (result.overrides ??= {})[device] = difference;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

type ModuleLayouts = {
  CATEGORY_TILES: CategoryLayoutFields;
  PRODUCT_GRID: ProductGridLayoutFields;
  PRODUCT_STORY: ProductStoryLayoutFields;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function normalizeModuleLayout<T extends keyof ModuleLayouts>(
  type: T,
  value: unknown,
): ResponsiveFields<ModuleLayouts[T]> | undefined {
  if (!isRecord(value)) return undefined;
  const fields = (input: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {};
    if (type !== "PRODUCT_STORY" && typeof input.columns === "number" &&
      Number.isInteger(input.columns) && input.columns >= 1 &&
      input.columns <= (type === "CATEGORY_TILES" ? 6 : 4)) {
      result.columns = input.columns;
    }
    if (typeof input.gap === "number" && Number.isInteger(input.gap) &&
      input.gap >= 0 && input.gap <= 48) result.gap = input.gap;
    if (type !== "PRODUCT_GRID" &&
      (input.imageRatio === "SQUARE" || input.imageRatio === "LANDSCAPE" || input.imageRatio === "PORTRAIT")) {
      result.imageRatio = input.imageRatio;
    }
    return result;
  };
  const result = fields(value);
  const overrides: Record<string, unknown> = {};
  if (isRecord(value.overrides)) {
    for (const device of ["tablet", "mobile"] as const) {
      const input = value.overrides[device];
      if (!isRecord(input)) continue;
      const parsed = fields(input);
      if (Object.keys(parsed).length > 0) overrides[device] = parsed;
    }
  }
  if (Object.keys(overrides).length > 0) result.overrides = overrides;
  return result as ResponsiveFields<ModuleLayouts[T]>;
}

const IMAGE_RATIOS = { SQUARE: "1 / 1", LANDSCAPE: "4 / 3", PORTRAIT: "3 / 4" } as const;
type ModuleLayoutValues = { columns?: number; gap: number; imageRatio?: keyof typeof IMAGE_RATIOS };

const STUDIO_GAPS: Record<keyof ModuleLayouts, Record<HomepageDevice, number>> = {
  CATEGORY_TILES: { desktop: 32, tablet: 24, mobile: 16 },
  PRODUCT_GRID: { desktop: 24, tablet: 20, mobile: 12 },
  PRODUCT_STORY: { desktop: 48, tablet: 28, mobile: 20 },
};

export function resolveModuleLayout(
  type: keyof ModuleLayouts,
  input: unknown,
  device: HomepageDevice,
  legacyColumns?: unknown,
  appearance?: HomepageAppearance,
): ModuleLayoutValues {
  const fallback: ModuleLayoutValues = {
    gap: appearance === "STUDIO_V3" ? STUDIO_GAPS[type][device] : type === "PRODUCT_STORY" ? 32 : 16,
    ...(type === "PRODUCT_STORY" ? {} : { columns: type === "CATEGORY_TILES"
      ? { desktop: 6, tablet: 3, mobile: 2 }[device]
      : legacyColumns === 2 ? 2 : { desktop: 4, tablet: 3, mobile: 2 }[device] }),
    ...(type === "PRODUCT_GRID" ? {} : { imageRatio: type === "PRODUCT_STORY" ? "LANDSCAPE" : "SQUARE" }),
  };
  return { ...fallback, ...resolveResponsiveFields<Partial<ModuleLayoutValues>>(
    { desktop: {}, tablet: {}, mobile: {} }, normalizeModuleLayout(type, input), device,
  ) };
}

export function moduleLayoutPresentation(
  type: keyof ModuleLayouts,
  input: unknown,
  previewDevice?: HomepageDevice,
  legacyColumns?: unknown,
  appearance?: HomepageAppearance,
): { className: string; style: CSSProperties; imageStyle: CSSProperties } | undefined {
  const layout = normalizeModuleLayout(type, input);
  if (layout === undefined && appearance !== "STUDIO_V3") return undefined;
  const values = {} as Record<HomepageDevice, ModuleLayoutValues>;
  const templates = {} as Record<HomepageDevice, string>;
  const flows = {} as Record<HomepageDevice, string>;
  const style: Record<string, string | number> = {};
  for (const device of ["desktop", "tablet", "mobile"] as const) {
    values[device] = resolveModuleLayout(type, layout, device, legacyColumns, appearance);
    const value = values[device];
    const configured = resolveResponsiveFields<Partial<ModuleLayoutValues>>({ desktop: {}, tablet: {}, mobile: {} }, layout, device);
    const automatic = appearance === "STUDIO_V3" && configured.columns === undefined && legacyColumns !== 2;
    const rail = automatic && type === "CATEGORY_TILES" && device === "mobile";
    flows[device] = rail ? "column" : "row";
    templates[device] = rail ? "none" : type === "PRODUCT_GRID" && automatic
      ? `repeat(auto-fill, minmax(min(100%, max(${device === "mobile" ? 140 : 200}px, calc((100% - ${(value.columns! - 1) * value.gap}px) / ${value.columns}))), 1fr))`
      : `repeat(${value.columns}, minmax(0, 1fr))`;
    style[`--hp-layout-${device}-gap`] = `${value.gap}px`;
    style[`--hp-layout-${device}-row-gap`] = `${appearance === "STUDIO_V3" && type === "PRODUCT_GRID" && device === "mobile" && configured.gap === undefined ? 20 : value.gap}px`;
    style[`--hp-layout-${device}-template`] = templates[device];
    style[`--hp-layout-${device}-flow`] = flows[device];
    if (value.columns !== undefined) style[`--hp-layout-${device}-columns`] = value.columns;
    if (value.imageRatio) style[`--hp-layout-${device}-ratio`] = IMAGE_RATIOS[value.imageRatio];
  }
  if (previewDevice) {
    const current = values[previewDevice];
    style.gap = current.gap;
    style.rowGap = Number.parseFloat(String(style[`--hp-layout-${previewDevice}-row-gap`]));
    if (current.columns !== undefined) {
      style.gridTemplateColumns = templates[previewDevice];
      style.gridAutoFlow = flows[previewDevice];
    }
    if (current.imageRatio) style["--hp-layout-ratio"] = IMAGE_RATIOS[current.imageRatio];
  }
  const currentRatio = previewDevice ? values[previewDevice].imageRatio : undefined;
  return {
    className: `hp-layout${type === "PRODUCT_STORY" ? "" : " hp-layout-columns"}`,
    style: style as CSSProperties,
    imageStyle: type === "PRODUCT_GRID" ? {} : { aspectRatio: currentRatio ? IMAGE_RATIOS[currentRatio] : "var(--hp-layout-ratio)" },
  };
}
