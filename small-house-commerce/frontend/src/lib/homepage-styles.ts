import type { CSSProperties } from "react";

import {
  effectiveElementStyle,
  type HeroElementKey,
  type HeroPayload,
  type HeroSlide,
  type SlideOverlay,
} from "./homepage-document";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_RE = /^#[0-9a-f]{6}$/i;
const SAFE_HEX_FALLBACK = "#000000";
const ELEMENT_KEYS = [
  "eyebrow",
  "heading",
  "subheading",
  "offer",
  "ctaPrimary",
  "ctaSecondary",
  "countdown",
] as const satisfies readonly HeroElementKey[];
const ALLOWED_WEIGHTS = [400, 500, 600, 700, 800] as const;

type Device = "desktop" | "tablet" | "mobile";

type Declaration = `--el-${string}: ${string};`;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function isHex(value: unknown): value is string {
  return typeof value === "string" && HEX_RE.test(value);
}

/**
 * Accept only a CSS six-digit hex color. The fallback is checked as well so
 * callers cannot accidentally turn an untrusted fallback into CSS.
 */
export function safeHex(
  value: string | null | undefined,
  fallback: string,
): string {
  const safeFallback = isHex(fallback) ? fallback : SAFE_HEX_FALLBACK;
  return isHex(value) ? value : safeFallback;
}

function inRange(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function allowedWeight(value: unknown): value is (typeof ALLOWED_WEIGHTS)[number] {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    ALLOWED_WEIGHTS.includes(value as (typeof ALLOWED_WEIGHTS)[number])
  );
}

function cssNumber(value: number): string {
  return String(Object.is(value, -0) ? 0 : value);
}

function safeAlign(value: unknown): "left" | "center" | "right" | null {
  switch (value) {
    case "LEFT":
      return "left";
    case "CENTER":
      return "center";
    case "RIGHT":
      return "right";
    default:
      return null;
  }
}

function declarationsFor(
  slide: HeroSlide,
  key: HeroElementKey,
  device: Device,
): Declaration[] {
  const { style, layout } = effectiveElementStyle(slide, key, device);
  const declarations: Declaration[] = [];

  if (inRange(layout.xPct, 0, 100)) {
    declarations.push(`--el-${key}-x: ${cssNumber(layout.xPct)}%;`);
  }
  if (inRange(layout.yPct, 0, 100)) {
    declarations.push(`--el-${key}-y: ${cssNumber(layout.yPct)}%;`);
  }
  if (inRange(layout.widthPct, 5, 100)) {
    declarations.push(`--el-${key}-w: ${cssNumber(layout.widthPct)}%;`);
  }
  if (inRange(style.fontSize, 8, 200)) {
    declarations.push(`--el-${key}-size: ${cssNumber(style.fontSize)}px;`);
  }
  if (allowedWeight(style.fontWeight)) {
    declarations.push(`--el-${key}-weight: ${cssNumber(style.fontWeight)};`);
  }
  if (inRange(style.lineHeight, 0.8, 3)) {
    declarations.push(`--el-${key}-lh: ${cssNumber(style.lineHeight)};`);
  }
  if (inRange(style.letterSpacing, -5, 20)) {
    declarations.push(`--el-${key}-ls: ${cssNumber(style.letterSpacing)}px;`);
  }
  if (isHex(style.textColor)) {
    declarations.push(
      `--el-${key}-color: ${safeHex(style.textColor, SAFE_HEX_FALLBACK)};`,
    );
  }

  const align =
    safeAlign(style.textAlign) ?? safeAlign(layout.align);
  if (align !== null) {
    declarations.push(`--el-${key}-align: ${align};`);
  }
  if (inRange(style.maxWidthPct, 5, 100)) {
    declarations.push(`--el-${key}-maxw: ${cssNumber(style.maxWidthPct)}%;`);
  }

  return declarations;
}

function slideSelector(sectionId: string, slideId: string): string {
  return `#hp-hero-${sectionId} [data-slide="${slideId}"]`;
}

function renderSlideBlock(
  sectionId: string,
  slide: HeroSlide,
  device: Device,
): string {
  const declarations = ELEMENT_KEYS.flatMap((key) =>
    declarationsFor(slide, key, device),
  );
  const selector = slideSelector(sectionId, slide.id);
  return [
    `${selector} {`,
    ...declarations.map((declaration) => `  ${declaration}`),
    "}",
  ].join("\n");
}

function renderMediaBlock(
  query: string,
  sectionId: string,
  slides: readonly HeroSlide[],
  device: Device,
): string {
  const blocks = slides
    .map((slide) => renderSlideBlock(sectionId, slide, device))
    .join("\n");
  const indented = blocks
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
  return [`@media (min-width: ${query}) {`, indented, "}"].join("\n");
}

/**
 * Compile hero element values into SSR-safe, section/slide-scoped CSS.
 * The base cascade is mobile-first, then tablet and desktop overrides.
 */
