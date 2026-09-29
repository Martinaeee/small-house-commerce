"use client";

import type { ReactNode } from "react";
import { useAdminI18n, type TKey } from "@/lib/admin-i18n";
import { useHomepageEditor, type BuilderDevice } from "@/components/admin/homepage/HomepageEditor";
import { LinkPicker } from "@/components/admin/homepage/LinkPicker";
import {
  swatchColor,
  useBufferedText,
  useBufferedValue,
} from "@/components/admin/homepage/AnnouncementSettings";
import { isoToLocalInput } from "@/lib/datetime-input";
import {
  resetElementLayout,
  setElementOverride,
  updateHeroElement,
  type ElementLayout,
  type ElementStyle,
  type HeroElement,
  type HeroElementKey,
  type HeroElementPatch,
  type HeroSlide,
  type HomepageDocument,
  type HomepageSection,
  type HorizontalAlign,
  type VerticalAlign,
} from "@/lib/homepage-document";

/**
 * Right pane, element mode (ledger Ruling 31): the grouped settings for the
 * selected `selectedElementKey` on the selected slide.
 *
 *   Content      text, link (CTAs), countdown endsAt
 *   Typography   size/weight/line height/letter spacing/colour/align/max width,
 *                each with an "inherit" clear that removes the property
 *   Position     x/y/width, align/verticalAlign, reset, lock
 *   Responsive   only off desktop: edits target `overrides[device]` and a
 *                reset restores the desktop values
 *   Style        the offer chip / CTA button sets for the matching element key
 *
 * Commit discipline (ledger Ruling 32): text and colour fields buffer with a
 * 300 ms debounce, numeric fields coalesce an 800 ms burst per field, and all
 * of them dispatch the race-safe `mutate` action; synchronous clicks, toggles
 * and selects dispatch `commit`.
 */

const TEXT_COMMIT_DELAY_MS = 300;
const NUMBER_COMMIT_DELAY_MS = 800;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const NUMBER_DRAFT_PATTERN = /^-?\d+(\.\d+)?$/;

const FONT_WEIGHT_OPTIONS = ["400", "500", "600", "700", "800"] as const;
type FontWeightOption = (typeof FONT_WEIGHT_OPTIONS)[number];

const FONT_WEIGHT_VALUES: Record<FontWeightOption, 400 | 500 | 600 | 700 | 800> =
  { "400": 400, "500": 500, "600": 600, "700": 700, "800": 800 };

const TEXT_ALIGNS: HorizontalAlign[] = ["LEFT", "CENTER", "RIGHT"];
const VERTICAL_ALIGNS: VerticalAlign[] = ["TOP", "MIDDLE", "BOTTOM"];
const BUTTON_VARIANTS = ["SOLID", "OUTLINE", "LINK"] as const;
const BUTTON_SIZES = ["SM", "MD", "LG"] as const;

/** The five nullable CTA colours, each with a clear-to-null button. */
const BUTTON_COLOR_FIELDS: ReadonlyArray<{
  prop:
    | "background"
    | "textColor"
    | "borderColor"
    | "hoverBackground"
    | "hoverTextColor";
  labelKey: TKey;
}> = [
  { prop: "background", labelKey: "homepage_builder_field_background" },
  { prop: "textColor", labelKey: "homepage_builder_field_text_color" },
  { prop: "borderColor", labelKey: "homepage_builder_field_border_color" },
  {
    prop: "hoverBackground",
    labelKey: "homepage_builder_field_hover_background",
  },
  { prop: "hoverTextColor", labelKey: "homepage_builder_field_hover_text_color" },
];

type DocumentMutation = (document: HomepageDocument) => HomepageDocument;

/** Option labels for the enum selects, in the backend's vocabulary. */
const TEXT_ALIGN_LABEL_KEYS: Record<HorizontalAlign, TKey> = {
  LEFT: "homepage_builder_align_left",
  CENTER: "homepage_builder_align_center",
  RIGHT: "homepage_builder_align_right",
};

const VERTICAL_ALIGN_LABEL_KEYS: Record<VerticalAlign, TKey> = {
  TOP: "homepage_builder_align_top",
  MIDDLE: "homepage_builder_align_middle",
  BOTTOM: "homepage_builder_align_bottom",
};

const BUTTON_VARIANT_LABEL_KEYS: Record<
  (typeof BUTTON_VARIANTS)[number],
  TKey
