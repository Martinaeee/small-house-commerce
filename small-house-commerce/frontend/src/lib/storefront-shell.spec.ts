import { afterEach, describe, expect, it, vi } from "vitest";
import type { Category, Collection } from "./api";
import { STOREFRONT_TAGS } from "./cache-tags";
import { DEFAULT_SITE_SETTINGS } from "./site-settings";
import {
  DEFAULT_PUBLIC_STOREFRONT_SHELL,
  fetchStorefrontShell,
  materializeDefaultStorefrontShell,
  storefrontThemeStyle,
} from "./storefront-shell";
import type { PublicStorefrontShell } from "./storefront-shell-api";

const customShell: PublicStorefrontShell = {
  publishedRevision: 9,
  brand: { brandName: "Roomy Co", horizontalLogo: null, squareMark: null },
  header: {
    items: [{ id: "campaign", kind: "LINK", label: "Campaign", href: "/campaign" }],
  },
  footer: {
    tagline: "Room for real life",
    description: "Flexible furniture for compact homes.",
    columns: [],
    copyrightBrand: "Roomy Co",
  },
  theme: {
    primary: "#315e81",
    action: "#7a351f",
    background: "#f1f2f3",
    surface: "#ffffff",
    text: "#111827",
    headingFont: "POPPINS_HEADING",
    bodyFont: "SYSTEM",
  },
  derivedTheme: {
    primaryDark: "#274b67",
    primaryLight: "#c9d4dd",
    actionHover: "#682d1a",
    textSecondary: "#636a75",
    textMuted: "#93979e",
    border: "#d9dade",
    focus: "#7a351f",
    disabled: "#a3a6ab",
    actionForeground: "#ffffff",
  },
};

const root: Category = {
  id: "living",
  name: "Living Room",
  slug: "living-room",
  imageUrl: null,
  children: [],
};

const collections: Collection[] = [
  {
    id: "new",
    name: "New Arrivals",
    slug: "new-arrivals",
    type: "NAVIGATION",
    description: null,
    heroImage: null,
    sortOrder: 0,
  },
  {
    id: "best",
    name: "Best Sellers",
    slug: "best-sellers",
    type: "NAVIGATION",
    description: null,
    heroImage: null,
    sortOrder: 60,
  },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchStorefrontShell", () => {
  it("fetches, tags and strictly parses the public shell", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(customShell), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchStorefrontShell()).resolves.toEqual(customShell);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/storefront/shell"),
      { next: { revalidate: 300, tags: STOREFRONT_TAGS } },
    );
  });

  it("can bypass the tagged cache for revision-sensitive reads", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(customShell), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchStorefrontShell({ cache: "no-store" }),
    ).resolves.toEqual(customShell);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/storefront/shell"),
      { cache: "no-store" },
    );
  });

  it.each(["network", "non-ok", "malformed"] as const)(
    "returns the exact built-in public fallback for a %s failure",
    async (failure) => {
      const fetchMock = vi.fn();
      if (failure === "network") fetchMock.mockRejectedValue(new Error("offline"));
      if (failure === "non-ok") fetchMock.mockResolvedValue(new Response("down", { status: 503 }));
      if (failure === "malformed") {
        fetchMock.mockResolvedValue(
          new Response(JSON.stringify({ ...customShell, draftDocument: {} }), {
            status: 200,
          }),
        );
      }
      vi.stubGlobal("fetch", fetchMock);

      await expect(fetchStorefrontShell()).resolves.toBe(
        DEFAULT_PUBLIC_STOREFRONT_SHELL,
      );
    },
  );

  it("materializes the fallback with the exact legacy nav and Footer data", () => {
    const fallback = materializeDefaultStorefrontShell(
      DEFAULT_PUBLIC_STOREFRONT_SHELL,
      [root],
      collections,
      {
        ...DEFAULT_SITE_SETTINGS,
        supportEmail: "care@luwag.ph",
        supportHours: "Daily, 9am–7pm",
      },
    );

    expect(fallback.header.items.map((item) => item.label)).toEqual([
      "New Arrivals",
      "Living Room",
      "Best Sellers",
    ]);
    expect(fallback.header.items[1]).toEqual({
      id: root.id,
      kind: "CATEGORY_ROOT",
      categoryId: root.id,
      label: root.name,
    });
    expect(fallback.footer.columns[0]).toMatchObject({
      kind: "LINKS",
      rows: [
        {
          id: "new",
          kind: "LINK",
          label: "New Arrivals",
          href: "/collections/new-arrivals",
        },
        {
          id: "best",
          kind: "LINK",
          label: "Best Sellers",
          href: "/collections/best-sellers",
        },
      ],
    });
    expect(fallback.footer.columns[1]).toMatchObject({
      kind: "CONTACT",
      supportEmail: "care@luwag.ph",
      supportHours: "Daily, 9am–7pm",
    });
    expect(fallback.theme).toEqual(DEFAULT_PUBLIC_STOREFRONT_SHELL.theme);
  });

  it("never rewrites a valid published shell as legacy fallback", () => {
    expect(
      materializeDefaultStorefrontShell(
        customShell,
        [root],
        collections,
        DEFAULT_SITE_SETTINGS,
      ),
    ).toBe(customShell);
  });
});

describe("storefrontThemeStyle", () => {
  it("puts only known color variables on :root so body-portaled overlays inherit them", () => {
    const css = storefrontThemeStyle(customShell);
    const declarations = [...css.matchAll(/(--[a-z-]+)\s*:/g)].map(
      (match) => match[1],
    );

    expect(css).toContain(":root { --color-primary: #315e81;");
    expect(new Set(declarations)).toEqual(
      new Set([
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
      ]),
    );
    expect(css).not.toMatch(
      /--color-(danger|error|warning|success|sale|star)\s*:/,
    );
  });

  it("scopes body and zero-specificity heading presets to storefront content", () => {
    const css = storefrontThemeStyle(customShell);

    expect(css).toContain(
      ":where(.storefront-app) { font-family: ui-sans-serif",
    );
    expect(css).toContain(
      ":where(.storefront-app) :where(h1, h2, h3, h4, h5, h6) { font-family: var(--font-poppins)",
    );
    expect(css).not.toContain(":root :where(h1");
  });
});
