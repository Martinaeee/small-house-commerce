"use client";

import type { ReactNode } from "react";
import { Field, Select, TextInput } from "@/components/admin/Field";
import { useAdminI18n, type TKey } from "@/lib/admin-i18n";
import type { HomepageDevice, SectionStyle, SectionStyleFields as StyleFields } from "@/lib/homepage-document";
import { resolveResponsiveFields } from "@/lib/homepage-responsive";
import { useBufferedValue } from "./AnnouncementSettings";
import { SelectField } from "./SettingsPanel";

export type { SectionContentWidth } from "@/lib/homepage-document";
export type SectionStylePatch = Partial<StyleFields>;

export function readSectionStyle(value: unknown, includeOverrides = true): SectionStyle {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const style = value as Record<string, unknown>;
  const result: SectionStyle = {
    ...(typeof style.backgroundColor === "string" ? { backgroundColor: style.backgroundColor } : {}),
    ...(typeof style.textColor === "string" ? { textColor: style.textColor } : {}),
    ...(style.contentWidth === "FULL" || style.contentWidth === "STANDARD" || style.contentWidth === "NARROW"
      ? { contentWidth: style.contentWidth } : {}),
    ...(typeof style.paddingTop === "number" && Number.isFinite(style.paddingTop) ? { paddingTop: style.paddingTop } : {}),
    ...(typeof style.paddingBottom === "number" && Number.isFinite(style.paddingBottom) ? { paddingBottom: style.paddingBottom } : {}),
  };
  if (includeOverrides && style.overrides && typeof style.overrides === "object" && !Array.isArray(style.overrides)) {
    const overrides = style.overrides as Record<string, unknown>;
    for (const device of ["tablet", "mobile"] as const) {
      const fields = readSectionStyle(overrides[device], false);
      if (Object.keys(fields).length) (result.overrides ??= {})[device] = fields;
    }
  }
  return result;
}

export function DeviceField({ device, overridden, resetLabel, onReset, children }: {
  device: HomepageDevice;
  overridden: boolean;
  resetLabel?: string;
  onReset?: () => void;
  children: ReactNode;
}): ReactNode {
  const { t } = useAdminI18n();
  const origin = device === "desktop" ? "base" : overridden ? "overridden" : "inherited";
  return <div className="flex min-w-0 flex-col gap-1" data-field-origin={origin}>
    {children}
    <div className="flex min-w-0 items-center justify-between gap-2 text-xs text-ink-muted">
      <span>{t(`homepage_builder_display_${origin}`)}</span>
      {onReset ? <button type="button" aria-label={resetLabel} onClick={onReset}
        className="shrink-0 rounded border border-border px-2 py-1 text-xs text-ink-secondary hover:text-cta">
        {t("homepage_builder_style_reset")}
      </button> : null}
    </div>
  </div>;
}

function PaddingInput({ label, value, placeholder, onCommit }: {
  label: string;
  value: number | undefined;
  placeholder: string;
  onCommit: (value: number | undefined) => void;
}): ReactNode {
  const field = useBufferedValue(value === undefined ? "" : String(value), (next) => {
    onCommit(next.trim() === "" ? undefined : Math.max(0, Math.min(240, Number(next))));
  }, (next) => next.trim() === "" || Number.isFinite(Number(next)), 300);
  return <TextInput className="min-w-0 flex-1 text-sm py-2" type="number" min={0} max={240}
    aria-label={label} value={field.value} placeholder={placeholder}
    onChange={(event) => field.change(event.target.value)} onBlur={field.blur} />;
}

