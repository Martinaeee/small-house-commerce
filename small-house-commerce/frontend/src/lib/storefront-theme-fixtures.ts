import { readFileSync } from "node:fs";
import path from "node:path";
import type { DerivedStorefrontTheme, StorefrontThemeSource } from "./storefront-shell-document";

/**
 * One authoritative fixture set shared with the backend suite so validation and
 * preview cannot drift on colour derivation or contrast boundaries. The JSON
 * lives outside both packages, so it is read from disk rather than imported.
 *
 * Resolved with Vite's build-time `import.meta.dirname` rather than
 * `import.meta.url`: these specs run in the jsdom environment, whose `URL`
 * global is the browser implementation and cannot be handed to
 * `fileURLToPath`.
 */
export type ThemeFixture = {
  name: string;
  source: StorefrontThemeSource;
  expected?: DerivedStorefrontTheme;
};

export function readThemeFixtures(): ThemeFixture[] {
  const fixturePath = path.resolve(
    import.meta.dirname,
    "../../../contracts/storefront-theme-fixtures.json",
  );
  return JSON.parse(readFileSync(fixturePath, "utf8")) as ThemeFixture[];
}

export const themeFixtures = readThemeFixtures();

