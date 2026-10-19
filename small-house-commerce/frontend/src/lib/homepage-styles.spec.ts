import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  emptyDocument,
  type HeroElementKey,
  type HeroPayload,
  type HeroSlide,
} from "@/lib/homepage-document";
import {
  elementInlineVars,
  heroCss,
  overlayCss,
  safeHex,
} from "@/lib/homepage-styles";

const SECTION_ID = "00000000-0000-7000-8000-000000000001";
const SLIDE_ID = "00000000-0000-7000-8000-000000000010";
const TABLET_ID = "00000000-0000-0000-0000-000000000001";
const MOBILE_ID = "00000000-0000-0000-0000-000000000002";
const ELEMENT_KEYS: HeroElementKey[] = [
  "eyebrow",
  "heading",
  "subheading",
  "offer",
  "ctaPrimary",
  "ctaSecondary",
  "countdown",
];

function heroFixture(): { payload: HeroPayload; slide: HeroSlide } {
  const document = emptyDocument();
  const section = document.sections[0];
  if (!section || section.type !== "HERO") throw new Error("missing HERO");
  const slide = section.payload.slides[0];
  if (!slide) throw new Error("missing slide");
  return { payload: section.payload, slide };
}

function cssBlock(css: string, marker: string, nextMarker?: string): string {
  const start = css.indexOf(marker);
  if (start < 0) throw new Error(`missing CSS marker: ${marker}`);
  const end = nextMarker ? css.indexOf(nextMarker, start) : css.length;
  return css.slice(start, end < 0 ? css.length : end);
}

function typographyRules(css: string) {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.append(style);
  try {
    return Array.from(style.sheet!.cssRules).flatMap((rule) => {
      const media = rule instanceof CSSMediaRule ? rule.conditionText : null;
      const rules =
        rule instanceof CSSMediaRule ? Array.from(rule.cssRules) : [rule];
      return rules.flatMap((child) => {
        if (
          !(child instanceof CSSStyleRule) ||
          !child.selectorText.includes("[data-hero-element=")
        ) {
          return [];
        }
        return [
          {
            media,
            selector: child.selectorText,
            declarations: child.style.cssText,
          },
        ];
      });
    });
  } finally {
    style.remove();
  }
}