const LABELS: Record<keyof StyleFields, TKey> = {
  backgroundColor: "homepage_builder_style_background_color",
  textColor: "homepage_builder_style_text_color",
  contentWidth: "homepage_builder_style_content_width",
  paddingTop: "homepage_builder_style_padding_top",
  paddingBottom: "homepage_builder_style_padding_bottom",
};
const RESETS: Record<keyof StyleFields, TKey> = {
  backgroundColor: "homepage_builder_style_reset_background",
  textColor: "homepage_builder_style_reset_text",
  contentWidth: "homepage_builder_style_reset_content_width",
  paddingTop: "homepage_builder_style_reset_padding_top",
  paddingBottom: "homepage_builder_style_reset_padding_bottom",
};

export function SectionStyleFields({ value, onChange, inheritText, device = "desktop", inheritedValue, hero = false, fields = Object.keys(LABELS) as (keyof StyleFields)[], choices = false }: {
  value: SectionStyle;
  onChange: (patch: SectionStylePatch) => void;
  inheritText?: string;
  device?: HomepageDevice;
  inheritedValue?: StyleFields;
  hero?: boolean;
  fields?: readonly (keyof StyleFields)[];
  choices?: boolean;
}): ReactNode {
  const { t } = useAdminI18n();
  const inherit = inheritText ?? t("homepage_builder_style_inherit");
  const effective = { ...inheritedValue, ...resolveResponsiveFields<StyleFields>(
    { desktop: {}, tablet: {}, mobile: {} }, value, device,
  ) };
  const own = device === "desktop" ? value : value.overrides?.[device];
  const patch = (key: keyof StyleFields, entry: StyleFields[keyof StyleFields]): void => onChange({ [key]: entry });

  return <section data-panel="section-style-fields"
    className="flex min-w-0 flex-col gap-3 overflow-x-hidden rounded-lg border border-border bg-card p-3">
    <h2 className="text-sm font-semibold text-ink">{t("homepage_builder_group_style")}</h2>
    {fields.map((key) => {
      const label = t(LABELS[key]);
      return <Field key={key} label={label}>
        <DeviceField device={device} overridden={own?.[key] !== undefined} resetLabel={t(RESETS[key])}
          onReset={() => patch(key, undefined)}>
          {key === "contentWidth" && choices ? <SelectField label={label} value={effective.contentWidth}
            presentation="cards" inheritLabel={inherit} options={["FULL", "STANDARD", "NARROW"] as const}
            labelKeys={{ FULL: "homepage_builder_display_width_FULL", STANDARD: "homepage_builder_display_width_STANDARD", NARROW: "homepage_builder_style_content_width_NARROW" }}
            onChange={(next) => patch(key, next)} onClear={() => patch(key, undefined)} />
            : key === "contentWidth" ? <Select aria-label={label} className="min-w-0 text-sm py-2"
            value={effective.contentWidth ?? ""}
            onChange={(event) => patch(key, (event.target.value || undefined) as StyleFields["contentWidth"])}>
            <option value="">{inherit}</option>
            <option value="FULL">{t(hero ? "homepage_builder_display_width_FULL" : "homepage_builder_style_content_width_FULL")}</option>
            <option value="STANDARD">{t(hero ? "homepage_builder_display_width_STANDARD" : "homepage_builder_style_content_width_STANDARD")}</option>
            <option value="NARROW">{t("homepage_builder_style_content_width_NARROW")}</option>
          </Select> : key === "paddingTop" || key === "paddingBottom" ? <PaddingInput
            label={label} value={effective[key]} placeholder={inherit} onCommit={(entry) => patch(key, entry)}
          /> : <TextInput aria-label={label} className="min-w-0 flex-1 text-sm py-2" value={effective[key] ?? ""}
            placeholder={inherit} onChange={(event) => patch(key, event.target.value || undefined)} />}
        </DeviceField>
      </Field>;
    })}
    {device !== "desktop" ? <button type="button" className="self-start text-xs text-cta"
      aria-label={t("homepage_builder_display_reset_style")}
      onClick={() => onChange(Object.fromEntries(fields.map(key => [key, undefined])) as SectionStylePatch)}>
      {t("homepage_builder_display_reset_style_action")}
    </button> : null}
  </section>;
}
