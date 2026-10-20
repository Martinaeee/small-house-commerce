"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import { ViewportVideo } from "@/components/product/ViewportVideo";
import type { ProductCardInteractionMode } from "@/components/product/ProductCard";
import { trackAttrs } from "@/lib/home-tracking";
import {
  elementInlineVars,
  heroCss,
  overlayCss,
  safeHex,
} from "@/lib/homepage-styles";
import {
  isHeroPayloadView,
  type HomepageHeroButton,
  type HomepageHeroElement,
  type HomepageHeroElementKey,
  type HomepageHeroMedia,
  type HomepageHeroSlide,
} from "@/lib/api";
import type { HeroPayload, HomepageDevice } from "@/lib/homepage-document";
import { useHeroReadableLayout } from "./useHeroReadableLayout";
import { HeroSlideCountdown } from "./HeroSlideCountdown";
import { sectionStylePresentation } from "./sectionShell";

/**
 * Storefront hero slider for the homepage document (spec §6.1 / plan Task 19).
 *
 * - SSR-renders the first slide, then a client effect rotates through
 *   `payload.slides` (the server already filters by enablement + schedule and
 *   resolves each element's `link` into `linkHref`).
 * - Styling: the component embeds `heroCss(section.id, payload)` so element
 *   positions, typography and the responsive `--hp-hero-height` var come from
 *   one scoped, SSR-safe stylesheet. The canvas overrides that variable for its
 *   simulated devices without touching this component.
 * - Each readable element renders inside a `[data-hero-element="<key>"]`
 *   container positioned through `elementInlineVars` (the `--el-*` vars).
 * - With an `edit` prop the slider is inert (no autoplay/rotation/chrome) and
 *   element containers become click-selectable with a dashed outline — the
 *   admin canvas contract. The versions page uses the read-only path.
 * - Tracking: CTA anchors keep the legacy `data-track-*` (HeroClick) attrs and
 *   every slide wrapper carries `data-slide-id`.
 */