export function heroCss(sectionId: string, payload: HeroPayload): string {
  if (!isUuid(sectionId) || !payload || !Array.isArray(payload.slides)) {
    return "";
  }

  const slides = payload.slides.filter(
    (slide): slide is HeroSlide =>
      Boolean(slide) && typeof slide === "object" && isUuid(slide.id),
  );
  if (slides.length === 0) return "";

  const base = slides
    .map((slide) => renderSlideBlock(sectionId, slide, "mobile"))
    .join("\n");
  const tablet = renderMediaBlock("768px", sectionId, slides, "tablet");
  const desktop = renderMediaBlock("1024px", sectionId, slides, "desktop");

  return [base, tablet, desktop].join("\n");
}

type InlineVars = Omit<CSSProperties, "textAlign"> & {
  textAlign?: string;
};

const INLINE_VARS: Record<HeroElementKey, InlineVars> = {
  eyebrow: {
    position: "absolute",
    left: "var(--el-eyebrow-x)",
    top: "var(--el-eyebrow-y)",
    width: "var(--el-eyebrow-w)",
    fontSize: "var(--el-eyebrow-size)",
    fontWeight: "var(--el-eyebrow-weight)",
    lineHeight: "var(--el-eyebrow-lh)",
    letterSpacing: "var(--el-eyebrow-ls)",
    color: "var(--el-eyebrow-color)",
    textAlign: "var(--el-eyebrow-align)",
    maxWidth: "var(--el-eyebrow-maxw)",
  },
  heading: {
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
  },
  subheading: {
    position: "absolute",
    left: "var(--el-subheading-x)",
    top: "var(--el-subheading-y)",
    width: "var(--el-subheading-w)",
    fontSize: "var(--el-subheading-size)",
    fontWeight: "var(--el-subheading-weight)",
    lineHeight: "var(--el-subheading-lh)",
    letterSpacing: "var(--el-subheading-ls)",
    color: "var(--el-subheading-color)",
    textAlign: "var(--el-subheading-align)",
    maxWidth: "var(--el-subheading-maxw)",
  },
  offer: {
    position: "absolute",
    left: "var(--el-offer-x)",
    top: "var(--el-offer-y)",
    width: "var(--el-offer-w)",
    fontSize: "var(--el-offer-size)",
    fontWeight: "var(--el-offer-weight)",
    lineHeight: "var(--el-offer-lh)",
    letterSpacing: "var(--el-offer-ls)",
    color: "var(--el-offer-color)",
    textAlign: "var(--el-offer-align)",
    maxWidth: "var(--el-offer-maxw)",
  },
  ctaPrimary: {
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
  },
  ctaSecondary: {
    position: "absolute",
    left: "var(--el-ctaSecondary-x)",
    top: "var(--el-ctaSecondary-y)",
    width: "var(--el-ctaSecondary-w)",
    fontSize: "var(--el-ctaSecondary-size)",
    fontWeight: "var(--el-ctaSecondary-weight)",
    lineHeight: "var(--el-ctaSecondary-lh)",
    letterSpacing: "var(--el-ctaSecondary-ls)",
    color: "var(--el-ctaSecondary-color)",
    textAlign: "var(--el-ctaSecondary-align)",
    maxWidth: "var(--el-ctaSecondary-maxw)",
  },
  countdown: {
    position: "absolute",
    left: "var(--el-countdown-x)",
    top: "var(--el-countdown-y)",
    width: "var(--el-countdown-w)",
    fontSize: "var(--el-countdown-size)",
    fontWeight: "var(--el-countdown-weight)",
    lineHeight: "var(--el-countdown-lh)",
    letterSpacing: "var(--el-countdown-ls)",
    color: "var(--el-countdown-color)",
    textAlign: "var(--el-countdown-align)",
    maxWidth: "var(--el-countdown-maxw)",
  },
};

/** Return a fresh inline style object for a fixed, trusted element key. */
export function elementInlineVars(key: HeroElementKey): CSSProperties {
  if (!Object.prototype.hasOwnProperty.call(INLINE_VARS, key)) {
    return { position: "absolute" };
  }
  return { ...INLINE_VARS[key] } as CSSProperties;
}

function clampedOpacity(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function rgba(hex: string, opacity: number): string {
  const red = Number.parseInt(hex.slice(1, 3), 16);
  const green = Number.parseInt(hex.slice(3, 5), 16);
  const blue = Number.parseInt(hex.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${cssNumber(opacity)})`;
}

/** Compile only the whitelisted overlay variants into a safe gradient. */
export function overlayCss(overlay: SlideOverlay): string {
  const input = overlay as Partial<SlideOverlay> | null | undefined;
  const color = safeHex(input?.color, SAFE_HEX_FALLBACK);
  const opacity = clampedOpacity(input?.opacity);
  const opaque = rgba(color, opacity);
  const transparent = rgba(color, 0);

  switch (input?.gradient) {
    case "NONE":
      return `linear-gradient(${transparent}, ${transparent})`;
    case "BOTTOM":
      return `linear-gradient(to top, ${opaque}, ${transparent})`;
    case "FULL":
      return `linear-gradient(${opaque}, ${opaque})`;
    default:
      return "linear-gradient(rgba(0, 0, 0, 0), rgba(0, 0, 0, 0))";
  }
}