> = {
  SOLID: "homepage_builder_button_variant_SOLID",
  OUTLINE: "homepage_builder_button_variant_OUTLINE",
  LINK: "homepage_builder_button_variant_LINK",
};

const BUTTON_SIZE_LABEL_KEYS: Record<(typeof BUTTON_SIZES)[number], TKey> = {
  SM: "homepage_builder_button_size_SM",
  MD: "homepage_builder_button_size_MD",
  LG: "homepage_builder_button_size_LG",
};

type HeroSection = Extract<HomepageSection, { type: "HERO" }>;

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

function findElement(
  document: HomepageDocument,
  slideId: string,
  key: HeroElementKey,
): HeroElement | null {
  const slide = findSlide(document, slideId);
  return slide ? slide.elements[key] : null;
}

function localInputToIso(value: string): string | null {
  if (value === "") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Removes one typography property so the element falls back to the design
 * tokens (ledger contract: "removes the property, not sets a default"). The
 * Task 8 mutators only merge style patches and cannot express a removal, so
 * this pure helper deletes the key — and drops a device override that becomes
 * empty. It returns the input document when there was nothing to remove, which
 * makes the dispatching `mutate` a no-op.
 */
function clearStyleProperty(
  document: HomepageDocument,
  slideId: string,
  key: HeroElementKey,
  prop: keyof ElementStyle,
  device: BuilderDevice,
): HomepageDocument {
  const next = structuredClone(document);
  const element = findElement(next, slideId, key);
  if (!element) return document;
  if (device === "desktop") {
    delete element.style[prop];
    return next;
  }
  const override = element.overrides[device];
  if (!override?.style) return document;
  delete override.style[prop];
  if (Object.keys(override.style).length === 0) delete override.style;
  if (!override.style && !override.layout) delete element.overrides[device];
  return next;
}

/**
 * Field primitives shared with `HeroStyleSettings` (same reuse pattern as
 * `LinkPicker`): `Group`, `NumberField`, `ColorField`, `SelectField`.
 * The `ClearButton` stays private to this panel.
 */
export function Group({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}): ReactNode {
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border p-2">
      <h3 className="text-xs font-semibold text-ink">{title}</h3>
      {children}
    </section>
  );
}

function ClearButton({
  label,
  onClick,
}: {
  /** Field label; the accessible name reads "<label>: Reset to inherit". */
  label: string;
  onClick: () => void;
}): ReactNode {
  const { t } = useAdminI18n();
  const name = `${label}: ${t("homepage_builder_clear_inherit")}`;
  return (
    <button
      type="button"
      className="shrink-0 rounded px-1.5 py-1 text-sm text-ink-muted hover:text-sale"
      aria-label={name}
      title={name}
      onClick={onClick}
    >
      ✕
    </button>
  );
}

/**
 * Numeric field: controlled local draft plus an 800 ms coalescing window per
 * (element, field) and a blur flush — one history entry per burst, never one
 * per keystroke. The value is clamped to the backend range on commit.
 *
 * `DecimalInput` is not reused here: it commits on every change (its debounce
 * is for typing ergonomics, not history coalescing) and its draft has no
 * min/max clamp.
 *
 * Exported for the section-level panel (HeroStyleSettings), which uses the
 * same coalescing for the slider behavior durations.
 */
export function NumberField({
  label,
  value,
  min,
  max,
  onCommit,
  onClear,
}: {
  label: string;
  value: number | null | undefined;
  min: number;
  max: number;
  onCommit: (value: number) => void;
  onClear?: () => void;
}): ReactNode {
  const field = useBufferedValue(
    value === null || value === undefined ? "" : String(value),
    (next) => {
      const parsed = Number(next);
      if (!Number.isFinite(parsed)) return;
      onCommit(Math.min(max, Math.max(min, parsed)));
    },
    (next) => NUMBER_DRAFT_PATTERN.test(next),
    NUMBER_COMMIT_DELAY_MS,
  );

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-ink-secondary">{label}</span>
      <div className="flex items-center gap-1">
        <input
          type="text"
          inputMode="decimal"
          className="min-w-0 flex-1 rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-ink"
          aria-label={label}
          value={field.value}
          onChange={(event) => field.change(event.target.value)}
          onBlur={field.blur}
        />
        {onClear ? <ClearButton label={label} onClick={onClear} /> : null}
      </div>
    </div>
  );
}