export function HeroSlider({
  section,
  edit,
  interactionMode = "storefront",
  previewDevice,
  previewViewportHeight,
}: {
  /**
   * Structural section accepted by both the storefront registry (api
   * `HomepageSection`, whose products are hydrated) and the admin document
   * (homepage-document `HomepageSection`, whose products are join stubs) —
   * the canvas and the versions dialog reuse this component on the seam.
   */
  section: HeroSliderSection;
  interactionMode?: ProductCardInteractionMode;
  previewDevice?: HomepageDevice;
  previewViewportHeight?: number;
  edit?: {
    selectedElementKey: HeroElementKey | null;
    onSelectElement(key: HeroElementKey): void;
  };
}): ReactNode {
  const payload = isHeroPayloadView(section.payload) ? section.payload : null;
  const rootRef = useRef<HTMLDivElement>(null);
  useHeroReadableLayout(rootRef, payload, previewDevice, previewViewportHeight);

  const slides = useMemo(
    () =>
      (payload?.slides ?? []).filter(
        (slide): slide is HomepageHeroSlide =>
          slide !== null &&
          typeof slide === "object" &&
          typeof slide.id === "string",
      ),
    [payload],
  );

  const behavior = useMemo<SliderBehavior>(
    () => ({
      autoplay: payload?.behavior?.autoplay ?? true,
      durationMs:
        typeof payload?.behavior?.durationMs === "number" &&
        Number.isFinite(payload.behavior.durationMs) &&
        payload.behavior.durationMs > 0
          ? payload.behavior.durationMs
          : 6000,
      transition: payload?.behavior?.transition === "SLIDE" ? "SLIDE" : "FADE",
      pauseOnHover: payload?.behavior?.pauseOnHover ?? true,
      arrows: payload?.behavior?.arrows ?? true,
      pagination:
        payload?.behavior?.pagination === "COUNTER"
          ? "COUNTER"
          : payload?.behavior?.pagination === "PROGRESS"
            ? "PROGRESS"
            : "DOTS",
      manualPauseMs:
        typeof payload?.behavior?.manualPauseMs === "number" &&
        Number.isFinite(payload.behavior.manualPauseMs) &&
        payload.behavior.manualPauseMs > 0
          ? payload.behavior.manualPauseMs
          : 12000,
    }),
    [payload],
  );

  const editing = edit !== undefined;
  const previewing = interactionMode === "preview";
  const interactive = !editing && !previewing;
  const reducedMotion = usePrefersReducedMotion();

  const [activeIndex, setActiveIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [unmuted, setUnmuted] = useState(false);
  const manualPauseUntilRef = useRef(0);
  const slideNodesRef = useRef(new Map<string, HTMLElement | null>());

  const goTo = useCallback(
    (next: number): void => {
      if (slides.length === 0) return;
      setActiveIndex(((next % slides.length) + slides.length) % slides.length);
      setUnmuted(false); // sound state is per-slide; never leak across slides
      manualPauseUntilRef.current = Date.now() + behavior.manualPauseMs;
    },
    [behavior.manualPauseMs, slides.length],
  );

  // Autoplay rotation (spec: durationMs, pauseOnHover, manualPauseMs). Edit
  // mode and prefers-reduced-motion never rotate.
  useEffect(() => {
    if (!interactive || reducedMotion || !behavior.autoplay || slides.length < 2) {
      return undefined;
    }
    const id = setInterval(() => {
      if (hovered && behavior.pauseOnHover) return;
      if (Date.now() < manualPauseUntilRef.current) return;
      setActiveIndex((current) => (current + 1) % slides.length);
      setUnmuted(false); // reset the sound toggle on rotation (Fix round 2)
    }, behavior.durationMs);
    return () => clearInterval(id);
  }, [
    behavior.autoplay,
    behavior.durationMs,
    behavior.pauseOnHover,
    interactive,
    hovered,
    reducedMotion,
    slides.length,
  ]);

  // Sound toggle: ViewportVideo hardcodes muted for HERO, so the toggle flips
  // the underlying video element(s) of the active slide after each render.
  useEffect(() => {
    if (!interactive) return;
    const wrapper = slideNodesRef.current.get(slides[activeIndex]?.id ?? "");
    wrapper?.querySelectorAll("video").forEach((video) => {
      video.muted = !unmuted;
    });
  }, [activeIndex, interactive, slides, unmuted]);

  if (section.type !== "HERO" || payload === null || slides.length === 0) {
    return null;
  }
  const cssText = heroCss(section.id, payload as unknown as HeroPayload, previewDevice) || "";
  const presentation = sectionStylePresentation(section.style, previewDevice);

  return (
    <div
      ref={rootRef}
      id={`hp-hero-${section.id}`}
      data-hero-slider
      className={`relative mx-auto w-full overflow-hidden text-white ${presentation.widthClass} ${presentation.responsiveClass} ${presentation.textColorClass}`.trim()}
      style={{ height: "var(--hp-hero-height, 560px)", ...presentation.style }}
      onMouseEnter={behavior.pauseOnHover && interactive ? () => setHovered(true) : undefined}
      onMouseLeave={behavior.pauseOnHover && interactive ? () => setHovered(false) : undefined}
    >
      <style>{cssText}</style>
      <style>
        {"@keyframes hpHeroProgress { from { width: 0%; } to { width: 100%; } }"}
      </style>

      {slides.map((slide, index) => {
        const active = index === activeIndex;
        return (
          <div
            key={slide.id}
            ref={(node) => {
              slideNodesRef.current.set(slide.id, node);
            }}
            data-slide={slide.id}
            data-slide-id={slide.id}
            aria-hidden={active ? undefined : "true"}
            inert={active ? undefined : true}
            className="absolute inset-0"
            style={slideTransitionStyle(index, activeIndex, behavior.transition, reducedMotion)}
          >
            <HeroSlideMedia
              slide={slide}
              eager={index === 0}
            />
            {ELEMENT_KEYS.map((key) => (
              <HeroElementContainer
                key={key}
                elementKey={key}
                element={slide.elements?.[key]}
                section={section}
                edit={edit}
                preview={previewing}
              />
            ))}
            {/* sound toggle (read-only storefront only) */}
            {interactive && slideHasSoundToggle(slide) ? (
              <button
                type="button"
                data-hero-sound-toggle
                aria-label={unmuted ? "Mute slide video" : "Enable slide sound"}
                aria-pressed={unmuted}
                onClick={() => setUnmuted((current) => !current)}
                className="absolute bottom-4 right-4 z-30 flex h-9 w-9 items-center justify-center rounded-full bg-ink/40 text-white backdrop-blur transition-colors hover:bg-ink/60"
              >
                {unmuted ? <SpeakerOnIcon /> : <SpeakerOffIcon />}
              </button>
            ) : null}
          </div>
        );
      })}

      {interactive && behavior.arrows ? (
        <div
          data-hero-arrows
          className="pointer-events-none absolute inset-x-0 top-1/2 z-30 flex -translate-y-1/2 items-center justify-between px-3"
        >
          <button
            type="button"
            data-hero-prev
            aria-label="Show previous slide"
            onClick={() => goTo(activeIndex - 1)}
            className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full bg-ink/30 text-white transition-colors hover:bg-ink/50"
          >
            <span aria-hidden="true" className="text-xl leading-none">‹</span>
          </button>
          <button
            type="button"
            data-hero-next
            aria-label="Show next slide"
            onClick={() => goTo(activeIndex + 1)}
            className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full bg-ink/30 text-white transition-colors hover:bg-ink/50"
          >
            <span aria-hidden="true" className="text-xl leading-none">›</span>
          </button>
        </div>
      ) : null}

      {interactive ? (
        <Pagination
          behavior={behavior}
          slides={slides}
          activeIndex={activeIndex}
          hovered={hovered}
          reducedMotion={reducedMotion}
          goTo={goTo}
        />
      ) : null}
    </div>
  );
}

type HeroElementKey = HomepageHeroElementKey;

/** Section shape shared by the storefront registry and the admin document. */
type HeroSliderSection = {
  id: string;
  type: string;
  title: string | null;
  subtitle: string | null;
  sortOrder: number;
  payload: Record<string, unknown>;
  style?: unknown;
};

type SliderBehavior = {
  autoplay: boolean;
  durationMs: number;
  transition: "FADE" | "SLIDE";
  pauseOnHover: boolean;
  arrows: boolean;
  pagination: "DOTS" | "COUNTER" | "PROGRESS";
  manualPauseMs: number;
};

const ELEMENT_KEYS: readonly HeroElementKey[] = [
  "eyebrow",
  "heading",
  "subheading",
  "offer",
  "ctaPrimary",
  "ctaSecondary",
  "countdown",
];

/** Typography fallbacks so an unstyled slide still reads like a hero. */
const TYPOGRAPHY_FALLBACKS: Record<
  HeroElementKey,
  { size: string; weight: string }
> = {
  eyebrow: { size: "0.875rem", weight: "500" },
  heading: { size: "2.25rem", weight: "600" },
  subheading: { size: "1rem", weight: "400" },
  offer: { size: "0.875rem", weight: "600" },
  ctaPrimary: { size: "0.875rem", weight: "600" },
  ctaSecondary: { size: "0.875rem", weight: "600" },
  countdown: { size: "1.25rem", weight: "600" },
};

const DEFAULT_TEXT_COLOR = "#292724";
const DEFAULT_CHIP_BG = "#F2EFE9";
const BUTTON_DEVICE_SCALE: Record<HomepageDevice, number> = {
  desktop: 1,
  tablet: 0.85,
  mobile: 0.7,
};

type ResponsiveButtonStyle = CSSProperties & {
  "--hp-hero-button-padding-x-desktop": string;
  "--hp-hero-button-padding-y-desktop": string;
  "--hp-hero-button-padding-x-tablet": string;
  "--hp-hero-button-padding-y-tablet": string;
  "--hp-hero-button-padding-x-mobile": string;
  "--hp-hero-button-padding-y-mobile": string;
};

function subscribePrefersReducedMotion(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => undefined;
  }
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  const onChangeMedia = (): void => onChange();
  query.addEventListener?.("change", onChangeMedia);
  return () => query.removeEventListener?.("change", onChangeMedia);
}

function snapshotPrefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribePrefersReducedMotion,
    snapshotPrefersReducedMotion,
    () => false,
  );
}

function slideTransitionStyle(
  index: number,
  activeIndex: number,
  transition: "FADE" | "SLIDE",
  reduced: boolean,
): CSSProperties {
  const active = index === activeIndex;
  if (reduced) {
    return {
      opacity: active ? 1 : 0,
      transition: "none",
      pointerEvents: active ? "auto" : "none",
      zIndex: active ? 1 : 0,
    };
  }
  if (transition === "SLIDE") {
    const offset = active ? 0 : index < activeIndex ? -100 : 100;
    return {
      transform: `translateX(${offset}%)`,
      opacity: 1,
      transition: "transform 600ms ease, opacity 600ms ease",
      pointerEvents: active ? "auto" : "none",
      zIndex: active ? 1 : 0,
    };
  }
  return {
    opacity: active ? 1 : 0,
    transition: "opacity 600ms ease",
    pointerEvents: active ? "auto" : "none",
    zIndex: active ? 1 : 0,
  };
}

function slideHasSoundToggle(slide: HomepageHeroSlide): boolean {
  const media = slide.media;
  const desktop = media?.video?.showSoundToggle === true;
  const mobile = media?.mobileOverride?.video?.showSoundToggle === true;
  return desktop || mobile;
}

