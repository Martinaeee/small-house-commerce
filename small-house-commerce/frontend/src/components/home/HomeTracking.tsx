"use client";

import { useEffect } from "react";
import { trackCustom } from "@/lib/tracking";
import type { HomepageTrackEvent } from "@/lib/home-tracking";

/**
 * Fires HomepageView once and delegates every section click via data-* attrs.
 * Standard Pixel events (ViewContent/AddToCart/…) are untouched elsewhere.
 */
export function HomeTracking() {
  useEffect(() => {
    trackCustom("HomepageView", {});

    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const el = target?.closest<HTMLElement>("[data-track-event]");
      if (!el) return;
      const name = el.dataset.trackEvent as HomepageTrackEvent | undefined;
      if (!name) return;
      const position = el.dataset.sectionPosition;
      trackCustom(name, {
        section_id: el.dataset.sectionId ?? "",
        section_name: el.dataset.sectionName ?? "",
        ...(position === undefined ? {} : { position: Number(position) }),
      });
    };

    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  return null;
}
