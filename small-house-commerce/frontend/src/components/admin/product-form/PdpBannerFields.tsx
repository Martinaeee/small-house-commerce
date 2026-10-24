"use client";

import { Field, TextInput } from "@/components/admin/Field";
import { readableTextColor } from "@/components/product/pdp-banner";
import { useAdminI18n } from "@/lib/admin-i18n";

export interface PdpBannerDraft {
  text: string;
  background: string;
  textColor: string;
}

export const BANNER_DEFAULT_BACKGROUND = "#a85238";
export const BANNER_HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function PdpBannerFields({ id, value, onChange, errors = {} }: {
  id: string;
  value: PdpBannerDraft;
  onChange: (patch: Partial<PdpBannerDraft>) => void;
  errors?: Partial<Record<keyof PdpBannerDraft, string>>;
}) {
  const { t } = useAdminI18n();
  const background = BANNER_HEX_COLOR.test(value.background.trim())
    ? value.background.trim() : BANNER_DEFAULT_BACKGROUND;
  const textColor = BANNER_HEX_COLOR.test(value.textColor.trim())
    ? value.textColor.trim() : readableTextColor(background);
  return (
    <div className="mt-3 grid gap-3">
      <Field label={t("product_pdp_banner_text_label")} htmlFor={`${id}-text`} error={errors.text}>
        <TextInput
          id={`${id}-text`} value={value.text} maxLength={60}
          placeholder={t("product_pdp_banner_text_placeholder")}
          onChange={(event) => onChange({ text: event.target.value })}
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        {(["background", "textColor"] as const).map((key) => (
          <Field
            key={key}
            label={t(key === "background" ? "product_pdp_banner_background_label" : "product_pdp_banner_text_color_label")}
            htmlFor={`${id}-${key}`} error={errors[key]}
          >
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label={t(key === "background" ? "product_pdp_banner_background_label" : "product_pdp_banner_text_color_label")}
                value={key === "background" ? background : textColor}
                onChange={(event) => onChange({ [key]: event.target.value })}
                className="h-9 w-10 shrink-0 cursor-pointer rounded border border-border bg-card p-0.5"
              />
              <TextInput
                id={`${id}-${key}`} value={value[key]}
                placeholder={key === "background" ? BANNER_DEFAULT_BACKGROUND : t("product_pdp_banner_color_auto")}
                onChange={(event) => onChange({ [key]: event.target.value })}
                className="min-w-0 flex-1"
              />
              {value[key] && (
                <button type="button" onClick={() => onChange({ [key]: "" })}
                  className="shrink-0 text-xs font-medium text-cta hover:underline">
                  {t("product_pdp_banner_color_auto")}
                </button>
              )}
            </div>
          </Field>
        ))}
      </div>
      {value.text.trim() && (
        <div>
          <p className="text-xs text-ink-muted">{t("product_pdp_banner_preview")}</p>
          <p className="mt-1 break-words rounded-lg px-3 py-2 text-center text-sm font-semibold leading-snug"
            style={{ backgroundColor: background, color: textColor }}>
            {value.text.trim()}
          </p>
        </div>
      )}
    </div>
  );
}
