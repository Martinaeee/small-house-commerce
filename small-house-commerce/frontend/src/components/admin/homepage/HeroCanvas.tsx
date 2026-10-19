"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useAdminI18n, type TKey } from "@/lib/admin-i18n";
import {
  useHomepageEditor,
  type BuilderDevice,
} from "@/components/admin/homepage/HomepageEditor";
import {
  clampPct,
  effectiveElementStyle,
  emptyElement,
  resetElementLayout,
  setElementOverride,
  updateHeroElement,
  type ElementLayout,
  type HeroElementKey,
  type HeroSlide,
  type HomepageDocument,
  type HomepageSection,
} from "@/lib/homepage-document";
import { safeHex } from "@/lib/homepage-styles";
import { HeroSlider } from "@/components/home/HeroSlider";

export { HeroSlider };

/**
 * Hero canvas (spec: homepage builder P1, Task 16).
 *
 * Renders the selected slide inside the shell's `DeviceFrame` and turns it into
 * an editable surface: click-to-select, pointer dragging with snapping, keyboard
 * nudging, a floating toolbar and the Task 15 safe-area overlays.
 *
 * Device faithfulness: `heroCss` (Task 10) scopes the `--el-*` variables through
 * viewport media queries, but the editor simulates devices with a frame — not a
 * viewport — so the canvas injects the CURRENT device's effective values as
 * inline custom properties on the stage (read by the tests) AND emits a small
 * override stylesheet after the real `HeroSlider` that re-asserts those values
 * on the slide selector for real-browser rendering. The stylesheet is the
 * authoritative layer (custom-element inheritance loses to the slides' own
 * custom properties); together they keep layout, alignment and typography
 * pinned to the selected device. The override also pins `--hp-hero-height` to
 * 100% so the shared container fills the frame instead of the storefront's
 * viewport-based 4:5 calc. During a drag the dragged element's `-x`/`-y`
 * variables are overridden with the local preview (never committed to the
 * reducer).
 */

/** Element render order; also the Tab cycle order (spec §5.4). */
const ELEMENT_KEYS: readonly HeroElementKey[] = [
  "eyebrow",
  "heading",
  "subheading",
  "offer",
  "ctaPrimary",
  "ctaSecondary",
  "countdown",
];

const SNAP_THRESHOLD_PCT = 1.5;
const KEYBOARD_STEP_PCT = 0.5;
const SHIFT_STEP_PX = 10;
const DEFAULT_TEXT_COLOR = "#292724";

/**
 * Single source of truth for the safe-area geometry (Ruling 3): the overlay
 * drawing and the drag snap-guide list both read this object, so the lines the
 * operator sees are exactly the lines a drag snaps to.
 *
 * Percent values are relative to the canvas frame. The insets were picked once
 * for P1 and documented here:
 *   - text:        a 5%/8% inset where headings stay legible on every device;
 *   - mediaCrop:   a 4%/6% boundary inside which COVER-fit media never crops;
 *   - mobileCrop:  the centred 4:5 column that survives the mobile hero crop
 *                  of a 16:10 desktop frame (900 * 0.8 / 1440 = 50% wide);
 *   - universal:   the always-visible centred rectangle shared by all devices.
 */
export const SAFE_AREA_GUIDES = {
  /** Spec §5.4: the header safe-area line sits 80px below the frame top. */
  headerPx: 80,
  /** The container centreline every axis snaps to. */
  centerlinePct: 50,
  text: { xPct: 5, yPct: 8, widthPct: 90, heightPct: 84 },
  mediaCrop: { xPct: 4, yPct: 6, widthPct: 92, heightPct: 88 },
  mobileCrop: { xPct: 25, yPct: 0, widthPct: 50, heightPct: 100 },
  universal: { xPct: 10, yPct: 12, widthPct: 80, heightPct: 76 },
} as const;

type SafeAreaRect = {
  readonly xPct: number;
  readonly yPct: number;
  readonly widthPct: number;
  readonly heightPct: number;
};

/**
 * Convert a pixel drag delta into the percentage coordinate space of the
 * container. Always returns a finite value clamped to 0–100: a non-finite or
 * non-positive container width contributes no movement, a non-finite start is
 * treated as 0 and a non-finite delta as 0 (Review Focus #4).
 */
