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
const OPTIONAL_PROPERTIES = {
  size: "font-size",
  weight: "font-weight",
  lh: "line-height",
  ls: "letter-spacing",
  color: "color",
  maxw: "max-width",
} as const;

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

function inRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function allowedWeight(
  value: unknown,
): value is (typeof ALLOWED_WEIGHTS)[number] {
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
): { variables: Declaration[]; typography: string[] } {
  const { style, layout } = effectiveElementStyle(slide, key, device);
  const variables: Declaration[] = [];
  const typography: string[] = [];

  function optional(suffix: keyof typeof OPTIONAL_PROPERTIES, value: string) {
    variables.push(`--el-${key}-${suffix}: ${value};`);
    typography.push(
      `${OPTIONAL_PROPERTIES[suffix]}: var(--el-${key}-${suffix});`,
    );
  }

  if (inRange(layout.xPct, 0, 100)) {
    variables.push(`--el-${key}-x: ${cssNumber(layout.xPct)}%;`);
  }
  if (inRange(layout.yPct, 0, 100)) {
    variables.push(`--el-${key}-y: ${cssNumber(layout.yPct)}%;`);
  }
  if (inRange(layout.widthPct, 5, 100)) {
    variables.push(`--el-${key}-w: ${cssNumber(layout.widthPct)}%;`);
  }
  if (inRange(style.fontSize, 8, 200)) {
    optional("size", `${cssNumber(style.fontSize)}px`);
  }
  if (allowedWeight(style.fontWeight)) {
    optional("weight", cssNumber(style.fontWeight));
  }
  if (inRange(style.lineHeight, 0.8, 3)) {
    optional("lh", cssNumber(style.lineHeight));
  }
  if (inRange(style.letterSpacing, -5, 20)) {
    optional("ls", `${cssNumber(style.letterSpacing)}px`);
  }
  if (isHex(style.textColor)) {
    optional("color", safeHex(style.textColor, SAFE_HEX_FALLBACK));
  }

  const align = safeAlign(style.textAlign) ?? safeAlign(layout.align);
  if (align !== null) {
    variables.push(`--el-${key}-align: ${align};`);
  }
  if (inRange(style.maxWidthPct, 5, 100)) {
    optional("maxw", `${cssNumber(style.maxWidthPct)}%`);
  }

  return { variables, typography };
}

function slideSelector(sectionId: string, slideId: string): string {
  return `#hp-hero-${sectionId} [data-slide="${slideId}"]`;
}

function renderSlideBlock(
  sectionId: string,
  slide: HeroSlide,
  device: Device,
): { variables: string; typography: string } {
  const variables: string[] = [];
  const typography: string[] = [];
  const selector = slideSelector(sectionId, slide.id);
  const media = slide.media;
  const fit = (device === "desktop" ? undefined : media?.fitOverrides?.[device]) ?? media?.fit;
  const position = media?.objectPosition?.[device] ?? media?.focal;
  variables.push(`--hp-media-fit: ${fit === "CONTAIN" ? "contain" : "cover"};`);
  variables.push(`--hp-media-position: ${inRange(position?.x, 0, 100) ? cssNumber(position.x) : "50"}% ${inRange(position?.y, 0, 100) ? cssNumber(position.y) : "50"}%;`);
  const overlay = { ...slide.overlay, ...(device === "desktop" ? {} : slide.overlay?.overrides?.[device]) };
  variables.push(`--hp-overlay: ${overlayCss(overlay)};`);
  if (overlay.gradient === "LOCAL") {
    typography.push(`${selector} [data-hero-overlay] { left: var(--hp-copy-left, 0px); top: var(--hp-copy-top, 0px); right: auto; bottom: auto; width: var(--hp-copy-width, 100%); height: var(--hp-copy-height, 100%); mask-image: linear-gradient(to right, transparent, black 8%, black 92%, transparent); }`);
  } else {
    typography.push(`${selector} [data-hero-overlay] { inset: 0; width: auto; height: auto; mask-image: none; }`);
  }
  for (const key of ELEMENT_KEYS) {
    const declarations = declarationsFor(slide, key, device);
    variables.push(...declarations.variables);
    if (declarations.typography.length > 0) {
      typography.push(
        `${selector} [data-hero-element="${key}"] {`,
        ...declarations.typography.map((declaration) => `  ${declaration}`),
        "}",
      );
    }
  }
  return {
    variables: [
      `${selector} {`,
      ...variables.map((declaration) => `  ${declaration}`),
      "}",
    ].join("\n"),
    typography: typography.join("\n"),
  };
}

