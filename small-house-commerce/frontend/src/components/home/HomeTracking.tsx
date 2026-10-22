"use client";

import { useEffect } from "react";
import { trackCustom } from "@/lib/tracking";
import { trackFirstParty } from "@/lib/analytics";
import type { HomepageTrackEvent } from "@/lib/home-tracking";

/**
 * Homepage tracking.
 *
 * Two channels, on purpose:
 *   - the existing Meta custom events (`HomepageView`, `HeroClick`, …), which
 *     the marketing team already reads;
 *   - the first-party events the dashboard reads: a section impression fires
 *     only when the section actually scrolls into view, and a section click
 *     carries where the visitor went.
 *
 * Sections are located by the `data-homepage-section-id` / `-type` attributes
 * the homepage page puts on every section wrapper, so no section component
 * needs to know about analytics.
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

  useEffect(() => {
    const sections = Array.from(
      document.querySelectorAll<HTMLElement>("[data-homepage-section-id]"),
    );
    if (sections.length === 0) return;

    // A section counts as seen once a quarter of it is on screen; below that
    // a visitor only glanced past it.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const element = entry.target as HTMLElement;
          observer.unobserve(element);
          const sectionId = element.dataset.homepageSectionId;
          if (!sectionId) continue;
          trackFirstParty("HOMEPAGE_SECTION_IMPRESSION", {
            sectionId,
            sectionType: element.dataset.homepageSectionType ?? null,
          });
        }
      },
      { threshold: 0.25 },
    );
    for (const section of sections) observer.observe(section);

    const onSectionClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const section = target?.closest<HTMLElement>("[data-homepage-section-id]");
      if (!section) return;
      const sectionId = section.dataset.homepageSectionId;
      if (!sectionId) return;
      const anchor = target?.closest<HTMLAnchorElement>("a[href]");
      const destination = anchor?.getAttribute("href") ?? null;
      trackFirstParty("HOMEPAGE_SECTION_CLICK", {
        sectionId,
        sectionType: section.dataset.homepageSectionType ?? null,
        destination,
        // The slug is the best product identifier the DOM carries; the backend
        // resolves it to a product id when the link points at a product.
        entityId: productSlugFrom(destination),
      });
    };
    document.addEventListener("click", onSectionClick);

    return () => {
      observer.disconnect();
      document.removeEventListener("click", onSectionClick);
    };
  }, []);

  return null;
}

/** `/products/some-slug` → `some-slug`; null for any other destination. */
function productSlugFrom(destination: string | null): string | null {
  if (!destination) return null;
  const match = destination.match(/\/products\/([^/?#]+)/);
  return match ? match[1] : null;
}