function HeroSlideMedia({
  slide,
  eager,
}: {
  slide: HomepageHeroSlide;
  eager: boolean;
}): ReactNode {
  const media = slide.media;
  const mobile = media?.mobileOverride?.enabled ? media.mobileOverride : null;
  const hasMobileMedia = Boolean(mobile?.image || mobile?.video);
  const baseClass = hasMobileMedia ? "hidden md:block" : "";
  const fit =
    media?.fit === "CONTAIN" ? "contain" : "cover";

  return (
    <>
      <div
        data-hero-media
        aria-hidden="true"
        className={`absolute inset-0 ${baseClass}`}
      >
        {renderBaseMedia(media, { eager, fit })}
      </div>

      {mobile?.image?.url ? (
        <div
          data-hero-mobile-media
          aria-hidden="true"
          className="absolute inset-0 md:hidden"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- hero media from the homepage document; arbitrary host, not on the next/image domain allowlist. */}
          <img
            src={mobile.image.url}
            alt={mobile.image.alt || ""}
            loading={eager ? undefined : "lazy"}
            className="h-full w-full object-cover"
            style={{ objectFit: fit }}
          />
        </div>
      ) : mobile?.video?.url ? (
        <div
          data-hero-mobile-media
          aria-hidden="true"
          className="absolute inset-0 md:hidden"
        >
          <ViewportVideo
            mode="HERO"
            src={mobile.video.url}
            poster={mobile.video.poster ?? undefined}
            ariaLabel={mobile.image?.alt ?? ""}
            className="h-full w-full object-cover"
          />
        </div>
      ) : null}

      {media ? (
        <div
          data-hero-overlay
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            // overlayCss is defensive (whitelisted enums, safeHex, clamped
            // opacity); the storefront view's overlay is Partial, so pass the
            // loose object through a never cast rather than inventing an
            // overlay type here.
            backgroundImage: overlayCss((slide.overlay ?? {}) as never),
          }}
        />
      ) : null}
    </>
  );
}

function renderBaseMedia(
  media: HomepageHeroMedia | null | undefined,
  options: { eager: boolean; fit: "cover" | "contain" },
): ReactNode {
  const { eager, fit } = options;
  if (!media) {
    return (
      <div
        data-hero-media-fallback
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-br from-primary-light to-cta/30"
      />
    );
  }
  if (media.type === "IMAGE" && media.image?.url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- hero media from the homepage document; arbitrary host, not on the next/image domain allowlist.
      <img
        src={media.image.url}
        alt={media.image.alt || ""}
        loading={eager ? undefined : "lazy"}
        className="h-full w-full object-cover"
        style={{ objectFit: fit }}
      />
    );
  }
  if (media.type === "VIDEO" && media.video?.url) {
    return (
      <ViewportVideo
        mode="HERO"
        src={media.video.url}
        poster={media.video.poster ?? undefined}
        ariaLabel={media.image?.alt ?? ""}
        className="h-full w-full object-cover"
      />
    );
  }
  return (
    <div
      data-hero-media-fallback
      aria-hidden="true"
      className="absolute inset-0 bg-gradient-to-br from-primary-light to-cta/30"
    />
  );
}

