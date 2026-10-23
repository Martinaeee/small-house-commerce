"use client";

import { wcagContrast } from "culori";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAdminI18n, type TKey } from "@/lib/admin-i18n";
import { useHomepageEditor } from "@/components/admin/homepage/HomepageEditor";
import { AnnouncementRichTextEditor } from "@/components/admin/homepage/AnnouncementRichTextEditor";
import { LinkPicker } from "@/components/admin/homepage/LinkPicker";
import { AnnouncementBar } from "@/components/layout/AnnouncementBar";
import { isoToLocalInput } from "@/lib/datetime-input";
import {
  addAnnouncementItem,
  moveAnnouncementItem,
  removeAnnouncementItem,
  updateAnnouncement,
  updateAnnouncementItem,
  type AnnouncementCountdownConfig,
  type AnnouncementItem,
  type HomepageDocument,
} from "@/lib/homepage-document";

/**
 * Right pane: the announcement bar editor (mount routed by the shell when the
 * module tree's announcement pseudo-node is selected — ledger Ruling 29).
 *
 * Mirrors the backend schema: at most six items, `rotationMs` 2000–30000 and
 * `#rrggbb` colours. Text fields buffer locally and commit once per typing
 * burst (300 ms) or on blur, so one burst is one undo entry.
 */

const TEXT_COMMIT_DELAY_MS = 300;
const MAX_ANNOUNCEMENT_ITEMS = 6;
const MAX_LINK_LABEL_LENGTH = 40;
const ROTATION_MIN_MS = 2000;
const ROTATION_MAX_MS = 30000;
const ROTATION_STEP_MS = 500;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** Neutral swatch colour shown while a nullable colour field is unset. */
const NEUTRAL_SWATCH_COLOR = "#808080";

/**
 * A native `<input type="color">` needs a concrete `#rrggbb` (and lowercases
 * it): unset or invalid values render the neutral default — without writing
 * anything until the operator actually picks — and stored values are
 * lowercased so React's value matches the control's own normalisation.
 */
export function swatchColor(value: string | null): string {
  return value !== null && HEX_COLOR_PATTERN.test(value)
    ? value.toLowerCase()
    : NEUTRAL_SWATCH_COLOR;
}

/** Preset palette (design spec §3.2): 浅蓝灰 / 淡绿 / 暖米. */
const PALETTE_COLORS = ["#E8EEF4", "#E7F0E7", "#F2EFE9"] as const;

const DEFAULT_COUNTDOWN: AnnouncementCountdownConfig = {
  endsAt: null,
  color: null,
  fontFamily: "SANS",
  fontSize: "MD",
  fontWeight: 700,
};

function previewHref(item: AnnouncementItem): string | null {
  if (!item.link) return null;
  if (item.link.type === "EXTERNAL") return item.link.url;
  if (item.link.type === "INTERNAL") return item.link.path;
  return "#preview-entity-link";
}

type AnnouncementItemIssue = {
  key: TKey;
  vars?: Record<string, string | number>;
};

function announcementItemIssues(
  blockEnabled: boolean,
  item: AnnouncementItem,
  nowMs: number = Date.now(),
): AnnouncementItemIssue[] {
  if (!blockEnabled || !item.enabled) return [];
  const issues: AnnouncementItemIssue[] = [];
  // A rich item's link rides on the whole bar when no label is set, so a
  // missing CTA label is a valid state, not an issue.
  if (item.countdown) {
    if (item.countdown.endsAt === null) {
      issues.push({
        key: "homepage_builder_announcement_issue_deadline_required",
      });
    } else {
      const deadline = Date.parse(item.countdown.endsAt);
      if (!Number.isFinite(deadline) || deadline <= nowMs) {
        issues.push({
          key: "homepage_builder_announcement_issue_deadline_future",
        });
      } else {
        const publishAt = item.schedule.publishAt
          ? Date.parse(item.schedule.publishAt)
          : nowMs;
        const unpublishAt = item.schedule.unpublishAt
          ? Date.parse(item.schedule.unpublishAt)
          : Infinity;
        if (Math.min(deadline, unpublishAt) <= Math.max(nowMs, publishAt)) {
          issues.push({
            key: "homepage_builder_announcement_issue_empty_window",
          });
        }
      }
    }
  }
  const contrast = wcagContrast(item.textColor, item.backgroundColor);
  if (contrast < 4.5) {
    issues.push({
      key: "homepage_builder_announcement_issue_contrast",
      vars: { ratio: contrast.toFixed(2) },
    });
  }
  return issues;
}