export function dragDeltaToPct(
  startPct: number,
  deltaPx: number,
  containerPx: number,
): number {
  const start = Number.isFinite(startPct) ? startPct : 0;
  if (!Number.isFinite(containerPx) || containerPx <= 0) {
    return clampPct(start);
  }
  const delta = Number.isFinite(deltaPx) ? deltaPx : 0;
  return clampPct(start + (delta / containerPx) * 100);
}

/**
 * Snap one percentage value to the nearest guide within the threshold
 * (inclusive). Non-finite guides are ignored and a non-finite input reports no
 * snap, so callers can distinguish "no guide in range" from "snapped".
 */
export function snapValue(
  pct: number,
  guides: number[],
  threshold = SNAP_THRESHOLD_PCT,
): { value: number; snapped: boolean } {
  if (!Number.isFinite(pct)) {
    return { value: pct, snapped: false };
  }
  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const guide of guides) {
    if (!Number.isFinite(guide)) continue;
    const distance = Math.abs(guide - pct);
    if (distance <= threshold && distance < bestDistance) {
      bestDistance = distance;
      best = guide;
    }
  }
  return best === null ? { value: pct, snapped: false } : { value: best, snapped: true };
}

type HeroSection = Extract<HomepageSection, { type: "HERO" }>;

function firstHero(doc: HomepageDocument): HeroSection | null {
  const section = doc.sections.find(({ type }) => type === "HERO");
  return section?.type === "HERO" ? section : null;
}

function locateSlide(
  doc: HomepageDocument,
  slideId: string,
): { section: HeroSection; slide: HeroSlide } | null {
  for (const section of doc.sections) {
    if (section.type !== "HERO") continue;
    const slide = section.payload.slides.find(({ id }) => id === slideId);
    if (slide) return { section, slide };
  }
  return null;
}

/** Desktop writes the base element; tablet/mobile write that device's override (Ruling 1). */
function layoutDocument(
  doc: HomepageDocument,
  slideId: string,
  key: HeroElementKey,
  device: BuilderDevice,
  patch: Partial<ElementLayout>,
): HomepageDocument {
  return device === "desktop"
    ? updateHeroElement(doc, slideId, key, { layout: patch })
    : setElementOverride(doc, slideId, key, device, { layout: patch });
}

function layoutsEqual(a: ElementLayout, b: ElementLayout): boolean {
  return (
    a.xPct === b.xPct &&
    a.yPct === b.yPct &&
    a.widthPct === b.widthPct &&
    a.align === b.align &&
    a.verticalAlign === b.verticalAlign
  );
}

/**
 * Reset semantics (Ruling 2): desktop restores the Task 8 default layout;
 * tablet/mobile remove only that device's layout override (any style override
 * survives, and an override left empty is dropped — the Task 14
 * `clearStyleProperty` deletion pattern). Returns the input reference when
 * nothing would change so the dispatching `mutate` is a true no-op.
 */
function resetPositionDocument(
  doc: HomepageDocument,
  slideId: string,
  key: HeroElementKey,
  device: BuilderDevice,
): HomepageDocument {
  const located = locateSlide(doc, slideId);
  if (!located) return doc;
  const element = located.slide.elements[key];

  if (device === "desktop") {
    const defaults = emptyElement(key).layout;
    return layoutsEqual(element.layout, defaults)
      ? doc
      : resetElementLayout(doc, slideId, key);
  }

  const override = element.overrides[device];
  if (!override?.layout) return doc;

  const next = structuredClone(doc);
  const target = locateSlide(next, slideId);
  if (!target) return doc;
  const nextElement = target.slide.elements[key];
  const nextOverride = nextElement.overrides[device];
  if (!nextOverride) return doc;
  delete nextOverride.layout;
  if (!nextOverride.style && !nextOverride.layout) {
    delete nextElement.overrides[device];
  }
  return next;
}

/** Arrow nudge through the same device-aware write path as drag and toolbar. */
function nudgeDocument(
  doc: HomepageDocument,
  slideId: string,
  key: HeroElementKey,
  device: BuilderDevice,
  dx: number,
  dy: number,
): HomepageDocument {
  const located = locateSlide(doc, slideId);
  if (!located) return doc;
  if (located.slide.elements[key].locked) return doc;
  const { layout } = effectiveElementStyle(located.slide, key, device);
  const xPct = clampPct(layout.xPct + dx);
  const yPct = clampPct(layout.yPct + dy);
  if (xPct === layout.xPct && yPct === layout.yPct) return doc;
  return layoutDocument(doc, slideId, key, device, { xPct, yPct });
}

