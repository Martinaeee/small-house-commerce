import { describe, expect, it } from "vitest";
import {
  createCurrentLuwagShellDocument,
  normalizeStorefrontShellDocument,
  storefrontShellDocumentSchemaParse,
  type StorefrontShellDocument,
} from "./storefront-shell-document";
import {
  deriveStorefrontTheme,
  serializeStorefrontThemeCss,
  themeCssVariables,
  themePublicationIssues,
} from "./storefront-theme";
import { themeFixtures } from "./storefront-theme-fixtures";

const current = themeFixtures.find((fixture) => fixture.name === "current-luwag")!;
const blue = themeFixtures.find((fixture) => fixture.name === "high-contrast-blue")!;

function validDocument(): StorefrontShellDocument {
  return createCurrentLuwagShellDocument({
    rootCategories: [
      { id: "00000000-0000-7000-8000-000000000101", name: "Living", sortOrder: 10 },
      { id: "00000000-0000-7000-8000-000000000102", name: "Bedroom", sortOrder: 20 },
    ],
    navigationCollections: [
      { id: "00000000-0000-7000-8000-000000000201", name: "New Arrivals", slug: "new-arrivals", sortOrder: 0 },
      { id: "00000000-0000-7000-8000-000000000202", name: "Solutions", slug: "small-space-solutions", sortOrder: 50 },
      { id: "00000000-0000-7000-8000-000000000203", name: "Best Sellers", slug: "best-sellers", sortOrder: 60 },
    ],
    supportEmail: "support@luwag.ph",
    supportHours: "Mon–Sat, 9am–6pm (PHT)",
  });
}