type BufferedText = {
  value: string;
  change(next: string): void;
  blur(): void;
  /** Replaces the buffer without committing (used by type switches). */
  reset(next: string): void;
  /** Commits a discrete pick immediately through the same fire path. */
  flush(next: string): void;
};

export type DocumentMutator = (
  document: HomepageDocument,
  next: string,
) => HomepageDocument;

/**
 * Buffer mechanics for a document-backed text input: local state plus a
 * debounce (300 ms by default), one commit per typing burst or on blur, never
 * per keystroke. Invalid text is kept while the field has focus (the caller
 * can surface an error) and reverted on blur.
 *
 * Exported for the element/slide panels (Task 14), which reuse the same
 * mechanics with their own coalescing windows.
 */
export function useBufferedValue(
  external: string,
  fire: (next: string) => void,
  isValid: (next: string) => boolean = () => true,
  delayMs: number = TEXT_COMMIT_DELAY_MS,
): BufferedText {
  const [value, setValue] = useState(external);
  const [synced, setSynced] = useState(external);
  const fireRef = useRef(fire);
  const isValidRef = useRef(isValid);
  const externalRef = useRef(external);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Latest callbacks for debounce timers that outlive a render.
  useEffect(() => {
    fireRef.current = fire;
    isValidRef.current = isValid;
    externalRef.current = external;
  });

  // Adopt external changes (undo/redo, another panel) into the buffer.
  if (external !== synced) {
    setSynced(external);
    setValue(external);
  }

  // A changed external value invalidates any pending draft (undo/redo, another
  // panel, a re-keyed target): cancel the timer so a stale draft can never
  // fire against the newer document state. A real blur still flushes the
  // current draft to its original target before any switch.
  useEffect(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, [external]);

  useEffect(() => {
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);

  const clearTimer = (): void => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const fireNow = (next: string): void => {
    clearTimer();
    if (isValidRef.current(next) && next !== externalRef.current) {
      fireRef.current(next);
    }
  };

  return {
    value,
    change(next) {
      setValue(next);
      clearTimer();
      timer.current = setTimeout(() => {
        timer.current = null;
        fireNow(next);
      }, delayMs);
    },
    blur() {
      clearTimer();
      if (isValidRef.current(value)) {
        fireNow(value);
      } else {
        setValue(externalRef.current);
      }
    },
    reset(next) {
      clearTimer();
      setValue(next);
    },
    flush(next) {
      setValue(next);
      fireNow(next);
    },
  };
}

/**
 * Buffered text that commits by dispatching a `mutate` action, which the
 * reducer applies to its latest document: two timers expiring in the same
 * flush therefore cannot drop each other's edit (a document built from a
 * render-captured snapshot would).
 *
 * Exported for the element/slide panels (Task 14).
 */
export function useBufferedText(
  external: string,
  mutate: DocumentMutator,
  isValid: (next: string) => boolean = () => true,
  delayMs: number = TEXT_COMMIT_DELAY_MS,
): BufferedText {
  const { dispatch } = useHomepageEditor();
  const mutateRef = useRef(mutate);
  useEffect(() => {
    mutateRef.current = mutate;
  });

  return useBufferedValue(
    external,
    (next) => {
      dispatch({
        type: "mutate",
        mutate: (document) => mutateRef.current(document, next),
      });
    },
    isValid,
    delayMs,
  );
}

function ColorField({
  label,
  value,
  mutate,
  onPick,
}: {
  label: string;
  value: string;
  /** Buffered hex text path: race-safe `mutate` applied to the latest document. */
  mutate: DocumentMutator;
  /** Palette click path: immediate synchronous commit. */
  onPick: (hex: string) => void;
}): ReactNode {
  const { t } = useAdminI18n();
  const hex = useBufferedText(value, mutate, (next) =>
    HEX_COLOR_PATTERN.test(next),
  );
  const swatchLabel = `${label}: ${t("homepage_builder_pick_color")}`;

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-ink-secondary">{label}</span>
      <div className="flex items-center gap-1.5">
        <input
          type="color"
          className="h-7 w-9 shrink-0 cursor-pointer rounded-lg border border-border bg-card p-0.5"
          aria-label={swatchLabel}
          title={swatchLabel}
          value={swatchColor(value)}
          onChange={(event) => hex.flush(event.target.value)}
        />
        <input
          type="text"
          className="w-24 rounded-lg border border-border bg-card px-2 py-1 font-mono text-xs text-ink"
          aria-label={label}
          value={hex.value}
          onChange={(event) => hex.change(event.target.value)}
          onBlur={hex.blur}
        />
        {PALETTE_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            title={color}
            aria-label={`${label} ${color}`}
            className={`h-6 w-6 rounded-full border ${
              value.toUpperCase() === color ? "border-cta" : "border-border"
            }`}
            style={{ backgroundColor: color }}
            onClick={() => onPick(color)}
          />
        ))}
      </div>
    </div>
  );
}

