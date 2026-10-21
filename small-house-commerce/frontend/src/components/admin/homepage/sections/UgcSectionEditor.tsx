"use client";

import { useEffect, useState, useRef, type ReactNode } from "react";
import { useAdminI18n, type TKey } from "@/lib/admin-i18n";
import type { UgcCollageVariant, UgcEntry, UgcPayload } from "@/lib/homepage-section-payloads";
import type { SectionPayloadEditorProps } from "@/components/admin/homepage/section-editor-registry";
import { BufferedImageUrlInput } from "@/components/admin/homepage/BufferedSectionField";
import { ProductPickerField } from "@/components/admin/ProductPicker";
import { UgcFocalFrame } from "@/components/admin/homepage/sections/UgcFocalFrame";
import { readUgcPayload } from "@/lib/homepage-section-normalize";
import { makeUgcPresentation, type UgcLayoutChoice } from "@/lib/homepage-content-actions";
import { newUuid } from "@/lib/homepage-document";

const MAX_ENTRIES = 12;

const LAYOUT_CHOICES: { value: UgcLayoutChoice; labelKey: TKey }[] = [
  { value: "CARDS", labelKey: "homepage_builder_ugc_layout_cards" },
  { value: "GRID", labelKey: "homepage_builder_ugc_layout_grid" },
  { value: "STRIP", labelKey: "homepage_builder_ugc_layout_strip" },
  { value: "PORTRAIT", labelKey: "homepage_builder_ugc_layout_portrait" },
];

/**
 * The box the photo is cropped into, so the preview matches the storefront.
 * Measured on the desktop storefront: the collage boxes are viewport
 * dependent, so these are the proportions an operator sees while editing.
 */
function focalAspect(layout: "CARDS" | "COLLAGE", variant: UgcCollageVariant, featured: boolean): string {
  if (layout === "CARDS") return "1 / 1";
  if (variant === "STRIP") return featured ? "3 / 2" : "1 / 1";
  if (variant === "PORTRAIT") return featured ? "4 / 5" : "7 / 6";
  return featured ? "3 / 2" : "4 / 3";
}

function newRowId(): string {
  const random = globalThis.crypto?.randomUUID?.();
  return random ? `ugc-${random}` : `ugc-${Date.now()}-${Math.random()}`;
}

function isMediaUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 2048 &&
    (/^https?:\/\/.+/i.test(value) ||
      (value.startsWith("/") && !value.startsWith("//") && value.length > 1))
  );
}

export function UgcSectionEditor(props: SectionPayloadEditorProps<"UGC">): ReactNode {
  return <UgcEntriesEditor key={props.section.id} {...props} />;
}

