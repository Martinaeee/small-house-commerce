import { formatHex, interpolate, wcagContrast } from "culori";
import {
  CURRENT_LUWAG_THEME_SOURCE,
  type DerivedStorefrontTheme,
  type ShellIssue,
  type StorefrontThemeSource,
} from "./storefront-shell-document";

/**
 * Base brand theme derivation — frontend mirror of
 * `backend/src/modules/storefront-shell/storefront-shell-theme.ts`
 * (spec §10–§11).
 *
 * The editor preview and the backend publish gate must produce identical
 * tokens and issue codes for the same source, so both implementations share
 * `contracts/storefront-theme-fixtures.json` and the mirrored specs assert
 * byte-equality against it.
 */

export const CURRENT_LUWAG_DERIVED_THEME: DerivedStorefrontTheme = {
  primaryDark: "#b8946a",
  primaryLight: "#dce4d7",
  actionHover: "#1b3b2e",
  textSecondary: "#5a665e",
  textMuted: "#8c968e",
  border: "#e4dfd5",
  focus: "#244c3c",
  disabled: "#8c968e",
  actionForeground: "#ffffff",
};

export const CONTRAST_NORMAL_TEXT = 4.5;
export const CONTRAST_GRAPHICAL = 3;

const MIX = {
  primaryDark: 0.18,
  primaryLight: 0.72,
  actionHover: 0.15,
  textSecondary: 0.35,
  textMuted: 0.55,
  border: 0.82,
  disabled: 0.65,
} as const;

function mix(from: string, to: string, amount: number): string {
  const value = formatHex(interpolate([from, to], "oklch")(amount));
  if (!value) throw new Error(`Theme color could not be converted to sRGB: ${from} → ${to}`);
  return value.toLowerCase();
}

function isCurrentLuwagSource(source: StorefrontThemeSource): boolean {
  return (
    source.primary === CURRENT_LUWAG_THEME_SOURCE.primary &&
    source.action === CURRENT_LUWAG_THEME_SOURCE.action &&
    source.background === CURRENT_LUWAG_THEME_SOURCE.background &&
    source.surface === CURRENT_LUWAG_THEME_SOURCE.surface &&
    source.text === CURRENT_LUWAG_THEME_SOURCE.text
  );
}

const CURRENT_LUWAG_COMPONENT_COLORS = {
  footerBackground: "#f2ede4",
  footerForeground: "#1f2a24",
  footerSecondary: "#5a665e",
  footerMuted: "#8c968e",
  footerBorder: "#e4dfd5",
  footerLogoTile: "#1f2a24",
  footerLogoSquare: "#f2ede4",
  footerLogoStroke: "#f2ede4",
  footerBand: "#a9b69b",
  footerBandInk: "#1f2a24",
  footerBandSoft: "#33412c",
  newsletterOverlay: "#1f2a24",
  newsletterSurface: "#f2ede4",
  newsletterSurfaceAlt: "#f6f1e8",
  newsletterCard: "#ffffff",
  newsletterText: "#1f2a24",
  newsletterSecondary: "#5a665e",
  newsletterMuted: "#8c968e",
  newsletterAccent: "#a85238",
  newsletterAccentHover: "#8e4230",
  newsletterBorder: "#e4dfd5",
  newsletterTicket: "#a85238",
  newsletterForeground: "#ffffff",
} as const;

function componentThemeColors(
  source: StorefrontThemeSource,
  derived: DerivedStorefrontTheme,
) {
  if (isCurrentLuwagSource(source)) {
    return CURRENT_LUWAG_COMPONENT_COLORS;
  }

  return {
    footerBackground: source.action,
    footerForeground: derived.actionForeground,
    footerSecondary: derived.actionForeground,
    footerMuted: derived.actionForeground,
    footerBorder: derived.actionForeground,
    footerLogoTile: derived.actionForeground,
    footerLogoSquare: source.primary,
    footerLogoStroke: source.action,
    footerBand: source.primary,
    footerBandInk: derived.actionForeground,
    footerBandSoft: derived.actionForeground,
    newsletterOverlay: source.text,
    newsletterSurface: source.surface,
    newsletterSurfaceAlt: source.surface,
    newsletterCard: source.background,
    newsletterText: source.text,
    newsletterSecondary: derived.textSecondary,
    newsletterMuted: derived.textMuted,
    newsletterAccent: source.action,
    newsletterAccentHover: derived.actionHover,
    newsletterBorder: derived.border,
    newsletterTicket: source.action,
    newsletterForeground: derived.actionForeground,
  };
}

