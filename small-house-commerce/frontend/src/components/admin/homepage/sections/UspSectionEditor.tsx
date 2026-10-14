"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAdminI18n, type TKey } from "@/lib/admin-i18n";
import type { UspIcon, UspItem } from "@/lib/homepage-section-payloads";
import type { SectionPayloadEditorProps } from "@/components/admin/homepage/section-editor-registry";

const MAX_ITEMS = 4;
const ICONS = ["shield", "home", "lock", "truck"] as const satisfies readonly UspIcon[];
const ICON_LABEL_KEYS: Record<UspIcon, TKey> = {
  shield: "homepage_builder_usp_icon_shield",
  home: "homepage_builder_usp_icon_home",
  lock: "homepage_builder_usp_icon_lock",
  truck: "homepage_builder_usp_icon_truck",
};

function newRowId(): string {
  const random = globalThis.crypto?.randomUUID?.();
  return random ? `usp-${random}` : `usp-${Date.now()}-${Math.random()}`;
}

/**
 * USP rows have no persisted id in the legacy payload. The ids live only in
 * this editor and are updated alongside add/remove/reorder actions, so React
 * keys follow a row without adding non-schema data to the document.
 */

function safeUspItems(value: unknown): UspItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Record<string, unknown> =>
      typeof item === "object" && item !== null && !Array.isArray(item),
  ).map((item) => ({
    ...(item.icon === "shield" ||
    item.icon === "home" ||
    item.icon === "lock" ||
    item.icon === "truck"
      ? { icon: item.icon }
      : {}),
    label: typeof item.label === "string" ? item.label : "",
    ...(typeof item.sub === "string" ? { sub: item.sub } : {}),
  }));
}