export function ColorField({
  label,
  value,
  mutate,
  onClear,
}: {
  label: string;
  value: string | null;
  /** Buffered hex path: committed through the race-safe `mutate` action. */
  mutate: (document: HomepageDocument, hex: string) => HomepageDocument;
  onClear?: () => void;
}): ReactNode {
  const { t } = useAdminI18n();
  const field = useBufferedText(
    value ?? "",
    mutate,
    (next) => HEX_COLOR_PATTERN.test(next),
    TEXT_COMMIT_DELAY_MS,
  );
  const swatchLabel = `${label}: ${t("homepage_builder_pick_color")}`;

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-ink-secondary">{label}</span>
      <div className="flex items-center gap-1">
        {/* The swatch is the primary control; an unset (inherited) value shows
            a neutral default and is only written on an actual pick. A pick is
            discrete, so it flushes the same buffered `mutate` path at once. */}
        <input
          type="color"
          className="h-7 w-9 shrink-0 cursor-pointer rounded-lg border border-border bg-card p-0.5"
          aria-label={swatchLabel}
          title={swatchLabel}
          value={swatchColor(value)}
          onChange={(event) => field.flush(event.target.value)}
        />
        <input
          type="text"
          className="min-w-0 flex-1 rounded-lg border border-border bg-card px-2 py-1.5 font-mono text-xs text-ink"
          aria-label={label}
          placeholder="#rrggbb"
          value={field.value}
          onChange={(event) => field.change(event.target.value)}
          onBlur={field.blur}
        />
        {onClear ? <ClearButton label={label} onClick={onClear} /> : null}
      </div>
    </div>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  labelKeys,
  inheritLabel,
  onChange,
  onClear,
}: {
  label: string;
  value: T | undefined;
  options: readonly T[];
  /** Omitted when the option value itself is the label (font weights). */
  labelKeys?: Record<T, TKey>;
  /** When set, an empty option selects "inherit" (removes the property). */
  inheritLabel?: string;
  onChange: (value: T) => void;
  onClear?: () => void;
}): ReactNode {
  const { t } = useAdminI18n();
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-ink-secondary">{label}</span>
      <div className="flex items-center gap-1">
        <select
          className="min-w-0 flex-1 rounded-lg border border-border bg-card px-2 py-1.5 text-xs text-ink"
          aria-label={label}
          value={value ?? ""}
          onChange={(event) => {
            const next = event.target.value;
            if (next === "") {
              onClear?.();
              return;
            }
            onChange(next as T);
          }}
        >
          {inheritLabel !== undefined ? (
            <option value="">{inheritLabel}</option>
          ) : null}
          {options.map((option) => (
            <option key={option} value={option}>
              {labelKeys ? t(labelKeys[option]) : option}
            </option>
          ))}
        </select>
        {onClear ? <ClearButton label={label} onClick={onClear} /> : null}
      </div>
    </div>
  );
}

export function SettingsPanel(): ReactNode {
  const { t } = useAdminI18n();
  const { state, device, selectedSlideId, selectedElementKey } =
    useHomepageEditor();
  const document = state.document;
  const hero = firstHero(document);
  const slide =
    findSlide(document, selectedSlideId) ?? hero?.payload.slides[0] ?? null;

  if (!slide || !selectedElementKey) {
    return (
      <div
        data-panel="settings-panel"
        className="flex min-h-[320px] flex-col gap-3 rounded-xl border border-border bg-card p-4"
      >
        <h2 className="text-sm font-semibold text-ink">
          {t("homepage_builder_pane_settings")}
        </h2>
      </div>
    );
  }

  // Mounted only with a resolved element so every hook in the panel below
  // runs unconditionally (Rules of Hooks). The key carries the full target
  // identity: a slide/element/device switch remounts the panel, whose unmount
  // cleanup cancels pending buffered drafts, so a stale draft can never be
  // committed against the new target.
  return (
    <ElementSettings
      key={`${slide.id}:${selectedElementKey}:${device}`}
      slide={slide}
      elementKey={selectedElementKey}
    />
  );
}