function HeroElementContainer({
  elementKey,
  element,
  section,
  edit,
  preview,
}: {
  elementKey: HeroElementKey;
  element: HomepageHeroElement | undefined;
  section: HeroSliderSection;
  preview: boolean;
  edit?: {
    selectedElementKey: HeroElementKey | null;
    onSelectElement(key: HeroElementKey): void;
  };
}): ReactNode {
  const selected = edit?.selectedElementKey === elementKey;
  const ctaElement = elementKey === "ctaPrimary" || elementKey === "ctaSecondary";
  const fallback = TYPOGRAPHY_FALLBACKS[elementKey];
  const style: CSSProperties = {
    ...elementInlineVars(elementKey),
    fontSize: `var(--el-${elementKey}-size, var(--hp-hero-fallback-size, ${fallback.size}))`,
    fontWeight: `var(--el-${elementKey}-weight, var(--hp-hero-fallback-weight, ${fallback.weight}))`,
    lineHeight: `var(--el-${elementKey}-lh, var(--hp-hero-fallback-lh, inherit))`,
    letterSpacing: `var(--el-${elementKey}-ls, var(--hp-hero-fallback-ls, inherit))`,
    color: `var(--el-${elementKey}-color, inherit)`,
    maxWidth: `var(--el-${elementKey}-maxw, none)`,
  };

  return (
    <div
      data-hero-element={elementKey}
      className={`min-h-[1.5em] ${edit ? "cursor-move" : ""}`}
      style={style}
      onClick={edit ? () => edit.onSelectElement(elementKey) : undefined}
    >
      <HeroElementContent
        elementKey={elementKey}
        element={element}
        section={section}
        edit={edit}
        preview={preview}
      />
      {selected && !ctaElement ? <SelectionChrome /> : null}
    </div>
  );
}

function HeroElementContent({
  elementKey,
  element,
  section,
  edit,
  preview,
}: {
  elementKey: HeroElementKey;
  element: HomepageHeroElement | undefined;
  section: HeroSliderSection;
  preview: boolean;
  edit?: {
    selectedElementKey: HeroElementKey | null;
    onSelectElement(key: HeroElementKey): void;
  };
}): ReactNode {
  const text = (element?.text ?? "").trim();

  if (elementKey === "countdown") {
    const endsAt = element?.endsAt ?? null;
    if (endsAt === null) {
      // Nothing to show; the empty block keeps its wrapper so the canvas can
      // still select it without painting placeholder text over the image.
      return null;
    }
    return (
      <HeroSlideCountdown
        endsAt={endsAt}
        style={element?.style as CSSProperties | undefined}
        layout={{ textAlign: readTextViewAlign(element?.style) }}
      />
    );
  }

  if (!text) return null;

  if (elementKey === "offer") {
    const chip = element?.chip;
    return (
      <span
        className="inline-flex items-center"
        style={{
          background: safeHex(chip?.background ?? null, DEFAULT_CHIP_BG),
          color: safeHex(chip?.textColor ?? null, DEFAULT_TEXT_COLOR),
          borderRadius: `${numOr(chip?.borderRadius, 0)}px`,
          padding: `${numOr(chip?.paddingY, 6)}px ${numOr(chip?.paddingX, 12)}px`,
        }}
      >
        {text}
      </span>
    );
  }

  if (elementKey === "ctaPrimary" || elementKey === "ctaSecondary") {
    const button = element?.button;
    const solid = button?.variant === "SOLID" || button?.variant == null;
    const linkStyle: CSSProperties = {
      background: solid ? safeHex(button?.background ?? null, DEFAULT_TEXT_COLOR) : undefined,
      color: solid ? safeHex(button?.textColor ?? null, "#FFFFFF") : undefined,
      border:
        button?.variant === "OUTLINE"
          ? `1px solid ${safeHex(button?.borderColor ?? null, DEFAULT_TEXT_COLOR)}`
          : undefined,
      textDecoration: button?.variant === "LINK" ? "underline" : undefined,
      borderRadius: `${numOr(button?.borderRadius, 0)}px`,
      ...responsiveButtonStyle(button),
    };

    if (!edit && !preview) {
      const href = element?.linkHref ?? null;
      // Empty/unresolved link: do not render that CTA.
      if (!href) return null;
      return (
        <a
          href={href}
          data-hero-button
          data-hero-button-size={button?.size ?? "MD"}
          className="inline-flex items-center justify-center"
          style={linkStyle}
          {...trackAttrs(
            "HeroClick",
            section,
            elementKey === "ctaPrimary" ? 1 : 2,
          )}
        >
          {text}
          {button?.arrow === true ? <HeroButtonArrow /> : null}
        </a>
      );
    }
    const buttonNode = (
      <span
        data-hero-button
        data-hero-button-size={button?.size ?? "MD"}
        className="inline-flex items-center justify-center"
        style={linkStyle}
      >
        {text}
        {button?.arrow === true ? <HeroButtonArrow /> : null}
      </span>
    );
    if (edit?.selectedElementKey !== elementKey) return buttonNode;
    // The selected CTA gets its own control frame hugging the real button box;
    // the canvas attaches pointer resize logic to these handles.
    return (
      <span
        data-hero-cta-frame
        className="relative inline-flex outline-2 outline-offset-2 outline-cta"
      >
        {buttonNode}
        {RESIZE_HANDLES.map(({ direction, className }) => (
          <span
            key={direction}
            data-hero-resize-handle={direction}
            aria-hidden="true"
            className={`absolute z-10 rounded-[2px] border border-cta bg-white shadow-sm ${className}`}
          />
        ))}
      </span>
    );
  }

  // The storefront home has exactly one page-level heading; the legacy
  // `HeroSection` rendered it as <h1> and the semantic tag must survive the
  // builder swap. Edit mode keeps a span so the admin canvas never injects a
  // stray page h1. Styling is fully builder-controlled (Task 19) — only the
  // tag is restored. Fix round 2 (Important 3).
  if (elementKey === "heading") {
    return edit ? <span>{text}</span> : <h1>{text}</h1>;
  }

  return <span>{text}</span>;
}