export function deriveStorefrontTheme(source: StorefrontThemeSource): DerivedStorefrontTheme {
  if (isCurrentLuwagSource(source)) return { ...CURRENT_LUWAG_DERIVED_THEME };

  const actionForeground = ["#ffffff", source.text].sort(
    (a, b) => wcagContrast(source.action, b) - wcagContrast(source.action, a),
  )[0];

  return {
    primaryDark: mix(source.primary, "#000000", MIX.primaryDark),
    primaryLight: mix(source.primary, source.background, MIX.primaryLight),
    actionHover: mix(
      source.action,
      actionForeground === "#ffffff" ? "#000000" : "#ffffff",
      MIX.actionHover,
    ),
    textSecondary: mix(source.text, source.background, MIX.textSecondary),
    textMuted: mix(source.text, source.background, MIX.textMuted),
    border: mix(source.text, source.background, MIX.border),
    focus: source.action,
    disabled: mix(source.text, source.background, MIX.disabled),
    actionForeground,
  };
}

function issue(
  code: string,
  path: string[],
  foreground: string,
  background: string,
  requiredRatio: number,
): ShellIssue | null {
  const ratio = wcagContrast(foreground, background);
  if (ratio >= requiredRatio) return null;
  return {
    code,
    path,
    message: `${foreground} on ${background} is ${ratio.toFixed(2)}:1; ${requiredRatio}:1 is required`,
    ratio,
    requiredRatio,
  };
}

/** Publication-blocking contrast issues (spec §11). Never rewrites source colors. */
export function themePublicationIssues(source: StorefrontThemeSource): ShellIssue[] {
  const derived = deriveStorefrontTheme(source);
  return [
    issue("THEME_TEXT_BACKGROUND_CONTRAST", ["theme", "text"], source.text, source.background, CONTRAST_NORMAL_TEXT),
    issue("THEME_TEXT_SURFACE_CONTRAST", ["theme", "text"], source.text, source.surface, CONTRAST_NORMAL_TEXT),
    issue("THEME_ACTION_CONTRAST", ["theme", "action"], derived.actionForeground, source.action, CONTRAST_NORMAL_TEXT),
    issue("THEME_FOCUS_CONTRAST", ["theme", "action"], derived.focus, source.background, CONTRAST_GRAPHICAL),
    issue("THEME_FOCUS_SURFACE_CONTRAST", ["theme", "action"], derived.focus, source.surface, CONTRAST_GRAPHICAL),
    issue("THEME_HEADER_CONTRAST", ["theme", "text"], source.text, source.surface, CONTRAST_NORMAL_TEXT),
    issue("THEME_FOOTER_CONTRAST", ["theme", "text"], source.text, source.surface, CONTRAST_NORMAL_TEXT),
  ].filter((candidate): candidate is ShellIssue => candidate !== null);
}

/**
 * The only CSS custom properties the published theme may set. Values come from
 * normalized hex tokens and fixed font enums, so no operator string is ever
 * interpolated into a stylesheet.
 */