function ElementSettings({
  slide,
  elementKey,
}: {
  slide: HeroSlide;
  elementKey: HeroElementKey;
}): ReactNode {
  const { t } = useAdminI18n();
  const { state, dispatch, device } = useHomepageEditor();
  const document = state.document;
  const key = elementKey;
  const element = slide.elements[key];
  const override = device === "desktop" ? undefined : element.overrides[device];
  const style: ElementStyle =
    device === "desktop" ? element.style : { ...element.style, ...override?.style };
  const layout: ElementLayout =
    device === "desktop"
      ? element.layout
      : { ...element.layout, ...override?.layout };

  const commit = (next: HomepageDocument): void => {
    dispatch({ type: "commit", document: next });
  };
  /**
   * Race-safe dispatch for async/buffered producers: the reducer applies the
   * mutation to its latest document (see `EditorAction.mutate`).
   */
  const applyMutation = (mutate: DocumentMutation): void => {
    dispatch({ type: "mutate", mutate });
  };

  /** Desktop edits hit the base element; device edits hit `overrides[device]`. */
  const styleDocument = (
    doc: HomepageDocument,
    patch: Partial<ElementStyle>,
  ): HomepageDocument =>
    device === "desktop"
      ? updateHeroElement(doc, slide.id, key, { style: patch })
      : setElementOverride(doc, slide.id, key, device, { style: patch });
  const layoutDocument = (
    doc: HomepageDocument,
    patch: Partial<ElementLayout>,
  ): HomepageDocument =>
    device === "desktop"
      ? updateHeroElement(doc, slide.id, key, { layout: patch })
      : setElementOverride(doc, slide.id, key, device, { layout: patch });
  const elementDocument = (
    doc: HomepageDocument,
    patch: HeroElementPatch,
  ): HomepageDocument => updateHeroElement(doc, slide.id, key, patch);

  const mutateStyle = (patch: Partial<ElementStyle>): void =>
    applyMutation((doc) => styleDocument(doc, patch));
  const mutateLayout = (patch: Partial<ElementLayout>): void =>
    applyMutation((doc) => layoutDocument(doc, patch));
  const commitStyle = (patch: Partial<ElementStyle>): void =>
    commit(styleDocument(document, patch));
  const commitLayout = (patch: Partial<ElementLayout>): void =>
    commit(layoutDocument(document, patch));
  const clearStyle = (prop: keyof ElementStyle): void =>
    applyMutation((doc) => clearStyleProperty(doc, slide.id, key, prop, device));

  const textLabel = t(
    key === "offer"
      ? "homepage_builder_field_offer_text"
      : "homepage_builder_field_text",
  );
  const text = useBufferedText(element.text, (doc, next) =>
    updateHeroElement(doc, slide.id, key, { text: next }),
  );

  return (
    <div
      data-panel="settings-panel"
      className="flex min-h-[320px] flex-col gap-3 rounded-xl border border-border bg-card p-4"
    >
      <h2 className="text-sm font-semibold text-ink">
        {t("homepage_builder_pane_settings")}
      </h2>
      <p data-element-key className="truncate text-xs text-ink-muted">
        {key}
      </p>

      <Group title={t("homepage_builder_group_content")}>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-secondary">
            {textLabel}
          </span>
          <textarea
            className="min-h-[64px] rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-ink"
            maxLength={500}
            aria-label={textLabel}
            value={text.value}
            onChange={(event) => text.change(event.target.value)}
            onBlur={text.blur}
          />
        </div>

        {key === "ctaPrimary" || key === "ctaSecondary" ? (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-secondary">
              {t("homepage_builder_field_link")}
            </span>
            <LinkPicker
              value={element.link}
              allowExternal
              onChange={(next) =>
                applyMutation((doc) =>
                  updateHeroElement(doc, slide.id, key, { link: next }),
                )
              }
            />
          </div>
        ) : null}

        {key === "countdown" ? (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-secondary">
              {t("homepage_builder_field_countdown_ends_at")}
            </span>
            <input
              type="datetime-local"
              className="rounded-lg border border-border bg-card px-2 py-1.5 text-xs text-ink"
              aria-label={t("homepage_builder_field_countdown_ends_at")}
              value={
                slide.elements.countdown.endsAt
                  ? isoToLocalInput(slide.elements.countdown.endsAt)
                  : ""
              }
              onChange={(event) =>
                commit(
                  elementDocument(document, {
                    endsAt: localInputToIso(event.target.value),
                  }),
                )
              }
            />
          </div>
        ) : null}
      </Group>

      <Group title={t("homepage_builder_group_typography")}>
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label={t("homepage_builder_field_font_size")}
            value={style.fontSize}
            min={8}
            max={200}
            onCommit={(value) => mutateStyle({ fontSize: value })}
            onClear={() => clearStyle("fontSize")}
          />
          <SelectField
            label={t("homepage_builder_field_font_weight")}
            value={
              style.fontWeight === undefined
                ? undefined
                : (String(style.fontWeight) as FontWeightOption)
            }
            options={FONT_WEIGHT_OPTIONS}
            inheritLabel="—"
            onChange={(value) =>
              commitStyle({ fontWeight: FONT_WEIGHT_VALUES[value] })
            }
            onClear={() => clearStyle("fontWeight")}
          />
          <NumberField
            label={t("homepage_builder_field_line_height")}
            value={style.lineHeight}
            min={0.8}
            max={3}
            onCommit={(value) => mutateStyle({ lineHeight: value })}
            onClear={() => clearStyle("lineHeight")}
          />
          <NumberField
            label={t("homepage_builder_field_letter_spacing")}
            value={style.letterSpacing}
            min={-5}
            max={20}
            onCommit={(value) => mutateStyle({ letterSpacing: value })}
            onClear={() => clearStyle("letterSpacing")}
          />
          <ColorField
            label={t("homepage_builder_field_text_color")}
            value={style.textColor ?? null}
            mutate={(doc, hex) => styleDocument(doc, { textColor: hex })}
            onClear={() => clearStyle("textColor")}
          />
          <SelectField
            label={t("homepage_builder_field_text_align")}
            value={style.textAlign}
            options={TEXT_ALIGNS}
            labelKeys={TEXT_ALIGN_LABEL_KEYS}
            inheritLabel="—"
            onChange={(value) => commitStyle({ textAlign: value })}
            onClear={() => clearStyle("textAlign")}
          />
          <NumberField
            label={t("homepage_builder_field_max_width")}
            value={style.maxWidthPct}
            min={5}
            max={100}
            onCommit={(value) => mutateStyle({ maxWidthPct: value })}
            onClear={() => clearStyle("maxWidthPct")}
          />
        </div>
      </Group>

      <Group title={t("homepage_builder_group_position")}>
        <div className="grid grid-cols-3 gap-2">
          <NumberField
            label={t("homepage_builder_field_x")}
            value={layout.xPct}
            min={0}
            max={100}
            onCommit={(value) => mutateLayout({ xPct: value })}
          />
          <NumberField
            label={t("homepage_builder_field_y")}
            value={layout.yPct}
            min={0}
            max={100}
            onCommit={(value) => mutateLayout({ yPct: value })}
          />
          <NumberField
            label={t("homepage_builder_field_width")}
            value={layout.widthPct}
            min={5}
            max={100}
            onCommit={(value) => mutateLayout({ widthPct: value })}
          />
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <SelectField
            label={t("homepage_builder_field_align")}
            value={layout.align}
            options={TEXT_ALIGNS}
            labelKeys={TEXT_ALIGN_LABEL_KEYS}
            onChange={(value) => commitLayout({ align: value })}
          />
          <SelectField
            label={t("homepage_builder_field_vertical_align")}
            value={layout.verticalAlign}
            options={VERTICAL_ALIGNS}
            labelKeys={VERTICAL_ALIGN_LABEL_KEYS}
            onChange={(value) => commitLayout({ verticalAlign: value })}
          />
          <button
            type="button"
            className="rounded-lg border border-cta/40 px-3 py-1.5 text-xs font-semibold text-cta hover:bg-primary-light/40"
            onClick={() =>
              commit(resetElementLayout(document, slide.id, key))
            }
          >
            {t("homepage_builder_reset_position")}
          </button>
          <label className="flex items-center gap-2 text-xs text-ink">
            <input
              type="checkbox"
              className="h-4 w-4 accent-cta"
              checked={element.locked}
              aria-label={t(
                element.locked
                  ? "homepage_builder_unlock"
                  : "homepage_builder_lock",
              )}
              onChange={(event) =>
                commit(
                  elementDocument(document, { locked: event.target.checked }),
                )
              }
            />
            {t(
              element.locked
                ? "homepage_builder_unlock"
                : "homepage_builder_lock",
            )}
          </label>
        </div>
      </Group>

      {device !== "desktop" ? (
        <Group title={t("homepage_builder_group_responsive")}>
          <p className="text-xs text-ink-muted">
            {t("homepage_builder_override_title")}
          </p>
          <button
            type="button"
            className="self-start rounded-lg border border-cta/40 px-3 py-1.5 text-xs font-semibold text-cta hover:bg-primary-light/40"
            onClick={() =>
              commit(setElementOverride(document, slide.id, key, device, null))
            }
          >
            {t("homepage_builder_override_reset")}
          </button>
        </Group>
      ) : null}

      {key === "offer" ? (
        <Group title={t("homepage_builder_group_offer_chip")}>
          <div className="grid grid-cols-2 gap-2">
            <ColorField
              label={t("homepage_builder_field_background")}
              value={slide.elements.offer.chip.background}
              mutate={(doc, hex) =>
                elementDocument(doc, { chip: { background: hex } })
              }
            />
            <ColorField
              label={t("homepage_builder_field_text_color")}
              value={slide.elements.offer.chip.textColor}
              mutate={(doc, hex) =>
                elementDocument(doc, { chip: { textColor: hex } })
              }
            />
            <NumberField
              label={t("homepage_builder_field_border_radius")}
              value={slide.elements.offer.chip.borderRadius}
              min={0}
              max={48}
              onCommit={(value) =>
                applyMutation((doc) =>
                  elementDocument(doc, { chip: { borderRadius: value } }),
                )
              }
            />
            <NumberField
              label={t("homepage_builder_field_padding_x")}
              value={slide.elements.offer.chip.paddingX}
              min={4}
              max={48}
              onCommit={(value) =>
                applyMutation((doc) =>
                  elementDocument(doc, { chip: { paddingX: value } }),
                )
              }
            />
            <NumberField
              label={t("homepage_builder_field_padding_y")}
              value={slide.elements.offer.chip.paddingY}
              min={2}
              max={32}
              onCommit={(value) =>
                applyMutation((doc) =>
                  elementDocument(doc, { chip: { paddingY: value } }),
                )
              }
            />
          </div>
        </Group>
      ) : null}

      {key === "ctaPrimary" || key === "ctaSecondary" ? (
        <Group title={t("homepage_builder_group_button")}>
          <div className="grid grid-cols-2 gap-2">
            <SelectField
              label={t("homepage_builder_field_button_variant")}
              value={slide.elements[key].button.variant}
              options={BUTTON_VARIANTS}
              labelKeys={BUTTON_VARIANT_LABEL_KEYS}
              onChange={(value) =>
                commit(
                  elementDocument(document, { button: { variant: value } }),
                )
              }
            />
            <SelectField
              label={t("homepage_builder_field_button_size")}
              value={slide.elements[key].button.size}
              options={BUTTON_SIZES}
              labelKeys={BUTTON_SIZE_LABEL_KEYS}
              onChange={(value) =>
                commit(elementDocument(document, { button: { size: value } }))
              }
            />
            {BUTTON_COLOR_FIELDS.map(({ prop, labelKey }) => (
              <ColorField
                key={prop}
                label={t(labelKey)}
                value={slide.elements[key].button[prop]}
                mutate={(doc, hex) =>
                  elementDocument(doc, { button: { [prop]: hex } })
                }
                onClear={() =>
                  commit(
                    elementDocument(document, { button: { [prop]: null } }),
                  )
                }
              />
            ))}
            <NumberField
              label={t("homepage_builder_field_border_radius")}
              value={slide.elements[key].button.borderRadius}
              min={0}
              max={48}
              onCommit={(value) =>
                applyMutation((doc) =>
                  elementDocument(doc, { button: { borderRadius: value } }),
                )
              }
            />
            <NumberField
              label={t("homepage_builder_field_padding_x")}
              value={slide.elements[key].button.paddingX}
              min={4}
              max={48}
              onCommit={(value) =>
                applyMutation((doc) =>
                  elementDocument(doc, { button: { paddingX: value } }),
                )
              }
            />
            <NumberField
              label={t("homepage_builder_field_padding_y")}
              value={slide.elements[key].button.paddingY}
              min={2}
              max={32}
              onCommit={(value) =>
                applyMutation((doc) =>
                  elementDocument(doc, { button: { paddingY: value } }),
                )
              }
            />
          </div>
          {/* Trailing arrow: a discrete toggle → one commit (Task 14 pattern). */}
          <label className="flex items-center gap-2 text-xs text-ink">
            <input
              type="checkbox"
              className="h-4 w-4 accent-cta"
              checked={slide.elements[key].button.arrow === true}
              aria-label={t("homepage_builder_button_arrow")}
              onChange={(event) =>
                commit(
                  elementDocument(document, {
                    button: { arrow: event.target.checked },
                  }),
                )
              }
            />
            {t("homepage_builder_button_arrow")}
          </label>
        </Group>
      ) : null}
    </div>
  );
}