function renderMediaBlock(query: string, blocks: string[]): string {
  const indented = blocks
    .filter(Boolean)
    .join("\n")
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
  return [`@media ${query} {`, indented, "}"].join("\n");
}

/**
 * Compile hero element values into SSR-safe, section/slide-scoped CSS.
 * Variables cascade mobile-first; optional typography uses exclusive ranges so
 * absent effective values leave the element's class defaults in the cascade.
 *
 * Also emits the section-scoped container height as `--hp-hero-height` (.Task 19,
 * spec §6.1): mobile/tablet default to the 4:5 portrait calc, desktop swaps to
 * the clamp formula. The HeroSlider root reads `height: var(--hp-hero-height)`
 * so the canvas can override the variable and the storefront keeps one source.
 */
function readableHeroCss(scope: string, payload: HeroPayload, device: Device): string {
  const display = payload.display;
  const automatic = ((device === "desktop" ? undefined : display?.overrides?.[device]?.contentLayout) ?? display?.contentLayout) === "AUTO";
  const mode = (device === "desktop" ? undefined : display?.overrides?.[device]?.heightMode) ?? display?.heightMode ?? (automatic ? "BANNER" : undefined);
  if (mode !== "SCREEN" && mode !== "BANNER" && mode !== "NATURAL") return "";
  const minimum = mode === "SCREEN" ? "100svh" : mode === "NATURAL"
    ? (device === "desktop" ? "clamp(560px, 72vh, 720px)" : "calc(100vw * 1.25)")
    : device === "mobile" ? "clamp(360px, 62svh, 500px)" : device === "tablet" ? "clamp(400px, 64svh, 600px)" : "clamp(420px, 62svh, 640px)";
  return [
    ...(automatic ? [`${scope} { --hp-auto-flow: 1; }`] : []),
    `${scope} { height: auto !important; min-height: ${minimum}; width: calc(100% - var(--hp-section-gutters, 0px)); }`,
    `${scope}:not([data-readable-ready]) > [data-slide] { position: relative !important; min-height: ${minimum}; padding: 16px 0; transform: none !important; }`,
    `${scope}:not([data-readable-ready]) > [data-slide][aria-hidden="true"] { display: none; }`,
    `${scope}:not([data-readable-ready]) [data-hero-element] { position: relative !important; left: auto !important; top: auto !important; margin: 12px 16px; width: calc(100% - 32px) !important; max-width: calc(100% - 32px); }`,
    `${scope}[data-readable-ready] { height: var(--hp-readable-height) !important; min-height: 0; }`,
    `${scope}[data-readable-ready] [data-hero-element] { margin: 0; left: var(--hp-safe-x) !important; top: var(--hp-safe-y) !important; width: var(--hp-safe-w) !important; min-width: var(--hp-safe-min-w, min-content); }`,
    // Measure readable words first, then clamp and wrap at the viewport's safe width.
    `${scope}[data-readable-ready] [data-hero-element^="cta"] { min-width: var(--hp-safe-min-w, fit-content); }`,
    `${scope} [data-hero-element] { overflow-wrap: break-word; }`,
    `${scope} [data-hero-element]:empty { display: none; }`,
    `${scope} [data-hero-element^="cta"] > :is(a, span) { min-height: 44px; max-width: 100%; white-space: normal; overflow-wrap: anywhere; }`,
  ].join("\n");
}

