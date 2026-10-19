"use client";

import { useState, type ReactNode } from "react";
import { sectionTypeLabelKey } from "./AddSectionDialog";
import { resetStudioVisualFields, studioVisualOverrides, type StudioVisualScope } from "@/lib/homepage-content-actions";
import { useAdminI18n } from "@/lib/admin-i18n";
import { useHomepageEditor } from "@/components/admin/homepage/HomepageEditor";
import {
  SectionStyleFields,
  readSectionStyle,
  type SectionStylePatch,
} from "@/components/admin/homepage/SectionStyleFields";
import { patchResponsiveFields } from "@/lib/homepage-responsive";
import { setHomepageAppearance } from "@/lib/homepage-document";

/**
 * Right-pane editor for the homepage-wide default section style. The values
 * live on `document.defaults`; every section inherits them field by field and
 * can override any single field through its own "advanced override" block.
 */
export function HomepageDefaultsPanel(): ReactNode {
  const { t } = useAdminI18n();
  const { state, dispatch, device, compareCurrentAppearance, setCompareCurrentAppearance } = useHomepageEditor();
  const [targetId, setTargetId] = useState("");
  const value = readSectionStyle(state.document.defaults);
  const isStudio = state.document.appearance === "STUDIO_V3";
  const fields = studioVisualOverrides(state.document);
  const customCount = new Set([...fields.sectionIds, ...fields.heroSectionIds]).size;
  const target = state.document.sections.find(({ id }) => id === targetId);
  const applyStudio = (scope: StudioVisualScope): void => {
    dispatch({ type: "mutate", mutate: (document) => resetStudioVisualFields(document, scope) });
  };

  const applyPatch = (patch: SectionStylePatch): void => {
    dispatch({
      type: "mutate",
      mutate: (document) => ({ ...document, defaults: patchResponsiveFields(document.defaults, device, patch) ?? {} }),
    });
  };

  return (
    <div
      data-testid="homepage-defaults-panel"
      data-panel="homepage-defaults"
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-4"
    >
      <header className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold text-ink">
          {t("homepage_builder_defaults_title")}
        </h2>
        <p className="text-xs leading-relaxed text-ink-muted">
          {t("homepage_builder_defaults_hint")}
        </p>
      </header>
      <fieldset className="flex min-w-0 flex-col gap-3">
        <legend className="mb-2 text-sm font-medium text-ink">{t("homepage_builder_appearance_title")}</legend>
        {([
          { value: undefined, label: "homepage_builder_appearance_current" },
          { value: "STUDIO_V3", label: "homepage_builder_appearance_v3" },
        ] as const).map((option) => (
          <label key={option.label} className="flex min-h-14 cursor-pointer items-center gap-3 rounded-lg border border-border p-3 text-sm text-ink has-checked:border-cta has-checked:bg-primary-light/40">
            <input type="radio" name="homepage-appearance" checked={state.document.appearance === option.value}
              onChange={() => {
                setCompareCurrentAppearance(false);
                dispatch({ type: "mutate", mutate: (document) => setHomepageAppearance(document, option.value) });
              }} />
            <span aria-hidden className={`grid h-9 w-12 shrink-0 rounded border border-border bg-background ${option.value ? "gap-1.5 p-1.5" : "gap-0.5 p-1"}`}>
              <span className="rounded-sm bg-cta/30" /><span className="rounded-sm bg-cta/15" /><span className="rounded-sm bg-cta/15" />
            </span>
            <span>{t(option.label)}</span>
          </label>
        ))}
        <p className="text-xs leading-relaxed text-ink-muted">{t("homepage_builder_appearance_hint")}</p>
      </fieldset>
      <section data-studio-conversion className="flex min-w-0 flex-col gap-3 border-t border-border pt-4">
        <h3 className="text-sm font-semibold text-ink">{t("homepage_builder_studio_apply_title")}</h3>
        <p className="text-xs leading-relaxed text-ink-muted">{t("homepage_builder_studio_apply_hint")}</p>
        <div role="status" className="text-xs text-ink-secondary">
          {customCount > 0 ? <p>{t("homepage_builder_studio_custom_count", { count: customCount })}</p> : null}
          {fields.defaults ? <p>{t("homepage_builder_studio_page_custom")}</p> : null}
          {customCount === 0 && !fields.defaults ? <p>{t("homepage_builder_studio_clean")}</p> : null}
        </div>
        <button type="button" className="min-h-11 rounded-lg border border-border px-3 py-2 text-sm font-medium disabled:opacity-50"
          disabled={!isStudio || !fields.defaults} onClick={() => applyStudio({ kind: "DEFAULTS" })}>
          {t("homepage_builder_studio_apply_defaults")}
        </button>
        <label className="flex min-w-0 flex-col gap-2 text-xs font-medium text-ink-secondary">
          {t("homepage_builder_studio_target")}
          <select value={target?.id ?? ""} disabled={!isStudio} onChange={(event) => setTargetId(event.target.value)}
            className="min-h-11 w-full min-w-0 rounded-lg border border-border bg-card px-3 text-sm text-ink">
            <option value="">{t("homepage_builder_studio_target_choose")}</option>
            {state.document.sections.map((section, index) => <option key={section.id} value={section.id}>
              {index + 1} · {section.title || (section.type === "HERO" ? "Hero" : t(sectionTypeLabelKey(section.type)))}
            </option>)}
          </select>
        </label>
        <button type="button" className="min-h-11 rounded-lg border border-border px-3 py-2 text-sm font-medium disabled:opacity-50"
          disabled={!isStudio || !target || !fields.sectionIds.includes(target.id)}
          onClick={() => { if (target) applyStudio({ kind: "SECTION", sectionId: target.id }); }}>
          {t("homepage_builder_studio_apply_section")}
        </button>
        <button type="button" className="min-h-11 rounded-lg border border-border px-3 py-2 text-sm font-medium disabled:opacity-50"
          disabled={!isStudio || target?.type !== "HERO" || !fields.heroSectionIds.includes(target.id)}
          onClick={() => { if (target?.type === "HERO") applyStudio({ kind: "HERO_TYPOGRAPHY", sectionId: target.id }); }}>
          {t("homepage_builder_studio_apply_hero")}
        </button>
        <label className="flex min-h-11 items-center gap-3 text-sm text-ink">
          <input type="checkbox" checked={isStudio && compareCurrentAppearance} disabled={!isStudio}
            onChange={(event) => setCompareCurrentAppearance(event.target.checked)} />
          {t("homepage_builder_studio_compare")}
        </label>
        <p className="text-xs leading-relaxed text-ink-muted">{t("homepage_builder_studio_compare_hint")}</p>
      </section>
      <SectionStyleFields
        key={device}
        device={device}
        value={value}
        onChange={applyPatch}
        inheritText={t("homepage_builder_defaults_unset")}
      />
    </div>
  );
}