function readTextViewAlign(style: Record<string, unknown> | undefined): string {
  const align = style?.textAlign;
  return typeof align === "string" ? align : "";
}

const RESIZE_HANDLES = [
  { direction: "nw", className: "-left-1 -top-1 h-2.5 w-2.5 cursor-nwse-resize" },
  { direction: "n", className: "-top-1 left-1/2 h-2 w-4 -translate-x-1/2 cursor-ns-resize" },
  { direction: "ne", className: "-right-1 -top-1 h-2.5 w-2.5 cursor-nesw-resize" },
  { direction: "e", className: "-right-1 top-1/2 h-4 w-2 -translate-y-1/2 cursor-ew-resize" },
  { direction: "se", className: "-bottom-1 -right-1 h-2.5 w-2.5 cursor-nwse-resize" },
  { direction: "s", className: "-bottom-1 left-1/2 h-2 w-4 -translate-x-1/2 cursor-ns-resize" },
  { direction: "sw", className: "-bottom-1 -left-1 h-2.5 w-2.5 cursor-nesw-resize" },
  { direction: "w", className: "-left-1 top-1/2 h-4 w-2 -translate-y-1/2 cursor-ew-resize" },
] as const;

function responsiveButtonStyle(
  button: HomepageHeroButton | undefined,
): ResponsiveButtonStyle {
  const paddingX = numOr(button?.paddingX, 24);
  const paddingY = numOr(button?.paddingY, 14);
  const scaled = (value: number, device: HomepageDevice): string =>
    `${Math.round(value * BUTTON_DEVICE_SCALE[device] * 100) / 100}px`;

  return {
    "--hp-hero-button-padding-x-desktop": scaled(paddingX, "desktop"),
    "--hp-hero-button-padding-y-desktop": scaled(paddingY, "desktop"),
    "--hp-hero-button-padding-x-tablet": scaled(paddingX, "tablet"),
    "--hp-hero-button-padding-y-tablet": scaled(paddingY, "tablet"),
    "--hp-hero-button-padding-x-mobile": scaled(paddingX, "mobile"),
    "--hp-hero-button-padding-y-mobile": scaled(paddingY, "mobile"),
  };
}

function numOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function SelectionChrome(): ReactNode {
  return (
    <div
      data-hero-selection-box
      aria-hidden="true"
      className="pointer-events-none absolute -inset-1 border-2 border-dashed border-cta"
    >
      {HANDLE_CORNERS.map((corner) => (
        <span
          key={corner}
          data-hero-handle={corner}
          className={`absolute h-3 w-3 rounded-[2px] border border-cta bg-white ${HANDLE_CLASSES[corner]}`}
        />
      ))}
    </div>
  );
}

