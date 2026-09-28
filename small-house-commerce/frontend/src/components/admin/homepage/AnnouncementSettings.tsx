"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAdminI18n, type TKey } from "@/lib/admin-i18n";
import { useHomepageEditor } from "@/components/admin/homepage/HomepageEditor";
import { isoToLocalInput } from "@/lib/datetime-input";
import {
  addAnnouncementItem,
  moveAnnouncementItem,
  removeAnnouncementItem,
  updateAnnouncement,
  updateAnnouncementItem,
  type AnnouncementItem,
  type HomepageDocument,
  type LinkValue,
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

const LINK_TYPES = ["PRODUCT", "COLLECTION", "CATEGORY", "LANDING"] as const;
type InternalLinkType = (typeof LINK_TYPES)[number];
type LinkType = InternalLinkType | "EXTERNAL";

/** Static mapping: `LANDING` stores as `homepage_builder_link_type_LANDING_PAGE`. */
const LINK_TYPE_LABEL_KEYS: Record<LinkType, TKey> = {
  PRODUCT: "homepage_builder_link_type_PRODUCT",
  COLLECTION: "homepage_builder_link_type_COLLECTION",
  CATEGORY: "homepage_builder_link_type_CATEGORY",
  LANDING: "homepage_builder_link_type_LANDING_PAGE",
  EXTERNAL: "homepage_builder_link_type_EXTERNAL",
};

type BufferedText = {
  value: string;
  change(next: string): void;
  blur(): void;
  /** Replaces the buffer without committing (used by type switches). */
  reset(next: string): void;
};

/**
 * Local buffer for a document-backed text input: one commit per typing burst
 * (300 ms) or on blur, never per keystroke. Invalid text is kept while the
 * field has focus (the caller can surface an error) and reverted on blur.
 */
function useBufferedText(
  external: string,
  commit: (next: string) => void,
  isValid: (next: string) => boolean = () => true,
): BufferedText {
  const [value, setValue] = useState(external);
  const [synced, setSynced] = useState(external);
  const commitRef = useRef(commit);
  const externalRef = useRef(external);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Latest values for callbacks that outlive a render (debounce timers).
  useEffect(() => {
    commitRef.current = commit;
    externalRef.current = external;
  });

  // Adopt external changes (undo/redo, another panel) into the buffer.
  if (external !== synced) {
    setSynced(external);
    setValue(external);
  }

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

  const fire = (next: string): void => {
    clearTimer();
    if (isValid(next) && next !== externalRef.current) {
      commitRef.current(next);
    }
  };

  return {
    value,
    change(next) {
      setValue(next);
      clearTimer();
      timer.current = setTimeout(() => {
        timer.current = null;
        fire(next);
      }, TEXT_COMMIT_DELAY_MS);
    },
    blur() {
      clearTimer();
      if (isValid(value)) {
        if (value !== externalRef.current) {
          commitRef.current(value);
        }
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

function linkTextOf(value: LinkValue | null): string {
  if (value === null) return "";
  return value.type === "EXTERNAL" ? value.url : value.id;
}

function isHttpsUrl(text: string): boolean {
  try {
    return new URL(text).protocol === "https:";
  } catch {
    return false;
  }
}

export type LinkControlProps = {
  value: LinkValue | null;
  onChange(value: LinkValue | null): void;
  allowExternal: boolean;
};

/**
 * Minimal inline link control (ledger Ruling 27): type select, id/url input
 * and clear. It keeps the exact interface Task 18's full `LinkPicker` will
 * implement, and is replaced by that component in AnnouncementSettings and
 * SettingsPanel.
 *
 * Incomplete drafts (a type without an id/url yet) stay local — the document
 * only ever receives complete links or `null`.
 */
export function InlineLinkControl({
  value,
  onChange,
  allowExternal,
}: LinkControlProps): ReactNode {
  const { t } = useAdminI18n();
  const [type, setType] = useState<LinkType | "">(value?.type ?? "");
  const [lastSeenType, setLastSeenType] = useState<LinkType | "">(
    value?.type ?? "",
  );

  // Adopt a committed link that arrived from elsewhere (undo, parent patch).
  const committedType = value?.type ?? "";
  if (value !== null && committedType !== lastSeenType) {
    setLastSeenType(committedType);
    setType(committedType);
  }

  const commitLink = (next: LinkValue | null): void => {
    if (JSON.stringify(next) === JSON.stringify(value)) return;
    onChange(next);
  };

  const text = useBufferedText(linkTextOf(value), (next) => {
    const candidate = next.trim();
    if (candidate === "") {
      commitLink(null);
      return;
    }
    if (type === "EXTERNAL") {
      if (isHttpsUrl(candidate)) commitLink({ type: "EXTERNAL", url: candidate });
      return;
    }
    if (type !== "") commitLink({ type, id: candidate });
  });

  const switchType = (nextType: LinkType | ""): void => {
    setType(nextType);
    if (nextType === "") {
      text.reset("");
      commitLink(null);
      return;
    }
    const carried =
      value !== null && value.type === nextType ? linkTextOf(value) : "";
    text.reset(carried);
    if (carried === "") {
      commitLink(null);
      return;
    }
    commitLink(
      nextType === "EXTERNAL"
        ? { type: "EXTERNAL", url: carried }
        : { type: nextType, id: carried },
    );
  };

  const external = type === "EXTERNAL";
  const trimmed = text.value.trim();
  const invalidExternal =
    external && trimmed !== "" && !isHttpsUrl(trimmed);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <select
          className="rounded-lg border border-border bg-card px-2 py-1.5 text-xs text-ink"
          aria-label={t("homepage_builder_link_type")}
          value={type}
          onChange={(event) => switchType(event.target.value as LinkType | "")}
        >
          <option value="">—</option>
          {LINK_TYPES.map((option) => (
            <option key={option} value={option}>
              {t(LINK_TYPE_LABEL_KEYS[option])}
            </option>
          ))}
          {allowExternal ? (
            <option value="EXTERNAL">{t(LINK_TYPE_LABEL_KEYS.EXTERNAL)}</option>
          ) : null}
        </select>
        {type !== "" ? (
          <input
            type="text"
            className="min-w-0 flex-1 rounded-lg border border-border bg-card px-2 py-1.5 font-mono text-xs text-ink"
            aria-label={
              external
                ? t("homepage_builder_link_external_url")
                : `${t(LINK_TYPE_LABEL_KEYS[type])} ID`
            }
            placeholder={external ? "https://…" : "UUID"}
            value={text.value}
            onChange={(event) => text.change(event.target.value)}
            onBlur={text.blur}
          />
        ) : null}
        {value !== null ? (
          <button
            type="button"
            className="shrink-0 rounded px-1.5 py-1 text-sm text-ink-muted hover:text-sale"
            aria-label={t("homepage_builder_link_clear")}
            onClick={() => {
              text.reset("");
              setType("");
              setLastSeenType("");
              commitLink(null);
            }}
          >
            ✕
          </button>
        ) : null}
      </div>
      {invalidExternal ? (
        <p className="text-xs text-sale">
          {t("homepage_builder_link_external_invalid")}
        </p>
      ) : null}
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
}): ReactNode {
  const hex = useBufferedText(value, onChange, (next) =>
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
            onClick={() => onChange(color)}
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
}: {
  document: HomepageDocument;
  item: AnnouncementItem;
  index: number;
  count: number;
  commit: (next: HomepageDocument) => void;
}): ReactNode {
  const { t } = useAdminI18n();

  const text = useBufferedText(item.text, (next) =>
    commit(updateAnnouncementItem(document, item.id, { text: next })),
  );
  const linkLabel = useBufferedText(item.linkLabel ?? "", (next) =>
    commit(
      updateAnnouncementItem(document, item.id, {
        linkLabel: next === "" ? null : next,
      }),
    ),
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
        <InlineLinkControl
          value={item.link}
          allowExternal
          onChange={(next) =>
            commit(updateAnnouncementItem(document, item.id, { link: next }))
          }
        />
      </div>

      <div className="flex flex-wrap gap-3">
        <ColorField
          label={t("homepage_builder_field_text_color")}
          value={item.textColor}
          onChange={(hex) =>
            commit(
              updateAnnouncementItem(document, item.id, { textColor: hex }),
            )
          }
        />
        <ColorField
          label={t("homepage_builder_field_background")}
          value={item.backgroundColor}
          onChange={(hex) =>
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
