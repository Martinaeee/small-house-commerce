"use client";

import type { ReactNode } from "react";
import { Field, Select, TextInput } from "@/components/admin/Field";
import { useAdminI18n } from "@/lib/admin-i18n";
import type { SectionStyle } from "@/lib/homepage-document";

export type { SectionContentWidth } from "@/lib/homepage-document";
export type SectionStylePatch = Partial<SectionStyle>;

/**
 * Narrow a stored (opaque) style record to the whitelisted section style keys.
 * Shared by the per-section override editor and the homepage defaults panel.
 */
export function readSectionStyle(value: unknown): SectionStyle {
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
  text,
  onReset,
}: {
  label: string;
  text: string;
  onReset: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      className="shrink-0 rounded-lg border border-border px-2 py-1 text-xs text-ink-secondary hover:border-cta hover:text-cta"
      aria-label={label}
      onClick={onReset}
    >
      {text}
    </button>
  );
}

export function SectionStyleFields({
  value,
  onChange,
  inheritText,
}: {
  value: SectionStyle;
  onChange: (patch: SectionStylePatch) => void;
  /** Placeholder for an unset field; the homepage defaults panel overrides it. */
  inheritText?: string;
}): ReactNode {
  const { t } = useAdminI18n();
  const resetLabel = t("homepage_builder_style_reset");
  const inherit = inheritText ?? t("homepage_builder_style_inherit");

  return (
    <section
      data-panel="section-style-fields"
      className="flex min-w-0 flex-col gap-3 overflow-x-hidden rounded-lg border border-border bg-card p-3"
    >
      <h2 className="text-sm font-semibold text-ink">{t("homepage_builder_group_style")}</h2>
      <div className="grid min-w-0 gap-3">
        <Field label={t("homepage_builder_style_background_color")}>
          <div className="flex min-w-0 items-center gap-2">
            <TextInput
              className="min-w-0 flex-1 text-sm py-2"
              aria-label={t("homepage_builder_style_background_color")}
              value={value.backgroundColor ?? ""}
              placeholder={inherit}
              onChange={(event) => onChange({ backgroundColor: event.target.value || undefined })}
            />
            <ResetButton
              label={t("homepage_builder_style_reset_background")}
              text={resetLabel}
              onReset={() => onChange({ backgroundColor: undefined })}
            />
          </div>
        </Field>
        <Field label={t("homepage_builder_style_text_color")}>
          <div className="flex min-w-0 items-center gap-2">
            <TextInput
              className="min-w-0 flex-1 text-sm py-2"
              aria-label={t("homepage_builder_style_text_color")}
              value={value.textColor ?? ""}
              placeholder={inherit}
              onChange={(event) => onChange({ textColor: event.target.value || undefined })}
            />
            <ResetButton
              label={t("homepage_builder_style_reset_text")}
              text={resetLabel}
              onReset={() => onChange({ textColor: undefined })}
            />
          </div>
        </Field>
        <Field label={t("homepage_builder_style_content_width")}>
          <div className="flex min-w-0 items-center gap-2">
            <Select
              className="min-w-0 flex-1 text-sm py-2"
              aria-label={t("homepage_builder_style_content_width")}
              value={value.contentWidth ?? ""}
              onChange={(event) =>
                onChange({
                  contentWidth:
                    (event.target.value || undefined) as SectionStyle["contentWidth"],
                })
              }
            >
              <option value="">{inherit}</option>
              <option value="FULL">{t("homepage_builder_style_content_width_FULL")}</option>
              <option value="STANDARD">{t("homepage_builder_style_content_width_STANDARD")}</option>
              <option value="NARROW">{t("homepage_builder_style_content_width_NARROW")}</option>
            </Select>
            <ResetButton
              label={t("homepage_builder_style_reset_content_width")}
              text={resetLabel}
              onReset={() => onChange({ contentWidth: undefined })}
            />
          </div>
        </Field>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <Field label={t("homepage_builder_style_padding_top")}>
            <div className="flex min-w-0 items-center gap-2">
              <TextInput
                className="min-w-0 flex-1 text-sm py-2"
                type="number"
                min={0}
                max={240}
                aria-label={t("homepage_builder_style_padding_top")}
                value={value.paddingTop ?? ""}
                placeholder={inherit}
                onChange={(event) => onChange({ paddingTop: numberValue(event.target.value) })}
              />
              <ResetButton
                label={t("homepage_builder_style_reset_padding_top")}
                text={resetLabel}
                onReset={() => onChange({ paddingTop: undefined })}
              />
            </div>
          </Field>
          <Field label={t("homepage_builder_style_padding_bottom")}>
            <div className="flex min-w-0 items-center gap-2">
              <TextInput
                className="min-w-0 flex-1 text-sm py-2"
                type="number"
                min={0}
                max={240}
                aria-label={t("homepage_builder_style_padding_bottom")}
                value={value.paddingBottom ?? ""}
                placeholder={inherit}
                onChange={(event) => onChange({ paddingBottom: numberValue(event.target.value) })}
              />
              <ResetButton
                label={t("homepage_builder_style_reset_padding_bottom")}
                text={resetLabel}
                onReset={() => onChange({ paddingBottom: undefined })}
              />
            </div>
          </Field>
        </div>
      </div>
    </section>
  );
}
