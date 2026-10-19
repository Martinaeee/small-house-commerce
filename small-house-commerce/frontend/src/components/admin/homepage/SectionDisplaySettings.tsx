"use client";

import type { ReactNode } from "react";
import { useAdminI18n, type TKey } from "@/lib/admin-i18n";
import type { CategoryLayoutFields, HeroDisplayFields, HomepageDevice, HomepageSection, SectionStyle, SectionStyleFields as StyleFields } from "@/lib/homepage-document";
import { normalizeModuleLayout, patchResponsiveFields, resolveModuleLayout, resolveResponsiveFields } from "@/lib/homepage-responsive";
import { useHomepageEditor } from "./HomepageEditor";
import { NumberField, SelectField } from "./SettingsPanel";
import { DeviceField, readSectionStyle, SectionStyleFields, type SectionStylePatch } from "./SectionStyleFields";

type LayoutSection = Extract<HomepageSection, { type: "CATEGORY_TILES" | "PRODUCT_GRID" | "PRODUCT_STORY" }>;
function isLayoutSection(section: HomepageSection): section is LayoutSection {
  return section.type === "CATEGORY_TILES" || section.type === "PRODUCT_GRID" || section.type === "PRODUCT_STORY";
}
const HEIGHTS = ["", "SCREEN", "BANNER", "NATURAL"] as const;
const HEIGHT_LABELS: Record<(typeof HEIGHTS)[number], TKey> = {
  "": "homepage_builder_display_height_legacy",
  SCREEN: "homepage_builder_display_height_SCREEN",
  BANNER: "homepage_builder_display_height_BANNER",
  NATURAL: "homepage_builder_display_height_NATURAL",
};
const RATIOS = ["SQUARE", "LANDSCAPE", "PORTRAIT"] as const;
const RATIO_LABELS: Record<(typeof RATIOS)[number], TKey> = {
  SQUARE: "homepage_builder_display_ratio_SQUARE",
  LANDSCAPE: "homepage_builder_display_ratio_LANDSCAPE",
  PORTRAIT: "homepage_builder_display_ratio_PORTRAIT",
};

