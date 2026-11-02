"use client";

import { useSyncExternalStore } from "react";

/**
 * The purchase-layout switch. Below `lg` (1024px) — the same breakpoint as
 * the desktop two-column product layouts — phones and tablets buy through
 * the fixed purchase bar and the shared variant drawer; at `lg` and up the
 * inline Cash on Delivery form stays on the page.
 */
export const DESKTOP_VIEWPORT_QUERY = "(min-width: 1024px)";

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => undefined;
  }
  const media = window.matchMedia(DESKTOP_VIEWPORT_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function snapshot(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(DESKTOP_VIEWPORT_QUERY).matches
  );
}

/**
 * `useSyncExternalStore` keeps the first client render consistent with the
 * server snapshot (mobile layout) and re-renders when the viewport crosses
 * the breakpoint, so a resized desktop window mounts or drops the inline
 * form instead of leaving it hidden but alive.
 */
export function useDesktopViewport(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