export function AnnouncementSettings(): ReactNode {
  const { t } = useAdminI18n();
  const { state, dispatch } = useHomepageEditor();
  const document = state.document;
  const announcement = document.announcement;

  const commit = (next: HomepageDocument): void => {
    dispatch({ type: "commit", document: next });
  };

  /**
   * Race-safe commit for async/buffered producers: the reducer applies the
   * mutation to its latest document (see `EditorAction.mutate`).
   */
  const applyMutation = (
    mutate: (document: HomepageDocument) => HomepageDocument,
  ): void => {
    dispatch({ type: "mutate", mutate });
  };

  const items = [...announcement.items].sort((a, b) => a.sortOrder - b.sortOrder);

  const changeRotation = (raw: string): void => {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return;
    const rotationMs = Math.min(
      ROTATION_MAX_MS,
      Math.max(ROTATION_MIN_MS, parsed),
    );
    if (rotationMs === announcement.rotationMs) return;
    commit(updateAnnouncement(document, { rotationMs }));
  };

  return (
    <div
      data-panel="announcement-settings"
      className="flex min-h-[320px] flex-col gap-3 rounded-xl border border-border bg-card p-4"
    >
      <h2 className="text-sm font-semibold text-ink">
        {t("homepage_builder_announcement_title")}
      </h2>

      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          className="h-4 w-4 accent-cta"
          checked={announcement.enabled}
          aria-label={t("homepage_builder_announcement_enabled")}
          onChange={(event) =>
            commit(updateAnnouncement(document, { enabled: event.target.checked }))
          }
        />
        {t("homepage_builder_announcement_enabled")}
      </label>

      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-secondary">
          {t("homepage_builder_announcement_rotation")}
        </span>
        <div className="flex items-center gap-2">
          <input
            type="range"
            className="min-w-0 flex-1 accent-cta"
            min={ROTATION_MIN_MS}
            max={ROTATION_MAX_MS}
            step={ROTATION_STEP_MS}
            value={announcement.rotationMs}
            aria-label={t("homepage_builder_announcement_rotation")}
            onChange={(event) => changeRotation(event.target.value)}
          />
          <span className="w-14 shrink-0 text-right text-xs tabular-nums text-ink-muted">
            {announcement.rotationMs}
          </span>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-ink-muted">
          {t("homepage_builder_announcement_empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item, index) => (
            <AnnouncementItemCard
              key={item.id}
              document={document}
              item={item}
              index={index}
              count={items.length}
              blockEnabled={announcement.enabled}
              rotationMs={announcement.rotationMs}
              commit={commit}
              applyMutation={applyMutation}
            />
          ))}
        </ul>
      )}

      <button
        type="button"
        className="self-start rounded-lg border border-cta/40 px-3 py-1.5 text-sm font-semibold text-cta hover:bg-primary-light/40 disabled:cursor-not-allowed disabled:border-border disabled:text-ink-muted"
        disabled={items.length >= MAX_ANNOUNCEMENT_ITEMS}
        onClick={() => commit(addAnnouncementItem(document))}
      >
        {t("homepage_builder_announcement_add")}
      </button>
    </div>
  );
}

