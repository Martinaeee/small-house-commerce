"use client";

import type { ReactNode } from "react";
import { useAdminI18n } from "@/lib/admin-i18n";
import { useHomepageEditor } from "@/components/admin/homepage/HomepageEditor";
import { LinkPicker } from "@/components/admin/homepage/LinkPicker";
import {
  addHeroZone,
  newUuid,
  removeHeroZone,
  updateHeroSlideLinks,
  updateHeroZone,
  type HeroLinkZone,
  type LinkValue,
} from "@/lib/homepage-document";

/**
 * The hero's links (spec: banner links).
 *
 * A slide navigates in one of two ways: only its CTA buttons navigate
 * (BUTTON), or the whole banner navigates (SLIDE). In either mode the
 * operator can paint clickable rectangles over the picture ("zones"); a zone
 * with a background colour shows it, a transparent one is an invisible
 * hotspot. Every slide keeps its own targets, so a carousel can send each
 * picture somewhere different.
 */
export function HeroLinkSettings(): ReactNode {
  const { t } = useAdminI18n();
  const {
    state,
    dispatch,
    selectedSlideId,
    selectedZoneId,
    zoneToolArmed,
    setSelectedZoneId,
    setZoneToolArmed,
  } = useHomepageEditor();

  const hero = state.document.sections.find((section) => section.type === "HERO");
  const slide =
    hero?.type === "HERO"
      ? (hero.payload.slides.find((item) => item.id === selectedSlideId) ??
        hero.payload.slides[0])
      : undefined;

  if (!slide) {
    return (
      <p className="text-xs text-ink-muted">
        {t("homepage_builder_hero_links_no_slide")}
      </p>
    );
  }

  const zones = slide.zones ?? [];
  const linkMode = slide.linkMode ?? "BUTTON";

  const commit = (mutate: (document: typeof state.document) => typeof state.document): void => {
    dispatch({ type: "mutate", mutate });
  };

  const setMode = (mode: "BUTTON" | "SLIDE"): void => {
    commit((doc) => updateHeroSlideLinks(doc, slide.id, { linkMode: mode }));
  };

  const setSlideLink = (link: LinkValue | null): void => {
    commit((doc) => updateHeroSlideLinks(doc, slide.id, { slideLink: link }));
  };

  const setZoneLink = (zone: HeroLinkZone, link: LinkValue | null): void => {
    commit((doc) => updateHeroZone(doc, slide.id, zone.id, { link }));
  };

  const setZoneBackground = (
    zone: HeroLinkZone,
    background: Partial<HeroLinkZone["background"]>,
  ): void => {
    commit((doc) => updateHeroZone(doc, slide.id, zone.id, { background }));
  };

  const removeZone = (zone: HeroLinkZone): void => {
    commit((doc) => removeHeroZone(doc, slide.id, zone.id));
    if (selectedZoneId === zone.id) setSelectedZoneId(null);
  };

  return (
    <div data-panel="hero-links" className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-1">
        <legend className="text-xs font-medium text-ink-secondary">
          {t("homepage_builder_hero_link_mode")}
        </legend>
        <label className="flex items-center gap-2 text-xs text-ink">
          <input
            type="radio"
            name="hero-link-mode"
            className="h-3.5 w-3.5 accent-cta"
            checked={linkMode === "BUTTON"}
            onChange={() => setMode("BUTTON")}
          />
          {t("homepage_builder_hero_link_mode_button")}
        </label>
        <label className="flex items-center gap-2 text-xs text-ink">
          <input
            type="radio"
            name="hero-link-mode"
            className="h-3.5 w-3.5 accent-cta"
            checked={linkMode === "SLIDE"}
            onChange={() => setMode("SLIDE")}
          />
          {t("homepage_builder_hero_link_mode_slide")}
        </label>
      </fieldset>

      {linkMode === "SLIDE" ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-secondary">
            {t("homepage_builder_hero_slide_link")}
          </span>
          <LinkPicker
            value={slide.slideLink ?? null}
            allowExternal
            allowSubscribe
            onChange={setSlideLink}
          />
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-ink-secondary">
          {t("homepage_builder_hero_zones")}
        </span>
        <p className="text-xs text-ink-muted">
          {t("homepage_builder_hero_zones_hint")}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-hero-zone-draw
            aria-pressed={zoneToolArmed}
            className={`flex w-fit items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold ${
              zoneToolArmed
                ? "border-cta bg-cta text-cta-foreground"
                : "border-cta/40 text-cta hover:bg-primary-light/40"
            }`}
            onClick={() => setZoneToolArmed((current) => !current)}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden="true"
              className="h-4 w-4"
            >
              <path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4" />
            </svg>
            {t(
              zoneToolArmed
                ? "homepage_builder_hero_zone_tool_stop"
                : "homepage_builder_hero_zone_draw",
            )}
          </button>
          {zoneToolArmed ? (
            <p className="text-xs text-ink-secondary">
              {t("homepage_builder_hero_zone_tool_hint")}
            </p>
          ) : null}
          <button
            type="button"
            data-hero-zone-add
            className="w-fit rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-ink-secondary hover:bg-surface"
            onClick={() => {
              const id = newUuid();
              commit((doc) =>
                addHeroZone(
                  doc,
                  slide.id,
                  { xPct: 35, yPct: 35, widthPct: 30, heightPct: 25 },
                  id,
                ),
              );
              setSelectedZoneId(id);
            }}
          >
            {t("homepage_builder_hero_zone_add")}
          </button>
        </div>
        {zones.length === 0 ? (
          <p className="text-xs text-ink-muted">
            {t("homepage_builder_hero_zones_empty")}
          </p>
        ) : null}
        <ul className="flex flex-col gap-2">
          {zones.map((zone, index) => (
            <li
              key={zone.id}
              data-hero-zone-settings={zone.id}
              className={`flex flex-col gap-2 rounded-lg border p-2 ${
                selectedZoneId === zone.id ? "border-cta" : "border-border"
              }`}
            >
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="rounded px-1.5 py-1 text-xs font-semibold tabular-nums text-ink-secondary hover:text-cta"
                  aria-label={t("homepage_builder_hero_zone_select", {
                    index: index + 1,
                  })}
                  aria-pressed={selectedZoneId === zone.id}
                  onClick={() => setSelectedZoneId(zone.id)}
                >
                  {String(index + 1).padStart(2, "0")}
                </button>
                <span className="min-w-0 flex-1 truncate text-xs text-ink-secondary">
                  {t("homepage_builder_hero_zone_title", { index: index + 1 })}
                </span>
                <button
                  type="button"
                  className="rounded px-1.5 py-1 text-sm text-ink-muted hover:text-sale"
                  aria-label={t("homepage_builder_hero_zone_delete")}
                  onClick={() => removeZone(zone)}
                >
                  ✕
                </button>
              </div>
              <LinkPicker
                value={zone.link}
                allowExternal
                allowSubscribe
                onChange={(next) => setZoneLink(zone, next)}
              />
              <label className="flex items-center gap-2 text-xs text-ink-secondary">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-cta"
                  checked={zone.background.visible}
                  onChange={(event) =>
                    setZoneBackground(zone, { visible: event.target.checked })
                  }
                />
                {t("homepage_builder_hero_zone_show_background")}
              </label>
              <label className="flex items-center gap-2 text-xs text-ink-secondary">
                {t("homepage_builder_hero_zone_background")}
                <input
                  type="color"
                  className="h-7 w-8 rounded border border-border bg-card p-0.5"
                  value={zone.background.color}
                  onChange={(event) =>
                    setZoneBackground(zone, { color: event.target.value })
                  }
                />
              </label>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