function isTextEntry(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable)
  );
}

type DragState = {
  key: HeroElementKey;
  slideId: string;
  startX: number;
  startY: number;
  widthPct: number;
  startClientX: number;
  startClientY: number;
  pointerId: number;
  moved: boolean;
  capture: HTMLElement;
};

type DragPreview = { key: HeroElementKey; xPct: number; yPct: number };

type DragGuides = { x: number | null; y: number | null };

const NO_GUIDES: DragGuides = { x: null, y: null };

/** Guide values for one axis, all derived from SAFE_AREA_GUIDES (Ruling 3). */
function guideValues(
  axis: "x" | "y",
  slide: HeroSlide,
  excludeKey: HeroElementKey,
  device: BuilderDevice,
  rect: DOMRect,
): number[] {
  const values: number[] = [SAFE_AREA_GUIDES.centerlinePct];
  for (const area of [
    SAFE_AREA_GUIDES.text,
    SAFE_AREA_GUIDES.mediaCrop,
    SAFE_AREA_GUIDES.mobileCrop,
    SAFE_AREA_GUIDES.universal,
  ]) {
    if (axis === "x") {
      values.push(area.xPct, area.xPct + area.widthPct);
    } else {
      values.push(area.yPct, area.yPct + area.heightPct);
    }
  }
  if (axis === "y" && rect.height > 0) {
    // The header line is fixed in px; snap in the frame's percentage space.
    values.push((SAFE_AREA_GUIDES.headerPx / rect.height) * 100);
  }
  for (const key of ELEMENT_KEYS) {
    if (key === excludeKey) continue;
    const { layout } = effectiveElementStyle(slide, key, device);
    // Only each element's leading edge is known in layout space; the trailing
    // edge depends on the rendered height and stays out of the guide list.
    if (axis === "x") {
      values.push(layout.xPct, layout.xPct + layout.widthPct);
    } else {
      values.push(layout.yPct);
    }
  }
  return values;
}

/**
 * Snap one axis: on x the element's left edge, centre and right edge are all
 * candidate anchors (the centre is what makes "snap to the centreline" feel
 * right); on y only the top edge is known. The smallest in-threshold distance
 * wins and the returned guide is the line to draw.
 */
function snapAxisValue(
  axis: "x" | "y",
  value: number,
  widthPct: number,
  guides: number[],
): { value: number; guide: number | null } {
  const anchors =
    axis === "x" ? [value, value + widthPct / 2, value + widthPct] : [value];
  let best: { value: number; guide: number | null } = {
    value,
    guide: null,
  };
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const anchor of anchors) {
    const snapped = snapValue(anchor, guides, SNAP_THRESHOLD_PCT);
    if (!snapped.snapped) continue;
    const distance = Math.abs(snapped.value - anchor);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { value: value + (snapped.value - anchor), guide: snapped.value };
    }
  }
  return best;
}

/**
 * Ruling 4: plain arrows nudge 0.5%; Shift+Arrow converts the spec's 10px
 * through the same `dragDeltaToPct` container math as the drag — not a literal
 * 5% — using the container width for both axes.
 */
function arrowStep(
  key: string,
  shiftKey: boolean,
  rect: DOMRect | null,
): { dx: number; dy: number } {
  const unit = shiftKey
    ? dragDeltaToPct(0, SHIFT_STEP_PX, rect?.width ?? 0)
    : KEYBOARD_STEP_PCT;
  if (unit === 0) return { dx: 0, dy: 0 };
  switch (key) {
    case "ArrowLeft":
      return { dx: -unit, dy: 0 };
    case "ArrowRight":
      return { dx: unit, dy: 0 };
    case "ArrowUp":
      return { dx: 0, dy: -unit };
    case "ArrowDown":
      return { dx: 0, dy: unit };
    default:
      return { dx: 0, dy: 0 };
  }
}

function rectStyle(rect: SafeAreaRect): CSSProperties {
  return {
    left: `${rect.xPct}%`,
    top: `${rect.yPct}%`,
    width: `${rect.widthPct}%`,
    height: `${rect.heightPct}%`,
  };
}

const ALIGN_OPTIONS = [
  { value: "LEFT", labelKey: "homepage_builder_align_left" },
  { value: "CENTER", labelKey: "homepage_builder_align_center" },
  { value: "RIGHT", labelKey: "homepage_builder_align_right" },
] as const satisfies ReadonlyArray<{ value: string; labelKey: TKey }>;