function AnnouncementItemCard({
  document,
  item,
  index,
  count,
  blockEnabled,
  rotationMs,
  commit,
  applyMutation,
}: {
  document: HomepageDocument;
  item: AnnouncementItem;
  index: number;
  count: number;
  blockEnabled: boolean;
  rotationMs: number;
  commit: (next: HomepageDocument) => void;
  applyMutation: (
    mutate: (document: HomepageDocument) => HomepageDocument,
  ) => void;
}): ReactNode {
  const { t } = useAdminI18n();

  const linkLabel = useBufferedText(item.linkLabel ?? "", (current, next) =>
    updateAnnouncementItem(current, item.id, {
      linkLabel: next === "" ? null : next,
    }),
  );

  const changeSchedule = (
    field: "publishAt" | "unpublishAt",
    value: string,
  ): void => {
    // `datetime-local` yields local wall-clock ("YYYY-MM-DDTHH:mm"); the
    // document stores ISO-8601 with an offset and never the raw input value.
    const parsed = value === "" ? null : new Date(value);
    const iso =
      parsed === null || Number.isNaN(parsed.getTime())
        ? null
        : parsed.toISOString();
    commit(
      updateAnnouncementItem(document, item.id, {
        schedule: { ...item.schedule, [field]: iso },
      }),
    );
  };

  const updateCountdown = (
    patch: Partial<AnnouncementCountdownConfig>,
  ): void => {
    applyMutation((current) => {
      const currentItem = current.announcement.items.find(
        ({ id }) => id === item.id,
      );
      const countdown = currentItem?.countdown ?? DEFAULT_COUNTDOWN;
      return updateAnnouncementItem(current, item.id, {
        countdown: { ...countdown, ...patch },
      });
    });
  };

  const changeCountdownDeadline = (value: string): void => {
    const parsed = value === "" ? null : new Date(value);
    updateCountdown({
      endsAt:
        parsed === null || Number.isNaN(parsed.getTime())
          ? null
          : parsed.toISOString(),
    });
  };

  const issues = announcementItemIssues(blockEnabled, item);

  return (
    <li
      data-item-id={item.id}
      className="flex flex-col gap-2 rounded-lg border border-border p-2"
    >
      <div className="flex items-center gap-1">
        <span className="text-xs font-semibold tabular-nums text-ink-secondary">
          {String(index + 1).padStart(2, "0")}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            className="rounded px-1.5 py-1 text-sm text-ink-muted hover:text-cta disabled:cursor-not-allowed disabled:text-ink-muted/50"
            aria-label={t("homepage_builder_move_up")}
            disabled={index === 0}
            onClick={() => commit(moveAnnouncementItem(document, index, index - 1))}
          >
            ↑
          </button>
          <button
            type="button"
            className="rounded px-1.5 py-1 text-sm text-ink-muted hover:text-cta disabled:cursor-not-allowed disabled:text-ink-muted/50"
            aria-label={t("homepage_builder_move_down")}
            disabled={index === count - 1}
            onClick={() => commit(moveAnnouncementItem(document, index, index + 1))}
          >
            ↓
          </button>
          <input
            type="checkbox"
            className="h-4 w-4 accent-cta"
            checked={item.enabled}
            aria-label={t("homepage_builder_announcement_item_enabled")}
            onChange={(event) =>
              commit(
                updateAnnouncementItem(document, item.id, {
                  enabled: event.target.checked,
                }),
              )
            }
          />
          <button
            type="button"
            className="rounded px-1.5 py-1 text-sm text-ink-muted hover:text-sale"
            aria-label={t("homepage_builder_announcement_item_delete")}
            onClick={() => commit(removeAnnouncementItem(document, item.id))}
          >
            ✕
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-secondary">
          {t("homepage_builder_announcement_text")}
        </span>
        <AnnouncementRichTextEditor
          itemId={item.id}
          content={item.content}
          fallbackText={item.text}
          onChange={(next) =>
            applyMutation((current) =>
              updateAnnouncementItem(current, item.id, {
                text: next.text,
                content: next.content,
              }),
            )
          }
          onUseSelectionAsLinkLabel={(text) =>
            applyMutation((current) =>
              updateAnnouncementItem(current, item.id, {
                linkLabel: text.slice(0, MAX_LINK_LABEL_LENGTH),
              }),
            )
          }
        />
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-secondary">
          {t("homepage_builder_announcement_link_label")}
        </span>
        <input
          type="text"
          className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-ink"
          maxLength={MAX_LINK_LABEL_LENGTH}
          aria-label={t("homepage_builder_announcement_link_label")}
          value={linkLabel.value}
          onChange={(event) => linkLabel.change(event.target.value)}
          onBlur={linkLabel.blur}
        />
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-secondary">
          {t("homepage_builder_field_link")}
        </span>
        <LinkPicker
          value={item.link}
          allowExternal
          allowSubscribe
          onChange={(next) =>
            applyMutation((current) =>
              updateAnnouncementItem(current, item.id, { link: next }),
            )
          }
        />
        {item.link?.type === "SUBSCRIBE" ? (
          <p className="text-xs text-ink-muted">
            {t("homepage_builder_announcement_subscribe_hint")}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-3">
        <ColorField
          label={t("homepage_builder_field_text_color")}
          value={item.textColor}
          mutate={(current, hex) =>
            updateAnnouncementItem(current, item.id, { textColor: hex })
          }
          onPick={(hex) =>
            commit(
              updateAnnouncementItem(document, item.id, { textColor: hex }),
            )
          }
        />
        <ColorField
          label={t("homepage_builder_field_background")}
          value={item.backgroundColor}
          mutate={(current, hex) =>
            updateAnnouncementItem(current, item.id, {
              backgroundColor: hex,
            })
          }
          onPick={(hex) =>
            commit(
              updateAnnouncementItem(document, item.id, {
                backgroundColor: hex,
              }),
            )
          }
        />
      </div>

      <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-2">
        <label className="flex items-center gap-2 text-xs font-medium text-ink-secondary">
          <input
            type="checkbox"
            className="h-4 w-4 accent-cta"
            aria-label={t("homepage_builder_announcement_countdown_enable")}
            checked={item.countdown !== undefined && item.countdown !== null}
            onChange={(event) =>
              applyMutation((current) =>
                updateAnnouncementItem(current, item.id, {
                  countdown: event.target.checked
                    ? structuredClone(DEFAULT_COUNTDOWN)
                    : null,
                }),
              )
            }
          />
          {t("homepage_builder_announcement_countdown_enable")}
        </label>

        {item.countdown ? (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-secondary">
                {t("homepage_builder_announcement_countdown_deadline")}
              </span>
              <input
                type="datetime-local"
                aria-label={t("homepage_builder_announcement_countdown_deadline")}
                className="rounded-lg border border-border bg-card px-2 py-1.5 text-xs text-ink"
                value={
                  item.countdown.endsAt
                    ? isoToLocalInput(item.countdown.endsAt)
                    : ""
                }
                onChange={(event) =>
                  changeCountdownDeadline(event.target.value)
                }
              />
            </label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <label className="flex flex-col gap-1 text-xs text-ink-secondary">
                {t("homepage_builder_announcement_countdown_font")}
                <select
                  aria-label={t("homepage_builder_announcement_countdown_font")}
                  className="rounded border border-border bg-card px-2 py-1.5 text-xs text-ink"
                  value={item.countdown.fontFamily}
                  onChange={(event) =>
                    updateCountdown({
                      fontFamily: event.target.value as "SANS" | "POPPINS",
                    })
                  }
                >
                  <option value="SANS">
                    {t("homepage_builder_announcement_font_storefront")}
                  </option>
                  <option value="POPPINS">
                    {t("homepage_builder_announcement_font_poppins")}
                  </option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-ink-secondary">
                {t("homepage_builder_announcement_countdown_size")}
                <select
                  aria-label={t("homepage_builder_announcement_countdown_size")}
                  className="rounded border border-border bg-card px-2 py-1.5 text-xs text-ink"
                  value={item.countdown.fontSize}
                  onChange={(event) =>
                    updateCountdown({
                      fontSize: event.target.value as "SM" | "MD" | "LG",
                    })
                  }
                >
                  <option value="SM">12px</option>
                  <option value="MD">14px</option>
                  <option value="LG">16px</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-ink-secondary">
                {t("homepage_builder_announcement_countdown_weight")}
                <select
                  aria-label={t("homepage_builder_announcement_countdown_weight")}
                  className="rounded border border-border bg-card px-2 py-1.5 text-xs text-ink"
                  value={item.countdown.fontWeight}
                  onChange={(event) =>
                    updateCountdown({
                      fontWeight: Number(event.target.value) as
                        | 400
                        | 500
                        | 600
                        | 700
                        | 800,
                    })
                  }
                >
                  {[400, 500, 600, 700, 800].map((weight) => (
                    <option key={weight} value={weight}>
                      {weight}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-xs text-ink-secondary">
                {t("homepage_builder_announcement_countdown_color")}
                <input
                  type="color"
                  aria-label={t("homepage_builder_announcement_countdown_color")}
                  className="h-7 w-9 rounded border border-border bg-card p-0.5"
                  value={swatchColor(item.countdown.color)}
                  onChange={(event) =>
                    updateCountdown({ color: event.target.value })
                  }
                />
              </label>
              <button
                type="button"
                className="rounded border border-border px-2 py-1 text-xs text-ink-secondary"
                onClick={() => updateCountdown({ color: null })}
              >
                {t("homepage_builder_announcement_countdown_inherit_color")}
              </button>
            </div>
          </>
        ) : null}
      </fieldset>

      <div className="flex flex-wrap gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-xs font-medium text-ink-secondary">
            {t("homepage_builder_announcement_start")}
          </span>
          <input
            type="datetime-local"
            className="rounded-lg border border-border bg-card px-2 py-1.5 text-xs text-ink"
            aria-label={t("homepage_builder_announcement_start")}
            value={
              item.schedule.publishAt
                ? isoToLocalInput(item.schedule.publishAt)
                : ""
            }
            onChange={(event) => changeSchedule("publishAt", event.target.value)}
          />
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-xs font-medium text-ink-secondary">
            {t("homepage_builder_announcement_end")}
          </span>
          <input
            type="datetime-local"
            className="rounded-lg border border-border bg-card px-2 py-1.5 text-xs text-ink"
            aria-label={t("homepage_builder_announcement_end")}
            value={
              item.schedule.unpublishAt
                ? isoToLocalInput(item.schedule.unpublishAt)
                : ""
            }
            onChange={(event) =>
              changeSchedule("unpublishAt", event.target.value)
            }
          />
        </label>
      </div>

      {issues.length > 0 ? (
        <ul className="rounded-lg bg-sale/10 px-2 py-1.5 text-xs text-sale">
          {issues.map((issue) => (
            <li key={issue.key}>{t(issue.key, issue.vars)}</li>
          ))}
        </ul>
      ) : null}

      <div
        data-testid="announcement-item-preview"
        className="overflow-hidden rounded-lg border border-border"
      >
        <AnnouncementBar
          mode="preview"
          device="desktop"
          data={{
            enabled: true,
            rotationMs,
            items: [
              {
                ...item,
                enabled: true,
                linkHref: previewHref(item),
              },
            ],
          }}
        />
      </div>
    </li>
  );
}
