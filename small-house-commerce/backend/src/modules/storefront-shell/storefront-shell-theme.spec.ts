import { wcagContrast } from 'culori';
import { describe, expect, it } from 'vitest';
import { deriveStorefrontTheme, themePublicationIssues } from './storefront-shell-theme.js';
import { themeFixtures } from './storefront-shell-theme-fixtures.js';

const current = themeFixtures.find((fixture) => fixture.name === 'current-luwag')!;
const blue = themeFixtures.find((fixture) => fixture.name === 'high-contrast-blue')!;

describe('deriveStorefrontTheme', () => {
  it('returns the exact compile-time LUWAG tokens for the current source', () => {
    expect(deriveStorefrontTheme(current.source)).toEqual(current.expected);
  });

  it('derives deterministic sRGB tokens for a custom source', () => {
    const first = deriveStorefrontTheme(blue.source);
    const second = deriveStorefrontTheme(blue.source);

    expect(first).toEqual(second);
    for (const value of Object.values(first)) {
      expect(value).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('picks the higher-contrast foreground for the action color', () => {
    expect(deriveStorefrontTheme(current.source).actionForeground).toBe('#ffffff');
    expect(deriveStorefrontTheme({ ...current.source, action: '#fff8ee' }).actionForeground).toBe(
      '#222222',
    );
  });

  it('keeps the hover state readable when the action selects a dark foreground', () => {
    const derived = deriveStorefrontTheme({ ...current.source, action: '#5fa046' });

    expect(derived.actionForeground).toBe('#222222');
    expect(wcagContrast(derived.actionHover, derived.actionForeground)).toBeGreaterThanOrEqual(
      4.5,
    );
  });
});

describe('themePublicationIssues', () => {
  it('accepts the current LUWAG source', () => {
    expect(themePublicationIssues(current.source)).toEqual([]);
  });

  it('accepts the high-contrast blue source', () => {
    expect(themePublicationIssues(blue.source)).toEqual([]);
  });

  it('flags low-contrast body text against the page background', () => {
    expect(themePublicationIssues({ ...current.source, text: '#cccccc' })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'THEME_TEXT_BACKGROUND_CONTRAST',
          path: ['theme', 'text'],
        }),
      ]),
    );
  });

  it('reports the measured ratio and the required threshold', () => {
    const [issue] = themePublicationIssues({ ...current.source, text: '#cccccc' }).filter(
      (candidate) => candidate.code === 'THEME_TEXT_BACKGROUND_CONTRAST',
    );

    expect(issue.ratio).toBeLessThan(4.5);
    expect(issue.requiredRatio).toBe(4.5);
  });

  it('flags an action color whose label cannot reach 4.5:1 with either candidate foreground', () => {
    // #808080 sits where neither white (3.95:1) nor the brand text (4.32:1)
    // reaches the normal-text floor, so no derived label can rescue it.
    expect(themePublicationIssues({ ...current.source, action: '#808080' })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'THEME_ACTION_CONTRAST', path: ['theme', 'action'] }),
      ]),
    );
  });

  it('flags a focus ring that disappears into the page background', () => {
    expect(
      themePublicationIssues({ ...current.source, action: '#fdfcfa', background: '#faf8f5' }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'THEME_FOCUS_CONTRAST', path: ['theme', 'action'] }),
      ]),
    );
  });

  it('never rewrites the operator source colors', () => {
    const source = { ...current.source, text: '#cccccc' };
    themePublicationIssues(source);

    expect(source.text).toBe('#cccccc');
  });
});