const VERTICAL_OPTIONS = [
  { value: "TOP", labelKey: "homepage_builder_align_top" },
  { value: "MIDDLE", labelKey: "homepage_builder_align_middle" },
  { value: "BOTTOM", labelKey: "homepage_builder_align_bottom" },
] as const satisfies ReadonlyArray<{ value: string; labelKey: TKey }>;

const ICON_BARS: Record<string, ReadonlyArray<readonly [number, number, number]>> =
  {
    LEFT: [
      [2, 3, 12],
      [2, 7, 8],
      [2, 11, 10],
    ],
    CENTER: [
      [2, 3, 12],
      [4, 7, 8],
      [3, 11, 10],
    ],
    RIGHT: [
      [2, 3, 12],
      [6, 7, 8],
      [4, 11, 10],
    ],
    TOP: [
      [3, 2, 10],
      [3, 5, 7],
      [3, 8, 9],
    ],
    MIDDLE: [
      [3, 4, 10],
      [3, 7, 7],
      [3, 10, 9],
    ],
    BOTTOM: [
      [3, 6, 10],
      [3, 9, 7],
      [3, 12, 9],
    ],
  };

function AlignIcon({ value }: { value: string }): ReactNode {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-4 w-4"
      aria-hidden="true"
      fill="currentColor"
    >
      {(ICON_BARS[value] ?? []).map(([x, y, width], index) => (
        <rect key={index} x={x} y={y} width={width} height={2} rx="1" />
      ))}
    </svg>
  );
}

function LockIcon({ locked }: { locked: boolean }): ReactNode {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      {locked ? (
        <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
      ) : (
        <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0" />
      )}
    </svg>
  );
}

const TOOLBAR_BUTTON_CLASS =
  "flex h-7 min-w-7 items-center justify-center gap-1 rounded border border-transparent px-1.5 text-xs font-semibold text-ink-secondary transition-colors hover:border-border hover:text-cta aria-pressed:border-cta aria-pressed:text-cta";

