"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAdminI18n } from "@/lib/admin-i18n";
import { useHomepageEditor } from "@/components/admin/homepage/HomepageEditor";
import { LinkPicker } from "@/components/admin/homepage/LinkPicker";
import { isoToLocalInput } from "@/lib/datetime-input";
import {
  addAnnouncementItem,
  moveAnnouncementItem,
  removeAnnouncementItem,
  updateAnnouncement,
  updateAnnouncementItem,
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
const MAX_ITEM_TEXT_LENGTH = 200;
const MAX_LINK_LABEL_LENGTH = 40;
const ROTATION_MIN_MS = 2000;
const ROTATION_MAX_MS = 30000;
const ROTATION_STEP_MS = 500;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** Preset palette (design spec §3.2): 浅蓝灰 / 淡绿 / 暖米. */
const PALETTE_COLORS = ["#E8EEF4", "#E7F0E7", "#F2EFE9"] as const;

type BufferedText = {
  value: string;
  change(next: string): void;
  blur(): void;
  /** Replaces the buffer without committing (used by type switches). */
  reset(next: string): void;
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
  /** Swatch click path: immediate synchronous commit. */
  onPick: (hex: string) => void;
}): ReactNode {
  const hex = useBufferedText(value, mutate, (next) =>
    HEX_COLOR_PATTERN.test(next),
  );

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-ink-secondary">{label}</span>
      <div className="flex items-center gap-1.5">
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
  commit,
  applyMutation,
}: {
  document: HomepageDocument;
  item: AnnouncementItem;
  index: number;
  count: number;
  commit: (next: HomepageDocument) => void;
  applyMutation: (
    mutate: (document: HomepageDocument) => HomepageDocument,
  ) => void;
}): ReactNode {
  const { t } = useAdminI18n();

  const text = useBufferedText(item.text, (current, next) =>
    updateAnnouncementItem(current, item.id, { text: next }),
  );
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
        <input
          type="text"
          className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-ink"
          maxLength={MAX_ITEM_TEXT_LENGTH}
          aria-label={t("homepage_builder_announcement_text")}
          value={text.value}
          onChange={(event) => text.change(event.target.value)}
          onBlur={text.blur}
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
          onChange={(next) =>
            applyMutation((current) =>
              updateAnnouncementItem(current, item.id, { link: next }),
            )
          }
        />
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
    </li>
  );
}
