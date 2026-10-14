import { wcagContrast } from "culori";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  deriveStorefrontTheme,
  themeCssVariables,
  themePublicationIssues,
} from "./storefront-theme";
import { themeFixtures } from "./storefront-theme-fixtures";

const current = themeFixtures.find((fixture) => fixture.name === "current-luwag")!;
const blue = themeFixtures.find((fixture) => fixture.name === "high-contrast-blue")!;
const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function storefrontSourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "admin") continue;
      files.push(...storefrontSourceFiles(path));
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !entry.name.includes(".spec.") &&
      !path.includes("/components/admin/")
    ) {
      files.push(path);
    }
  }
  return files;
}

describe("frontend theme derivation matches the shared contract fixtures", () => {
  it("reproduces the exact current-LUWAG derived tokens", () => {
    expect(deriveStorefrontTheme(current.source)).toEqual(current.expected);
  });

  it("reports no publication issues for the current-LUWAG source", () => {
    expect(themePublicationIssues(current.source)).toEqual([]);
  });

  it("reports no publication issues for the high-contrast blue source", () => {
    expect(themePublicationIssues(blue.source)).toEqual([]);
  });

  it("keeps the hover state readable when the action selects a dark foreground", () => {
    const derived = deriveStorefrontTheme({
      ...current.source,
      action: "#5fa046",
    });

    expect(derived.actionForeground).toBe("#222222");
    expect(wcagContrast(derived.actionHover, derived.actionForeground)).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it("uses the same issue code and path as the backend for a low-contrast body text", () => {
    expect(themePublicationIssues({ ...current.source, text: "#cccccc" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "THEME_TEXT_BACKGROUND_CONTRAST", path: ["theme", "text"] }),
      ]),
    );
  });
});

describe("storefront theme component adoption", () => {
  it("derives legacy-equivalent Footer and Newsletter tokens for the current theme", () => {
    expect(themeCssVariables(current.source, current.expected)).toMatchObject({
      "--color-cta-foreground": "#ffffff",
      "--color-footer-background": "#704632",
      "--color-footer-foreground": "#fff8f1",
      "--color-footer-secondary": "#ead7ca",
      "--color-footer-muted": "#d9c2b5",
      "--color-footer-border": "#9b7460",
      "--color-newsletter-overlay": "#2f211b",
      "--color-newsletter-surface": "#fff4ed",
      "--color-newsletter-surface-alt": "#fffaf6",
      "--color-newsletter-accent": "#a85238",
      "--color-newsletter-foreground": "#ffffff",
    });
  });

  it("maps custom Footer and Newsletter surfaces to the validated source pairs", () => {
    const derived = deriveStorefrontTheme(blue.source);

    expect(themeCssVariables(blue.source, derived)).toMatchObject({
      "--color-footer-background": blue.source.action,
      "--color-footer-foreground": derived.actionForeground,
      "--color-newsletter-surface": blue.source.surface,
      "--color-newsletter-text": blue.source.text,
      "--color-newsletter-accent": blue.source.action,
      "--color-newsletter-foreground": derived.actionForeground,
    });
  });

  it("never hard-codes white text on the operator-selected CTA background", () => {
    const offenders = storefrontSourceFiles(srcRoot).flatMap((path) =>
      readFileSync(path, "utf8")
        .split("\n")
        .flatMap((line, index) =>
          line.includes("bg-cta") && line.includes("text-white")
            ? [`${path.slice(srcRoot.length + 1)}:${index + 1}`]
            : [],
        ),
    );

    expect(offenders).toEqual([]);
  });
});