export function HeroCanvas({ style, previewViewportHeight }: { style?: unknown; previewViewportHeight?: number } = {}): ReactNode {
  const { t } = useAdminI18n();
  const {
    state,
    dispatch,
    device,
    selectedSlideId,
    selectedElementKey,
    setSelectedSectionId,
    setSelectedElementKey,
    safeAreaFlags,
  } = useHomepageEditor();

  const canvasRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const previewRef = useRef<DragPreview | null>(null);
  const suppressClickRef = useRef(false);
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  const [dragGuides, setDragGuides] = useState<DragGuides>(NO_GUIDES);
  const [toolbarAnchor, setToolbarAnchor] = useState<{
    left: number;
    top: number;
    below: boolean;
  } | null>(null);

  const hero = firstHero(state.document);
  const located = selectedSlideId
    ? locateSlide(state.document, selectedSlideId)
    : null;
  const section = located?.section ?? hero;
  const display = section?.type === "HERO" ? section.payload.display : undefined;
  const responsiveHeight = ((device === "desktop" ? undefined : display?.overrides?.[device]?.heightMode) ?? display?.heightMode) !== undefined;
  const slide = located?.slide ?? hero?.payload.slides[0] ?? null;
  const selectedElement =
    slide && selectedElementKey ? slide.elements[selectedElementKey] : null;
  const selectedLayout =
    slide && selectedElementKey
      ? effectiveElementStyle(slide, selectedElementKey, device).layout
      : null;

  const viewSection = useMemo<HomepageSection | null>(() => {
    if (!section || !slide || section.type !== "HERO") return null;
    return { ...section, payload: { ...section.payload, slides: [slide] } };
  }, [section, slide]);

  /**
   * Device-effective `--el-*` values for the selected slide, injected inline on
   * the stage so both the inline render and Task 19's real component resolve
   * the same variables for the device the operator selected. The drag preview
   * overrides the dragged element's position without touching the document.
   */
  const stageVars = useMemo<CSSProperties>(() => {
    if (!slide) return {};
    const vars: Record<string, string> = {};
    for (const key of ELEMENT_KEYS) {
      const { style, layout } = effectiveElementStyle(slide, key, device);
      vars[`--el-${key}-x`] = `${layout.xPct}%`;
      vars[`--el-${key}-y`] = `${layout.yPct}%`;
      vars[`--el-${key}-w`] = `${layout.widthPct}%`;
      vars[`--el-${key}-align`] = (
        style.textAlign ?? layout.align
      ).toLowerCase();
      if (typeof style.fontSize === "number" && Number.isFinite(style.fontSize)) {
        vars[`--el-${key}-size`] = `${style.fontSize}px`;
      }
      if (typeof style.fontWeight === "number") {
        vars[`--el-${key}-weight`] = String(style.fontWeight);
      }
      if (typeof style.lineHeight === "number") {
        vars[`--el-${key}-lh`] = String(style.lineHeight);
      }
      if (typeof style.letterSpacing === "number") {
        vars[`--el-${key}-ls`] = `${style.letterSpacing}px`;
      }
      if (typeof style.textColor === "string") {
        vars[`--el-${key}-color`] = safeHex(style.textColor, DEFAULT_TEXT_COLOR);
      }
      if (typeof style.maxWidthPct === "number") {
        vars[`--el-${key}-maxw`] = `${style.maxWidthPct}%`;
      }
    }
    // The shared HeroSlider container reads height:var(--hp-hero-height); in the
    // editor the stage owns the height, so pin the variable to 100%.
    if (!responsiveHeight) vars["--hp-hero-height"] = "100%";
    if (dragPreview) {
      vars[`--el-${dragPreview.key}-x`] = `${dragPreview.xPct}%`;
      vars[`--el-${dragPreview.key}-y`] = `${dragPreview.yPct}%`;
    }
    return vars as CSSProperties;
  }, [slide, device, dragPreview, responsiveHeight]);

  /**
   * The inline stage vars above read cleanly from tests, but a real browser
   * resolves custom properties on the slide element, where `heroCss` (rendered
   * inside the shared HeroSlider) also sets them - and the slide's own values
   * win over the stage's inherited ones. Re-assert the same effective values in
   * a stylesheet emitted AFTER the HeroSlider so equal-specificity rules resolve
   * to the selected device (and the drag preview) in the real cascade, then pin
   * the hero height to the frame.
   */
  const deviceOverrideCss = useMemo<string>(() => {
    if (!section || !slide) return "";
    if (section.type !== "HERO") return "";
    const rule: string[] = [];
    for (const key of ELEMENT_KEYS) {
      const { style, layout } = effectiveElementStyle(slide, key, device);
      rule.push(`--el-${key}-x: ${layout.xPct}%;`);
      rule.push(`--el-${key}-y: ${layout.yPct}%;`);
      rule.push(`--el-${key}-w: ${layout.widthPct}%;`);
      rule.push(
        `--el-${key}-align: ${(style.textAlign ?? layout.align).toLowerCase()};`,
      );
      if (typeof style.fontSize === "number" && Number.isFinite(style.fontSize)) {
        rule.push(`--el-${key}-size: ${style.fontSize}px;`);
      }
      if (typeof style.fontWeight === "number") {
        rule.push(`--el-${key}-weight: ${style.fontWeight};`);
      }
      if (typeof style.lineHeight === "number") {
        rule.push(`--el-${key}-lh: ${style.lineHeight};`);
      }
      if (typeof style.letterSpacing === "number") {
        rule.push(`--el-${key}-ls: ${style.letterSpacing}px;`);
      }
      if (typeof style.textColor === "string") {
        rule.push(`--el-${key}-color: ${safeHex(style.textColor, DEFAULT_TEXT_COLOR)};`);
      }
      if (typeof style.maxWidthPct === "number") {
        rule.push(`--el-${key}-maxw: ${style.maxWidthPct}%;`);
      }
    }
    if (dragPreview) {
      rule.push(`--el-${dragPreview.key}-x: ${dragPreview.xPct}%;`);
      rule.push(`--el-${dragPreview.key}-y: ${dragPreview.yPct}%;`);
    }
    return [
      !responsiveHeight ? `#hp-hero-${section.id} { --hp-hero-height: 100%; }` : "",
      rule.length > 0
        ? `#hp-hero-${section.id} [data-slide="${slide.id}"] { ${rule.join(" ")} }`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
  }, [section, slide, device, dragPreview, responsiveHeight]);

  const focusCanvas = useCallback((): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const active = document.activeElement;
    // Ruling 33: never pull focus out of a text field.
    if (isTextEntry(active)) return;
    if (active instanceof HTMLElement && canvas.contains(active)) return;
    canvas.focus({ preventScroll: true });
  }, []);

  // Keyboard nudge/Tab handling needs the canvas to own the focus after a
  // selection made outside the canvas (tests, future panels).
  useEffect(() => {
    if (selectedElementKey === null) return;
    focusCanvas();
  }, [selectedElementKey, focusCanvas]);

  // The toolbar floats OUTSIDE the DeviceFrame's scaled viewport: canvas-space
  // chrome would render at ~40% size and clip at the frame edge. It is portaled
  // to the body and positioned from the selected element's screen rect (the
  // same measure-then-setState shape DeviceFrame uses for its frame width).
  useEffect(() => {
    const measure = (): void => {
      const container = selectedElementKey
        ? canvasRef.current?.querySelector(
            `[data-hero-element="${selectedElementKey}"]`,
          )
        : null;
      const rect = container?.getBoundingClientRect();
      setToolbarAnchor(
        rect
          ? { left: rect.left, top: rect.top, below: rect.top < 64 }
          : null,
      );
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [selectedElementKey, device, state.document, dragPreview]);

  const commitLayoutPatch = (patch: Partial<ElementLayout>): void => {
    if (!slide || !selectedElementKey) return;
    dispatch({
      type: "commit",
      document: layoutDocument(
        state.document,
        slide.id,
        selectedElementKey,
        device,
        patch,
      ),
    });
  };

  const resetPosition = (): void => {
    if (!slide || !selectedElementKey) return;
    const slideId = slide.id;
    const key = selectedElementKey;
    dispatch({
      type: "mutate",
      mutate: (doc) => resetPositionDocument(doc, slideId, key, device),
    });
  };

  const toggleLock = (): void => {
    if (!slide || !selectedElementKey || !selectedElement) return;
    dispatch({
      type: "commit",
      document: updateHeroElement(state.document, slide.id, selectedElementKey, {
        locked: !selectedElement.locked,
      }),
    });
  };

  const cycleElement = (delta: number): void => {
    if (!selectedElementKey) return;
    const index = ELEMENT_KEYS.indexOf(selectedElementKey);
    if (index < 0) return;
    setSelectedElementKey(
      ELEMENT_KEYS[
        (index + delta + ELEMENT_KEYS.length) % ELEMENT_KEYS.length
      ],
    );
  };

  const handleCanvasClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (suppressClickRef.current) {
      // The click that closes a real drag must not clear the selection.
      suppressClickRef.current = false;
      return;
    }
    const target = event.target;
    // The floating toolbar is portaled to the body, but React still bubbles its
    // synthetic events through this component — DOM containment keeps toolbar
    // clicks from reading as "clicked the empty canvas".
    if (!(target instanceof Node) || !event.currentTarget.contains(target)) {
      return;
    }
    if (target instanceof Element && target.closest("[data-hero-element]")) {
      return;
    }
    setSelectedElementKey(null);
  };

  const handlePointerDown = (
    event: ReactPointerEvent<HTMLDivElement>,
  ): void => {
    if (event.button !== 0) return;
    const target = event.target;
    const container =
      target instanceof Element
        ? target.closest("[data-hero-element]")
        : null;
    if (
      !(container instanceof HTMLElement) ||
      !canvasRef.current?.contains(container)
    ) {
      return;
    }
    const key = container.getAttribute("data-hero-element");
    if (!key || !slide || !ELEMENT_KEYS.includes(key as HeroElementKey)) return;
    const elementKey = key as HeroElementKey;

    event.preventDefault();
    suppressClickRef.current = false;
    if (section) setSelectedSectionId(section.id);
    setSelectedElementKey(elementKey);
    focusCanvas();

    if (slide.elements[elementKey].locked) return;
    const layout = effectiveElementStyle(slide, elementKey, device).layout;
    dragRef.current = {
      key: elementKey,
      slideId: slide.id,
      startX: layout.xPct,
      startY: layout.yPct,
      widthPct: layout.widthPct,
      startClientX: event.clientX,
      startClientY: event.clientY,
      pointerId: event.pointerId,
      moved: false,
      capture: container,
    };
    try {
      container.setPointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture is unavailable (jsdom) or the pointer is gone.
    }
  };

  const handlePointerMove = (
    event: ReactPointerEvent<HTMLDivElement>,
  ): void => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId || !slide) return;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;

    const dx = event.clientX - drag.startClientX;
    const dy = event.clientY - drag.startClientY;
    if (dx !== 0 || dy !== 0) drag.moved = true;

    let x = dragDeltaToPct(drag.startX, dx, rect.width);
    let y = dragDeltaToPct(drag.startY, dy, rect.height);
    let guideX: number | null = null;
    let guideY: number | null = null;
    if (!event.shiftKey) {
      const xSnap = snapAxisValue(
        "x",
        x,
        drag.widthPct,
        guideValues("x", slide, drag.key, device, rect),
      );
      x = clampPct(xSnap.value);
      guideX = xSnap.guide;
      const ySnap = snapAxisValue(
        "y",
        y,
        drag.widthPct,
        guideValues("y", slide, drag.key, device, rect),
      );
      y = clampPct(ySnap.value);
      guideY = ySnap.guide;
    }

    const preview: DragPreview = { key: drag.key, xPct: x, yPct: y };
    previewRef.current = preview;
    setDragPreview(preview);
    setDragGuides({ x: guideX, y: guideY });
  };

  const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    dragRef.current = null;
    try {
      drag.capture.releasePointerCapture?.(event.pointerId);
    } catch {
      // Nothing to release without pointer capture.
    }

    const preview = previewRef.current;
    previewRef.current = null;
    setDragPreview(null);
    setDragGuides(NO_GUIDES);

    if (!drag.moved || !preview) return;
    suppressClickRef.current = true;
    if (preview.xPct === drag.startX && preview.yPct === drag.startY) return;
    const { key, slideId } = drag;
    dispatch({
      type: "mutate",
      // Ruling 5: one commit per gesture, applied to the latest document.
      mutate: (doc) =>
        layoutDocument(doc, slideId, key, device, {
          xPct: preview.xPct,
          yPct: preview.yPct,
        }),
    });
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    // Ruling 33: keys born in a text field belong to the text field.
    if (isTextEntry(event.target)) return;
    // Portaled toolbar keys bubble through React but are not canvas keys.
    if (
      !(event.target instanceof Node) ||
      !event.currentTarget.contains(event.target)
    ) {
      return;
    }

    if (event.key === "Escape") {
      if (selectedElementKey !== null) {
        event.preventDefault();
        setSelectedElementKey(null);
      }
      return;
    }

    if (event.key === "Tab") {
      // Cycle only while the canvas itself owns the event; a Tab pressed on a
      // focusable descendant keeps the browser's native focus navigation.
      if (event.target !== event.currentTarget) return;
      event.preventDefault();
      cycleElement(event.shiftKey ? -1 : 1);
      return;
    }

    if (!slide || !selectedElementKey) return;
    if (!event.key.startsWith("Arrow")) return;
    if (slide.elements[selectedElementKey].locked) return;
    const rect = stageRef.current?.getBoundingClientRect() ?? null;
    const step = arrowStep(event.key, event.shiftKey, rect);
    if (step.dx === 0 && step.dy === 0) return;
    event.preventDefault();
    const slideId = slide.id;
    const key = selectedElementKey;
    dispatch({
      type: "mutate",
      mutate: (doc) => nudgeDocument(doc, slideId, key, device, step.dx, step.dy),
    });
  };

  const toolbar =
    selectedElement && selectedElementKey && toolbarAnchor
      ? createPortal(
          <div
            data-hero-toolbar
            role="toolbar"
            aria-label={t("homepage_builder_group_position")}
            className="fixed z-50 flex items-center gap-1 rounded-lg border border-border bg-card p-1 shadow-lg"
            style={{
              left: toolbarAnchor.left,
              top: toolbarAnchor.top,
              transform: toolbarAnchor.below
                ? "translateY(8px)"
                : "translateY(calc(-100% - 8px))",
            }}
          >
            {ALIGN_OPTIONS.map(({ value, labelKey }) => (
              <button
                key={value}
                type="button"
                aria-label={t(labelKey)}
                aria-pressed={selectedLayout?.align === value}
                className={TOOLBAR_BUTTON_CLASS}
                onClick={() => commitLayoutPatch({ align: value })}
              >
                <AlignIcon value={value} />
              </button>
            ))}
            <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-border" />
            {VERTICAL_OPTIONS.map(({ value, labelKey }) => (
              <button
                key={value}
                type="button"
                aria-label={t(labelKey)}
                aria-pressed={selectedLayout?.verticalAlign === value}
                className={TOOLBAR_BUTTON_CLASS}
                onClick={() => commitLayoutPatch({ verticalAlign: value })}
              >
                <AlignIcon value={value} />
              </button>
            ))}
            <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-border" />
            <button
              type="button"
              aria-label={t("homepage_builder_reset_position")}
              className={TOOLBAR_BUTTON_CLASS}
              onClick={resetPosition}
            >
              Reset
            </button>
            <button
              type="button"
              aria-pressed={selectedElement.locked}
              className={TOOLBAR_BUTTON_CLASS}
              onClick={toggleLock}
            >
              <LockIcon locked={selectedElement.locked} />
              {selectedElement.locked
                ? t("homepage_builder_unlock")
                : t("homepage_builder_lock")}
            </button>
          </div>,
          document.body,
        )
      : null;

  return (
    <div
      ref={canvasRef}
      data-panel="hero-canvas"
      data-hero-canvas
      role="group"
      aria-label={t("homepage_builder_pane_preview")}
      tabIndex={0}
      className={`relative w-full overflow-hidden outline-none ${responsiveHeight ? "" : "h-full"}`}
      onClick={handleCanvasClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={stageRef}
        data-hero-stage
        className={responsiveHeight ? "relative" : "absolute inset-0"}
        style={stageVars}
      >
        {viewSection ? (
          <>
            {/* The real storefront HeroSlider (Task 19) renders heroCss and the
                element DOM contract; the canvas narrows it to the selected slide
                and passes the edit handle. The override stylesheet re-asserts the
                simulated device's vars on the slide selector (see the memo
                above) so a real browser resolves the selected device and the
                frame height. */}
            <HeroSlider
              previewDevice={device}
              previewViewportHeight={previewViewportHeight ?? { desktop: 900, tablet: 1024, mobile: 844 }[device]}
              section={{
                ...viewSection,
                ...(style !== undefined ? { style } : {}),
              }}
              edit={{
                selectedElementKey,
                onSelectElement: setSelectedElementKey,
              }}
            />
            {deviceOverrideCss ? (
              <style data-hero-canvas-device-css>{deviceOverrideCss}</style>
            ) : null}
          </>
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-primary-light/20 text-sm text-ink-secondary">
            {t("homepage_builder_pane_preview")}
          </div>
        )}
      </div>

      {/* Safe-area overlays (Task 15 flags) — every geometry value comes from
          SAFE_AREA_GUIDES so overlays and snap guides never drift apart. */}
      {safeAreaFlags.header ? (
        <div
          data-safe-area="header"
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 border-t-2 border-dashed border-admin-warning"
          style={{ top: SAFE_AREA_GUIDES.headerPx }}
        />
      ) : null}
      {safeAreaFlags.text ? (
        <div
          data-safe-area="text"
          aria-hidden="true"
          className="pointer-events-none absolute border-2 border-dashed border-admin-warning"
          style={rectStyle(SAFE_AREA_GUIDES.text)}
        />
      ) : null}
      {safeAreaFlags.mediaCrop ? (
        <div
          data-safe-area="mediaCrop"
          aria-hidden="true"
          className="pointer-events-none absolute border-2 border-dashed border-admin-warning"
          style={rectStyle(SAFE_AREA_GUIDES.mediaCrop)}
        />
      ) : null}
      {safeAreaFlags.mobileCrop ? (
        <div
          data-safe-area="mobileCrop"
          aria-hidden="true"
          className="pointer-events-none absolute border-2 border-dashed border-admin-warning"
          style={rectStyle(SAFE_AREA_GUIDES.mobileCrop)}
        />
      ) : null}
      {safeAreaFlags.universal ? (
        <div
          data-safe-area="universal"
          aria-hidden="true"
          className="pointer-events-none absolute border-2 border-dashed border-admin-warning"
          style={rectStyle(SAFE_AREA_GUIDES.universal)}
        />
      ) : null}

      {/* Alignment guides shown while a drag snaps to a line. */}
      {dragGuides.x !== null ? (
        <div
          data-hero-guide="x"
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 border-l border-dashed border-cta"
          style={{ left: `${dragGuides.x}%` }}
        />
      ) : null}
      {dragGuides.y !== null ? (
        <div
          data-hero-guide="y"
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 border-t border-dashed border-cta"
          style={{ top: `${dragGuides.y}%` }}
        />
      ) : null}

      {toolbar}
    </div>
  );
}
