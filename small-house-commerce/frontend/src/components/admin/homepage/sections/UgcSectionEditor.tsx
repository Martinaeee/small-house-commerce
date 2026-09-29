"use client";

import { useState, useEffect, useRef, type ReactNode } from "react";
import { useAdminI18n } from "@/lib/admin-i18n";
import type { UgcEntry, UgcPayload } from "@/lib/homepage-section-payloads";
import type { SectionPayloadEditorProps } from "@/components/admin/homepage/section-editor-registry";
import { ImageUrlInput } from "@/components/admin/ImageUrlInput";
import { useProductOptions } from "@/components/admin/homepage/sections/SectionProductPicker";

const MAX_ENTRIES = 6;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function newRowId(): string {
  const random = globalThis.crypto?.randomUUID?.();
  return random ? `ugc-${random}` : `ugc-${Date.now()}-${Math.random()}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMediaUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 2048 &&
    (/^https?:\/\/.+/i.test(value) ||
      (value.startsWith("/") && !value.startsWith("//") && value.length > 1))
  );
}

function safeEntries(value: unknown): UgcEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((entry) => ({
      ...(isMediaUrl(entry.imageUrl) ? { imageUrl: entry.imageUrl } : {}),
      name: typeof entry.name === "string" ? entry.name.slice(0, 120) : "",
      ...(typeof entry.location === "string" ? { location: entry.location.slice(0, 120) } : {}),
      comment: typeof entry.comment === "string" ? entry.comment.slice(0, 1000) : "",
      ...(typeof entry.productId === "string" && UUID_PATTERN.test(entry.productId)
        ? { productId: entry.productId }
        : {}),
    }))
    .slice(0, MAX_ENTRIES);
}

function safePayload(value: unknown): UgcPayload {
  if (!isRecord(value)) return {};
  return Array.isArray(value.entries) ? { entries: safeEntries(value.entries) } : {};
}

export function UgcSectionEditor({
  section,
  onPayloadChange,
}: SectionPayloadEditorProps<"UGC">): ReactNode {
  const { t } = useAdminI18n();
  const [productSearch, setProductSearch] = useState("");
  const { products, loading } = useProductOptions(productSearch);
  const payload = safePayload(section.payload);
  const entries = safeEntries(payload.entries);
  const snapshotSignature = `${section.id}:${JSON.stringify(entries)}`;
  const localSnapshotSignature = useRef(snapshotSignature);
  const [rowIds, setRowIds] = useState<string[]>(() => entries.map(() => newRowId()));
  const visibleRowIds = entries.map(
    (_, index) => rowIds[index] ?? `ugc-${section.id}-${index}`,
  );

  useEffect(() => {
    if (snapshotSignature === localSnapshotSignature.current) return;
    localSnapshotSignature.current = snapshotSignature;
    setRowIds(entries.map(() => newRowId()));
  }, [entries, section.id, snapshotSignature]);

  const updateEntry = (rowId: string, patch: Partial<UgcEntry>): void => {
    onPayloadChange((payload) => {
      const currentEntries = safeEntries(safePayload(payload).entries);
      const index = visibleRowIds.indexOf(rowId);
      if (index < 0 || index >= currentEntries.length) return payload;
      const nextEntries = currentEntries.map((entry, entryIndex) => {
        if (entryIndex !== index) return entry;
        const next = { ...entry, ...patch };
        for (const field of ["imageUrl", "location", "productId"] as const) {
          if (patch[field] === undefined) delete next[field];
        }
        return next;
      });
      localSnapshotSignature.current = `${section.id}:${JSON.stringify(nextEntries)}`;
      return { ...safePayload(payload), entries: nextEntries };
    });
  };

  const moveEntry = (rowId: string, delta: -1 | 1): void => {
    onPayloadChange((payload) => {
      const currentEntries = safeEntries(safePayload(payload).entries);
      const index = visibleRowIds.indexOf(rowId);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= currentEntries.length) return payload;
      const nextEntries = [...currentEntries];
      [nextEntries[index], nextEntries[target]] = [nextEntries[target], nextEntries[index]];
      localSnapshotSignature.current = `${section.id}:${JSON.stringify(nextEntries)}`;
      return { ...safePayload(payload), entries: nextEntries };
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

  const removeEntry = (rowId: string): void => {
    onPayloadChange((payload) => {
      const currentEntries = safeEntries(safePayload(payload).entries);
      const index = visibleRowIds.indexOf(rowId);
      if (index < 0) return payload;
      const nextEntries = currentEntries.filter((_, entryIndex) => entryIndex !== index);
      localSnapshotSignature.current = `${section.id}:${JSON.stringify(nextEntries)}`;
      return { ...safePayload(payload), entries: nextEntries };
    });
    setRowIds((current) => current.filter((id) => id !== rowId));
  };

  const addEntry = (): void => {
    const nextRowId = newRowId();
    onPayloadChange((payload) => {
      const currentEntries = safeEntries(safePayload(payload).entries);
      if (currentEntries.length >= MAX_ENTRIES) return payload;
      const nextEntries = [...currentEntries, { name: "", comment: "" }];
      localSnapshotSignature.current = `${section.id}:${JSON.stringify(nextEntries)}`;
      return { ...safePayload(payload), entries: nextEntries };
    });
    if (entries.length < MAX_ENTRIES) setRowIds((current) => [...current, nextRowId]);
  };

  return (
    <section
      data-section-content-editor="UGC"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">{t("homepage_builder_ugc_entries")}</h2>
          <p className="text-xs text-ink-muted">{t("homepage_builder_ugc_limit", { max: MAX_ENTRIES })}</p>
        </div>
        <button
          type="button"
          className="rounded-lg border border-cta/40 px-3 py-1.5 text-sm font-semibold text-cta hover:bg-primary-light/40 disabled:cursor-not-allowed disabled:border-border disabled:text-ink-muted"
          disabled={entries.length >= MAX_ENTRIES}
          onClick={addEntry}
        >
          {t("homepage_builder_ugc_add")}
        </button>
      </div>

      <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
        {t("homepage_builder_product_search")}
        <input
          type="search"
          className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-ink"
          aria-label={t("homepage_builder_product_search")}
          placeholder={t("homepage_builder_product_search")}
          value={productSearch}
          onChange={(event) => setProductSearch(event.target.value)}
        />
      </label>

      {entries.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-xs text-ink-muted">
          {t("homepage_builder_ugc_empty")}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {entries.map((entry, index) => {
            const rowId = visibleRowIds[index];
            return (
              <div
                key={rowId}
                data-testid={`ugc-row-${index}`}
                className="flex flex-col gap-2 rounded-lg border border-border p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-ink-secondary">
                    {t("homepage_builder_ugc_row", { index: index + 1 })}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="rounded px-2 py-1 text-xs text-ink-secondary hover:bg-surface disabled:cursor-not-allowed disabled:text-ink-muted"
                      aria-label={t("homepage_builder_ugc_move_up", { index: index + 1 })}
                      disabled={index === 0}
                      onClick={() => moveEntry(rowId, -1)}
                    >
                      {t("homepage_builder_move_up")}
                    </button>
                    <button
                      type="button"
                      className="rounded px-2 py-1 text-xs text-ink-secondary hover:bg-surface disabled:cursor-not-allowed disabled:text-ink-muted"
                      aria-label={t("homepage_builder_ugc_move_down", { index: index + 1 })}
                      disabled={index === entries.length - 1}
                      onClick={() => moveEntry(rowId, 1)}
                    >
                      {t("homepage_builder_move_down")}
                    </button>
                    <button
                      type="button"
                      className="rounded px-2 py-1 text-xs text-sale hover:bg-sale/10"
                      aria-label={t("homepage_builder_ugc_remove", { index: index + 1 })}
                      onClick={() => removeEntry(rowId)}
                    >
                      {t("homepage_builder_ugc_remove", { index: index + 1 })}
                    </button>
                  </div>
                </div>
                <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
                  {t("homepage_builder_ugc_image", { index: index + 1 })}
                  <ImageUrlInput
                    ariaLabel={t("homepage_builder_ugc_image", { index: index + 1 })}
                    value={entry.imageUrl ?? ""}
                    placeholder={t("homepage_builder_media_url_placeholder")}
                    onChange={(value) => updateEntry(rowId, { imageUrl: value || undefined })}
                    labels={{
                      upload: t("homepage_builder_media_upload_image"),
                      uploading: t("homepage_builder_media_uploading"),
                      invalidType: t("homepage_builder_media_image_invalid"),
                      tooLarge: t("homepage_builder_media_image_too_large"),
                      uploadFailed: t("homepage_builder_media_upload_failed"),
                    }}
                  />
                </label>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
                    {t("homepage_builder_ugc_name", { index: index + 1 })}
                    <input
                      type="text"
                      className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-ink"
                      aria-label={t("homepage_builder_ugc_name", { index: index + 1 })}
                      maxLength={120}
                      required
                      value={entry.name}
                      onChange={(event) => updateEntry(rowId, { name: event.target.value })}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
                    {t("homepage_builder_ugc_location", { index: index + 1 })}
                    <input
                      type="text"
                      className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-ink"
                      aria-label={t("homepage_builder_ugc_location", { index: index + 1 })}
                      maxLength={120}
                      value={entry.location ?? ""}
                      onChange={(event) => updateEntry(rowId, { location: event.target.value || undefined })}
                    />
                  </label>
                </div>
                <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
                  {t("homepage_builder_ugc_comment", { index: index + 1 })}
                  <textarea
                    className="min-h-20 rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-ink"
                    aria-label={t("homepage_builder_ugc_comment", { index: index + 1 })}
                    maxLength={1000}
                    required
                    value={entry.comment}
                    onChange={(event) => updateEntry(rowId, { comment: event.target.value })}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
                  {t("homepage_builder_ugc_product", { index: index + 1 })}
                  <select
                    className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-ink"
                    aria-label={t("homepage_builder_ugc_product", { index: index + 1 })}
                    value={entry.productId ?? ""}
                    disabled={loading}
                    onChange={(event) => updateEntry(rowId, { productId: event.target.value || undefined })}
                  >
                    <option value="">{loading ? t("homepage_builder_product_loading") : t("homepage_builder_product_no_results")}</option>
                    {products.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
