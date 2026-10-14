import { formatHex, interpolate, wcagContrast } from 'culori';
import {
  CURRENT_LUWAG_THEME_SOURCE,
  type DerivedStorefrontTheme,
  type ShellIssue,
  type StorefrontThemeSource,
} from './storefront-shell-document.js';

/**
 * Base brand theme derivation (spec §10–§11).
 *
 * Operators pick five source colors and two font presets; every technical
 * state token is derived here so the editor preview and the backend publish
 * gate cannot disagree. The current LUWAG source short-circuits to the exact
 * compile-time tokens, which are hand-tuned values OKLCH interpolation cannot
 * reproduce byte-for-byte; every other source is derived deterministically.
 */

/** The hand-tuned tokens the migration, fallback and first publish must match. */
export const CURRENT_LUWAG_DERIVED_THEME: DerivedStorefrontTheme = {
  primaryDark: '#b8946a',
  primaryLight: '#e8dccb',
  actionHover: '#5a4130',
  textSecondary: '#666666',
  textMuted: '#999999',
  border: '#e8e2d9',
  focus: '#6b4f3a',
  disabled: '#999999',
  actionForeground: '#ffffff',
};

/** Normal-text and focus/graphical contrast floors (spec §11). */
export const CONTRAST_NORMAL_TEXT = 4.5;
export const CONTRAST_GRAPHICAL = 3;

/**
 * OKLCH mix amounts applied to every non-default source. The palette they
 * reproduce is defined by relationship to the source colors, not by the
 * current LUWAG values, so a rebrand keeps the same perceptual structure.
 */
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
  const value = formatHex(interpolate([from, to], 'oklch')(amount));
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

export function deriveStorefrontTheme(source: StorefrontThemeSource): DerivedStorefrontTheme {
  if (isCurrentLuwagSource(source)) return { ...CURRENT_LUWAG_DERIVED_THEME };

  const actionForeground = ['#ffffff', source.text].sort(
    (a, b) => wcagContrast(source.action, b) - wcagContrast(source.action, a),
  )[0];

  return {
    primaryDark: mix(source.primary, '#000000', MIX.primaryDark),
    primaryLight: mix(source.primary, source.background, MIX.primaryLight),
    actionHover: mix(
      source.action,
      actionForeground === '#ffffff' ? '#000000' : '#ffffff',
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

/**
 * Publication-blocking contrast issues (spec §11). Only the pairs the spec
 * names are enforced — primary text, the action label, and the focus ring.
 * Derived muted/secondary text is intentionally low-contrast chrome and is not
 * treated as body copy. The operator's chosen colors are never rewritten.
 */
export function themePublicationIssues(source: StorefrontThemeSource): ShellIssue[] {
  const derived = deriveStorefrontTheme(source);
  const issues = [
    issue('THEME_TEXT_BACKGROUND_CONTRAST', ['theme', 'text'], source.text, source.background, CONTRAST_NORMAL_TEXT),
    issue('THEME_TEXT_SURFACE_CONTRAST', ['theme', 'text'], source.text, source.surface, CONTRAST_NORMAL_TEXT),
    issue('THEME_ACTION_CONTRAST', ['theme', 'action'], derived.actionForeground, source.action, CONTRAST_NORMAL_TEXT),
    issue('THEME_FOCUS_CONTRAST', ['theme', 'action'], derived.focus, source.background, CONTRAST_GRAPHICAL),
    issue('THEME_FOCUS_SURFACE_CONTRAST', ['theme', 'action'], derived.focus, source.surface, CONTRAST_GRAPHICAL),
  ].filter((candidate): candidate is ShellIssue => candidate !== null);

  // Header and Footer surfaces resolve from the same card/background tokens the
  // storefront uses, so their text pairs are enforced here rather than twice.
  const headerFooter = [
    issue('THEME_HEADER_CONTRAST', ['theme', 'text'], source.text, source.surface, CONTRAST_NORMAL_TEXT),
    issue('THEME_FOOTER_CONTRAST', ['theme', 'text'], source.text, source.surface, CONTRAST_NORMAL_TEXT),
  ].filter((candidate): candidate is ShellIssue => candidate !== null);

  return [...issues, ...headerFooter];
}
