import type { CSSProperties } from "react";

import {
  effectiveButtonMetrics,
  effectiveElementStyle,
  type HeroCtaKey,
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
const CTA_KEYS = [
  "ctaPrimary",
  "ctaSecondary",
] as const satisfies readonly HeroCtaKey[];
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

const BUTTON_PADDING_FALLBACKS: Record<Device, { x: number; y: number }> = {
  desktop: { x: 24, y: 14 },
  tablet: { x: 20.4, y: 11.9 },
  mobile: { x: 16.8, y: 9.8 },
};

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
): { variables: Declaration[]; typography: string[]; declared: string[] } {
  const { style, layout } = effectiveElementStyle(slide, key, device);
  const variables: Declaration[] = [];
  const typography: string[] = [];
  const declared: string[] = [];

  function optional(suffix: keyof typeof OPTIONAL_PROPERTIES, value: string) {
    declared.push(`--el-${key}-${suffix}`);
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

  return { variables, typography, declared };
}

function slideSelector(sectionId: string, slideId: string): string {
  return `#hp-hero-${sectionId} [data-slide="${slideId}"]`;
}

function renderSlideBlock(
  sectionId: string,
  slide: HeroSlide,
  device: Device,
): { variables: string; typography: string; declared: string[] } {
  const variables: string[] = [];
  const typography: string[] = [];
  const declared = new Set<string>();
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
    for (const name of declarations.declared) declared.add(name);
    variables.push(...declarations.variables);
    if (declarations.typography.length > 0) {
      typography.push(
        `${selector} [data-hero-element="${key}"] {`,
        ...declarations.typography.map((declaration) => `  ${declaration}`),
        "}",
      );
    }
  }
  // Direct-manipulation CTA size: one device-scoped rule per button so the
  // saved width/height/paddings reach both the live anchor and the edit span.
  // `min-height: 0` only appears with an explicit height — buttons without a
  // stored size keep the design's 44/48px tap defaults.
  for (const key of CTA_KEYS) {
    const metrics = effectiveButtonMetrics(slide, key, device);
    const rules = [
      "box-sizing: border-box",
      `padding: ${cssNumber(metrics.paddingY)}px ${cssNumber(metrics.paddingX)}px`,
    ];
    if (
      metrics.widthPx !== null &&
      inRange(metrics.widthPx, 40, 1200)
    ) {
      rules.push(`width: ${cssNumber(metrics.widthPx)}px`);
    }
    if (
      metrics.heightPx !== null &&
      inRange(metrics.heightPx, 24, 400)
    ) {
      rules.push(`height: ${cssNumber(metrics.heightPx)}px`, "min-height: 0");
    }
    typography.push(
      `${selector} [data-hero-element="${key}"] [data-hero-button] { ${rules.join("; ")}; }`,
    );
  }
  return {
    variables: [
      `${selector} {`,
      ...variables.map((declaration) => `  ${declaration}`),
      "}",
    ].join("\n"),
    typography: typography.join("\n"),
    declared: [...declared],
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

function responsiveButtonCss(scope: string, device: Device): string {
  const fallback = BUTTON_PADDING_FALLBACKS[device];
  return `${scope} [data-hero-button] { box-sizing: border-box; padding: var(--hp-hero-button-padding-y-${device}, ${cssNumber(fallback.y)}px) var(--hp-hero-button-padding-x-${device}, ${cssNumber(fallback.x)}px); }`;
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
    // The pseudo-element keeps a 44x44 tap target even after a direct resize
    // makes the visible button smaller (the frame itself stays hit-testable
    // through the anchor's box, pseudo-elements are part of the anchor).
    `${scope} [data-hero-element^="cta"] :is(a, span)[data-hero-button] { position: relative; min-height: 44px; max-width: 100%; white-space: normal; overflow-wrap: anywhere; }`,
    `${scope} [data-hero-element^="cta"] :is(a, span)[data-hero-button]::before { content: ""; position: absolute; left: 50%; top: 50%; width: max(100%, 44px); height: max(100%, 44px); transform: translate(-50%, -50%); }`,
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

  // Custom properties cascade wider-device-ward, so a value only a narrower
  // device declares would otherwise inherit upward (a mobile font-size showing
  // on desktop). Reset those names at the breakpoint where the effective style
  // stops declaring them; the element's `var(--el-…, fallback)` then falls
  // back to its class default exactly as the per-device editor preview does.
  const declaredSets = (blocks: typeof mobile) =>
    blocks.map((block) => new Set(block.declared));
  const mobileDeclared = declaredSets(mobile);
  const tabletDeclared = declaredSets(tablet);
  const resetBlocks = (
    device: typeof mobile,
    lower: Array<Set<string>>,
  ): string[] =>
    slides
      .map((slide, index) => {
        const own = new Set(device[index].declared);
        const names = [...lower[index]].filter((name) => !own.has(name));
        if (names.length === 0) return "";
        return `${slideSelector(sectionId, slide.id)} {\n${names
          .map((name) => `  ${name}: initial;`)
          .join("\n")}\n}`;
      })
      .filter((block) => block !== "");
  const tabletResets = resetBlocks(tablet, mobileDeclared);
  const desktopResets = resetBlocks(
    desktop,
    mobileDeclared.map((set, index) => new Set([...set, ...tabletDeclared[index]])),
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
      responsiveButtonCss(heightScope, previewDevice),
      ...blocks.flatMap((block) => [block.variables, block.typography]), mediaCss,
      ...mediaVisibility, readableHeroCss(heightScope, payload, previewDevice),
    ].join("\n");
  }
  return [
    `${heightScope} {\n  --hp-hero-height: calc(100vw * 1.25);\n  height: var(--hp-hero-height);\n}`,
    responsiveButtonCss(heightScope, "mobile"),
    ...mobile.map((block) => block.variables),
    renderMediaBlock(
      "(min-width: 768px)",
      [...tabletResets, ...tablet.map((block) => block.variables)],
    ),
    renderMediaBlock(
      "(max-width: 767.98px)",
      mobile.map((block) => block.typography),
    ),
    renderMediaBlock(
      "(min-width: 768px) and (max-width: 1023.98px)",
      [
        ...tablet.map((block) => block.typography),
        responsiveButtonCss(heightScope, "tablet"),
      ],
    ),
    renderMediaBlock("(min-width: 1024px)", [
      `${heightScope} {\n  --hp-hero-height: clamp(560px, 72vh, 720px);\n  height: var(--hp-hero-height);\n}`,
      ...desktopResets,
      ...desktop.flatMap((block) => [block.variables, block.typography]),
      responsiveButtonCss(heightScope, "desktop"),
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