function UgcEntriesEditor({
  section,
  onPayloadChange,
}: SectionPayloadEditorProps<"UGC">): ReactNode {
  const { t } = useAdminI18n();
  const payload = readUgcPayload(section.payload);
  const entries = (payload.entries ?? []).slice(0, MAX_ENTRIES);
  const collage = payload.presentation?.layout === "COLLAGE";
  const variant: UgcCollageVariant = payload.presentation?.collageVariant ?? "GRID";
  const choice: UgcLayoutChoice = collage ? variant : "CARDS";
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const [rowIds, setRowIds] = useState<string[]>(() => entries.map(() => newRowId()));
  const visibleRowIds = entries.map(
    (entry, index) => entry.id ?? rowIds[index] ?? `ugc-${section.id}-${index}`,
  );
  const rowIdsRef = useRef(visibleRowIds);
  useEffect(() => {
    rowIdsRef.current = visibleRowIds;
  }, [visibleRowIds]);

  const indexOfEntry = (items: UgcEntry[], rowId: string): number => items.findIndex((entry, index) => (entry.id ?? rowIdsRef.current[index]) === rowId);
  const updateEntry = (rowId: string, patch: Partial<UgcEntry>): void => {
    if (!active.current) return;
    onPayloadChange((payload) => {
      const current = readUgcPayload(payload);
      const currentEntries = (current.entries ?? []).slice(0, MAX_ENTRIES);
      const index = indexOfEntry(currentEntries, rowId);
      if (index < 0) return payload;
      const nextEntries = currentEntries.map((entry, entryIndex) => {
        if (entryIndex !== index) return entry;
        const next = { ...entry, ...patch };
        for (const field of ["imageUrl", "location", "productId", "focalX", "focalY"] as const) {
          if (field in patch && patch[field] === undefined) delete next[field];
        }
        return next;
      });
      return { ...current, entries: nextEntries };
    });
  };

  const moveEntry = (rowId: string, delta: -1 | 1): void => {
    onPayloadChange((payload) => {
      const current = readUgcPayload(payload);
      const currentEntries = (current.entries ?? []).slice(0, MAX_ENTRIES);
      const index = indexOfEntry(currentEntries, rowId);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= currentEntries.length) return payload;
      const nextEntries = [...currentEntries];
      [nextEntries[index], nextEntries[target]] = [nextEntries[target], nextEntries[index]];
      return { ...current, entries: nextEntries };
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
      const current = readUgcPayload(payload);
      const currentEntries = (current.entries ?? []).slice(0, MAX_ENTRIES);
      const index = indexOfEntry(currentEntries, rowId);
      if (index < 0) return payload;
      const nextEntries = currentEntries.filter((_, entryIndex) => entryIndex !== index);
      const next = { ...current, entries: nextEntries };
      if (current.presentation && current.presentation.featuredEntryId === currentEntries[index].id && currentEntries[index].id) {
        const presentation = { ...current.presentation };
        if (nextEntries[0]?.id) presentation.featuredEntryId = nextEntries[0].id;
        else delete presentation.featuredEntryId;
        next.presentation = presentation;
      }
      return next;
    });
    setRowIds((current) => current.filter((id) => id !== rowId));
  };

  const addEntry = (): void => {
    const nextRowId = newUuid();
    onPayloadChange((payload) => {
      const current = readUgcPayload(payload);
      const currentEntries = (current.entries ?? []).slice(0, MAX_ENTRIES);
      if (currentEntries.length >= MAX_ENTRIES) return payload;
      const persistent = current.presentation?.layout === "COLLAGE" || currentEntries.some((entry) => entry.id);
      const nextEntries = [...currentEntries, { ...(persistent ? { id: nextRowId } : {}), name: "", comment: "" }];
      const next = { ...current, entries: nextEntries };
      if (current.presentation?.layout === "COLLAGE" && !current.presentation.featuredEntryId) next.presentation = { ...current.presentation, featuredEntryId: nextRowId };
      return next;
    });
    if (entries.length < MAX_ENTRIES) setRowIds((current) => [...current, nextRowId]);
  };

  const changePresentation = (patch: Partial<NonNullable<UgcPayload["presentation"]>>): void => {
    onPayloadChange((payload) => {
      const current = readUgcPayload(payload);
      if (current.presentation?.layout !== "COLLAGE") return payload;
      if (patch.featuredEntryId && !current.entries?.some((entry) => entry.id === patch.featuredEntryId)) return payload;
      return { ...current, presentation: { ...current.presentation, ...patch } };
    });
  };

  return (
    <section
      data-section-content-editor="UGC"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3"
    >
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-secondary">{t("homepage_builder_ugc_layout")}</span>
        <div className="grid grid-cols-2 gap-2">
          {LAYOUT_CHOICES.map((layout) => <button key={layout.value} type="button"
            data-testid={`ugc-layout-${layout.value}`}
            aria-pressed={layout.value === choice}
            className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border border-border px-3 py-2 text-sm font-medium aria-pressed:border-cta aria-pressed:bg-primary-light/30"
            onClick={() => { if (layout.value !== choice) onPayloadChange((current) => makeUgcPresentation(current, layout.value, newUuid)); }}>
            <span aria-hidden="true">{layout.value === "CARDS" ? "▤ ▤" : layout.value === "STRIP" ? "▣ ▤▤▤" : layout.value === "PORTRAIT" ? "▯ ▦" : "▣ ▦"}</span>
            {t(layout.labelKey)}
          </button>)}
        </div>
      </div>
      {collage ? <div className="flex flex-col gap-3">
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={payload.presentation?.showQuote !== false} onChange={(event) => changePresentation({ showQuote: event.target.checked })} />
          {t("homepage_builder_ugc_show_quote")}
        </label>
        <div className="grid grid-cols-2 gap-2">{(["SOFT", "STRONG"] as const).map((overlay) => <button key={overlay} type="button"
          className="min-h-11 rounded-lg border border-border px-2 py-2 text-sm aria-pressed:border-cta aria-pressed:bg-primary-light/30"
          aria-pressed={(payload.presentation?.overlay ?? "SOFT") === overlay} onClick={() => changePresentation({ overlay })}>
          {t(overlay === "SOFT" ? "homepage_builder_ugc_overlay_soft" : "homepage_builder_ugc_overlay_strong")}
        </button>)}</div>
      </div> : null}
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
                data-entry-id={entry.id}
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
                {collage ? <>
                  <button type="button" className="min-h-11 rounded-lg border border-border px-3 py-2 text-sm aria-pressed:border-cta aria-pressed:bg-primary-light/30"
                    aria-pressed={payload.presentation?.featuredEntryId === entry.id}
                    onClick={() => { if (entry.id) changePresentation({ featuredEntryId: entry.id }); }}>
                    {t("homepage_builder_ugc_set_featured")}
                  </button>
                  {!entry.imageUrl ? <p className="text-xs text-sale">{t("homepage_builder_ugc_photo_needed")}</p> : null}
                  {payload.presentation?.featuredEntryId === entry.id && payload.presentation?.showQuote !== false && !entry.comment.trim()
                    ? <p className="text-xs text-sale">{t("homepage_builder_ugc_quote_needed")}</p> : null}
                </> : !entry.name.trim() || !entry.comment.trim() ? <p role="status" className="text-sm text-sale">{t("homepage_builder_ugc_cards_incomplete")}</p> : null}
                <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
                  {t("homepage_builder_ugc_image", { index: index + 1 })}
                  <BufferedImageUrlInput
                    ariaLabel={t("homepage_builder_ugc_image", { index: index + 1 })}
                    value={entry.imageUrl ?? ""}
                    placeholder={t("homepage_builder_media_url_placeholder")}
                    isValid={(value) => value === "" || isMediaUrl(value)}
                    onCommit={(value) => updateEntry(rowId, { imageUrl: value || undefined })}
                    labels={{
                      upload: t("homepage_builder_media_upload_image"),
                      uploading: t("homepage_builder_media_uploading"),
                      invalidType: t("homepage_builder_media_image_invalid"),
                      tooLarge: t("homepage_builder_media_image_too_large"),
                      uploadFailed: t("homepage_builder_media_upload_failed"),
                    }}
                  />
                </label>
                <UgcFocalFrame
                  imageUrl={entry.imageUrl}
                  focalX={entry.focalX ?? 50}
                  focalY={entry.focalY ?? 50}
                  aspect={focalAspect(collage ? "COLLAGE" : "CARDS", variant, collage && payload.presentation?.featuredEntryId === entry.id)}
                  label={`${t("homepage_builder_ugc_focal")} ${index + 1}`}
                  hint={t("homepage_builder_ugc_focal_hint")}
                  resetLabel={t("homepage_builder_ugc_focal_reset")}
                  testId={`ugc-focal-${index + 1}`}
                  onChange={(focal) => updateEntry(rowId, focal)}
                  onReset={() => updateEntry(rowId, { focalX: undefined, focalY: undefined })}
                />
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
                    {t("homepage_builder_ugc_name", { index: index + 1 })}
                    <input
                      type="text"
                      className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-ink"
                      aria-label={t("homepage_builder_ugc_name", { index: index + 1 })}
                      maxLength={120}
                      required={!collage}
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
                    required={!collage}
                    value={entry.comment}
                    onChange={(event) => updateEntry(rowId, { comment: event.target.value })}
                  />
                </label>
                <ProductPickerField
                  label={t("homepage_builder_ugc_product", { index: index + 1 })}
                  value={entry.productId}
                  onChange={(productId) => updateEntry(rowId, { productId })}
                  scope={`ugc-row-${index + 1}-product`}
                />
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