const HANDLE_CORNERS = ["nw", "ne", "sw", "se"] as const;

const HANDLE_CLASSES: Record<(typeof HANDLE_CORNERS)[number], string> = {
  nw: "-left-1.5 -top-1.5",
  ne: "-right-1.5 -top-1.5",
  sw: "-left-1.5 -bottom-1.5",
  se: "-right-1.5 -bottom-1.5",
};

function Pagination({
  behavior,
  slides,
  activeIndex,
  hovered,
  reducedMotion,
  goTo,
}: {
  behavior: SliderBehavior;
  slides: HomepageHeroSlide[];
  activeIndex: number;
  hovered: boolean;
  reducedMotion: boolean;
  goTo: (next: number) => void;
}): ReactNode {
  const paused =
    reducedMotion || (behavior.pauseOnHover && hovered);

  if (behavior.pagination === "COUNTER") {
    const label = `${String(activeIndex + 1).padStart(2, "0")} / ${String(
      slides.length,
    ).padStart(2, "0")}`;
    return (
      <div
        data-pag-counter
        className="absolute inset-x-0 bottom-4 z-30 flex justify-center text-sm font-semibold tracking-widest text-white"
      >
        {label}
      </div>
    );
  }

  if (behavior.pagination === "PROGRESS") {
    return (
      <div
        data-pag-progress
        className="absolute inset-x-0 bottom-0 z-30 h-1 bg-white/25"
      >
        <div
          key={activeIndex}
          role="progressbar"
          aria-label="Slide progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={0}
          className="h-full bg-white"
          style={{
            animation: reducedMotion
              ? undefined
              : `hpHeroProgress ${behavior.durationMs}ms linear forwards`,
            animationPlayState: paused ? "paused" : "running",
          }}
        />
      </div>
    );
  }

  return (
    <div
      data-pag-dots
      className="absolute inset-x-0 bottom-4 z-30 flex justify-center gap-2"
    >
      {slides.map((slide, index) => {
        const active = index === activeIndex;
        return (
          <button
            key={slide.id}
            type="button"
            data-pag-dot
            aria-label={`Go to slide ${index + 1}`}
            aria-current={active ? "true" : undefined}
            onClick={() => goTo(index)}
            className={`h-2.5 w-2.5 rounded-full transition-colors ${
              active ? "bg-white" : "bg-white/40 hover:bg-white/70"
            }`}
          />
        );
      })}
    </div>
  );
}

function SpeakerOnIcon(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true" fill="currentColor">
      <path d="M2 6v4h2.5L8 13V3L4.5 6H2Z" />
      <path d="M10.5 4.7a4 4 0 0 1 0 6.6l.8 1.2a5.5 5.5 0 0 0 0-9l-.8 1.2Z" />
      <path d="M12 8a6.7 6.7 0 0 0-1.7-4.4l-.9 1.1a5 5 0 0 1 0 6.6l.9 1.1A6.7 6.7 0 0 0 12 8Z" />
    </svg>
  );
}

function SpeakerOffIcon(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true" fill="currentColor">
      <path d="M2 6v4h2.5L8 13V3L4.5 6H2Z" />
      <path d="m11 6 2.5 2.5L16 6l-.7-.7L12.7 7.8 10.3 5.3 9.6 6l2.1 2.1L9.6 10Z" />
    </svg>
  );
}

/**
 * The reference design's trailing arrow on CTA buttons (rendered only when the
 * button's `arrow` is explicitly true). The glyph scales with the button label
 * (`em`), sits one gap after it, and is aria-hidden like every decorative icon
 * here. It renders in read-only AND edit mode so the admin canvas matches the
 * storefront exactly.
 */
function HeroButtonArrow(): ReactNode {
  return (
    <svg
      data-hero-btn-arrow
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="inline-block h-[0.9em] w-[0.9em] shrink-0"
      style={{ marginLeft: "0.43em" }}
    >
      <path d="M2 8h11.5" />
      <path d="m9.5 3.5 4.5 4.5-4.5 4.5" />
    </svg>
  );
}