"use client";

import { useState, type ReactNode } from "react";
import { useAdminI18n } from "@/lib/admin-i18n";
import type { SolutionItem, SolutionsPayload } from "@/lib/homepage-section-payloads";
import type { SectionPayloadEditorProps } from "@/components/admin/homepage/section-editor-registry";
import { BufferedTextInput } from "@/components/admin/homepage/BufferedSectionField";

const MAX_ITEMS = 6;

type SolutionPatch = Partial<SolutionItem>;

function newRowId(): string {
  const random = globalThis.crypto?.randomUUID?.();
  return random ? `solution-${random}` : `solution-${Date.now()}-${Math.random()}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInAppOrHttps(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 2048 &&
    ((value.startsWith("/") && !value.startsWith("//")) ||
      value.startsWith("#") ||
      /^https:\/\/.+/.test(value))
  );
}

function safeItems(value: unknown): SolutionItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((item) => ({
      title: typeof item.title === "string" ? item.title.slice(0, 120) : "",
      ...(typeof item.blurb === "string" ? { blurb: item.blurb.slice(0, 300) } : {}),
      link: isInAppOrHttps(item.link) ? item.link : "",
    }))
    .slice(0, MAX_ITEMS);
}

function safePayload(value: unknown): SolutionsPayload {
  if (!isRecord(value)) return {};
  return Array.isArray(value.items) ? { items: safeItems(value.items) } : {};
}

export function SolutionsSectionEditor({
  section,
  onPayloadChange,
}: SectionPayloadEditorProps<"SOLUTIONS">): ReactNode {
  const { t } = useAdminI18n();
  const payload = safePayload(section.payload);
  const items = safeItems(payload.items);
  const [rowIds, setRowIds] = useState<string[]>(() => items.map(() => newRowId()));
  const visibleRowIds = items.map(
    (_, index) => rowIds[index] ?? `solution-${section.id}-${index}`,
  );

  const updateItem = (rowId: string, patch: SolutionPatch): void => {
    onPayloadChange((payload) => {
      const currentItems = safeItems(safePayload(payload).items);
      const index = visibleRowIds.indexOf(rowId);
      if (index < 0 || index >= currentItems.length) return payload;
      const nextItems = currentItems.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        const next = { ...item, ...patch };
        if ("blurb" in patch && patch.blurb === undefined) delete next.blurb;
        return next;
      });
      return { ...safePayload(payload), items: nextItems };
    });
  };

  const moveItem = (rowId: string, delta: -1 | 1): void => {
    onPayloadChange((payload) => {
      const currentItems = safeItems(safePayload(payload).items);
      const index = visibleRowIds.indexOf(rowId);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= currentItems.length) return payload;
      const nextItems = [...currentItems];
      [nextItems[index], nextItems[target]] = [nextItems[target], nextItems[index]];
      return { ...safePayload(payload), items: nextItems };
    });
    setRowIds((current) => {
      const index = current.indexOf(rowId);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const removeItem = (rowId: string): void => {
    onPayloadChange((payload) => {
      const currentItems = safeItems(safePayload(payload).items);
      const index = visibleRowIds.indexOf(rowId);
      if (index < 0) return payload;
      const nextItems = currentItems.filter((_, itemIndex) => itemIndex !== index);
      return { ...safePayload(payload), items: nextItems };
    });
    setRowIds((current) => current.filter((id) => id !== rowId));
  };

  const addItem = (): void => {
    const nextRowId = newRowId();
    onPayloadChange((payload) => {
      const currentItems = safeItems(safePayload(payload).items);
      if (currentItems.length >= MAX_ITEMS) return payload;
      const nextItems = [...currentItems, { title: "", link: "" }];
      return { ...safePayload(payload), items: nextItems };
    });
    if (items.length < MAX_ITEMS) setRowIds((current) => [...current, nextRowId]);
  };

  return (
    <section
      data-section-content-editor="SOLUTIONS"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">{t("homepage_builder_solutions_items")}</h2>
          <p className="text-xs text-ink-muted">{t("homepage_builder_solutions_limit", { max: MAX_ITEMS })}</p>
        </div>
        <button
          type="button"
          className="rounded-lg border border-cta/40 px-3 py-1.5 text-sm font-semibold text-cta hover:bg-primary-light/40 disabled:cursor-not-allowed disabled:border-border disabled:text-ink-muted"
          disabled={items.length >= MAX_ITEMS}
          onClick={addItem}
        >
          {t("homepage_builder_solutions_add")}
        </button>
      </div>

      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-xs text-ink-muted">
          {t("homepage_builder_solutions_empty")}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((item, index) => {
            const rowId = visibleRowIds[index];
            return (
              <div
                key={rowId}
                data-testid={`solutions-row-${index}`}
                className="flex flex-col gap-2 rounded-lg border border-border p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-ink-secondary">
                    {t("homepage_builder_solutions_row", { index: index + 1 })}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="rounded px-2 py-1 text-xs text-ink-secondary hover:bg-surface disabled:cursor-not-allowed disabled:text-ink-muted"
                      aria-label={t("homepage_builder_solutions_move_up", { index: index + 1 })}
                      disabled={index === 0}
                      onClick={() => moveItem(rowId, -1)}
                    >
                      {t("homepage_builder_move_up")}
                    </button>
                    <button
                      type="button"
                      className="rounded px-2 py-1 text-xs text-ink-secondary hover:bg-surface disabled:cursor-not-allowed disabled:text-ink-muted"
                      aria-label={t("homepage_builder_solutions_move_down", { index: index + 1 })}
                      disabled={index === items.length - 1}
                      onClick={() => moveItem(rowId, 1)}
                    >
                      {t("homepage_builder_move_down")}
                    </button>
                    <button
                      type="button"
                      className="rounded px-2 py-1 text-xs text-sale hover:bg-sale/10"
                      aria-label={t("homepage_builder_solutions_remove", { index: index + 1 })}
                      onClick={() => removeItem(rowId)}
                    >
                      {t("homepage_builder_solutions_remove", { index: index + 1 })}
                    </button>
                  </div>
                </div>
                <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
                  {t("homepage_builder_solutions_title", { index: index + 1 })}
                  <input
                    type="text"
                    className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-ink"
                    aria-label={t("homepage_builder_solutions_title", { index: index + 1 })}
                    maxLength={120}
                    value={item.title}
                    onChange={(event) => updateItem(rowId, { title: event.target.value })}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
                  {t("homepage_builder_solutions_blurb", { index: index + 1 })}
                  <textarea
                    className="min-h-16 rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-ink"
                    aria-label={t("homepage_builder_solutions_blurb", { index: index + 1 })}
                    maxLength={300}
                    value={item.blurb ?? ""}
                    onChange={(event) => updateItem(rowId, { blurb: event.target.value || undefined })}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
                  {t("homepage_builder_solutions_link", { index: index + 1 })}
                  <BufferedTextInput
                    type="text"
                    className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-ink"
                    aria-label={t("homepage_builder_solutions_link", { index: index + 1 })}
                    maxLength={2048}
                    value={item.link}
                    isValid={(value) => value === "" || isInAppOrHttps(value)}
                    commitValidImmediately
                    onCommit={(value) => updateItem(rowId, { link: value })}
                  />
                </label>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
