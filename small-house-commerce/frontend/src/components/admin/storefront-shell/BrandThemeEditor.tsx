"use client";

import { type ReactNode } from "react";
import { useAdminI18n, type TKey } from "@/lib/admin-i18n";
import {
  CONTRAST_NORMAL_TEXT,
  deriveStorefrontTheme,
  themePublicationIssues,
} from "@/lib/storefront-theme";
import {
  createCurrentLuwagShellDocument,
  type HeadingFont,
  type StorefrontThemeSource,
} from "@/lib/storefront-shell-document";

export type BrandThemeEditorProps = {
  theme: StorefrontThemeSource;
  onChange: (theme: StorefrontThemeSource) => void;
};

const COLOR_CONTROLS: Array<{
  key: "primary" | "action" | "background" | "surface" | "text";
  labelKey: TKey;
}> = [
  { key: "primary", labelKey: "storefront_shell_theme_primary" },
  { key: "action", labelKey: "storefront_shell_theme_action" },
  { key: "background", labelKey: "storefront_shell_theme_background" },
  { key: "surface", labelKey: "storefront_shell_theme_surface" },
  { key: "text", labelKey: "storefront_shell_theme_text" },
];

const DERIVED_SWATCHES: Array<{
  key:
    | "primaryDark"
    | "primaryLight"
    | "actionHover"
    | "textSecondary"
    | "textMuted"
    | "border"
    | "focus"
    | "disabled"
    | "actionForeground";
  labelKey: TKey;
}> = [
  { key: "primaryDark", labelKey: "storefront_shell_theme_derived_primary_dark" },
  { key: "primaryLight", labelKey: "storefront_shell_theme_derived_primary_light" },
  { key: "actionHover", labelKey: "storefront_shell_theme_derived_action_hover" },
  { key: "textSecondary", labelKey: "storefront_shell_theme_derived_text_secondary" },
  { key: "textMuted", labelKey: "storefront_shell_theme_derived_text_muted" },
  { key: "border", labelKey: "storefront_shell_theme_derived_border" },
  { key: "focus", labelKey: "storefront_shell_theme_derived_focus" },
  { key: "disabled", labelKey: "storefront_shell_theme_derived_disabled" },
  { key: "actionForeground", labelKey: "storefront_shell_theme_derived_action_foreground" },
];

const HEADING_FONTS: Array<{ value: HeadingFont; labelKey: TKey }> = [
  { value: "SYSTEM", labelKey: "storefront_shell_theme_font_system" },
  { value: "POPPINS_HEADING", labelKey: "storefront_shell_theme_font_poppins" },
  { value: "SERIF_HEADING", labelKey: "storefront_shell_theme_font_serif" },
];

/** The reset target is always the current LUWAG preset, never a stored copy. */
function currentLuwagTheme(): StorefrontThemeSource {
  return createCurrentLuwagShellDocument({
    rootCategories: [],
    navigationCollections: [],
    supportEmail: "",
    supportHours: "",
  }).theme;
}