describe("storefrontShellDocumentSchemaParse", () => {
  it("accepts a complete current-LUWAG document", () => {
    expect(storefrontShellDocumentSchemaParse(validDocument()).success).toBe(true);
  });

  it("rejects a CSS fragment smuggled into a theme color", () => {
    const doc = validDocument();
    expect(
      storefrontShellDocumentSchemaParse({ ...doc, theme: { ...doc.theme, primary: "red;--x:1" } }).success,
    ).toBe(false);
  });

  it("rejects a remote font URL in a font preset slot", () => {
    const doc = validDocument();
    expect(
      storefrontShellDocumentSchemaParse({
        ...doc,
        theme: { ...doc.theme, headingFont: "https://fonts.example/x" },
      }).success,
    ).toBe(false);
  });

  it("rejects a protocol-relative internal path", () => {
    const doc = validDocument();
    expect(
      storefrontShellDocumentSchemaParse({
        ...doc,
        header: {
          items: [
            {
              id: "row-1",
              kind: "STRUCTURED_LINK",
              label: "Bad",
              enabled: true,
              link: { type: "INTERNAL", path: "//evil.test/x" },
            },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it("rejects external links that are not credential-free https", () => {
    const doc = validDocument();
    for (const url of ["http://luwag.ph/x", "javascript:alert(1)", "https://user:pass@luwag.ph/x"]) {
      expect(
        storefrontShellDocumentSchemaParse({
          ...doc,
          header: {
            items: [
              { id: "row-1", kind: "STRUCTURED_LINK", label: "Bad", enabled: true, link: { type: "EXTERNAL", url } },
            ],
          },
        }).success,
      ).toBe(false);
    }
  });

  it("rejects unknown keys instead of silently accepting them", () => {
    const doc = validDocument();
    expect(
      storefrontShellDocumentSchemaParse({
        ...doc,
        theme: { ...doc.theme, derivedTheme: { primaryDark: "#000000" } },
      }).success,
    ).toBe(false);
  });
});

describe("normalizeStorefrontShellDocument", () => {
  it("trims strings and lowercases hex values while preserving ids and order", () => {
    const doc = validDocument();
    const normalized = normalizeStorefrontShellDocument({
      ...doc,
      brand: { ...doc.brand, brandName: "  LUWAG  " },
      theme: { ...doc.theme, primary: "#C9A77B" },
    });

    expect(normalized.brand.brandName).toBe("LUWAG");
    expect(normalized.theme.primary).toBe("#c9a77b");
    expect(normalized.header.items.map((item) => item.id)).toEqual(doc.header.items.map((item) => item.id));
  });

  it("keeps an incomplete empty label in a draft rather than dropping the row", () => {
    const doc = validDocument();
    const normalized = normalizeStorefrontShellDocument({
      ...doc,
      header: {
        items: [
          { id: "row-1", kind: "COLLECTION", targetId: "00000000-0000-7000-8000-000000000201", labelOverride: "", enabled: true },
        ],
      },
    });

    expect(normalized.header.items).toHaveLength(1);
    expect(normalized.header.items[0]).toMatchObject({ labelOverride: "" });
  });

  it("does not silently cap an over-limit shape", () => {
    const doc = validDocument();
    expect(() =>
      normalizeStorefrontShellDocument({
        ...doc,
        footer: {
          ...doc.footer,
          columns: Array.from({ length: 6 }, (_, index) => ({
            id: `column-${index}`,
            kind: "LINKS",
            title: `Column ${index}`,
            rows: [],
          })),
        },
      }),
    ).toThrow();
  });
});

describe("deriveStorefrontTheme", () => {
  it("returns the exact compile-time LUWAG tokens for the current source", () => {
    expect(deriveStorefrontTheme(current.source)).toEqual(current.expected);
  });

  it("derives deterministic sRGB tokens for a custom source", () => {
    const first = deriveStorefrontTheme(blue.source);
    expect(first).toEqual(deriveStorefrontTheme(blue.source));
    for (const value of Object.values(first)) {
      expect(value).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("picks the higher-contrast foreground for the action color", () => {
    expect(deriveStorefrontTheme(current.source).actionForeground).toBe("#ffffff");
    expect(deriveStorefrontTheme({ ...current.source, action: "#fff8ee" }).actionForeground).toBe("#1f2a24");
  });
});

describe("themePublicationIssues", () => {
  it("accepts the current LUWAG and high-contrast blue sources", () => {
    expect(themePublicationIssues(current.source)).toEqual([]);
    expect(themePublicationIssues(blue.source)).toEqual([]);
  });

  it("flags low-contrast body text against the page background", () => {
    expect(themePublicationIssues({ ...current.source, text: "#cccccc" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "THEME_TEXT_BACKGROUND_CONTRAST", path: ["theme", "text"] }),
      ]),
    );
  });

  it("flags an action color whose label cannot reach 4.5:1 with either candidate foreground", () => {
    expect(themePublicationIssues({ ...current.source, action: "#808080" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "THEME_ACTION_CONTRAST", path: ["theme", "action"] }),
      ]),
    );
  });

  it("flags a focus ring that disappears into the page background", () => {
    expect(
      themePublicationIssues({ ...current.source, action: "#fdfcfa", background: "#faf8f5" }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "THEME_FOCUS_CONTRAST", path: ["theme", "action"] }),
      ]),
    );
  });

  it("never rewrites the operator source colors", () => {
    const source = { ...current.source, text: "#cccccc" };
    themePublicationIssues(source);
    expect(source.text).toBe("#cccccc");
  });
});

describe("themeCssVariables", () => {
  it("maps only the fixed token set", () => {
    expect(Object.keys(themeCssVariables(current.source)).sort()).toEqual(
      [
        "--color-primary",
        "--color-primary-dark",
        "--color-primary-light",
        "--color-background",
        "--color-card",
        "--color-ink",
        "--color-ink-secondary",
        "--color-ink-muted",
        "--color-cta",
        "--color-cta-hover",
        "--color-border",
        "--color-focus",
        "--color-disabled",
        "--color-cta-foreground",
        "--color-footer-background",
        "--color-footer-foreground",
        "--color-footer-secondary",
        "--color-footer-muted",
        "--color-footer-border",
        "--color-footer-logo-tile",
        "--color-footer-logo-square",
        "--color-footer-logo-stroke",
        "--color-footer-band",
        "--color-footer-band-ink",
        "--color-footer-band-soft",
        "--color-newsletter-overlay",
        "--color-newsletter-surface",
        "--color-newsletter-surface-alt",
        "--color-newsletter-card",
        "--color-newsletter-text",
        "--color-newsletter-secondary",
        "--color-newsletter-muted",
        "--color-newsletter-accent",
        "--color-newsletter-accent-hover",
        "--color-newsletter-border",
        "--color-newsletter-ticket",
        "--color-newsletter-foreground",
      ].sort(),
    );
  });
});

describe("serializeStorefrontThemeCss", () => {
  it("emits zero-specificity typography so explicit utilities still win", () => {
    const css = serializeStorefrontThemeCss(":where(.storefront-app)", current.source);

    expect(css).toContain(":where(.storefront-app) {");
    expect(css).toContain(":where(.storefront-app) :where(h1, h2, h3, h4, h5, h6) {");
  });

  it("cannot be escaped by a hostile selector or value", () => {
    expect(() => serializeStorefrontThemeCss("</style><script>", current.source)).toThrow();
    expect(() =>
      serializeStorefrontThemeCss(":where(.storefront-app)", { ...current.source, primary: "#ffffff" }),
    ).not.toThrow();
  });
});
