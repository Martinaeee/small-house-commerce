import type { HomepageSection } from "./api";

export type HomepageTrackEvent =
  | "HomepageView"
  | "HeroClick"
  | "CategoryClick"
  | "SolutionClick"
  | "ProductClick";

/**
 * Data attributes consumed by the HomeTracking delegated click listener
 * (names per spec §5.7). Spread onto any clickable element; closest() catches
 * nested clicks.
 */
export function trackAttrs(
  event: HomepageTrackEvent,
  section: Pick<HomepageSection, "id" | "title">,
  position?: number,
): Record<string, string> {
  return {
    "data-track-event": event,
    "data-section-id": section.id,
    "data-section-name": section.title ?? "",
    ...(position === undefined ? {} : { "data-section-position": String(position) }),
  };
}