export function UspSectionEditor({
  section,
  onPayloadChange,
}: SectionPayloadEditorProps<"USP">): ReactNode {
  const { t } = useAdminI18n();
  const items = safeUspItems(section.payload.items);
  const snapshotSignature = `${section.id}:${JSON.stringify(items)}`;
  const localSnapshotSignature = useRef(snapshotSignature);
  const [rowIds, setRowIds] = useState<string[]>(() =>
    items.map(() => newRowId()),
  );
  const visibleRowIds = items.map(
    (_, index) => rowIds[index] ?? `usp-${section.id}-${index}`,
  );
  const [touchedRows, setTouchedRows] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (snapshotSignature === localSnapshotSignature.current) return;
    localSnapshotSignature.current = snapshotSignature;
    setRowIds(items.map(() => newRowId()));
    setTouchedRows(new Set());
  }, [items, section.id, snapshotSignature]);

  const updateItem = (rowId: string, patch: Partial<UspItem>): void => {
    onPayloadChange((payload) => {
      const currentItems = safeUspItems(payload.items);
      const index = visibleRowIds.indexOf(rowId);
      if (index < 0 || index >= currentItems.length) return payload;
      const nextItems = currentItems.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      );
      localSnapshotSignature.current = `${section.id}:${JSON.stringify(nextItems)}`;
      return {
        ...payload,
        items: nextItems,
      };
    });
  };

  const moveItem = (rowId: string, delta: -1 | 1): void => {
    onPayloadChange((payload) => {
      const currentItems = safeUspItems(payload.items);
      const index = visibleRowIds.indexOf(rowId);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= currentItems.length) return payload;
      const nextItems = [...currentItems];
      [nextItems[index], nextItems[target]] = [nextItems[target], nextItems[index]];
      localSnapshotSignature.current = `${section.id}:${JSON.stringify(nextItems)}`;
      return { ...payload, items: nextItems };
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
      const currentItems = safeUspItems(payload.items);
      const index = visibleRowIds.indexOf(rowId);
      if (index < 0) return payload;
      const nextItems = currentItems.filter((_, itemIndex) => itemIndex !== index);
      localSnapshotSignature.current = `${section.id}:${JSON.stringify(nextItems)}`;
      return {
        ...payload,
        items: nextItems,
      };
    });
    setRowIds((current) => current.filter((id) => id !== rowId));
    setTouchedRows((current) => {
      const next = new Set(current);
      next.delete(rowId);
      return next;
    });
  };

  const addItem = (): void => {
    const nextRowId = newRowId();
    onPayloadChange((payload) => {
      const currentItems = safeUspItems(payload.items);
      if (currentItems.length >= MAX_ITEMS) return payload;
      const nextItems: UspItem[] = [
        ...currentItems,
        { icon: "shield", label: "" },
      ];
      localSnapshotSignature.current = `${section.id}:${JSON.stringify(nextItems)}`;
      return {
        ...payload,
        items: nextItems,
      };
    });
    setRowIds((current) => [...current, nextRowId]);
  };

  return (
    <section
      data-section-content-editor="USP"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">
            {t("homepage_builder_usp_items")}
          </h2>
          <p className="text-xs text-ink-muted">
            {t("homepage_builder_usp_limit", { max: MAX_ITEMS })}
          </p>
        </div>
        <button
          type="button"
          className="rounded-lg border border-cta/40 px-3 py-1.5 text-sm font-semibold text-cta hover:bg-primary-light/40 disabled:cursor-not-allowed disabled:border-border disabled:text-ink-muted"
          disabled={items.length >= MAX_ITEMS}
          onClick={addItem}
        >
          {t("homepage_builder_usp_add")}
        </button>
      </div>

      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-xs text-ink-muted">
          {t("homepage_builder_usp_empty")}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((item, index) => {
            const rowId = visibleRowIds[index];
            const invalid = touchedRows.has(rowId) && item.label.trim() === "";
            return (
              <div
                key={rowId}
                data-testid={`usp-item-row-${index}`}
                className="flex flex-col gap-2 rounded-lg border border-border p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-ink-secondary">
                    {t("homepage_builder_usp_row", { index: index + 1 })}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="rounded px-2 py-1 text-xs text-ink-secondary hover:bg-surface disabled:cursor-not-allowed disabled:text-ink-muted"
                      aria-label={t("homepage_builder_usp_move_up", { index: index + 1 })}
                      disabled={index === 0}
                      onClick={() => moveItem(rowId, -1)}
                    >
                      {t("homepage_builder_move_up")}
                    </button>
                    <button
                      type="button"
                      className="rounded px-2 py-1 text-xs text-ink-secondary hover:bg-surface disabled:cursor-not-allowed disabled:text-ink-muted"
                      aria-label={t("homepage_builder_usp_move_down", { index: index + 1 })}
                      disabled={index === items.length - 1}
                      onClick={() => moveItem(rowId, 1)}
                    >
                      {t("homepage_builder_move_down")}
                    </button>
                    <button
                      type="button"
                      className="rounded px-2 py-1 text-xs text-sale hover:bg-sale/10 disabled:cursor-not-allowed disabled:text-ink-muted"
                      aria-label={t("homepage_builder_usp_remove", { index: index + 1 })}
                      disabled={items.length <= 0}
                      onClick={() => removeItem(rowId)}
                    >
                      {t("homepage_builder_usp_remove", { index: index + 1 })}
                    </button>
                  </div>
                </div>

                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]">
                  <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
                    {t("homepage_builder_usp_label", { index: index + 1 })}
                    <input
                      type="text"
                      className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-ink"
                      aria-label={t("homepage_builder_usp_label", { index: index + 1 })}
                      aria-invalid={invalid}
                      value={item.label}
                      maxLength={120}
                      required
                      onChange={(event) => {
                        const value = event.target.value;
                        updateItem(rowId, { label: value });
                        if (value.trim() !== "") {
                          setTouchedRows((current) => {
                            const next = new Set(current);
                            next.delete(rowId);
                            return next;
                          });
                        }
                      }}
                      onBlur={() =>
                        setTouchedRows((current) => {
                          const next = new Set(current);
                          next.add(rowId);
                          return next;
                        })
                      }
                    />
                    {invalid ? (
                      <span className="text-xs font-normal text-sale">
                        {t("homepage_builder_usp_label_required")}
                      </span>
                    ) : null}
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
                    {t("homepage_builder_usp_icon", { index: index + 1 })}
                    <select
                      className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-ink"
                      aria-label={t("homepage_builder_usp_icon", { index: index + 1 })}
                      value={item.icon ?? "shield"}
                      onChange={(event) =>
                        updateItem(rowId, {
                          icon: event.target.value as UspIcon,
                        })
                      }
                    >
                      {ICONS.map((icon) => (
                        <option key={icon} value={icon}>
                          {t(ICON_LABEL_KEYS[icon])}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
                  {t("homepage_builder_usp_sub", { index: index + 1 })}
                  <input
                    type="text"
                    className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-ink"
                    aria-label={t("homepage_builder_usp_sub", { index: index + 1 })}
                    value={item.sub ?? ""}
                    maxLength={200}
                    onChange={(event) =>
                      updateItem(rowId, {
                        sub: event.target.value || undefined,
                      })
                    }
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