describe("heroCss", () => {
  it("bounds a local overlay to the measured copy region instead of darkening the whole image", () => {
    const { payload, slide } = heroFixture();
    slide.overlay = { color: "#000000", opacity: .7, gradient: "LOCAL" };
    expect(heroCss(SECTION_ID, payload, "desktop")).toContain("var(--hp-copy-width, 100%)");
    slide.overlay.gradient = "FULL";
    expect(heroCss(SECTION_ID, payload, "desktop")).not.toContain("var(--hp-copy-width, 100%)");
  });
  it("enables auto flow without replacing saved free-position coordinates", () => {
    const { payload, slide } = heroFixture();
    payload.display = { contentLayout: "AUTO" } as NonNullable<HeroPayload["display"]>;
    const css = heroCss(SECTION_ID, payload, "mobile");
    expect(css).toContain("--hp-auto-flow: 1");
    expect(css).toContain("clamp(360px, 62svh, 500px)");
    expect(slide.elements.heading.layout.widthPct).toBe(40);
    payload.display = { contentLayout: "FREE" } as NonNullable<HeroPayload["display"]>;
    expect(heroCss(SECTION_ID, payload, "mobile")).not.toContain("--hp-auto-flow: 1");
  });

  it("uses mobile media fit and focal overrides without applying them to desktop", () => {
    const { payload, slide } = heroFixture();
    slide.media = {
      type: "IMAGE", image: { url: "/uploads/hero.jpg", alt: "Hero" }, video: null,
      mobileOverride: { enabled: false, image: null, video: null },
      fit: "COVER", fitOverrides: { mobile: "CONTAIN" }, focal: { x: 50, y: 50 },
      objectPosition: { desktop: { x: 50, y: 50 }, tablet: null, mobile: { x: 80, y: 20 } },
    };
    const mobile = heroCss(SECTION_ID, payload, "mobile");
    const desktop = heroCss(SECTION_ID, payload, "desktop");
    expect(mobile).toContain("--hp-media-fit: contain;");
    expect(mobile).toContain("--hp-media-position: 80% 20%;");
    expect(desktop).toContain("--hp-media-fit: cover;");
    expect(desktop).not.toContain("--hp-media-fit: contain;");
  });
  it("emits mobile values in the base block and desktop in the min-width:1024 block", () => {
    const { payload, slide } = heroFixture();
    slide.elements.heading.layout.xPct = 12;
    slide.elements.heading.overrides.mobile = {
      layout: { xPct: 31 },
    };
    slide.elements.heading.style = { fontSize: 42 };

    const css = heroCss(SECTION_ID, payload);
    const selector = `#hp-hero-${SECTION_ID} [data-slide="${SLIDE_ID}"]`;
    const base = cssBlock(css, `${selector} {`, "@media (min-width: 768px)");
    const desktop = cssBlock(css, "@media (min-width: 1024px)");

    expect(base).toContain("--el-heading-x: 31%;");
    expect(base).toContain("--el-heading-size: 42px;");
    expect(desktop).toContain("--el-heading-x: 12%;");
    expect(desktop).toContain("--el-heading-size: 42px;");
    expect(css.indexOf("@media (min-width: 768px)")).toBeGreaterThan(
      css.indexOf(selector),
    );
    expect(css.indexOf("@media (min-width: 1024px)")).toBeGreaterThan(
      css.indexOf("@media (min-width: 768px)"),
    );
  });

  it("emits the responsive --hp-hero-height variable (mobile 4:5, desktop clamp)", () => {
    const { payload, slide } = heroFixture();
    slide.elements.heading.layout.xPct = 12;
    const css = heroCss(SECTION_ID, payload);
    const scope = `#hp-hero-${SECTION_ID}`;
    const base = cssBlock(css, `${scope} {`, "@media (min-width: 768px)");
    const desktop = cssBlock(css, "@media (min-width: 1024px)");

    expect(base).toContain("--hp-hero-height: calc(100vw * 1.25);");
    expect(base).toContain("height: var(--hp-hero-height);");
    expect(desktop).toContain(
      "--hp-hero-height: clamp(560px, 72vh, 720px);",
    );
    // the height rules live in the desktop range, not the tablet range
    expect(
      cssBlock(
        css,
        "@media (min-width: 768px) and (max-width: 1023.98px)",
        "@media (min-width: 1024px)",
      ),
    ).not.toContain("clamp(560px, 72vh, 720px)");
  });

  it("lets a mobile override win in the base block while desktop keeps its own value", () => {
    const { payload, slide } = heroFixture();
    slide.elements.heading.layout.xPct = 10;
    slide.elements.heading.overrides.mobile = { layout: { xPct: 90 } };

    const css = heroCss(SECTION_ID, payload);
    const selector = `#hp-hero-${SECTION_ID} [data-slide="${SLIDE_ID}"]`;
    const base = cssBlock(css, `${selector} {`, "@media (min-width: 768px)");
    const desktop = cssBlock(css, "@media (min-width: 1024px)");

    expect(base).toContain("--el-heading-x: 90%;");
    expect(desktop).toContain("--el-heading-x: 10%;");
  });

  it("falls back to desktop values when tablet has no override", () => {
    const { payload, slide } = heroFixture();
    slide.elements.heading.layout.xPct = 17;
    slide.elements.heading.overrides.mobile = { layout: { xPct: 83 } };

    const css = heroCss(SECTION_ID, payload);
    const selector = `#hp-hero-${SECTION_ID} [data-slide="${SLIDE_ID}"]`;
    const tablet = cssBlock(
      css,
      "@media (min-width: 768px)",
      "@media (min-width: 1024px)",
    );

    expect(tablet).toContain("--el-heading-x: 17%;");
    expect(tablet).not.toContain("--el-heading-x: 83%;");
    expect(css).toContain(selector);
  });

  it("emits all fixed element keys with the documented units", () => {
    const { payload, slide } = heroFixture();
    for (const key of ELEMENT_KEYS) {
      slide.elements[key].layout = {
        ...slide.elements[key].layout,
        xPct: 10,
        yPct: 20,
        widthPct: 30,
        align: "CENTER",
      };
      slide.elements[key].style = {
        fontSize: 24,
        fontWeight: 700,
        lineHeight: 1.25,
        letterSpacing: 2,
        textColor: "#aBc123",
        textAlign: "RIGHT",
        maxWidthPct: 55,
      };
    }

    const css = heroCss(SECTION_ID, payload);
    for (const key of ELEMENT_KEYS) {
      expect(css).toContain(`--el-${key}-x: 10%;`);
      expect(css).toContain(`--el-${key}-y: 20%;`);
      expect(css).toContain(`--el-${key}-w: 30%;`);
      expect(css).toContain(`--el-${key}-size: 24px;`);
      expect(css).toContain(`--el-${key}-weight: 700;`);
      expect(css).toContain(`--el-${key}-lh: 1.25;`);
      expect(css).toContain(`--el-${key}-ls: 2px;`);
      expect(css).toContain(`--el-${key}-color: #aBc123;`);
      expect(css).toContain(`--el-${key}-align: right;`);
      expect(css).toContain(`--el-${key}-maxw: 55%;`);
    }
  });

  it("omits absent and invalid optional values while safely falling back for alignment", () => {
    const { payload, slide } = heroFixture();
    slide.elements.heading.layout = {
      ...slide.elements.heading.layout,
      align: "RIGHT",
    };
    slide.elements.heading.style = {
      textAlign: "not-css" as never,
      fontSize: Number.NaN,
      fontWeight: 450 as never,
      lineHeight: Number.POSITIVE_INFINITY,
      letterSpacing: 21,
      textColor: "#fff; background:url(https://attacker.invalid)" as never,
      maxWidthPct: 101,
    };

    const css = heroCss(SECTION_ID, payload);
    const block = cssBlock(
      css,
      `#hp-hero-${SECTION_ID} [data-slide="${SLIDE_ID}"] {`,
      "@media (min-width: 768px)",
    );

    expect(block).toContain("--el-heading-align: right;");
    expect(block).not.toContain("--el-heading-size:");
    expect(block).not.toContain("--el-heading-weight:");
    expect(block).not.toContain("--el-heading-lh:");
    expect(block).not.toContain("--el-heading-ls:");
    expect(block).not.toContain("--el-heading-color:");
    expect(block).not.toContain("--el-heading-maxw:");
    expect(block).not.toContain("attacker.invalid");
  });

  it("rejects non-finite and out-of-range layout values without serializing them", () => {
    const { payload, slide } = heroFixture();
    slide.elements.heading.layout = {
      ...slide.elements.heading.layout,
      xPct: Number.NaN,
      yPct: Number.POSITIVE_INFINITY,
      widthPct: 101,
    };
    slide.elements.heading.style = {
      fontSize: 7,
      lineHeight: 3.1,
      letterSpacing: -5.1,
      maxWidthPct: 4.9,
    };

    const css = heroCss(SECTION_ID, payload);
    const block = cssBlock(
      css,
      `#hp-hero-${SECTION_ID} [data-slide="${SLIDE_ID}"] {`,
      "@media (min-width: 768px)",
    );

    expect(block).not.toContain("--el-heading-x:");
    expect(block).not.toContain("--el-heading-y:");
    expect(block).not.toContain("--el-heading-w:");
    expect(block).not.toContain("--el-heading-size:");
    expect(block).not.toContain("--el-heading-lh:");
    expect(block).not.toContain("--el-heading-ls:");
    expect(block).not.toContain("--el-heading-maxw:");
    expect(block).not.toMatch(/NaN|Infinity/);
  });

  it("emits isolated selectors for valid slides and skips invalid slide IDs", () => {
    const { payload, slide } = heroFixture();
    slide.id = SLIDE_ID;
    const second = structuredClone(slide);
    second.id = TABLET_ID;
    second.elements.heading.text = "second";
    const invalid = structuredClone(slide);
    invalid.id = 'bad"] { color: red } /*' as never;
    invalid.elements.heading.text = "invalid";
    payload.slides = [slide, second, invalid];

    const css = heroCss(SECTION_ID, payload);
    expect(css).toContain(`[data-slide="${SLIDE_ID}"]`);
    expect(css).toContain(`[data-slide="${TABLET_ID}"]`);
    expect(css).not.toContain('bad"]');
    expect(css).not.toContain("color: red");
    expect([...new Set([...css.matchAll(/\[data-slide="([^"]+)"\]/g)].map((match) => match[1]))]).toEqual([SLIDE_ID, TABLET_ID]);
  });

  it("rejects unsafe section IDs but accepts stable zero-version UUIDs", () => {
    const { payload, slide } = heroFixture();
    slide.id = MOBILE_ID;

    expect(heroCss('section"] { color:red } /*', payload)).toBe("");
    const css = heroCss(TABLET_ID, payload);
    expect(css).toContain(`#hp-hero-${TABLET_ID} [data-slide="${MOBILE_ID}"]`);
  });

  it("does not mutate input payload and is deterministic across repeated compilation", () => {
    const { payload } = heroFixture();
    const before = structuredClone(payload);

    const first = heroCss(SECTION_ID, payload);
    const second = heroCss(SECTION_ID, payload);

    expect(payload).toEqual(before);
    expect(second).toBe(first);
  });
  it("emits sparse mobile-only typography only in the mobile range", () => {
    const { payload, slide } = heroFixture();
    slide.elements.heading.overrides.mobile = {
      style: { fontSize: 36, textColor: "#123456", maxWidthPct: 64 },
    };

    const css = heroCss(SECTION_ID, payload);
    const mobile = cssBlock(
      css,
      "@media (max-width: 767.98px)",
      "@media (min-width: 768px) and (max-width: 1023.98px)",
    );
    const tablet = cssBlock(
      css,
      "@media (min-width: 768px) and (max-width: 1023.98px)",
      "@media (min-width: 1024px)",
    );
    const desktop = cssBlock(css, "@media (min-width: 1024px)");
    const elementSelector = '[data-hero-element="heading"]';

    expect(mobile).toContain(elementSelector);
    expect(mobile).toContain("font-size: var(--el-heading-size);");
    expect(mobile).toContain("color: var(--el-heading-color);");
    expect(mobile).toContain("max-width: var(--el-heading-maxw);");
    expect(tablet).not.toContain(elementSelector);
    expect(desktop).not.toContain(elementSelector);
    expect(tablet).not.toContain("font-size: var(--el-heading-size);");
    expect(desktop).not.toContain("font-size: var(--el-heading-size);");
  });

  it("applies a sparse tablet override only through 1023.98px and falls back on desktop", () => {
    const { payload, slide } = heroFixture();
    slide.elements.heading.style = { fontSize: 20 };
    slide.elements.heading.overrides.tablet = {
      style: { fontSize: 30 },
    };

    const css = heroCss(SECTION_ID, payload);
    const tabletVariables = cssBlock(
      css,
      "@media (min-width: 768px)",
      "@media (min-width: 1024px)",
    );
    const desktopVariables = cssBlock(css, "@media (min-width: 1024px)");
    const mobileActual = cssBlock(
      css,
      "@media (max-width: 767.98px)",
      "@media (min-width: 768px) and (max-width: 1023.98px)",
    );
    const tabletActual = cssBlock(
      css,
      "@media (min-width: 768px) and (max-width: 1023.98px)",
      "@media (min-width: 1024px)",
    );
    const elementSelector = '[data-hero-element="heading"]';

    expect(tabletVariables).toContain("--el-heading-size: 30px;");
    expect(desktopVariables).toContain("--el-heading-size: 20px;");
    expect(mobileActual).toContain("font-size: var(--el-heading-size);");
    expect(tabletActual).toContain(elementSelector);
    expect(tabletActual).toContain("font-size: var(--el-heading-size);");
    expect(desktopVariables).toContain("--el-heading-size: 20px;");
  });

  it("maps distinct mobile, tablet, and desktop values to their matching ranges", () => {
    const { payload, slide } = heroFixture();
    slide.elements.heading.style = {
      fontSize: 20,
      textColor: "#202020",
      maxWidthPct: 40,
    };
    slide.elements.heading.overrides.tablet = {
      style: {
        fontSize: 30,
        textColor: "#303030",
        maxWidthPct: 50,
      },
    };
    slide.elements.heading.overrides.mobile = {
      style: {
        fontSize: 40,
        textColor: "#404040",
        maxWidthPct: 60,
      },
    };

    const css = heroCss(SECTION_ID, payload);
    const base = cssBlock(
      css,
      `#hp-hero-${SECTION_ID}`,
      "@media (min-width: 768px)",
    );
    const tablet = cssBlock(
      css,
      "@media (min-width: 768px)",
      "@media (min-width: 1024px)",
    );
    const desktop = cssBlock(
      css,
      "@media (min-width: 1024px)",
      "@media (max-width: 767.98px)",
    );
    const mobileActual = cssBlock(
      css,
      "@media (max-width: 767.98px)",
      "@media (min-width: 768px) and (max-width: 1023.98px)",
    );
    const tabletActual = cssBlock(
      css,
      "@media (min-width: 768px) and (max-width: 1023.98px)",
      "@media (min-width: 1024px)",
    );
    const desktopActual = desktop;

    expect(base).toContain("--el-heading-size: 40px;");
    expect(base).toContain("--el-heading-color: #404040;");
    expect(base).toContain("--el-heading-maxw: 60%;");
    expect(tablet).toContain("--el-heading-size: 30px;");
    expect(tablet).toContain("--el-heading-color: #303030;");
    expect(tablet).toContain("--el-heading-maxw: 50%;");
    expect(desktop).toContain("--el-heading-size: 20px;");
    expect(desktop).toContain("--el-heading-color: #202020;");
    expect(desktop).toContain("--el-heading-maxw: 40%;");
    for (const actual of [mobileActual, tabletActual, desktopActual]) {
      expect(actual).toContain("font-size: var(--el-heading-size);");
      expect(actual).toContain("color: var(--el-heading-color);");
      expect(actual).toContain("max-width: var(--el-heading-maxw);");
    }
  });

  it.each([
    ["mobile", ["(max-width: 767.98px)"]],
    [
      "tablet",
      [
        "(max-width: 767.98px)",
        "(min-width: 768px) and (max-width: 1023.98px)",
      ],
    ],
  ] as const)(
    "scopes sparse %s values to their effective ranges without desktop usage",
    (device, mediaRanges) => {
      const { payload, slide } = heroFixture();
      slide.elements.heading.overrides[device] = {
        style: {
          fontSize: 36,
          fontWeight: 700,
          lineHeight: 1.2,
          letterSpacing: 2,
          textColor: "#123456",
          maxWidthPct: 64,
        },
      };

      // Tablet values intentionally inherit into mobile via effectiveElementStyle.
      expect(typographyRules(heroCss(SECTION_ID, payload))).toEqual(
        mediaRanges.map((media) => ({
          media,
          selector: `#hp-hero-${SECTION_ID} [data-slide="${SLIDE_ID}"] [data-hero-element="heading"]`,
          declarations:
            "font-size: var(--el-heading-size); font-weight: var(--el-heading-weight); line-height: var(--el-heading-lh); letter-spacing: var(--el-heading-ls); color: var(--el-heading-color); max-width: var(--el-heading-maxw);",
        })),
      );
    },
  );

  it("writes present optional values as safe actual properties and skips invalid ones", () => {
    const { payload, slide } = heroFixture();
    slide.elements.heading.style = {
      fontSize: 42,
      fontWeight: 700,
      lineHeight: 1.2,
      letterSpacing: 1,
      textColor: "#aBc123",
      maxWidthPct: 55,
    };
    const validCss = heroCss(SECTION_ID, payload);
    expect(validCss).toContain("font-size: var(--el-heading-size);");
    expect(validCss).toContain("font-weight: var(--el-heading-weight);");
    expect(validCss).toContain("line-height: var(--el-heading-lh);");
    expect(validCss).toContain("letter-spacing: var(--el-heading-ls);");
    expect(validCss).toContain("color: var(--el-heading-color);");
    expect(validCss).toContain("max-width: var(--el-heading-maxw);");

    slide.elements.heading.style = {
      fontSize: Number.NaN,
      fontWeight: 450 as never,
      lineHeight: Number.POSITIVE_INFINITY,
      letterSpacing: 21,
      textColor: "#fff; color:red" as never,
      maxWidthPct: 101,
    };
    const invalidCss = heroCss(SECTION_ID, payload);
    expect(invalidCss).not.toContain("--el-heading-size:");
    expect(invalidCss).not.toContain("--el-heading-weight:");
    expect(invalidCss).not.toContain("--el-heading-lh:");
    expect(invalidCss).not.toContain("--el-heading-ls:");
    expect(invalidCss).not.toContain("--el-heading-color:");
    expect(invalidCss).not.toContain("--el-heading-maxw:");
    expect(invalidCss).not.toContain("font-size: var(--el-heading-size);");
    expect(invalidCss).not.toContain("font-weight: var(--el-heading-weight);");
    expect(invalidCss).not.toContain("line-height: var(--el-heading-lh);");
    expect(invalidCss).not.toContain("letter-spacing: var(--el-heading-ls);");
    expect(invalidCss).not.toContain("color: var(--el-heading-color);");
    expect(invalidCss).not.toContain("max-width: var(--el-heading-maxw);");
  });
});

describe("elementInlineVars", () => {
  it("returns fresh exact CSS properties for heading and CTA keys", () => {
    expect(elementInlineVars("heading")).toEqual({
      position: "absolute",
      left: "var(--el-heading-x)",
      top: "var(--el-heading-y)",
      width: "var(--el-heading-w)",
      textAlign: "var(--el-heading-align)",
    });
    expect(elementInlineVars("ctaPrimary")).toEqual({
      position: "absolute",
      left: "var(--el-ctaPrimary-x)",
      top: "var(--el-ctaPrimary-y)",
      width: "var(--el-ctaPrimary-w)",
      textAlign: "var(--el-ctaPrimary-align)",
    });
    for (const key of ELEMENT_KEYS) {
      expect(elementInlineVars(key)).toEqual({
        position: "absolute",
        left: `var(--el-${key}-x)`,
        top: `var(--el-${key}-y)`,
        width: `var(--el-${key}-w)`,
        textAlign: `var(--el-${key}-align)`,
      });
    }
  });

  it("leaves class typography defaults intact when optional inline vars are absent", () => {
    const style = document.createElement("style");
    style.textContent =
      ".hero-element { font-size: 19px; color: rgb(1, 2, 3); }";
    document.head.append(style);
    const element = document.createElement("div");
    element.className = "hero-element";
    Object.assign(element.style, elementInlineVars("heading"));
    document.body.append(element);

    expect(elementInlineVars("heading")).not.toHaveProperty("fontSize");
    expect(elementInlineVars("heading")).not.toHaveProperty("color");
    expect(getComputedStyle(element).fontSize).toBe("19px");
    expect(getComputedStyle(element).color).toBe("rgb(1, 2, 3)");

    element.remove();
    style.remove();
  });

  it("returns a fresh object and never interpolates an unsafe runtime key", () => {
    const first = elementInlineVars("heading");
    const second = elementInlineVars("heading");
    expect(first).not.toBe(second);
    expect(first).toEqual(second);

    const unsafe = elementInlineVars(
      "heading);color:red;--x:bad" as HeroElementKey,
    );
    expect(JSON.stringify(unsafe)).not.toContain("color:red");
    expect(JSON.stringify(unsafe)).not.toContain("heading);");
  });
});

describe("safeHex", () => {
  it("accepts only six-digit hexadecimal colors and protects an unsafe fallback", () => {
    expect(safeHex("#aBc123", "#000000")).toBe("#aBc123");
    expect(safeHex("#fff", "#123456")).toBe("#123456");
    expect(
      safeHex("red; background:url(https://attacker.invalid)", "#123456"),
    ).toBe("#123456");
    const fallback = safeHex("not-a-color", "red; color: white");
    expect(fallback).toMatch(/^#[0-9a-f]{6}$/i);
    expect(fallback).not.toContain("red");
  });
});

describe("overlayCss", () => {
  it("keeps LOCAL edges transparent and darkens the central readable region", () => {
    expect(overlayCss({ color: "#000000", opacity: 0.65, gradient: "LOCAL" })).toBe(
      "linear-gradient(to bottom, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 0.65) 12%, rgba(0, 0, 0, 0.65) 88%, rgba(0, 0, 0, 0) 100%)",
    );
  });
  it.each(["NONE", "BOTTOM", "FULL"] as const)(
    "returns a deterministic gradient for %s",
    (gradient) => {
      const css = overlayCss({ color: "#123456", opacity: 0.5, gradient });
      expect(css).toMatch(/^linear-gradient\(/);
      expect(css).toContain("18, 52, 86");
      expect(css).not.toContain("undefined");
    },
  );

  it("uses a uniform transparent gradient for NONE", () => {
    expect(
      overlayCss({ color: "#123456", opacity: 0.5, gradient: "NONE" }),
    ).toBe("linear-gradient(rgba(18, 52, 86, 0), rgba(18, 52, 86, 0))");
  });

  it("clamps opacity and rejects non-finite values", () => {
    const low = overlayCss({ color: "#123456", opacity: -4, gradient: "FULL" });
    const high = overlayCss({ color: "#123456", opacity: 4, gradient: "FULL" });
    const nan = overlayCss({
      color: "#123456",
      opacity: Number.NaN,
      gradient: "FULL",
    });
    const infinity = overlayCss({
      color: "#123456",
      opacity: Number.POSITIVE_INFINITY,
      gradient: "FULL",
    });

    expect(low).toContain("rgba(18, 52, 86, 0)");
    expect(high).toContain("rgba(18, 52, 86, 1)");
    expect(nan).toContain("rgba(18, 52, 86, 0)");
    expect(infinity).toContain("rgba(18, 52, 86, 0)");
    expect(`${low}${high}${nan}${infinity}`).not.toMatch(/NaN|Infinity/);
  });

  it("falls back safely for malicious colors and unknown runtime enum values", () => {
    const malicious = overlayCss({
      color: "#123456; background:url(https://attacker.invalid)",
      opacity: 0.4,
      gradient: "FULL",
    } as never);
    const unknown = overlayCss({
      color: "#123456",
      opacity: 0.4,
      gradient: "TOP" as never,
    });

    expect(malicious).toContain("rgba(0, 0, 0, 0.4)");
    expect(malicious).not.toContain("attacker.invalid");
    expect(unknown).toBe("linear-gradient(rgba(0, 0, 0, 0), rgba(0, 0, 0, 0))");
  });
});

describe("SSR constraints", () => {
  it("uses no browser globals or nondeterministic runtime sources", () => {
    const source = readFileSync(
      path.resolve(process.cwd(), "src/lib/homepage-styles.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/\b(?:window|document)\s*[.\[]/);
    expect(source).not.toContain("CSS.escape");
    expect(source).not.toMatch(/Math\.random|Date\.now|crypto\.randomUUID/);
    expect(source).toContain('import type { CSSProperties } from "react"');
  });
});
