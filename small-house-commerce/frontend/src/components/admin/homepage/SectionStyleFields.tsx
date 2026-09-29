"use client";

import type { ReactNode } from "react";
import { Field, Select, TextInput } from "@/components/admin/Field";
import { useAdminI18n } from "@/lib/admin-i18n";
import type { NonHeroHomepageSection } from "@/lib/homepage-document";

export type SectionContentWidth = "FULL" | "STANDARD" | "NARROW";

export type SectionStyle = {
  backgroundColor?: string;
  textColor?: string;
  contentWidth?: SectionContentWidth;
  paddingTop?: number;
  paddingBottom?: number;
};

export type SectionStylePatch = Partial<SectionStyle>;

function readStyle(section: NonHeroHomepageSection): SectionStyle {
  const value = section.style;
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const style = value as Record<string, unknown>;
  return {
    ...(typeof style.backgroundColor === "string"
      ? { backgroundColor: style.backgroundColor }
      : {}),
    ...(typeof style.textColor === "string" ? { textColor: style.textColor } : {}),
    ...(style.contentWidth === "FULL" ||
    style.contentWidth === "STANDARD" ||
    style.contentWidth === "NARROW"
      ? { contentWidth: style.contentWidth }
      : {}),
    ...(typeof style.paddingTop === "number" && Number.isFinite(style.paddingTop)
      ? { paddingTop: style.paddingTop }
      : {}),
    ...(typeof style.paddingBottom === "number" && Number.isFinite(style.paddingBottom)
      ? { paddingBottom: style.paddingBottom }
      : {}),
  };
}

function numberValue(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(240, parsed)) : undefined;
}

function ResetButton({
  label,
  onReset,
}: {
  label: string;
  onReset: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      className="shrink-0 rounded-lg border border-border px-2 py-1 text-xs text-ink-secondary hover:border-cta hover:text-cta"
      aria-label={label}
      onClick={onReset}
    >
      Reset
    </button>
  );
}

export function SectionStyleFields({
  section,
  onChange,
}: {
  section: NonHeroHomepageSection;
  onChange: (patch: SectionStylePatch) => void;
}): ReactNode {
  const { t } = useAdminI18n();
  const style = readStyle(section);

  return (
    <section
      data-panel="section-style-fields"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3"
    >
      <h2 className="text-sm font-semibold text-ink">{t("homepage_builder_group_style")}</h2>
      <div className="grid gap-3">
        <Field label={t("homepage_builder_style_background_color")}>
          <div className="flex items-center gap-2">
            <TextInput
              aria-label={t("homepage_builder_style_background_color")}
              value={style.backgroundColor ?? ""}
              placeholder={t("homepage_builder_style_inherit")}
              onChange={(event) => onChange({ backgroundColor: event.target.value || undefined })}
            />
            <ResetButton
              label={t("homepage_builder_style_reset_background")}
              onReset={() => onChange({ backgroundColor: undefined })}
            />
          </div>
        </Field>
        <Field label={t("homepage_builder_style_text_color")}>
          <div className="flex items-center gap-2">
            <TextInput
              aria-label={t("homepage_builder_style_text_color")}
              value={style.textColor ?? ""}
              placeholder={t("homepage_builder_style_inherit")}
              onChange={(event) => onChange({ textColor: event.target.value || undefined })}
            />
            <ResetButton
              label={t("homepage_builder_style_reset_text")}
              onReset={() => onChange({ textColor: undefined })}
            />
          </div>
        </Field>
        <Field label={t("homepage_builder_style_content_width")}>
          <div className="flex items-center gap-2">
            <Select
              aria-label={t("homepage_builder_style_content_width")}
              value={style.contentWidth ?? ""}
              onChange={(event) =>
                onChange({
                  contentWidth:
                    (event.target.value || undefined) as SectionContentWidth | undefined,
                })
              }
            >
              <option value="">{t("homepage_builder_style_inherit")}</option>
              <option value="FULL">Full width</option>
              <option value="STANDARD">Standard</option>
              <option value="NARROW">Narrow</option>
            </Select>
            <ResetButton
              label={t("homepage_builder_style_reset_content_width")}
              onReset={() => onChange({ contentWidth: undefined })}
            />
          </div>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("homepage_builder_style_padding_top")}>
            <div className="flex items-center gap-2">
              <TextInput
                type="number"
                min={0}
                max={240}
                aria-label={t("homepage_builder_style_padding_top")}
                value={style.paddingTop ?? ""}
                placeholder={t("homepage_builder_style_inherit")}
                onChange={(event) => onChange({ paddingTop: numberValue(event.target.value) })}
              />
              <ResetButton
                label={t("homepage_builder_style_reset_padding_top")}
                onReset={() => onChange({ paddingTop: undefined })}
              />
            </div>
          </Field>
          <Field label={t("homepage_builder_style_padding_bottom")}>
            <div className="flex items-center gap-2">
              <TextInput
                type="number"
                min={0}
                max={240}
                aria-label={t("homepage_builder_style_padding_bottom")}
                value={style.paddingBottom ?? ""}
                placeholder={t("homepage_builder_style_inherit")}
                onChange={(event) => onChange({ paddingBottom: numberValue(event.target.value) })}
              />
              <ResetButton
                label={t("homepage_builder_style_reset_padding_bottom")}
                onReset={() => onChange({ paddingBottom: undefined })}
              />
            </div>
          </Field>
        </div>
      </div>
    </section>
  );
}