export function heroCss(sectionId: string, payload: HeroPayload, previewDevice?: Device): string {
  if (!isUuid(sectionId) || !payload || !Array.isArray(payload.slides)) {
    return "";
  }

  const slides = payload.slides.filter(
    (slide): slide is HeroSlide =>
      Boolean(slide) && typeof slide === "object" && isUuid(slide.id),
  );
  if (slides.length === 0) return "";

  const mobile = slides.map((slide) =>
    renderSlideBlock(sectionId, slide, "mobile"),
  );
  const tablet = slides.map((slide) =>
    renderSlideBlock(sectionId, slide, "tablet"),
  );
  const desktop = slides.map((slide) =>
    renderSlideBlock(sectionId, slide, "desktop"),
  );

  const heightScope = `#hp-hero-${sectionId}`;
  const mediaCss = `${heightScope} :is([data-hero-media], [data-hero-mobile-media]) :is(img, video) { object-fit: var(--hp-media-fit) !important; object-position: var(--hp-media-position) !important; }\n${heightScope} [data-hero-overlay] { background-image: var(--hp-overlay) !important; }`;
  if (previewDevice) {
    const blocks = slides.map((slide) => renderSlideBlock(sectionId, slide, previewDevice));
    const mediaVisibility = slides.map((slide) => {
      const mobile = slide.media?.mobileOverride;
      const useMobile = previewDevice === "mobile" && mobile?.enabled && Boolean(mobile.image || mobile.video);
      const scope = slideSelector(sectionId, slide.id);
      return `${scope} [data-hero-media] { display: ${useMobile ? "none" : "block"}; }\n${scope} [data-hero-mobile-media] { display: ${useMobile ? "block" : "none"}; }`;
    });
    return [
      `${heightScope} { --hp-hero-height: ${previewDevice === "desktop" ? "clamp(560px, 72vh, 720px)" : "calc(100vw * 1.25)"}; height: var(--hp-hero-height); }`,
      ...blocks.flatMap((block) => [block.variables, block.typography]), mediaCss,
      ...mediaVisibility, readableHeroCss(heightScope, payload, previewDevice),
    ].join("\n");
  }
  return [
    `${heightScope} {\n  --hp-hero-height: calc(100vw * 1.25);\n  height: var(--hp-hero-height);\n}`,
    ...mobile.map((block) => block.variables),
    renderMediaBlock(
      "(min-width: 768px)",
      tablet.map((block) => block.variables),
    ),
    renderMediaBlock(
      "(max-width: 767.98px)",
      mobile.map((block) => block.typography),
    ),
    renderMediaBlock(
      "(min-width: 768px) and (max-width: 1023.98px)",
      tablet.map((block) => block.typography),
    ),
    renderMediaBlock("(min-width: 1024px)", [
      `${heightScope} {\n  --hp-hero-height: clamp(560px, 72vh, 720px);\n  height: var(--hp-hero-height);\n}`,
      ...desktop.flatMap((block) => [block.variables, block.typography]),
    ]),
    mediaCss,
    renderMediaBlock("(max-width: 767.98px)", [readableHeroCss(heightScope, payload, "mobile")]),
    renderMediaBlock("(min-width: 768px) and (max-width: 1023.98px)", [readableHeroCss(heightScope, payload, "tablet")]),
    renderMediaBlock("(min-width: 1024px)", [readableHeroCss(heightScope, payload, "desktop")]),
  ].join("\n");
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
    textAlign: "var(--el-eyebrow-align)",
  },
  heading: {
    position: "absolute",
    left: "var(--el-heading-x)",
    top: "var(--el-heading-y)",
    width: "var(--el-heading-w)",
    textAlign: "var(--el-heading-align)",
  },
  subheading: {
    position: "absolute",
    left: "var(--el-subheading-x)",
    top: "var(--el-subheading-y)",
    width: "var(--el-subheading-w)",
    textAlign: "var(--el-subheading-align)",
  },
  offer: {
    position: "absolute",
    left: "var(--el-offer-x)",
    top: "var(--el-offer-y)",
    width: "var(--el-offer-w)",
    textAlign: "var(--el-offer-align)",
  },
  ctaPrimary: {
    position: "absolute",
    left: "var(--el-ctaPrimary-x)",
    top: "var(--el-ctaPrimary-y)",
    width: "var(--el-ctaPrimary-w)",
    textAlign: "var(--el-ctaPrimary-align)",
  },
  ctaSecondary: {
    position: "absolute",
    left: "var(--el-ctaSecondary-x)",
    top: "var(--el-ctaSecondary-y)",
    width: "var(--el-ctaSecondary-w)",
    textAlign: "var(--el-ctaSecondary-align)",
  },
  countdown: {
    position: "absolute",
    left: "var(--el-countdown-x)",
    top: "var(--el-countdown-y)",
    width: "var(--el-countdown-w)",
    textAlign: "var(--el-countdown-align)",
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
    case "LOCAL":
      return `linear-gradient(to bottom, ${transparent} 0%, ${opaque} 12%, ${opaque} 88%, ${transparent} 100%)`;
    default:
      return "linear-gradient(rgba(0, 0, 0, 0), rgba(0, 0, 0, 0))";
  }
}
