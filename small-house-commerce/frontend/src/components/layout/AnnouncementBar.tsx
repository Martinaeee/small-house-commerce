"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { safeHex } from "@/lib/homepage-styles";
import type { AnnouncementBlockView, AnnouncementItemView } from "@/lib/api";

/**
 * Site-wide announcement bar (HOMEPAGE_SPEC §5.1 / design §6.2). Sits above
 * the sticky header on every page and scrolls away with the page.
 *
 * Data comes from `getAnnouncement()` in the storefront layout; the backend
 * already filtered the items by enablement + schedule and resolved each
 * `linkHref`. This component:
 * - renders nothing without data, for a disabled block, or with no enabled item;
 * - shows a single item statically, several by rotating on `rotationMs`;
 * - pauses rotation on hover; prefers-reduced-motion disables rotation
 *   entirely and pins the first enabled item;
 * - re-clamps item colors through `safeHex` (defense in depth — the server
 *   whitelists, but the payload crosses the network);
 * - renders the whole item as a link when `linkHref` exists (accessible name
 *   = item text + linkLabel suffix); without it the text renders plain.
 */

/** Mirrors the document schema floor (2000–30000ms) with a safe default. */
const MIN_ROTATION_MS = 2000;
const DEFAULT_ROTATION_MS = 5000;
/** Theme tokens: the bar's look before any item color is applied. */
const DEFAULT_BACKGROUND = "#6b4f3a"; // --color-cta
const DEFAULT_TEXT_COLOR = "#FFFFFF";

function rotationIntervalMs(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_ROTATION_MS;
  }
  return Math.max(Math.round(value), MIN_ROTATION_MS);
}

function isRenderableItem(item: unknown): item is AnnouncementItemView {
  if (item === null || typeof item !== "object") return false;
  const candidate = item as Partial<AnnouncementItemView>;
  return candidate.enabled === true && typeof candidate.text === "string";
}

export function AnnouncementBar({
  data,
}: {
  data: AnnouncementBlockView | null;
}): ReactNode {
  const items = useMemo(
    () => (Array.isArray(data?.items) ? data.items : []).filter(isRenderableItem),
    [data],
  );
  const rotationMs = rotationIntervalMs(data?.rotationMs);
  const reducedMotion = usePrefersReducedMotion();
  const [activeIndex, setActiveIndex] = useState(0);
  // Hover pause lives in a ref so the interval can skip ticks without
  // rescheduling; the effect below clears a stale pause (see Minor 2 fix).
  const hoveredRef = useRef(false);

  useEffect(() => {
    if (reducedMotion || items.length < 2) {
      // The bar shows nothing (or a single static item) and its div is gone,
      // so a pointer that was over it never fired mouseleave. Clear the stale
      // pause so rotation resumes when items come back on the same instance.
      hoveredRef.current = false;
      return undefined;
    }
    const id = setInterval(() => {
      if (hoveredRef.current) return;
      setActiveIndex((current) => (current + 1) % items.length);
    }, rotationMs);
    return () => clearInterval(id);
  }, [items.length, reducedMotion, rotationMs]);

  if (!data || !data.enabled || items.length === 0) return null;

  const item = reducedMotion ? items[0] : items[activeIndex % items.length];
  const linkLabel = item.linkLabel;

  return (
    <div
      data-announcement-bar
      className="bg-cta px-4 py-2 text-center text-xs font-medium text-cta-foreground sm:text-sm"
      style={{
        backgroundColor: safeHex(item.backgroundColor, DEFAULT_BACKGROUND),
        color: safeHex(item.textColor, DEFAULT_TEXT_COLOR),
      }}
      onMouseEnter={() => {
        hoveredRef.current = true;
      }}
      onMouseLeave={() => {
        hoveredRef.current = false;
      }}
    >
      {item.linkHref ? (
        <a
          href={item.linkHref}
          className="inline-flex items-center justify-center"
        >
          <span>{item.text}</span>
          {linkLabel ? (
            <>
              {" "}
              <span className="underline underline-offset-2">{linkLabel}</span>
            </>
          ) : null}
        </a>
      ) : (
        item.text
      )}
    </div>
  );
}

// Same pattern as HeroSlider: a local matchMedia-backed store so SSR renders
// the static first item and hydration can flip to reduced-motion instantly.
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
