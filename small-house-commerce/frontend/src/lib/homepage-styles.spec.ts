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

describe("heroCss", () => {
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
    expect(css).not.toContain("bad\"]");
    expect(css).not.toContain("color: red");
    expect(css.match(/\[data-slide=/g)).toHaveLength(6);
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
});

describe("elementInlineVars", () => {
  it("returns fresh exact CSS properties for heading and CTA keys", () => {
    expect(elementInlineVars("heading")).toEqual({
      position: "absolute",
      left: "var(--el-heading-x)",
      top: "var(--el-heading-y)",
      width: "var(--el-heading-w)",
      fontSize: "var(--el-heading-size)",
      fontWeight: "var(--el-heading-weight)",
      lineHeight: "var(--el-heading-lh)",
      letterSpacing: "var(--el-heading-ls)",
      color: "var(--el-heading-color)",
      textAlign: "var(--el-heading-align)",
      maxWidth: "var(--el-heading-maxw)",
    });
    expect(elementInlineVars("ctaPrimary")).toEqual({
      position: "absolute",
      left: "var(--el-ctaPrimary-x)",
      top: "var(--el-ctaPrimary-y)",
      width: "var(--el-ctaPrimary-w)",
      fontSize: "var(--el-ctaPrimary-size)",
      fontWeight: "var(--el-ctaPrimary-weight)",
      lineHeight: "var(--el-ctaPrimary-lh)",
      letterSpacing: "var(--el-ctaPrimary-ls)",
      color: "var(--el-ctaPrimary-color)",
      textAlign: "var(--el-ctaPrimary-align)",
      maxWidth: "var(--el-ctaPrimary-maxw)",
    });
  });

  it("returns a fresh object and never interpolates an unsafe runtime key", () => {
    const first = elementInlineVars("heading");
    const second = elementInlineVars("heading");
    expect(first).not.toBe(second);
    expect(first).toEqual(second);

    const unsafe = elementInlineVars(
      'heading);color:red;--x:bad' as HeroElementKey,
    );
    expect(JSON.stringify(unsafe)).not.toContain("color:red");
    expect(JSON.stringify(unsafe)).not.toContain("heading);");
  });
});

describe("safeHex", () => {
  it("accepts only six-digit hexadecimal colors and protects an unsafe fallback", () => {
    expect(safeHex("#aBc123", "#000000")).toBe("#aBc123");
    expect(safeHex("#fff", "#123456")).toBe("#123456");
    expect(safeHex("red; background:url(https://attacker.invalid)", "#123456")).toBe(
      "#123456",
    );
    const fallback = safeHex("not-a-color", "red; color: white");
    expect(fallback).toMatch(/^#[0-9a-f]{6}$/i);
    expect(fallback).not.toContain("red");
  });
});

describe("overlayCss", () => {
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
