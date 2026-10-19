"use client";

import type { ReactNode } from "react";
import { useAdminI18n, type TKey } from "@/lib/admin-i18n";
import { useHomepageEditor } from "@/components/admin/homepage/HomepageEditor";
import { DeviceField } from "./SectionStyleFields";
import { patchResponsiveFields } from "@/lib/homepage-responsive";
import { useBufferedValue } from "@/components/admin/homepage/AnnouncementSettings";
import {
  ColorField,
  Group,
  NumberField,
  SelectField,
} from "@/components/admin/homepage/SettingsPanel";
import {
  updateHeroBehavior,
  updateHeroSlide,
  type HomepageDocument,
  type HomepageSection,
  type SlideOverlay,
  type OverlayFields,
  type HomepageDevice,
} from "@/lib/homepage-document";

/**
 * Right pane, section/slide mode (ledger Ruling 31): the HERO slider behavior
 * for the section plus the per-slide overlay for the selected slide.
 *
 * The behavior fields clamp to the backend ranges (durationMs 3000–15000,
 * manualPauseMs 0–60000) and the overlay opacity is a coalesced slider; both
 * commit through the race-safe `mutate` action (ledger Ruling 32) so a burst
 * is one history entry and a patch is always merged into the latest overlay.
 */

const OVERLAY_COMMIT_DELAY_MS = 800;
const NUMBER_DRAFT_PATTERN = /^-?\d+(\.\d+)?$/;

const DURATION_MIN_MS = 3000;
const DURATION_MAX_MS = 15000;
const MANUAL_PAUSE_MIN_MS = 0;
const MANUAL_PAUSE_MAX_MS = 60000;

const TRANSITIONS = ["FADE", "SLIDE"] as const;
const PAGINATIONS = ["DOTS", "COUNTER", "PROGRESS"] as const;
const GRADIENTS = ["NONE", "BOTTOM", "FULL", "LOCAL"] as const;

const TRANSITION_LABEL_KEYS: Record<(typeof TRANSITIONS)[number], TKey> = {
  FADE: "homepage_builder_transition_FADE",
  SLIDE: "homepage_builder_transition_SLIDE",
};

const PAGINATION_LABEL_KEYS: Record<(typeof PAGINATIONS)[number], TKey> = {
  DOTS: "homepage_builder_pagination_DOTS",
  COUNTER: "homepage_builder_pagination_COUNTER",
  PROGRESS: "homepage_builder_pagination_PROGRESS",
};

const GRADIENT_LABEL_KEYS: Record<(typeof GRADIENTS)[number], TKey> = {
  NONE: "homepage_builder_overlay_gradient_NONE",
  BOTTOM: "homepage_builder_overlay_gradient_BOTTOM",
  FULL: "homepage_builder_overlay_gradient_FULL",
  LOCAL: "homepage_builder_overlay_gradient_LOCAL",
};

type HeroSection = Extract<HomepageSection, { type: "HERO" }>;
type DocumentMutation = (document: HomepageDocument) => HomepageDocument;

function firstHero(document: HomepageDocument): HeroSection | null {
  const section = document.sections.find(({ type }) => type === "HERO");
  return section?.type === "HERO" ? section : null;
}

function findSlide(document: HomepageDocument, slideId: string | null) {
  if (slideId === null) return null;
  for (const section of document.sections) {
    if (section.type !== "HERO") continue;
    const slide = section.payload.slides.find(
      (candidate) => candidate.id === slideId,
    );
    if (slide) return slide;
  }
  return null;
}

/**
 * Overlay edits merge into the slide's latest overlay: `updateHeroSlide`
 * replaces the overlay object wholesale, so a patch built from a stale
 * snapshot would drop a concurrent colour/gradient edit.
 */
function slideOverlayDocument(
  document: HomepageDocument,
  slideId: string,
  patch: Partial<OverlayFields>,
  device: HomepageDevice,
): HomepageDocument {
  const slide = findSlide(document, slideId);
  if (!slide) return document;
  return updateHeroSlide(document, slideId, {
    overlay: patchResponsiveFields(slide.overlay, device, patch) as SlideOverlay,
  });
}

function CheckboxField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}): ReactNode {
  return (
    <label className="flex items-center gap-2 text-xs text-ink">
      <input
        type="checkbox"
        className="h-4 w-4 accent-cta"
        checked={checked}
        aria-label={label}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}

/** Coalesced opacity slider: one history entry per drag burst. */
function OpacitySlider({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
}): ReactNode {
  const field = useBufferedValue(
    String(value),
    (next) => {
      const parsed = Number(next);
      if (!Number.isFinite(parsed)) return;
      onCommit(Math.min(1, Math.max(0, parsed)));
    },
    (next) => NUMBER_DRAFT_PATTERN.test(next),
    OVERLAY_COMMIT_DELAY_MS,
  );
  const displayed = Number(field.value);

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-ink-secondary">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="range"
          className="min-w-0 flex-1 accent-cta"
          min={0}
          max={1}
          step={0.05}
          aria-label={label}
          value={Number.isFinite(displayed) ? displayed : value}
          onChange={(event) => field.change(event.target.value)}
          onBlur={field.blur}
        />
        <span className="w-10 shrink-0 text-right text-xs tabular-nums text-ink-muted">
          {Number.isFinite(displayed) ? displayed : value}
        </span>
      </div>
    </div>
  );
}

