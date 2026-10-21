import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DerivedStorefrontTheme, StorefrontThemeSource } from './storefront-shell-document.js';

/**
 * One authoritative fixture set shared with the frontend suite so backend
 * validation and frontend preview cannot drift on colour derivation or
 * contrast boundaries. The JSON lives outside both packages, so it is read
 * from disk rather than imported.
 */
export type ThemeFixture = {
  name: string;
  source: StorefrontThemeSource;
  expected?: DerivedStorefrontTheme;
};

const FIXTURES_URL = new URL(
  '../../../../contracts/storefront-theme-fixtures.json',
  import.meta.url,
);

export function readThemeFixtures(): ThemeFixture[] {
  return JSON.parse(readFileSync(fileURLToPath(FIXTURES_URL), 'utf8')) as ThemeFixture[];
}

export const themeFixtures = readThemeFixtures();
