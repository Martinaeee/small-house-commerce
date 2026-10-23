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
  it("gives the Footer a cream surface and a sage newsletter band", () => {
    expect(themeCssVariables(current.source, current.expected)).toMatchObject({
      "--color-cta-foreground": "#ffffff",
      "--color-footer-background": "#f7f2e8",
      "--color-footer-foreground": "#23301f",
      "--color-footer-secondary": "#4c5646",
      "--color-footer-muted": "#6b7263",
      "--color-footer-border": "#d9d2c2",
      "--color-footer-band": "#a9b69b",
      "--color-footer-band-ink": "#23301f",
      "--color-footer-band-soft": "#33412c",
      "--color-newsletter-overlay": "#2f211b",
      "--color-newsletter-surface": "#fff4ed",
      "--color-newsletter-surface-alt": "#fffaf6",
      "--color-newsletter-accent": "#a85238",
      "--color-newsletter-foreground": "#ffffff",
    });
  });

  it("derives the newsletter band from the operator primary for a custom theme", () => {
    const derived = deriveStorefrontTheme(blue.source);

    expect(themeCssVariables(blue.source, derived)).toMatchObject({
      "--color-footer-background": blue.source.action,
      "--color-footer-foreground": derived.actionForeground,
      "--color-footer-band": blue.source.primary,
      "--color-footer-band-ink": derived.actionForeground,
      "--color-footer-band-soft": derived.actionForeground,
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