export function themeCssVariables(
  source: StorefrontThemeSource,
  derived: DerivedStorefrontTheme = deriveStorefrontTheme(source),
): Record<string, string> {
  const components = componentThemeColors(source, derived);

  return {
    "--color-primary": source.primary,
    "--color-primary-dark": derived.primaryDark,
    "--color-primary-light": derived.primaryLight,
    "--color-background": source.background,
    "--color-card": source.surface,
    "--color-ink": source.text,
    "--color-ink-secondary": derived.textSecondary,
    "--color-ink-muted": derived.textMuted,
    "--color-cta": source.action,
    "--color-cta-hover": derived.actionHover,
    "--color-border": derived.border,
    "--color-focus": derived.focus,
    "--color-disabled": derived.disabled,
    "--color-cta-foreground": derived.actionForeground,
    "--color-footer-background": components.footerBackground,
    "--color-footer-foreground": components.footerForeground,
    "--color-footer-secondary": components.footerSecondary,
    "--color-footer-muted": components.footerMuted,
    "--color-footer-border": components.footerBorder,
    "--color-footer-logo-tile": components.footerLogoTile,
    "--color-footer-logo-square": components.footerLogoSquare,
    "--color-footer-logo-stroke": components.footerLogoStroke,
    "--color-footer-band": components.footerBand,
    "--color-footer-band-ink": components.footerBandInk,
    "--color-footer-band-soft": components.footerBandSoft,
    "--color-newsletter-overlay": components.newsletterOverlay,
    "--color-newsletter-surface": components.newsletterSurface,
    "--color-newsletter-surface-alt": components.newsletterSurfaceAlt,
    "--color-newsletter-card": components.newsletterCard,
    "--color-newsletter-text": components.newsletterText,
    "--color-newsletter-secondary": components.newsletterSecondary,
    "--color-newsletter-muted": components.newsletterMuted,
    "--color-newsletter-accent": components.newsletterAccent,
    "--color-newsletter-accent-hover": components.newsletterAccentHover,
    "--color-newsletter-border": components.newsletterBorder,
    "--color-newsletter-ticket": components.newsletterTicket,
    "--color-newsletter-foreground": components.newsletterForeground,
  };
}

/** Fixed, source-code-only font stacks. No remote or uploaded fonts. */
export const FONT_STACKS = {
  SYSTEM: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  SERIF_HEADING: "ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif",
  POPPINS_HEADING: "var(--font-poppins), ui-sans-serif, system-ui, sans-serif",
} as const;

const SAFE_CSS_VALUE = /^#[0-9a-f]{6}$|^[a-zA-Z0-9\s,'"()-]+$/;

function serializeThemeDeclarations(
  source: StorefrontThemeSource,
  derived: DerivedStorefrontTheme,
): string {
  return Object.entries(themeCssVariables(source, derived))
    .map(([property, value]) => {
      if (!SAFE_CSS_VALUE.test(value)) {
        throw new Error(`Unsafe theme value for ${property}`);
      }
      return `${property}: ${value};`;
    })
    .join("");
}

/**
 * Serializes the theme into a `<style>` payload. Only known keys and
 * validated values are emitted, so `</style>` or an unknown key cannot escape
 * the declaration block.
 */
export function serializeStorefrontThemeCss(
  selector: string,
  source: StorefrontThemeSource,
  derived: DerivedStorefrontTheme = deriveStorefrontTheme(source),
): string {
  if (!/^:where\([a-z0-9._#\- ]+\)$|^:root$/.test(selector)) {
    throw new Error(`Unsafe theme selector: ${selector}`);
  }
  const declarations = serializeThemeDeclarations(source, derived);

  const headingStack = FONT_STACKS[source.headingFont];
  const bodyStack = FONT_STACKS[source.bodyFont];
  const typography =
    `${selector} { font-family: ${bodyStack}; }` +
    `${selector} :where(h1, h2, h3, h4, h5, h6) { font-family: ${headingStack}; }`;

  return `${selector} { ${declarations} }${typography}`;
}

/**
 * Public storefront style: color variables live on :root so body-portaled
 * shopper overlays inherit them, while typography is constrained to the
 * storefront segment and cannot leak into admin routes.
 */
export function serializePublishedStorefrontThemeCss(
  source: StorefrontThemeSource,
  derived: DerivedStorefrontTheme = deriveStorefrontTheme(source),
): string {
  const declarations = serializeThemeDeclarations(source, derived);
  const bodyStack = FONT_STACKS[source.bodyFont];
  const headingStack = FONT_STACKS[source.headingFont];

  return (
    `:root { ${declarations} }` +
    `:where(.storefront-app) { font-family: ${bodyStack}; }` +
    `:where(.storefront-app) :where(h1, h2, h3, h4, h5, h6) { font-family: ${headingStack}; }`
  );
}