function DisplayPanel({ sectionId, device, view }: { sectionId: string; device: HomepageDevice; view?: "layout" | "spacing" }): ReactNode {
  const { t } = useAdminI18n();
  const { state, dispatch } = useHomepageEditor();
  const section = state.document.sections.find(({ id }) => id === sectionId);
  if (!section || (section.type !== "HERO" && !isLayoutSection(section))) return null;

  const mutateSection = (change: (target: HomepageSection) => void): void => {
    dispatch({ type: "mutate", mutate: (latest) => {
      const next = structuredClone(latest);
      const target = next.sections.find(({ id }) => id === sectionId);
      if (!target) return latest;
      change(target);
      return next;
    } });
  };
  const changeHeight = (heightMode: HeroDisplayFields["heightMode"] | undefined): void => {
    mutateSection((target) => {
      if (target.type !== "HERO") return;
      const display = patchResponsiveFields(target.payload.display, device, { heightMode });
      if (display) target.payload.display = display;
      else delete target.payload.display;
    });
  };
  const changeStyle = (patch: SectionStylePatch): void => {
    mutateSection((target) => {
      const source = target.style && typeof target.style === "object" && !Array.isArray(target.style)
        ? target.style as SectionStyle : undefined;
      const style = patchResponsiveFields(source, device, patch);
      if (style) target.style = style;
      else delete target.style;
    });
  };
  const changeLayout = (patch: Partial<CategoryLayoutFields>): void => {
    mutateSection((target) => {
      if (!isLayoutSection(target)) return;
      const layout = patchResponsiveFields<Partial<CategoryLayoutFields>>(target.payload.layout, device, patch);
      if (layout) target.payload.layout = normalizeModuleLayout(target.type, layout);
      else delete target.payload.layout;
    });
  };

  if (section.type === "HERO") {
    const display = section.payload.display;
    const height = resolveResponsiveFields<Partial<HeroDisplayFields>>(
      { desktop: {}, tablet: {}, mobile: {} }, display, device,
    ).heightMode;
    const contentLayout = (device === "desktop" ? undefined : display?.overrides?.[device]?.contentLayout) ?? display?.contentLayout;
    const changeContentLayout = (contentLayout: HeroDisplayFields["contentLayout"] | undefined) => mutateSection((target) => {
      if (target.type !== "HERO") return;
      const next = patchResponsiveFields(target.payload.display, device, { contentLayout });
      if (next) target.payload.display = next;
      else delete target.payload.display;
    });
    const inherited = resolveResponsiveFields<StyleFields>(
      { desktop: {}, tablet: {}, mobile: {} }, state.document.defaults, device,
    );
    if (view === "spacing") return <SectionStyleFields value={readSectionStyle(section.style)} onChange={changeStyle}
      device={device} inheritedValue={inherited} hero fields={["paddingTop", "paddingBottom", "backgroundColor", "textColor"]} />;
    return <div data-panel="section-display-settings" className={view ? "flex min-w-0 flex-col gap-4" : "flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-4"}>
      {view ? <SectionStyleFields value={readSectionStyle(section.style)} onChange={changeStyle}
        device={device} inheritedValue={inherited} hero fields={["contentWidth"]} choices />
        : <h2 className="text-sm font-semibold text-ink">{t("homepage_builder_display_hero_title")}</h2>}
      <DeviceField device={device} overridden={device !== "desktop" && display?.overrides?.[device]?.contentLayout !== undefined}
        resetLabel={t("homepage_builder_display_copy_layout")} onReset={() => changeContentLayout(undefined)}>
        <SelectField label={t("homepage_builder_display_copy_layout")} value={contentLayout ?? ""}
          options={["", "AUTO", "FREE"] as const} labelKeys={{ "": "homepage_builder_display_copy_inherit", AUTO: "homepage_builder_display_copy_AUTO", FREE: "homepage_builder_display_copy_FREE" }}
          presentation={view ? "segments" : undefined}
          onChange={(next) => changeContentLayout(next || undefined)} onClear={() => changeContentLayout(undefined)} />
      </DeviceField>
      <p className="text-xs leading-relaxed text-ink-muted">{t("homepage_builder_display_copy_note")}</p>
      <DeviceField device={device} overridden={device !== "desktop" && display?.overrides?.[device]?.heightMode !== undefined}
        resetLabel={t("homepage_builder_display_reset_display")} onReset={() => changeHeight(undefined)}>
        <SelectField label={t("homepage_builder_display_hero_height")} value={height ?? ""}
          options={HEIGHTS} labelKeys={HEIGHT_LABELS} presentation={view ? "segments" : undefined}
          onChange={(next) => changeHeight(next || undefined)} onClear={() => changeHeight(undefined)} />
      </DeviceField>
      <p className="text-xs leading-relaxed text-ink-muted">{t("homepage_builder_display_mobile_overlay_note")}</p>
      <p className="text-xs leading-relaxed text-ink-muted">{t("homepage_builder_display_ratio_note")}</p>
      {!view ? <SectionStyleFields value={readSectionStyle(section.style)} onChange={changeStyle}
        device={device} inheritedValue={inherited} hero /> : null}
    </div>;
  }

  const layout = normalizeModuleLayout(section.type, section.payload.layout);
  const value = resolveModuleLayout(section.type, layout, device, section.type === "PRODUCT_GRID" ? section.payload.columns : undefined, state.document.appearance);
  const own = device === "desktop" ? layout : layout?.overrides?.[device];
  const configuredColumns = (own && "columns" in own ? own.columns : undefined) ?? (layout && "columns" in layout ? layout.columns : undefined);
  const automaticColumns = state.document.appearance === "STUDIO_V3" && configuredColumns === undefined && !(section.type === "PRODUCT_GRID" && section.payload.columns === 2);
  const field = (key: keyof CategoryLayoutFields, label: string, children: ReactNode): ReactNode =>
    <DeviceField device={device} overridden={own !== undefined && key in own}
      resetLabel={`${label}: ${t("homepage_builder_clear_inherit")}`} onReset={() => changeLayout({ [key]: undefined })}>
      {children}
      <span className="text-xs text-ink-muted" data-layout-source={own !== undefined && key in own ? "device" : layout !== undefined && key in layout ? "common" : "auto"}>
        {t(own !== undefined && key in own ? device === "desktop" ? "homepage_builder_display_source_common" : "homepage_builder_display_source_device"
          : layout !== undefined && key in layout ? "homepage_builder_display_source_common" : "homepage_builder_display_source_auto")}
      </span>
    </DeviceField>;

  return <div data-panel="section-display-settings" className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-4">
    <h2 className="text-sm font-semibold text-ink">{t("homepage_builder_display_layout_title")}</h2>
    {section.type === "CATEGORY_TILES" ? <p className="text-xs leading-relaxed text-ink-muted">{t("homepage_builder_display_category_auto")}</p> : null}
    {section.type !== "PRODUCT_STORY" ? field("columns", t("homepage_builder_display_columns"),
      <SelectField label={t("homepage_builder_display_columns")} value={automaticColumns ? undefined : String(value.columns)}
        inheritLabel={state.document.appearance === "STUDIO_V3" ? t("homepage_builder_display_auto_inherit") : undefined}
        options={section.type === "CATEGORY_TILES" ? ["1", "2", "3", "4", "5", "6"] : ["1", "2", "3", "4"]}
        onClear={() => changeLayout({ columns: undefined })}
        onChange={(next) => changeLayout({ columns: Number(next) as CategoryLayoutFields["columns"] })} />,
    ) : null}
    {field("gap", t("homepage_builder_display_grid_gap"),
      <NumberField label={t("homepage_builder_display_grid_gap")} value={value.gap} min={0} max={48}
        onCommit={(next) => changeLayout({ gap: Math.round(next) })} />,
    )}
    {section.type !== "PRODUCT_GRID" ? field("imageRatio", t("homepage_builder_display_image_ratio"),
      <SelectField label={t("homepage_builder_display_image_ratio")} value={value.imageRatio ?? "SQUARE"}
        options={RATIOS} labelKeys={RATIO_LABELS} onChange={(next) => changeLayout({ imageRatio: next })} />,
    ) : null}
    {device !== "desktop" ? <button type="button" className="self-start text-xs text-cta"
      aria-label={t("homepage_builder_display_reset_layout")}
      onClick={() => changeLayout({ columns: undefined, gap: undefined, imageRatio: undefined })}>
      {t("homepage_builder_display_reset_layout_action")}
    </button> : null}
  </div>;
}

export function SectionDisplaySettings({ view }: { view?: "layout" | "spacing" } = {}): ReactNode {
  const { state, selectedSectionId, device } = useHomepageEditor();
  const id = selectedSectionId ?? state.document.sections.find(({ type }) => type === "HERO")?.id;
  return id ? <DisplayPanel key={`${id}:${device}`} sectionId={id} device={device} view={view} /> : null;
}