export function BrandThemeEditor({
  theme,
  onChange,
}: BrandThemeEditorProps): ReactNode {
  const { t } = useAdminI18n();
  const derived = deriveStorefrontTheme(theme);
  const issues = themePublicationIssues(theme);
  const textBackgroundRatio = contrastRatio(theme.text, theme.background);

  return (
    <section className="min-w-0" aria-labelledby="storefront-shell-theme-heading">
      <h2
        id="storefront-shell-theme-heading"
        className="text-lg font-semibold text-ink"
      >
        {t("storefront_shell_theme_heading")}
      </h2>
      <p className="mt-1 text-sm text-ink-secondary">
        {t("storefront_shell_theme_hint")}
      </p>

      <div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {COLOR_CONTROLS.map(({ key, labelKey }) => (
          <label
            key={key}
            className="block min-w-0 text-sm font-medium text-ink"
          >
            {t(labelKey)}
            <span className="mt-1 flex min-w-0 items-center gap-2">
              <input
                type="color"
                aria-label={t(labelKey)}
                value={theme[key]}
                onChange={(event) =>
                  onChange({ ...theme, [key]: event.target.value })
                }
                className="h-9 w-12 shrink-0 rounded border border-admin-border"
              />
              <input
                type="text"
                aria-label={`${t(labelKey)} hex`}
                value={theme[key]}
                maxLength={7}
                onChange={(event) => {
                  const next = event.target.value.trim().toLowerCase();
                  if (!/^#[0-9a-f]{6}$/.test(next)) return;
                  onChange({ ...theme, [key]: next });
                }}
                className="block w-full min-w-0 rounded-lg border border-admin-border px-3 py-2 font-mono text-xs"
              />
            </span>
          </label>
        ))}
      </div>

      <div className="mt-5 grid min-w-0 gap-4 sm:grid-cols-2">
        <label className="block min-w-0 text-sm font-medium text-ink">
          {t("storefront_shell_theme_heading_font")}
          <select
            aria-label={t("storefront_shell_theme_heading_font")}
            value={theme.headingFont}
            onChange={(event) =>
              onChange({
                ...theme,
                headingFont: event.target.value as HeadingFont,
              })
            }
            className="mt-1 block w-full min-w-0 rounded-lg border border-admin-border bg-admin-surface px-3 py-2"
          >
            {HEADING_FONTS.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.labelKey)}
              </option>
            ))}
          </select>
        </label>
        <label className="block min-w-0 text-sm font-medium text-ink">
          {t("storefront_shell_theme_body_font")}
          <select
            aria-label={t("storefront_shell_theme_body_font")}
            value={theme.bodyFont}
            onChange={() => undefined}
            className="mt-1 block w-full min-w-0 rounded-lg border border-admin-border bg-admin-surface px-3 py-2"
          >
            <option value="SYSTEM">
              {t("storefront_shell_theme_font_system")}
            </option>
          </select>
        </label>
      </div>

      <button
        type="button"
        onClick={() => onChange(currentLuwagTheme())}
        className="mt-4 rounded-lg border border-admin-border px-4 py-2 text-sm font-semibold text-ink"
      >
        {t("storefront_shell_theme_reset")}
      </button>

      <div className="mt-6">
        <h3 className="text-sm font-semibold text-ink">
          {t("storefront_shell_theme_derived_heading")}
        </h3>
        <ul className="mt-2 grid min-w-0 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {DERIVED_SWATCHES.map(({ key, labelKey }) => (
            <li key={key} className="min-w-0 text-xs text-ink-secondary">
              <span
                data-testid={`theme-derived-${key.replace(
                  /[A-Z]/g,
                  (letter) => `-${letter.toLowerCase()}`,
                )}`}
                className="flex min-w-0 items-center gap-2"
              >
                <span
                  aria-hidden
                  className="h-4 w-4 shrink-0 rounded border border-admin-border"
                  style={{ backgroundColor: derived[key] }}
                />
                <span className="min-w-0 truncate font-mono">{derived[key]}</span>
              </span>
              <span className="mt-0.5 block truncate">{t(labelKey)}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-6">
        <h3 className="text-sm font-semibold text-ink">
          {t("storefront_shell_theme_contrast_heading")}
        </h3>
        <p className="mt-1 text-xs text-ink-muted">
          {t("storefront_shell_theme_contrast_hint", {
            ratio: CONTRAST_NORMAL_TEXT,
          })}
        </p>
        <p className="mt-2 text-sm text-ink">
          {t("storefront_shell_theme_contrast_text_background", {
            ratio: textBackgroundRatio.toFixed(2),
          })}
        </p>
        <p
          data-testid="theme-issues"
          role="status"
          className="mt-3 text-sm text-ink"
        >
          {issues.length === 0
            ? t("storefront_shell_theme_contrast_pass")
            : `${issues.length} ${issues
                .map((issue) => issue.code)
                .join(" ")}`}
        </p>
        {issues.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {issues.map((issue) => (
              <li key={issue.code} className="text-xs text-admin-error">
                <span className="font-mono">{issue.code}</span>
                <span className="ml-2">{issue.message}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(
    relativeLuminance(foreground),
    relativeLuminance(background),
  );
  const darker = Math.min(
    relativeLuminance(foreground),
    relativeLuminance(background),
  );
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