export function HeroStyleSettings({ embedded = false, group }: { embedded?: boolean; group?: "overlay" | "behavior" } = {}): ReactNode {
  const { t } = useAdminI18n();
  const { state, dispatch, selectedSlideId, device } = useHomepageEditor();
  const document = state.document;
  const hero = firstHero(document);
  const slide = findSlide(document, selectedSlideId) ?? (embedded ? hero?.payload.slides[0] : null);
  const overlay = slide ? { ...slide.overlay, ...(device === "desktop" ? {} : slide.overlay.overrides?.[device]) } : null;

  const commit = (next: HomepageDocument): void => {
    dispatch({ type: "commit", document: next });
  };
  const applyMutation = (mutate: DocumentMutation): void => {
    dispatch({ type: "mutate", mutate });
  };

  return (
    <div
      data-panel="hero-style-settings"
      className={embedded ? "flex min-w-0 flex-col gap-3" : "flex min-h-[320px] flex-col gap-3 rounded-xl border border-border bg-card p-4"}
    >
      {!embedded ? <h2 className="text-sm font-semibold text-ink">
        {t("homepage_builder_pane_settings")}
      </h2> : null}

      {hero && group !== "overlay" ? (
        <Group title={t("homepage_builder_group_behavior")}>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            <CheckboxField
              label={t("homepage_builder_field_autoplay")}
              checked={hero.payload.behavior.autoplay}
              onChange={(checked) =>
                commit(updateHeroBehavior(document, { autoplay: checked }))
              }
            />
            <CheckboxField
              label={t("homepage_builder_field_pause_on_hover")}
              checked={hero.payload.behavior.pauseOnHover}
              onChange={(checked) =>
                commit(updateHeroBehavior(document, { pauseOnHover: checked }))
              }
            />
            <CheckboxField
              label={t("homepage_builder_field_arrows")}
              checked={hero.payload.behavior.arrows}
              onChange={(checked) =>
                commit(updateHeroBehavior(document, { arrows: checked }))
              }
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label={t("homepage_builder_field_duration_ms")}
              value={hero.payload.behavior.durationMs}
              min={DURATION_MIN_MS}
              max={DURATION_MAX_MS}
              onCommit={(value) =>
                applyMutation((doc) =>
                  updateHeroBehavior(doc, { durationMs: value }),
                )
              }
            />
            <NumberField
              label={t("homepage_builder_field_manual_pause_ms")}
              value={hero.payload.behavior.manualPauseMs}
              min={MANUAL_PAUSE_MIN_MS}
              max={MANUAL_PAUSE_MAX_MS}
              onCommit={(value) =>
                applyMutation((doc) =>
                  updateHeroBehavior(doc, { manualPauseMs: value }),
                )
              }
            />
            <SelectField
              label={t("homepage_builder_field_transition")}
              value={hero.payload.behavior.transition}
              options={TRANSITIONS}
              labelKeys={TRANSITION_LABEL_KEYS}
              onChange={(value) =>
                commit(updateHeroBehavior(document, { transition: value }))
              }
            />
            <SelectField
              label={t("homepage_builder_field_pagination")}
              value={hero.payload.behavior.pagination}
              options={PAGINATIONS}
              labelKeys={PAGINATION_LABEL_KEYS}
              onChange={(value) =>
                commit(updateHeroBehavior(document, { pagination: value }))
              }
            />
          </div>
        </Group>
      ) : null}

      {slide && overlay && group !== "behavior" ? (
        <Group key={`${slide.id}:${device}`} title={t("homepage_builder_group_overlay")}>
          <p className="text-xs text-ink-muted">{t("homepage_builder_display_overlay_note")}</p>
          <DeviceField device={device} overridden={device !== "desktop" && slide.overlay.overrides?.[device]?.color !== undefined}
            resetLabel={`${t("homepage_builder_field_overlay_color")}: ${t("homepage_builder_clear_inherit")}`}
            onReset={device === "desktop" ? undefined : () => applyMutation((doc) => slideOverlayDocument(doc, slide.id, { color: undefined }, device))}>
            <ColorField label={t("homepage_builder_field_overlay_color")} value={overlay.color}
              mutate={(doc, hex) => slideOverlayDocument(doc, slide.id, { color: hex }, device)} />
          </DeviceField>
          <DeviceField device={device} overridden={device !== "desktop" && slide.overlay.overrides?.[device]?.gradient !== undefined}
            resetLabel={`${t("homepage_builder_field_overlay_gradient")}: ${t("homepage_builder_clear_inherit")}`}
            onReset={device === "desktop" ? undefined : () => applyMutation((doc) => slideOverlayDocument(doc, slide.id, { gradient: undefined }, device))}>
            <SelectField label={t("homepage_builder_field_overlay_gradient")} value={overlay.gradient}
              options={GRADIENTS} labelKeys={GRADIENT_LABEL_KEYS}
              onChange={(gradient) => applyMutation((doc) => slideOverlayDocument(doc, slide.id, { gradient }, device))} />
          </DeviceField>
          <DeviceField device={device} overridden={device !== "desktop" && slide.overlay.overrides?.[device]?.opacity !== undefined}
            resetLabel={`${t("homepage_builder_field_overlay_opacity")}: ${t("homepage_builder_clear_inherit")}`}
            onReset={device === "desktop" ? undefined : () => applyMutation((doc) => slideOverlayDocument(doc, slide.id, { opacity: undefined }, device))}>
            <OpacitySlider label={t("homepage_builder_field_overlay_opacity")} value={overlay.opacity}
              onCommit={(opacity) => applyMutation((doc) => slideOverlayDocument(doc, slide.id, { opacity }, device))} />
          </DeviceField>
          {device !== "desktop" ? <button type="button" className="self-start text-xs text-cta"
            aria-label={t("homepage_builder_display_reset_overlay")}
            onClick={() => applyMutation((doc) => slideOverlayDocument(doc, slide.id, { color: undefined, opacity: undefined, gradient: undefined }, device))}>
            {t("homepage_builder_display_reset_overlay_action")}
          </button> : null}
        </Group>
      ) : null}
    </div>
  );
}
